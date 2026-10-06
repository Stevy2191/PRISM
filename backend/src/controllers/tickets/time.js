// Ticket time: thin wrappers over services/time (the one ledger).
const { Ticket } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { parsePagination, paginated } = require('../../utils/pagination');
const { canAccessTicket } = require('../../services/permissionService');
const { ticketParent } = require('../../services/tasks');
const time = require('../../services/time');
const { SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

async function ticketFor(req) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  return ticketParent(ticket);
}

async function entryFor(parent, rawId) {
  const entry = await time.findEntry(parent, rawId);
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  return entry;
}

// GET /tickets/:id/time
const listTime = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count, totalSeconds, totalLaborCost } = await time.listEntries(parent, { limit, offset });
  res.json({ ...paginated('entries', { rows, count }, { page, limit }), totalSeconds, totalLaborCost });
});

// POST /tickets/:id/time — { durationMinutes | startTime+endTime, entryDate?, note?, taskId?, workTypeId?, billable?, userId? }
const createTime = asyncHandler(async (req, res) => {
  res.status(201).json({ entry: await time.createEntry(req, await ticketFor(req), req.body) });
});

// PATCH /tickets/:id/time/:entryId
const updateTime = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  res.json({ entry: await time.updateEntry(req, parent, await entryFor(parent, req.params.entryId), req.body) });
});

// DELETE /tickets/:id/time/:entryId
const removeTime = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  await time.deleteEntry(req, parent, await entryFor(parent, req.params.entryId));
  res.json({ ok: true });
});

module.exports = {
  listTime,
  createTime,
  updateTime,
  removeTime,
};
