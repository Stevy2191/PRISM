// Files and screenshots from the tray's Submit a ticket window (9, owner
// 2026-11-11). The agent's service sends each one as its own signed request
// right after the ticket is created: the raw bytes, the name in the (signed)
// query. They go through the same checks as any ticket attachment: blocked
// extensions, the content check, the configured size limit and the virus
// scan (routes/agent.js chains the upload middleware).
//
// A device may only attach to a ticket it raised itself from the tray (the
// ticket is linked to its Asset and came from the agent), within 30 minutes
// of raising it, and at most MAX_FILES files. Anything else looks like a
// missing ticket.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Ticket, AssetTicket, Attachment } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../ticketActivity');
const { getSystemActorUserId } = require('../inboundEmailService');

const { UPLOAD_ROOT, BLOCKED_EXTENSIONS } = require('../../middleware/upload');
const MAX_FILES = 5;
const WINDOW_MS = 30 * 60 * 1000;
const MAX_BYTES = 25 * 1024 * 1024;

const notFound = () => new ApiError(404, 'Ticket not found', 'NOT_FOUND');

// A safe display name: the last path part, no control characters, at most
// 200 characters (the extension kept). Never used as a path on disk.
function cleanName(raw) {
  let name = typeof raw === 'string' ? raw : '';
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim(); // eslint-disable-line no-control-regex
  if (!name || name === '.' || name === '..') name = 'attachment';
  if (name.length > 200) {
    const ext = path.extname(name).slice(0, 20);
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name;
}

// The ticket this device may still attach to, or a 404.
async function trayTicketFor(device, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  const ticket = await Ticket.findByPk(id, { attributes: ['id', 'source', 'createdAt', 'companyId'] });
  if (!ticket || ticket.source !== 'agent' || Date.now() - new Date(ticket.createdAt).getTime() > WINDOW_MS) throw notFound();
  const linked = await AssetTicket.findOne({ where: { ticketId: ticket.id, assetId: device.assetId } });
  if (!linked) throw notFound();
  const count = await Attachment.count({ where: { ticketId: ticket.id } });
  if (count >= MAX_FILES) throw new ApiError(400, `At most ${MAX_FILES} files can be attached from the tray`, 'TOO_MANY_FILES');
  return ticket;
}

// Middleware: checks the ticket, then writes the signed body to the
// ticket's upload folder as a randomly named file and sets req.file the way
// multer would, so the usual checks (verifyFileSignature,
// enforceMaxAttachmentSize, scanUpload) run next.
async function receiveTrayFile(req, res, next) {
  try {
    const ticket = await trayTicketFor(req.device, req.params.id);
    const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
    if (!body || !body.length) throw new ApiError(400, 'The file is empty', 'NO_FILE');
    const originalname = cleanName(req.query.name);
    const ext = path.extname(originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) throw new ApiError(400, `File type ${ext} is not allowed`, 'INVALID_FILE_TYPE');
    const dir = path.join(UPLOAD_ROOT, String(ticket.id));
    await fs.promises.mkdir(dir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(originalname)}`;
    const file = path.join(dir, filename);
    await fs.promises.writeFile(file, body, { flag: 'wx' });
    const type = typeof req.query.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(req.query.type) ? req.query.type.slice(0, 100) : 'application/octet-stream';
    req.trayTicket = ticket;
    req.file = {
      path: file, filename, originalname, size: body.length, mimetype: type,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// The Attachment record, once every check passed.
async function saveTrayAttachment(req) {
  const actorId = await getSystemActorUserId();
  const attachment = await Attachment.create({
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    ticketId: req.trayTicket.id,
    uploadedById: actorId,
  });
  await writeAudit({ user: null, ip: req.ip }, 'attachment.create', 'Attachment', attachment.id, {
    ticketId: req.trayTicket.id, originalName: attachment.originalName, deviceId: req.device.id, source: 'agent',
  });
  await logActivity(req.trayTicket.id, actorId, 'attachment_added', null, attachment.originalName);
  return { id: attachment.id, name: attachment.originalName, size: attachment.size };
}

module.exports = {
  receiveTrayFile, saveTrayAttachment, cleanName, MAX_FILES, MAX_BYTES, WINDOW_MS,
};
