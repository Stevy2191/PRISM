// Tickets from the agent's tray app (8a, task 5).
//
// The tray's "Submit a ticket" form is filled from whoami (who is signed in,
// their company and computer) and posts a subject, a description and a
// health snapshot. The ticket is raised in the device's company, linked to
// its Asset, with source 'agent', through the normal new-ticket path (SLA,
// workflow rules, notifications).
//
// The requester is the signed-in user's contact, matched by UPN or email
// within the device's company only. With no match it is the company's
// "Unknown tray user" placeholder (owner decision 2026-11-03: every ticket
// needs a contact), and the description says who raised it from where, so
// staff can set the right person. No other contact is ever created.
//
// The health snapshot becomes a private note. Everything the tray sends is
// untrusted text: type-checked, cleaned and cut.
const {
  sequelize, Asset, Company, Contact, Comment, Department, SystemSettings,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { createTicket } = require('../tickets/ticketWrite');
const { getSystemActorUserId } = require('../inboundEmailService');
const { matchContact } = require('./inventory');

const PLACEHOLDER_NAME = 'Unknown tray user';
const MAX_DESCRIPTION = 20000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, max) : null); // eslint-disable-line no-control-regex
const line = (v, max = 255) => (clean(v, max) || '').replace(/[\r\n\t]+/g, ' ') || null;

// Who is asking: the Windows account (DOMAIN\user) and, when known, the UPN.
function parseUser(source) {
  const s = source || {};
  const account = line(s.account);
  const upn = typeof s.upn === 'string' && EMAIL.test(s.upn.trim()) ? s.upn.trim().slice(0, 255) : null;
  const email = typeof s.email === 'string' && EMAIL.test(s.email.trim()) ? s.email.trim().slice(0, 255) : null;
  return { account, upn, email };
}

// The company's placeholder, created on first use. The company row is locked
// so two tray tickets at once can't create two.
async function placeholderFor(companyId) {
  return sequelize.transaction(async (transaction) => {
    await Company.findByPk(companyId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
    const found = await Contact.findOne({ where: { companyId, isPlaceholder: true }, order: [['id', 'ASC']], transaction });
    if (found) return found;
    return Contact.create({
      firstName: 'Unknown',
      lastName: 'tray user',
      displayName: PLACEHOLDER_NAME,
      email: null,
      companyId,
      isPlaceholder: true,
      portalAccess: false,
      notes: 'Requester of tickets raised from the PRISM agent by people who match no contact. Each ticket says who raised it.',
    }, { transaction });
  });
}

// The help desk's own details, for the form and the offline message.
async function helpdesk() {
  const rows = await SystemSettings.findAll({
    where: { key: ['branding.appName', 'company.name', 'portal.enabled', 'inboundEmail.enabled', 'inboundEmail.address'] },
    raw: true,
  });
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const base = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return {
    name: v['company.name'] || v['branding.appName'] || 'PRISM',
    email: v['inboundEmail.enabled'] === 'true' && v['inboundEmail.address'] ? v['inboundEmail.address'] : null,
    portalUrl: v['portal.enabled'] === 'true' && base ? `${base}/portal` : null,
  };
}

async function deviceAsset(device) {
  const asset = await Asset.findByPk(device.assetId, { attributes: ['id', 'name', 'companyId'] });
  if (!asset) throw new ApiError(404, 'This device has no Asset', 'NOT_FOUND');
  return asset;
}

// → { name, company, department, computer, helpdesk }
async function whoami(device, query) {
  const user = parseUser(query);
  const asset = await deviceAsset(device);
  const [company, contact, desk] = await Promise.all([
    Company.findByPk(asset.companyId, { attributes: ['name'] }),
    matchContact(asset.companyId, user),
    helpdesk(),
  ]);
  let full = null;
  if (contact) full = await Contact.findByPk(contact.id, { include: [{ model: Department, as: 'department', attributes: ['name'] }] });
  return {
    name: full ? full.displayName : user.account,
    company: company ? company.name : null,
    department: full && full.department ? full.department.name : null,
    computer: asset.name,
    helpdesk: desk,
  };
}

// The health snapshot as a readable private note.
const GB = 1024 ** 3;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const gb = (b) => `${(b / GB).toFixed(b >= 100 * GB ? 0 : 1)} GB`;

function snapshotNote(snap, computer) {
  const s = snap && typeof snap === 'object' ? snap : {};
  const out = [`Health snapshot from ${computer}`];
  const add = (label, value) => { if (value) out.push(`${label}: ${value}`); };
  const os = s.os && typeof s.os === 'object' ? s.os : {};
  add('OS', [line(os.name, 100), line(os.version, 30), line(os.build, 30) && `(build ${line(os.build, 30)})`].filter(Boolean).join(' '));
  const up = num(s.uptimeSec);
  if (up !== null) add('Uptime', `${Math.floor(up / 86400)} d ${Math.floor((up % 86400) / 3600)} h ${Math.floor((up % 3600) / 60)} min`);
  const mem = s.memory && typeof s.memory === 'object' ? s.memory : {};
  if (num(mem.usedBytes) !== null && num(mem.totalBytes)) {
    add('Memory in use', `${gb(mem.usedBytes)} of ${gb(mem.totalBytes)} (${Math.round((100 * mem.usedBytes) / mem.totalBytes)}%)`);
  }
  (Array.isArray(s.disks) ? s.disks : []).slice(0, 16).forEach((d) => {
    const name = line(d && d.name, 64);
    if (name && num(d.freeBytes) !== null && num(d.sizeBytes)) add(`Free on ${name}`, `${gb(d.freeBytes)} of ${gb(d.sizeBytes)}`);
  });
  add('Signed in', line(s.signedInUser));
  add('Domain', line(s.domain));
  add('Directory', line(s.directory));
  add('Realm', line(s.realm));
  const ips = (Array.isArray(s.ipAddresses) ? s.ipAddresses : []).map((ip) => line(ip, 64)).filter(Boolean).slice(0, 16);
  if (ips.length) add('IP addresses', ips.join(', '));
  add('Agent version', line(s.agentVersion, 50));
  const at = typeof s.takenAt === 'string' && !Number.isNaN(Date.parse(s.takenAt)) ? new Date(s.takenAt).toISOString() : null;
  add('Taken', at);
  return out.join('\n');
}

// → { ticketId, number, replyTo }
async function raiseTrayTicket(device, body, req) {
  const b = body || {};
  const subject = line(b.subject);
  if (!subject) throw new ApiError(400, 'A subject is required', 'VALIDATION_ERROR');
  const description = clean(b.description, MAX_DESCRIPTION);
  const user = parseUser(b);
  const asset = await deviceAsset(device);

  const matched = await matchContact(asset.companyId, user);
  const contact = matched ? await Contact.findByPk(matched.id) : await placeholderFor(asset.companyId);
  const raisedBy = `Raised from ${asset.name} by ${user.account || user.upn || 'an unknown user'}`;
  const fullDescription = matched ? (description || raisedBy) : [raisedBy, description].filter(Boolean).join('\n\n');

  const actorId = await getSystemActorUserId();
  if (!actorId) throw new ApiError(503, 'The help desk is not ready: no administrator account exists', 'NO_SYSTEM_ACTOR');
  const ticket = await createTicket({ id: actorId }, {
    title: subject,
    description: fullDescription,
    contactId: contact.id,
    assetIds: [asset.id],
  }, {
    req, createdById: actorId, source: 'agent', portal: { contact },
  });
  await Comment.create({
    body: snapshotNote(b.snapshot, asset.name), authorId: actorId, ticketId: ticket.id, type: 'comment_private',
  });
  // Where the help desk's replies go, for the tray's "Ticket sent" screen:
  // the matched contact's email; none for the placeholder.
  return { ticketId: ticket.id, number: String(ticket.id).padStart(5, '0'), replyTo: matched ? contact.email : null };
}

module.exports = {
  whoami, raiseTrayTicket, placeholderFor, snapshotNote, PLACEHOLDER_NAME,
};
