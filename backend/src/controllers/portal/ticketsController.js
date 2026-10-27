// Client-portal tickets: raise, list, read, reply, attach files. Every
// response is built from an explicit allow-list of keys, and every lookup
// goes through services/portal/scope, so a contact sees only what that
// service says and nothing staff-only (private comments, time, SLA, staff
// fields) ever leaves.
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  Ticket, TicketStatus, Comment, Attachment, Contact, Team, User,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { parsePagination, paginated } = require('../../utils/pagination');
const { parseRecordId } = require('../../services/permissionService');
const { createTicket } = require('../../services/tickets/ticketWrite');
const { applyCustomerReply } = require('../../services/tickets/customerReply');
const { logActivity } = require('../../services/ticketActivity');
const { getSystemActorUserId } = require('../../services/inboundEmailService');
const { loadTree, isEffectivelyActive, activeChildren, categoryJson } = require('../../services/tickets/categories');
const {
  portalTicketWhere, canSeeTicket, forContacts, SCOPES,
} = require('../../services/portal/scope');
const { displayName } = require('./authController');
const { escapeLike } = require('../../utils/escapeLike');

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const PUBLIC_COMMENT_TYPES = ['reply', 'comment_public'];
const MAX_BODY = 20000;

const notFound = () => new ApiError(404, 'Ticket not found', 'NOT_FOUND');
const fileShape = (a) => ({
  id: a.id, originalName: a.originalName, size: a.size, createdAt: a.createdAt,
});
const removeUpload = (req) => { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); };

async function systemActorId() {
  const id = await getSystemActorUserId();
  if (!id) throw new ApiError(503, 'The portal is not ready: no administrator account exists', 'NO_SYSTEM_ACTOR');
  return id;
}

async function statusBehaviors() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType'] });
  return new Map(rows.map((r) => [r.name, r.behaviorType]));
}

// Route guard for /tickets/:id/...: the ticket must be one this contact can
// see. Runs before multer, so nothing is written to disk for any other id.
async function loadVisibleTicket(req, res, next) {
  try {
    const id = parseRecordId(req.params.id);
    if (!id || !(await canSeeTicket(req.contact, id))) throw notFound();
    req.portalTicket = await Ticket.findByPk(id);
    if (!req.portalTicket) throw notFound();
    next();
  } catch (err) {
    next(err);
  }
}

// GET /portal/meta
const meta = asyncHandler(async (req, res) => {
  const tree = await loadTree();
  const categories = [...tree.values()]
    .filter((n) => isEffectivelyActive(tree, n.id) && !(n.requireChild && activeChildren(tree, n.id).length))
    .map((n) => categoryJson(tree, n.id))
    .sort((a, b) => a.path.join(' / ').localeCompare(b.path.join(' / ')));
  const people = await forContacts(req.contact);
  res.json({
    categories,
    priorities: PRIORITIES,
    forContacts: people.map((c) => ({ id: c.id, displayName: displayName(c) })),
  });
});

// "12", "00012", "#12" → 12.
const ticketNumber = (q) => {
  const m = /^#?0*(\d{1,10})$/.exec(q);
  return m ? Number(m[1]) : null;
};

// GET /portal/tickets?scope&status=open|closed|all&q&page&limit
const list = asyncHandler(async (req, res) => {
  const scope = SCOPES.includes(req.query.scope) ? req.query.scope : 'all';
  const behaviors = await statusBehaviors();
  const namesFor = (kinds) => [...behaviors].filter(([, b]) => kinds.includes(b)).map(([n]) => n);
  const statusFilter = { open: ['open', 'on_hold'], closed: ['closed'] }[req.query.status] || ['open', 'on_hold', 'closed'];
  const parts = [await portalTicketWhere(req.contact, scope), { status: { [Op.in]: namesFor(statusFilter) } }];
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  if (q) {
    const n = ticketNumber(q);
    parts.push({ [Op.or]: [...(n ? [{ id: n }] : []), { title: { [Op.like]: `%${escapeLike(q)}%` } }] });
  }
  const { page, limit, offset } = parsePagination(req);
  const { rows, count } = await Ticket.findAndCountAll({
    where: { [Op.and]: parts },
    attributes: ['id', 'title', 'status', 'contactId', 'updatedAt'],
    include: [{ model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'displayName', 'email'] }],
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  const tickets = rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    statusBehavior: behaviors.get(t.status) || 'open',
    contact: t.contact ? { id: t.contact.id, displayName: displayName(t.contact) } : null,
    updatedAt: t.updatedAt,
  }));
  res.json(paginated('tickets', { rows: tickets, count }, { page, limit }));
});

// GET /portal/tickets/:id
const get = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.portalTicket.id, {
    include: [
      { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'displayName', 'email'] },
      { model: Team, as: 'team', attributes: ['id', 'name'] },
    ],
  });
  const [behaviors, tree, comments, files] = await Promise.all([
    statusBehaviors(),
    ticket.categoryId ? loadTree() : null,
    Comment.findAll({
      where: { ticketId: ticket.id, type: { [Op.in]: PUBLIC_COMMENT_TYPES } },
      include: [
        { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
        { model: Contact, as: 'authorContact', attributes: ['id', 'firstName', 'lastName', 'displayName', 'email'] },
      ],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: 1000,
    }),
    Attachment.findAll({ where: { ticketId: ticket.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] }),
  ]);
  const visibleCommentIds = new Set(comments.map((c) => c.id));
  const byComment = new Map();
  const ticketFiles = [];
  files.forEach((a) => {
    if (a.commentId == null) ticketFiles.push(fileShape(a));
    else if (visibleCommentIds.has(a.commentId)) {
      if (!byComment.has(a.commentId)) byComment.set(a.commentId, []);
      byComment.get(a.commentId).push(fileShape(a));
    }
  });
  const meId = req.contact.id;
  const author = (c) => {
    if (c.type === 'comment_public') {
      return { displayName: c.author ? (c.author.displayName || c.author.username) : 'Support', side: 'support' };
    }
    // A customer reply: by the contact who wrote it in the portal, or (by
    // email) the ticket's contact.
    const who = c.authorContact || ticket.contact;
    return { displayName: who ? displayName(who) : '', side: who && who.id === meId ? 'you' : 'contact' };
  };
  const category = ticket.categoryId && tree ? categoryJson(tree, ticket.categoryId) : null;
  res.json({
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      statusBehavior: behaviors.get(ticket.status) || 'open',
      priority: ticket.priority,
      category: category ? { path: category.path } : null,
      contact: { displayName: ticket.contact ? displayName(ticket.contact) : '' },
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      handledBy: ticket.team ? ticket.team.name : null,
    },
    comments: comments.map((c) => ({
      id: c.id, body: c.body, createdAt: c.createdAt, author: author(c), attachments: byComment.get(c.id) || [],
    })),
    attachments: ticketFiles,
  });
});

const requiredText = (value, what) => {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, `${what} is required`, 'VALIDATION_ERROR');
  if (value.length > MAX_BODY) throw new ApiError(400, `${what} is too long`, 'VALIDATION_ERROR');
  return value.trim();
};

// POST /portal/tickets { title, description, categoryId?, priority?, forContactId? }
const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const title = requiredText(body.title, 'A title');
  const description = requiredText(body.description, 'A description');
  if (body.priority !== undefined && body.priority !== null && body.priority !== '' && !PRIORITIES.includes(body.priority)) {
    throw new ApiError(400, 'Unknown priority', 'VALIDATION_ERROR');
  }
  const me = req.contact;
  let target = me;
  if (body.forContactId !== undefined && body.forContactId !== null && body.forContactId !== '' && String(body.forContactId) !== String(me.id)) {
    const allowed = await forContacts(me);
    if (allowed.length <= 1) throw new ApiError(403, 'You can only raise tickets for yourself', 'FORBIDDEN');
    const id = parseRecordId(body.forContactId);
    if (!id || !allowed.some((c) => c.id === id)) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
    target = await Contact.findByPk(id);
  }
  const actorId = await systemActorId();
  const ticket = await createTicket({ id: actorId }, {
    title,
    description,
    priority: body.priority || undefined,
    categoryId: body.categoryId === '' ? null : body.categoryId,
    contactId: target.id,
  }, {
    req, createdById: actorId, source: 'portal', portal: { contact: target, raisedBy: me },
  });
  res.status(201).json({ ticket: { id: ticket.id } });
});

// POST /portal/tickets/:id/replies { body }
const reply = asyncHandler(async (req, res) => {
  const text = requiredText((req.body || {}).body, 'A reply');
  const ticket = req.portalTicket;
  const actorId = await systemActorId();
  const comment = await Comment.create({
    body: text, authorId: actorId, authorContactId: req.contact.id, ticketId: ticket.id, type: 'reply',
  });
  await applyCustomerReply(ticket, comment, actorId);
  res.status(201).json({ comment: { id: comment.id } });
});

// POST /portal/tickets/:id/attachments — multipart (file, commentId?). The
// file can hang off one of this contact's own replies on the ticket.
const createAttachment = asyncHandler(async (req, res) => {
  const ticket = req.portalTicket;
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');
  let commentId = null;
  const rawCommentId = (req.body || {}).commentId;
  if (rawCommentId !== undefined && rawCommentId !== '') {
    const id = parseRecordId(rawCommentId);
    const comment = id ? await Comment.findOne({
      where: {
        id, ticketId: ticket.id, type: 'reply', authorContactId: req.contact.id,
      },
    }) : null;
    if (!comment) {
      removeUpload(req);
      throw new ApiError(400, 'You can attach files only to your own replies', 'VALIDATION_ERROR');
    }
    commentId = comment.id;
  }
  let actorId;
  try {
    actorId = await systemActorId();
  } catch (err) {
    removeUpload(req);
    throw err;
  }
  const attachment = await Attachment.create({
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    ticketId: ticket.id,
    commentId,
    uploadedById: actorId,
  });
  await logActivity(ticket.id, actorId, 'attachment_added', null, attachment.originalName);
  res.status(201).json({ attachment: fileShape(attachment) });
});

// GET /portal/tickets/:id/attachments/:attachmentId/download — files on the
// ticket itself or on a customer-visible comment only.
const downloadAttachment = asyncHandler(async (req, res) => {
  const ticket = req.portalTicket;
  const id = parseRecordId(req.params.attachmentId);
  const attachment = id ? await Attachment.findOne({ where: { id, ticketId: ticket.id } }) : null;
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  if (attachment.commentId != null) {
    const comment = await Comment.findOne({ where: { id: attachment.commentId, ticketId: ticket.id, type: { [Op.in]: PUBLIC_COMMENT_TYPES } } });
    if (!comment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  }
  const filePath = path.join(UPLOAD_ROOT, String(ticket.id), path.basename(attachment.filename));
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'File missing from storage', 'FILE_MISSING');
  res.download(filePath, attachment.originalName);
});

module.exports = {
  loadVisibleTicket, meta, list, get, create, reply, createAttachment, downloadAttachment,
};
