// Ticket comments: list, create (with the reply email), edit, delete.
const { Ticket, Comment, User, Contact } = require('../../models');
const { Op } = require('sequelize');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const {
  notifyComment,
  notifyWatchers,
  createNotification,
} = require('../../services/notifications');
const { logActivity } = require('../../services/ticketActivity');
const { recordFirstResponse } = require('../../services/sla/ticketSla');
const { queueTicketEmail } = require('../../services/email/ticketMail');
const { parsePagination, paginated } = require('../../utils/pagination');
const {
  hasPermission,
  canAccessTicket,
  canModerateTicketContent,
} = require('../../services/permissionService');
const { evaluateRules } = require('../../services/workflowEngine');
const { userAttrs, SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

// ---- Comments ----

// GET /tickets/:id/comments
const COMMENT_TYPES = ['reply', 'comment_private', 'comment_public'];

const listComments = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const where = { ticketId: ticket.id };
  // Customers never see internal-only comments, regardless of who posted them.
  const canViewPrivate = await hasPermission(req.user.id, 'tickets.view_private_comments');
  if (!canViewPrivate) where.type = { [Op.ne]: 'comment_private' };

  // Comments read oldest-first, but the page worth loading first is the
  // newest one — so select descending (page 1 = most recent) and flip each
  // page back into reading order before sending it. "Show older comments"
  // then just asks for page 2, 3, ... and prepends.
  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await Comment.findAndCountAll({
    where,
    include: [{ model: User, as: 'author', attributes: userAttrs }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  res.json(paginated('comments', { rows: rows.slice().reverse(), count }, { page, limit }));
});

// POST /tickets/:id/comments
const createComment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { body, type } = req.body || {};
  if (!body || !body.trim()) {
    throw new ApiError(400, 'Comment body is required', 'VALIDATION_ERROR');
  }
  let resolvedType = 'reply';
  if (type && type !== 'reply') {
    if (!(await hasPermission(req.user.id, 'tickets.view_private_comments'))) {
      throw new ApiError(403, 'You do not have permission to post internal comments', 'FORBIDDEN');
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
  // Only a staff reply or public comment through this endpoint is a first
  // response; inbound email replies are written elsewhere and never count.
  if (resolvedType !== 'comment_private') await recordFirstResponse(ticket.id);
  await logActivity(ticket.id, req.user.id, 'comment', null, null);

  if (resolvedType === 'comment_private') {
    // Internal-only note: notify the assignee, never any watcher who might
    // be a customer-facing contact.
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
      [req.user.id, ticket.assigneeId]
    );
    // Fire-and-forget: only a human-authored reply through this HTTP
    // endpoint emails the contact — inbound-email-created reply comments
    // are written directly via Comment.create() in inboundEmailService.js,
    // never through here, so there's no risk of mailing a reply back in
    // response to the email that created it.
    const contact = ticket.contactId ? await Contact.findByPk(ticket.contactId) : null;
    if (contact && contact.email) {
      queueTicketEmail('contact_tech_reply', {
        ticket, comment, author: req.user, contact, to: [contact.email],
      });
    }
  }

  await evaluateRules(ticket.id, 'ticket_comment_added');

  const fresh = await Comment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: userAttrs }],
  });
  res.status(201).json({ comment: fresh });
});

// PATCH /tickets/:id/comments/:commentId — author or staff
const updateComment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const comment = await Comment.findOne({
    where: { id: req.params.commentId, ticketId: req.params.id },
  });
  if (!comment) throw new ApiError(404, 'Comment not found', 'NOT_FOUND');
  if (comment.authorId !== req.user.id && !(await canModerateTicketContent(req.user, ticket))) {
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
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const comment = await Comment.findOne({
    where: { id: req.params.commentId, ticketId: req.params.id },
  });
  if (!comment) throw new ApiError(404, 'Comment not found', 'NOT_FOUND');
  if (comment.authorId !== req.user.id && !(await canModerateTicketContent(req.user, ticket))) {
    throw new ApiError(403, 'You can only delete your own comments', 'FORBIDDEN');
  }
  await comment.destroy();
  await writeAudit(req, 'comment.delete', 'Comment', comment.id, { ticketId: comment.ticketId });
  res.json({ ok: true });
});

module.exports = {
  listComments,
  createComment,
  updateComment,
  removeComment,
};
