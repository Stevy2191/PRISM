const fs = require('fs');
const path = require('path');
const {
  Ticket,
  Comment,
  Attachment,
  TimeEntry,
  TicketRelation,
  TicketWatcher,
  TicketTask,
  TicketActivity,
  CsatResponse,
  Team,
  TeamMember,
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
const {
  notifyAssigned,
  notifyComment,
  notifyStatusChange,
  notifyWatchers,
  createNotification,
} = require('../services/notifications');
const { logActivity, resolveDisplayValue } = require('../services/ticketActivity');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const ticketInclude = [
  { model: User, as: 'assignee', attributes: userAttrs },
  {
    model: User,
    as: 'requester',
    attributes: userAttrs,
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  },
  { model: Team, as: 'team', attributes: ['id', 'name'] },
  { model: Project, as: 'project', attributes: ['id', 'name'] },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'resolutionUpdatedByUser', attributes: userAttrs },
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

// Admins and team leads may log time attributed to another tech.
async function canLogForOthers(user) {
  if (user.role === 'admin') return true;
  const lead = await TeamMember.findOne({ where: { userId: user.id, isLead: true } });
  return !!lead;
}

const CLOSED_STATUSES = ['resolved', 'closed'];
const SORTABLE_COLUMNS = ['id', 'title', 'priority', 'status', 'dueDate', 'createdAt', 'updatedAt'];

// GET /tickets — with filters
const list = asyncHandler(async (req, res) => {
  const where = {};
  const {
    status, priority, assignee, project, department, requester, type, team,
    search, myTickets, overdue, unassigned, sortBy, sortDir,
  } = req.query;

  // "Closed" in the UI covers both terminal statuses; everything else maps
  // to the matching column value directly.
  if (status) where.status = status === 'closed' ? { [Op.in]: CLOSED_STATUSES } : status;
  if (priority) where.priority = priority;
  if (type) where.type = type;
  if (assignee) where.assigneeId = assignee;
  if (project) where.projectId = project;
  if (department) where.departmentId = department;
  if (requester) where.requesterId = requester;
  if (team) where.teamId = team;

  if (search && search.trim()) {
    const term = search.trim();
    const or = [
      { title: { [Op.like]: `%${term}%` } },
      { description: { [Op.like]: `%${term}%` } },
    ];
    const numeric = term.replace(/^#/, '').replace(/^0+(?=\d)/, '');
    if (/^\d+$/.test(numeric)) or.push({ id: Number(numeric) });
    where[Op.or] = or;
  }

  if (overdue === 'true') {
    where.dueDate = { [Op.lt]: new Date().toISOString().slice(0, 10) };
    // Only imply "not closed" when the status dropdown isn't already set —
    // this is an independent quick-filter toggle, not a status override.
    if (!status) where.status = { [Op.notIn]: CLOSED_STATUSES };
  }
  if (unassigned === 'true') where.assigneeId = null;
  // "My tickets" pins the view to the logged-in user regardless of any
  // assignee filter that was also passed. Requesters are never assignees in
  // this app's RBAC — their tickets are already scoped by requesterId below,
  // so forcing assigneeId here would incorrectly return zero results.
  if (myTickets === 'true' && req.user.role !== 'requester') where.assigneeId = req.user.id;

  // Requesters are scoped to their own tickets regardless of filters.
  if (req.user.role === 'requester') {
    where.requesterId = req.user.id;
  }

  const orderColumn = SORTABLE_COLUMNS.includes(sortBy) ? sortBy : 'updatedAt';
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const tickets = await Ticket.findAll({
    where,
    include: ticketInclude,
    order: [[orderColumn, orderDir]],
  });

  const ticketIds = tickets.map((t) => t.id);
  const timeTotals = ticketIds.length
    ? await TimeEntry.findAll({
        where: { ticketId: { [Op.in]: ticketIds } },
        attributes: ['ticketId', [sequelize.fn('SUM', sequelize.col('minutes')), 'total']],
        group: ['ticketId'],
        raw: true,
      })
    : [];
  const minutesByTicket = new Map(timeTotals.map((r) => [r.ticketId, Number(r.total) || 0]));

  res.json({
    tickets: tickets.map((t) => ({ ...t.toJSON(), timeLoggedMinutes: minutesByTicket.get(t.id) || 0 })),
  });
});

// POST /tickets
// Requesters can create tickets for themselves only.
const create = asyncHandler(async (req, res) => {
  const {
    title, description, priority, type, status, projectId, departmentId, dueDate,
    blueprintId, customFields, teamId, tags, watcherIds, parentTicketId, childTicketIds, relatedTicketIds,
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

  const watcherIdList = Array.isArray(watcherIds)
    ? [...new Set(watcherIds.map((id) => parseInt(id, 10)).filter(Boolean))]
    : [];
  const childIdList = Array.isArray(childTicketIds)
    ? [...new Set(childTicketIds.map((id) => parseInt(id, 10)).filter(Boolean))]
    : [];
  const relatedIdList = Array.isArray(relatedTicketIds)
    ? [...new Set(relatedTicketIds.map((id) => parseInt(id, 10)).filter(Boolean))]
    : [];
  const parentId = parentTicketId ? parseInt(parentTicketId, 10) : null;

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
      tags: Array.isArray(tags) && tags.length ? tags : null,
    }, { transaction: t });

    if (Array.isArray(req.body.fieldValues)) {
      await syncFieldValues(created.id, req.body.fieldValues, t);
    }

    if (parentId) {
      await TicketRelation.create(
        { ticketId: created.id, relatedTicketId: parentId, relationType: 'parent' },
        { transaction: t }
      );
    }
    for (const childId of childIdList) {
      // eslint-disable-next-line no-await-in-loop
      await TicketRelation.create(
        { ticketId: childId, relatedTicketId: created.id, relationType: 'parent' },
        { transaction: t }
      );
    }
    for (const relId of relatedIdList) {
      // eslint-disable-next-line no-await-in-loop
      await TicketRelation.create(
        { ticketId: created.id, relatedTicketId: relId, relationType: 'related' },
        { transaction: t }
      );
    }
    for (const userId of watcherIdList) {
      // eslint-disable-next-line no-await-in-loop
      await TicketWatcher.create({ ticketId: created.id, userId }, { transaction: t });
    }

    return created;
  });
  await writeAudit(req, 'ticket.create', 'Ticket', ticket.id, { title: ticket.title });
  await logActivity(ticket.id, req.user.id, 'created', null, null);
  await notifyAssigned(ticket, req.user.id);
  if (watcherIdList.length) {
    await notifyWatchers(ticket, `Ticket created: ${ticket.title}`, [req.user.id]);
  }

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
  // resolution is staff-only to edit (customers only ever see it read-only).
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
      'tags',
      'resolution',
    ];
  } else {
    allowed = ['title', 'description', 'priority', 'tags'];
  }

  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (changes.resolution !== undefined) {
    changes.resolutionUpdatedBy = req.user.id;
    changes.resolutionUpdatedAt = new Date();
  }
  const TRACKED_ACTIVITY_FIELDS = ['status', 'priority', 'type', 'assigneeId', 'teamId', 'departmentId', 'dueDate'];
  const before = {};
  TRACKED_ACTIVITY_FIELDS.forEach((f) => { before[f] = ticket[f]; });
  const previousAssigneeId = ticket.assigneeId;
  const previousStatus = ticket.status;
  await sequelize.transaction(async (t) => {
    await ticket.update(changes, { transaction: t });
    if (isStaff(req.user) && Array.isArray(req.body.fieldValues)) {
      await syncFieldValues(ticket.id, req.body.fieldValues, t);
    }
  });
  await writeAudit(req, 'ticket.update', 'Ticket', ticket.id, changes);

  // eslint-disable-next-line no-restricted-syntax
  for (const field of TRACKED_ACTIVITY_FIELDS) {
    if (changes[field] === undefined) continue; // eslint-disable-line no-continue
    const beforeVal = before[field];
    const afterVal = ticket[field];
    if (String(beforeVal ?? '') === String(afterVal ?? '')) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const fromDisplay = await resolveDisplayValue(field, beforeVal);
    // eslint-disable-next-line no-await-in-loop
    const toDisplay = await resolveDisplayValue(field, afterVal);
    // eslint-disable-next-line no-await-in-loop
    await logActivity(ticket.id, req.user.id, field, fromDisplay, toDisplay);
  }

  if (changes.assigneeId !== undefined && ticket.assigneeId && ticket.assigneeId !== previousAssigneeId) {
    await notifyAssigned(ticket, req.user.id);
  }
  if (changes.status !== undefined && ticket.status !== previousStatus && isStaff(req.user)) {
    await notifyStatusChange(ticket, req.user.id, ticket.status);
    await notifyWatchers(
      ticket,
      `Status changed to "${ticket.status.replace(/_/g, ' ')}" on ticket: ${ticket.title}`,
      [req.user.id, ticket.requesterId, ticket.assigneeId]
    );
  }

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
const COMMENT_TYPES = ['reply', 'comment_private', 'comment_public'];

const listComments = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const where = { ticketId: ticket.id };
  // Customers never see internal-only comments, regardless of who posted them.
  if (!isStaff(req.user)) where.type = { [Op.ne]: 'comment_private' };

  const comments = await Comment.findAll({
    where,
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

  const { body, type } = req.body || {};
  if (!body || !body.trim()) {
    throw new ApiError(400, 'Comment body is required', 'VALIDATION_ERROR');
  }
  let resolvedType = 'reply';
  if (type && type !== 'reply') {
    if (!isStaff(req.user)) {
      throw new ApiError(403, 'Only staff can post internal comments', 'FORBIDDEN');
    }
    if (!COMMENT_TYPES.includes(type)) {
      throw new ApiError(400, 'Invalid comment type', 'VALIDATION_ERROR');
    }
    resolvedType = type;
  }
  const comment = await Comment.create({
    body: body.trim(),
    authorId: req.user.id,
    ticketId: ticket.id,
    type: resolvedType,
  });
  await writeAudit(req, 'comment.create', 'Comment', comment.id, { ticketId: ticket.id, type: resolvedType });
  await logActivity(ticket.id, req.user.id, 'comment', null, null);

  if (resolvedType === 'comment_private') {
    // Internal-only note: notify the assignee, never the requester or any
    // watcher who might be a customer.
    if (ticket.assigneeId && ticket.assigneeId !== req.user.id) {
      await createNotification({
        userId: ticket.assigneeId,
        type: 'reply',
        message: `Internal comment added to ticket: ${ticket.title}`,
        ticketId: ticket.id,
      });
    }
  } else {
    await notifyComment(ticket, comment, req.user.id);
    await notifyWatchers(
      ticket,
      `Someone commented on ticket you're watching: ${ticket.title}`,
      [req.user.id, ticket.requesterId, ticket.assigneeId]
    );
  }

  const fresh = await Comment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: userAttrs }],
  });
  res.status(201).json({ comment: fresh });
});

// PATCH /tickets/:id/comments/:commentId — author or staff
const updateComment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

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
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

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
  try {
    assertCanViewTicket(req, ticket);
  } catch (err) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw err;
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
  if (attachment.uploadedById !== req.user.id && !isStaff(req.user)) {
    throw new ApiError(403, 'You can only remove your own attachments', 'FORBIDDEN');
  }

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
    include: [
      { model: User, as: 'user', attributes: userAttrs },
      { model: User, as: 'loggedBy', attributes: userAttrs },
    ],
    order: [['loggedAt', 'DESC']],
  });
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  res.json({ entries, totalMinutes });
});

// POST /tickets/:id/time — Admin/Technician (enforced at route level)
const createTime = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  const { minutes, note, entryDate, userId, startTime, endTime } = req.body || {};

  // Preferred path: explicit start/end timestamps, from which duration is
  // derived server-side (never trust a client-computed duration). Falls back
  // to a raw minutes value for callers that don't have start/end (e.g. older
  // clients, or a future non-ticket-detail caller).
  let mins;
  let durationSeconds;
  let startDt = null;
  let endDt = null;
  if (startTime && endTime) {
    startDt = new Date(startTime);
    endDt = new Date(endTime);
    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
      throw new ApiError(400, 'Invalid start/end time', 'VALIDATION_ERROR');
    }
    durationSeconds = Math.round((endDt.getTime() - startDt.getTime()) / 1000);
    if (durationSeconds <= 0) {
      throw new ApiError(400, 'End time must be after start time', 'VALIDATION_ERROR');
    }
    mins = Math.max(1, Math.round(durationSeconds / 60));
  } else {
    mins = parseInt(minutes, 10);
    if (!mins || mins < 1) {
      throw new ApiError(400, 'minutes must be a positive integer', 'VALIDATION_ERROR');
    }
    durationSeconds = mins * 60;
  }

  // Attribute the entry to another tech — admins/team leads only.
  let targetUserId = req.user.id;
  if (userId !== undefined && userId !== null && Number(userId) !== req.user.id) {
    if (!(await canLogForOthers(req.user))) {
      throw new ApiError(403, 'Only admins and team leads can log time for other users', 'FORBIDDEN');
    }
    const targetUser = await User.findByPk(userId);
    if (!targetUser || !isStaff(targetUser)) {
      throw new ApiError(400, 'Invalid user to log time for', 'VALIDATION_ERROR');
    }
    targetUserId = targetUser.id;
  }

  // The work date is user-editable but never in the future.
  const todayStr = new Date().toISOString().slice(0, 10);
  let resolvedEntryDate = todayStr;
  if (entryDate) {
    const d = String(entryDate).slice(0, 10);
    if (d > todayStr) {
      throw new ApiError(400, 'Entry date cannot be in the future', 'VALIDATION_ERROR');
    }
    resolvedEntryDate = d;
  }

  const entry = await TimeEntry.create({
    ticketId: ticket.id,
    userId: targetUserId,
    loggedById: req.user.id,
    minutes: mins,
    durationSeconds,
    startTime: startDt,
    endTime: endDt,
    note: note || null,
    entryDate: resolvedEntryDate,
    loggedAt: new Date(),
  });
  await writeAudit(req, 'time.create', 'TimeEntry', entry.id, { ticketId: ticket.id, minutes: mins });
  await logActivity(ticket.id, req.user.id, 'time_logged', null, `${mins}m`);

  const fresh = await TimeEntry.findByPk(entry.id, {
    include: [
      { model: User, as: 'user', attributes: userAttrs },
      { model: User, as: 'loggedBy', attributes: userAttrs },
    ],
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
  // 'child' is a UI-only direction: the other ticket becomes a child of this
  // one, which is stored as a 'parent' row from the other ticket's side.
  if (relationType && !['related', 'caused_by', 'duplicates', 'parent', 'child'].includes(relationType)) {
    throw new ApiError(400, 'Invalid relation type', 'VALIDATION_ERROR');
  }
  const related = await Ticket.findByPk(relId);
  if (!related) throw new ApiError(404, 'Related ticket not found', 'NOT_FOUND');

  const isChild = relationType === 'child';
  const storedType = isChild ? 'parent' : (relationType || 'related');
  const storedTicketId = isChild ? relId : ticket.id;
  const storedRelatedId = isChild ? ticket.id : relId;

  const existing = await TicketRelation.findOne({
    where: { ticketId: storedTicketId, relatedTicketId: storedRelatedId },
  });
  if (existing) throw new ApiError(409, 'These tickets are already linked', 'DUPLICATE_RELATION');

  const relation = await TicketRelation.create({
    ticketId: storedTicketId,
    relatedTicketId: storedRelatedId,
    relationType: storedType,
  });
  await writeAudit(req, 'relation.create', 'TicketRelation', relation.id, {
    ticketId: storedTicketId,
    relatedTicketId: storedRelatedId,
    relationType: storedType,
  });
  await logActivity(ticket.id, req.user.id, 'relation_added', null, `${storedType}: ${related.title}`);

  res.status(201).json({
    relation: {
      id: relation.id,
      relationType: relation.relationType,
      direction: relation.ticketId === ticket.id ? 'outgoing' : 'incoming',
      ticket: related,
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

// ---- Watchers ----

// GET /tickets/:id/watchers
const listWatchers = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const watchers = await TicketWatcher.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'ASC']],
  });
  res.json({ watchers });
});

// POST /tickets/:id/watchers { userId }
const addWatcher = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const userId = parseInt(req.body?.userId, 10);
  if (!userId) throw new ApiError(400, 'userId is required', 'VALIDATION_ERROR');

  const [watcher] = await TicketWatcher.findOrCreate({
    where: { ticketId: ticket.id, userId },
  });
  const fresh = await TicketWatcher.findByPk(watcher.id, {
    include: [{ model: User, as: 'user', attributes: userAttrs }],
  });
  res.status(201).json({ watcher: fresh });
});

// DELETE /tickets/:id/watchers/:userId
const removeWatcher = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  await TicketWatcher.destroy({ where: { ticketId: ticket.id, userId: req.params.userId } });
  res.json({ ok: true });
});

// ---- Tasks (per-ticket checklist) ----

// GET /tickets/:id/tasks
const listTasks = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const tasks = await TicketTask.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    order: [['createdAt', 'ASC']],
  });
  res.json({ tasks });
});

// POST /tickets/:id/tasks { description, assigneeId? }
const createTask = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const { description, assigneeId } = req.body || {};
  if (!description || !description.trim()) {
    throw new ApiError(400, 'Task description is required', 'VALIDATION_ERROR');
  }
  const task = await TicketTask.create({
    ticketId: ticket.id,
    description: description.trim(),
    assigneeId: assigneeId || null,
  });
  const fresh = await TicketTask.findByPk(task.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
  });
  res.status(201).json({ task: fresh });
});

// PATCH /tickets/:id/tasks/:taskId { completed?, assigneeId?, description? }
const updateTask = asyncHandler(async (req, res) => {
  const task = await TicketTask.findOne({ where: { id: req.params.taskId, ticketId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const ticket = await Ticket.findByPk(req.params.id);
  assertCanViewTicket(req, ticket);

  const changes = {};
  if (req.body?.completed !== undefined) changes.completed = !!req.body.completed;
  if (req.body?.assigneeId !== undefined) changes.assigneeId = req.body.assigneeId || null;
  if (req.body?.description !== undefined && req.body.description.trim()) {
    changes.description = req.body.description.trim();
  }
  await task.update(changes);

  const fresh = await TicketTask.findByPk(task.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
  });
  res.json({ task: fresh });
});

// ---- Activity (per-ticket timeline) ----

// GET /tickets/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  assertCanViewTicket(req, ticket);

  const activity = await TicketActivity.findAll({
    where: { ticketId: ticket.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity });
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
  listWatchers,
  addWatcher,
  removeWatcher,
  listTasks,
  createTask,
  updateTask,
  listActivity,
};
