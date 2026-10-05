// Ticket relationships: list, link, unlink.
const { Ticket, TicketRelation } = require('../../models');
const { Op } = require('sequelize');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../../services/ticketActivity');
const { canAccessTicket, findAccessibleTicket } = require('../../services/permissionService');

// ---- Related tickets ----

const relTicketAttrs = ['id', 'title', 'status', 'priority', 'type'];

// GET /tickets/:id/relations
// Returns relations where this ticket is on either side, normalized so each item
// describes "the other ticket" plus the relation type and direction.
const listRelations = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const rows = await TicketRelation.findAll({
    where: { [Op.or]: [{ ticketId: ticket.id }, { relatedTicketId: ticket.id }] },
    // Only relations whose two tickets share a company: a relation can
    // outlive a contact's move, and must not show the other company's ticket.
    include: [
      { model: Ticket, as: 'ticket', attributes: relTicketAttrs, where: { companyId: ticket.companyId }, required: true },
      { model: Ticket, as: 'relatedTicket', attributes: relTicketAttrs, where: { companyId: ticket.companyId }, required: true },
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
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const { relatedTicketId, relationType } = req.body || {};
  if (relatedTicketId === undefined || relatedTicketId === null || relatedTicketId === '') {
    throw new ApiError(400, 'relatedTicketId is required', 'VALIDATION_ERROR');
  }
  // 'child' is a UI-only direction: the other ticket becomes a child of this
  // one, which is stored as a 'parent' row from the other ticket's side.
  if (relationType && !['related', 'caused_by', 'duplicates', 'parent', 'child'].includes(relationType)) {
    throw new ApiError(400, 'Invalid relation type', 'VALIDATION_ERROR');
  }
  const related = await findAccessibleTicket(req.user, relatedTicketId);
  if (!related) throw new ApiError(404, 'Related ticket not found', 'NOT_FOUND');
  if (related.companyId !== ticket.companyId) throw new ApiError(400, 'Related ticket not found', 'VALIDATION_ERROR');
  const relId = related.id;
  if (relId === ticket.id) {
    throw new ApiError(400, 'A ticket cannot be related to itself', 'VALIDATION_ERROR');
  }

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
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket || !(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }
  await relation.destroy();
  await writeAudit(req, 'relation.delete', 'TicketRelation', relation.id, { ticketId: req.params.id });
  res.json({ ok: true });
});

module.exports = {
  listRelations,
  createRelation,
  removeRelation,
};
