// Ticket attachments: list, upload, download, delete.
const fs = require('fs');
const path = require('path');
const { Ticket, Attachment, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { logActivity } = require('../../services/ticketActivity');
const { parsePagination, paginated } = require('../../utils/pagination');
const { canAccessTicket, canModerateTicketContent } = require('../../services/permissionService');
const { userAttrs, SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

// ---- Attachments ----

// GET /tickets/:id/attachments
const listAttachments = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await Attachment.findAndCountAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  res.json(paginated('attachments', { rows, count }, { page, limit }));
});

// POST /tickets/:id/attachments — multipart/form-data (field: "file")
const createAttachment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) {
    // Clean up the orphaned upload if the ticket doesn't exist.
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  }
  if (!(await canAccessTicket(req.user, ticket))) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');
  }

  const attachment = await Attachment.create({
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    ticketId: ticket.id,
    uploadedById: req.user.id,
  });
  await writeAudit(req, 'attachment.create', 'Attachment', attachment.id, {
    ticketId: ticket.id,
    originalName: attachment.originalName,
  });
  await logActivity(ticket.id, req.user.id, 'attachment_added', null, attachment.originalName);
  res.status(201).json({ attachment });
});

// GET /tickets/:id/attachments/:attachmentId/download
const downloadAttachment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const attachment = await Attachment.findOne({
    where: { id: req.params.attachmentId, ticketId: ticket.id },
  });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');

  const filePath = path.join(UPLOAD_ROOT, String(ticket.id), attachment.filename);
  if (!fs.existsSync(filePath)) {
    throw new ApiError(404, 'File missing from storage', 'FILE_MISSING');
  }
  res.download(filePath, attachment.originalName);
});

// DELETE /tickets/:id/attachments/:attachmentId
const removeAttachment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const attachment = await Attachment.findOne({
    where: { id: req.params.attachmentId, ticketId: ticket.id },
  });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  if (attachment.uploadedById !== req.user.id && !(await canModerateTicketContent(req.user, ticket))) {
    throw new ApiError(403, 'You can only remove your own attachments', 'FORBIDDEN');
  }

  const filePath = path.join(UPLOAD_ROOT, String(ticket.id), attachment.filename);
  await attachment.destroy();
  fs.rm(filePath, { force: true }, () => {});
  await writeAudit(req, 'attachment.delete', 'Attachment', attachment.id, { ticketId: ticket.id });
  res.json({ ok: true });
});

module.exports = {
  listAttachments,
  createAttachment,
  downloadAttachment,
  removeAttachment,
};
