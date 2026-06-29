const fs = require('fs');
const path = require('path');
const {
  Ticket,
  Comment,
  Attachment,
  TimeEntry,
  TicketRelation,
  CsatResponse,
  Team,
  CustomField,
  TicketFieldValue,
  User,
  Project,
  Department,
  sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { UPLOAD_ROOT } = require('../middleware/upload');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const ticketInclude = [
  { model: User, as: 'assignee', attributes: userAttrs },
  { model: User, as: 'requester', attributes: userAttrs },
  { model: Team, as: 'team', attributes: ['id', 'name'] },
  { model: Project, as: 'project', attributes: ['id', 'name'] },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: CsatResponse, as: 'csat' },
  {
    model: TicketFieldValue,
    as: 'fieldValues',
    include: [{ model: CustomField, as: 'field' }],
  },
];

// Upsert/remove a ticket's admin-defined custom field values.
// fieldValues: array of { customFieldId, value }.
async function syncFieldValues(ticketId, fieldValues, t) {
  if (!Array.isArray(fieldValues)) return;
  for (const fv of fieldValues) {
    const customFieldId = parseInt(fv.customFieldId, 10);
    if (!customFieldId) continue;
    const value = fv.value === undefined || fv.value === null ? '' : String(fv.value);
    if (value === '') {
      await TicketFieldValue.destroy({ where: { ticketId, customFieldId }, transaction: t });
    } else {
      const existing = await TicketFieldValue.findOne({ where: { ticketId, customFieldId }, transaction: t });
      if (existing) await existing.update({ value }, { transaction: t });
      else await TicketFieldValue.create({ ticketId, customFieldId, value }, { transaction: t });
    }
  }
}

// Requesters may only touch their own tickets.
function assertCanViewTicket(req, ticket) {
  if (req.user.role === 'requester' && ticket.requesterId !== req.user.id) {
    throw new ApiError(403, 'You may only access your own tickets', 'FORBIDDEN');
  }
}

const isStaff = (user) => user.role === 'admin' || user.role === 'technician';

// GET /tickets — with filters
const list = asyncHandler(async (req, res) => {
  const where = {};
  const { status, priority, assignee, project, department, requester, type, team } = req.query;
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (type) where.type = type;
  if (assignee) where.assigneeId = assignee;
  if (project) where.projectId = project;
  if (department) where.departmentId = department;
  if (requester) where.requesterId = requester;
  if (team) where.teamId = team;

  // Requesters are scoped to their own tickets regardless of filters.
  if (req.user.role === 'requester') {
    where.requesterId = req.user.id;
  }

  const tickets = await Ticket.findAll({
    where,
    include: ticketInclude,
    order: [['updatedAt', 'DESC']],
  });
  res.json({ tickets });
});

// POST /tickets
// Requesters can create tickets for themselves only.
const create = asyncHandler(async (req, res) => {
  const {
    title, description, priority, type, status, projectId, departmentId, dueDate,
    blueprintId, customFields, teamId,
  } = req.body || {};
  if (!title || !title.trim()) {
    throw new ApiError(400, 'Ticket title is required', 'VALIDATION_ERROR');
  }

  let { assigneeId, requesterId } = req.body || {};
  if (req.user.role === 'requester') {
    requesterId = req.user.id;
    assigneeId = null;
  } else {
    requesterId = requesterId || req.user.id;
  }

  const ticket = await sequelize.transaction(async (t) => {
    const created = await Ticket.create({
      title: title.trim(),
      description: description || null,
      status: status || 'open',
      priority: priority || 'medium',
      type: type || 'request',
      assigneeId: assigneeId || null,
      teamId: req.user.role === 'requester' ? null : (teamId || null),
      requesterId,
      projectId: projectId || null,
      departmentId: departmentId || null,
      dueDate: dueDate || null,
      blueprintId: blueprintId || null,
      customFields: Array.isArray(customFields) && customFields.length ? customFields : null,
    }, { transaction: t });
    if (Array.isArray(req.body.fieldValues)) {
      await syncFieldValues(created.id, req.body.fieldValues, t);
    }
    return created;
  });
  await writeAudit(req, 'ticket.create', 'Ticket', ticket.id, { title: ticket.title });

  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.status(201).json({ ticket: fresh });
});

// GET /tickets/:id
const get = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id, { include: ticketInclude });
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);
  res.json({ ticket });
});

// PATCH /tickets/:id
const update = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  // Requesters can only edit a narrow set of fields on their own tickets.
  let allowed;
  if (isStaff(req.user)) {
    allowed = [
      'title',
      'description',
      'status',
      'priority',
      'type',
      'assigneeId',
      'teamId',
      'requesterId',
      'projectId',
      'departmentId',
      'dueDate',
      'customFields',
    ];
  } else {
    allowed = ['title', 'description', 'priority'];
  }

  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  await sequelize.transaction(async (t) => {
    await ticket.update(changes, { transaction: t });
    if (isStaff(req.user) && Array.isArray(req.body.fieldValues)) {
      await syncFieldValues(ticket.id, req.body.fieldValues, t);
    }
  });
  await writeAudit(req, 'ticket.update', 'Ticket', ticket.id, changes);

  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.json({ ticket: fresh });
});

// DELETE /tickets/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  await sequelize.transaction(async (t) => {
    await ticket.destroy({ transaction: t });
    await writeAudit(req, 'ticket.delete', 'Ticket', ticket.id, { title: ticket.title }, { transaction: t });
  });

  // Remove attachment files from disk (best-effort).
  const dir = path.join(UPLOAD_ROOT, String(ticket.id));
  fs.rm(dir, { recursive: true, force: true }, () => {});

  res.json({ ok: true });
});

// ---- Comments ----

// GET /tickets/:id/comments
const listComments = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const comments = await Comment.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'author', attributes: userAttrs }],
    order: [['createdAt', 'ASC']],
  });
  res.json({ comments });
});

// POST /tickets/:id/comments
const createComment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const { body } = req.body || {};
  if (!body || !body.trim()) {
    throw new ApiError(400, 'Comment body is required', 'VALIDATION_ERROR');
  }
  const comment = await Comment.create({
    body: body.trim(),
    authorId: req.user.id,
    ticketId: ticket.id,
  });
  await writeAudit(req, 'comment.create', 'Comment', comment.id, { ticketId: ticket.id });

  const fresh = await Comment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: userAttrs }],
  });
  res.status(201).json({ comment: fresh });
});

// PATCH /tickets/:id/comments/:commentId — author or staff
const updateComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findOne({
    where: { id: req.params.commentId, ticketId: req.params.id },
  });
  if (!comment) throw new ApiError(404, 'Comment not found', 'NOT_FOUND');
  if (comment.authorId !== req.user.id && !isStaff(req.user)) {
    throw new ApiError(403, 'You can only edit your own comments', 'FORBIDDEN');
  }
  const { body } = req.body || {};
  if (!body || !body.trim()) {
    throw new ApiError(400, 'Comment body is required', 'VALIDATION_ERROR');
  }
  await comment.update({ body: body.trim() });
  await writeAudit(req, 'comment.update', 'Comment', comment.id, { ticketId: comment.ticketId });

  const fresh = await Comment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: userAttrs }],
  });
  res.json({ comment: fresh });
});

// DELETE /tickets/:id/comments/:commentId — author or staff
const removeComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findOne({
    where: { id: req.params.commentId, ticketId: req.params.id },
  });
  if (!comment) throw new ApiError(404, 'Comment not found', 'NOT_FOUND');
  if (comment.authorId !== req.user.id && !isStaff(req.user)) {
    throw new ApiError(403, 'You can only delete your own comments', 'FORBIDDEN');
  }
  await comment.destroy();
  await writeAudit(req, 'comment.delete', 'Comment', comment.id, { ticketId: comment.ticketId });
  res.json({ ok: true });
});

// ---- Attachments ----

// GET /tickets/:id/attachments
const listAttachments = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const attachments = await Attachment.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ attachments });
});

// POST /tickets/:id/attachments — multipart/form-data (field: "file")
const createAttachment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) {
    // Clean up the orphaned upload if the ticket doesn't exist.
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
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
  res.status(201).json({ attachment });
});

// GET /tickets/:id/attachments/:attachmentId/download
const downloadAttachment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

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
  assertCanViewTicket(req, ticket);

  const attachment = await Attachment.findOne({
    where: { id: req.params.attachmentId, ticketId: ticket.id },
  });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');

  const filePath = path.join(UPLOAD_ROOT, String(ticket.id), attachment.filename);
  await attachment.destroy();
  fs.rm(filePath, { force: true }, () => {});
  await writeAudit(req, 'attachment.delete', 'Attachment', attachment.id, { ticketId: ticket.id });
  res.json({ ok: true });
});

// ---- Time entries ----

// GET /tickets/:id/time
const listTime = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const entries = await TimeEntry.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['loggedAt', 'DESC']],
  });
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  res.json({ entries, totalMinutes });
});

// POST /tickets/:id/time — Admin/Technician (enforced at route level)
const createTime = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  const { minutes, note, loggedAt } = req.body || {};
  const mins = parseInt(minutes, 10);
  if (!mins || mins < 1) {
    throw new ApiError(400, 'minutes must be a positive integer', 'VALIDATION_ERROR');
  }
  const entry = await TimeEntry.create({
    ticketId: ticket.id,
    userId: req.user.id,
    minutes: mins,
    note: note || null,
    loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
  });
  await writeAudit(req, 'time.create', 'TimeEntry', entry.id, { ticketId: ticket.id, minutes: mins });

  const fresh = await TimeEntry.findByPk(entry.id, {
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  res.status(201).json({ entry: fresh });
});

// DELETE /tickets/:id/time/:entryId — owner or admin
const removeTime = asyncHandler(async (req, res) => {
  const entry = await TimeEntry.findOne({
    where: { id: req.params.entryId, ticketId: req.params.id },
  });
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only remove your own time entries', 'FORBIDDEN');
  }
  await entry.destroy();
  await writeAudit(req, 'time.delete', 'TimeEntry', entry.id, { ticketId: req.params.id });
  res.json({ ok: true });
});

// ---- Related tickets ----

const relTicketAttrs = ['id', 'title', 'status', 'priority', 'type'];

// GET /tickets/:id/relations
// Returns relations where this ticket is on either side, normalized so each item
// describes "the other ticket" plus the relation type and direction.
const listRelations = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const rows = await TicketRelation.findAll({
    where: { [Op.or]: [{ ticketId: ticket.id }, { relatedTicketId: ticket.id }] },
    include: [
      { model: Ticket, as: 'ticket', attributes: relTicketAttrs },
      { model: Ticket, as: 'relatedTicket', attributes: relTicketAttrs },
    ],
    order: [['createdAt', 'DESC']],
  });

  const relations = rows.map((r) => {
    const outgoing = r.ticketId === ticket.id;
    return {
      id: r.id,
      relationType: r.relationType,
      direction: outgoing ? 'outgoing' : 'incoming',
      ticket: outgoing ? r.relatedTicket : r.ticket,
    };
  });
  res.json({ relations });
});

// POST /tickets/:id/relations — Admin/Technician
const createRelation = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  const { relatedTicketId, relationType } = req.body || {};
  const relId = parseInt(relatedTicketId, 10);
  if (!relId) throw new ApiError(400, 'relatedTicketId is required', 'VALIDATION_ERROR');
  if (relId === ticket.id) {
    throw new ApiError(400, 'A ticket cannot be related to itself', 'VALIDATION_ERROR');
  }
  if (relationType && !['related', 'caused_by', 'duplicates'].includes(relationType)) {
    throw new ApiError(400, 'Invalid relation type', 'VALIDATION_ERROR');
  }
  const related = await Ticket.findByPk(relId);
  if (!related) throw new ApiError(404, 'Related ticket not found', 'NOT_FOUND');

  const existing = await TicketRelation.findOne({
    where: { ticketId: ticket.id, relatedTicketId: relId },
  });
  if (existing) throw new ApiError(409, 'These tickets are already linked', 'DUPLICATE_RELATION');

  const relation = await TicketRelation.create({
    ticketId: ticket.id,
    relatedTicketId: relId,
    relationType: relationType || 'related',
  });
  await writeAudit(req, 'relation.create', 'TicketRelation', relation.id, {
    ticketId: ticket.id,
    relatedTicketId: relId,
    relationType: relation.relationType,
  });

  const fresh = await TicketRelation.findByPk(relation.id, {
    include: [{ model: Ticket, as: 'relatedTicket', attributes: relTicketAttrs }],
  });
  res.status(201).json({
    relation: {
      id: fresh.id,
      relationType: fresh.relationType,
      direction: 'outgoing',
      ticket: fresh.relatedTicket,
    },
  });
});

// DELETE /tickets/:id/relations/:relationId — Admin/Technician
const removeRelation = asyncHandler(async (req, res) => {
  const relation = await TicketRelation.findOne({
    where: {
      id: req.params.relationId,
      [Op.or]: [{ ticketId: req.params.id }, { relatedTicketId: req.params.id }],
    },
  });
  if (!relation) throw new ApiError(404, 'Relation not found', 'NOT_FOUND');
  await relation.destroy();
  await writeAudit(req, 'relation.delete', 'TicketRelation', relation.id, { ticketId: req.params.id });
  res.json({ ok: true });
});

// ---- CSAT (customer happiness) ----

// GET /tickets/:id/csat
const getCsat = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);
  const csat = await CsatResponse.findOne({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  res.json({ csat });
});

// POST /tickets/:id/csat — the ticket's requester submits a satisfaction rating.
// Available once the ticket is resolved or closed.
const submitCsat = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  // Only the requester (or an admin acting on their behalf) may rate.
  if (req.user.role !== 'admin' && ticket.requesterId !== req.user.id) {
    throw new ApiError(403, 'Only the ticket requester can submit a rating', 'FORBIDDEN');
  }
  if (!['resolved', 'closed'].includes(ticket.status)) {
    throw new ApiError(400, 'You can rate a ticket once it is resolved or closed', 'NOT_RATEABLE');
  }

  const { rating, comment } = req.body || {};
  if (!['happy', 'neutral', 'unhappy'].includes(rating)) {
    throw new ApiError(400, 'rating must be happy, neutral, or unhappy', 'VALIDATION_ERROR');
  }

  await CsatResponse.upsert({
    ticketId: ticket.id,
    userId: req.user.id,
    rating,
    comment: comment || null,
    respondedAt: new Date(),
  });
  const csat = await CsatResponse.findOne({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  await writeAudit(req, 'csat.submit', 'CsatResponse', ticket.id, { rating });
  res.status(201).json({ csat });
});

module.exports = {
  list,
  create,
  get,
  update,
  remove,
  listComments,
  createComment,
  updateComment,
  removeComment,
  listAttachments,
  createAttachment,
  downloadAttachment,
  removeAttachment,
  listTime,
  createTime,
  removeTime,
  listRelations,
  createRelation,
  removeRelation,
  getCsat,
  submitCsat,
};
