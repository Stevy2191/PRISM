const { AssignmentRule, Department, User, Team } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const TICKET_TYPES = ['incident', 'request', 'problem', 'change'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

const include = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'assignee', attributes: ['id', 'displayName'] },
  { model: Team, as: 'team', attributes: ['id', 'name'] },
];

function validateBody(body) {
  const { name, ticketType, departmentId, priority, assigneeId, teamId } = body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Rule name is required', 'VALIDATION_ERROR');
  }
  if (ticketType && !TICKET_TYPES.includes(ticketType)) {
    throw new ApiError(400, 'Invalid ticket type', 'VALIDATION_ERROR');
  }
  if (priority && !PRIORITIES.includes(priority)) {
    throw new ApiError(400, 'Invalid priority', 'VALIDATION_ERROR');
  }
  if (!assigneeId && !teamId) {
    throw new ApiError(400, 'Choose a user or a team to assign to', 'VALIDATION_ERROR');
  }
  if (assigneeId && teamId) {
    throw new ApiError(400, 'Choose either a user or a team, not both', 'VALIDATION_ERROR');
  }
  return {
    name: name.trim(),
    ticketType: ticketType || null,
    departmentId: departmentId || null,
    priority: priority || null,
    assigneeId: assigneeId || null,
    teamId: teamId || null,
  };
}

// GET /assignment-rules
const list = asyncHandler(async (req, res) => {
  const rules = await AssignmentRule.findAll({ include, order: [['position', 'ASC']] });
  res.json({ rules });
});

// POST /assignment-rules
const create = asyncHandler(async (req, res) => {
  const data = validateBody(req.body);
  const maxPosition = await AssignmentRule.max('position');
  const rule = await AssignmentRule.create({
    ...data,
    position: (maxPosition || 0) + 1,
    createdBy: req.user.id,
  });
  await writeAudit(req, 'assignmentRule.create', 'AssignmentRule', rule.id, { name: rule.name });
  const fresh = await AssignmentRule.findByPk(rule.id, { include });
  res.status(201).json({ rule: fresh });
});

// PATCH /assignment-rules/:id
const update = asyncHandler(async (req, res) => {
  const rule = await AssignmentRule.findByPk(req.params.id);
  if (!rule) throw new ApiError(404, 'Rule not found', 'NOT_FOUND');

  // isActive-only toggle doesn't need the full validation (name/assignee
  // are already known-good on an existing row).
  if (Object.keys(req.body || {}).length === 1 && req.body.isActive !== undefined) {
    await rule.update({ isActive: !!req.body.isActive });
  } else {
    const data = validateBody({ ...rule.get({ plain: true }), ...req.body });
    await rule.update(data);
  }
  await writeAudit(req, 'assignmentRule.update', 'AssignmentRule', rule.id, req.body);
  const fresh = await AssignmentRule.findByPk(rule.id, { include });
  res.json({ rule: fresh });
});

// DELETE /assignment-rules/:id
const remove = asyncHandler(async (req, res) => {
  const rule = await AssignmentRule.findByPk(req.params.id);
  if (!rule) throw new ApiError(404, 'Rule not found', 'NOT_FOUND');
  await rule.destroy();
  await writeAudit(req, 'assignmentRule.delete', 'AssignmentRule', rule.id, { name: rule.name });
  res.json({ ok: true });
});

// PATCH /assignment-rules/reorder — Body: { order: [id, id, ...] }
const reorder = asyncHandler(async (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order.map((v) => parseInt(v, 10)).filter(Boolean) : [];
  if (!order.length) throw new ApiError(400, 'order must be a non-empty array of rule ids', 'VALIDATION_ERROR');

  const rules = await AssignmentRule.findAll({ where: { id: order } });
  if (rules.length !== order.length) {
    throw new ApiError(400, 'One or more rules do not exist', 'VALIDATION_ERROR');
  }

  await Promise.all(order.map((id, idx) => AssignmentRule.update({ position: idx + 1 }, { where: { id } })));
  res.json({ ok: true });
});

// Applied from ticketsController.js's create — only when the ticket wasn't
// already given an explicit assignee/team. First active rule (in position
// order) whose non-null conditions all match wins; a rule with every
// condition left blank matches everything, so ordering matters. Returns
// { assigneeId, teamId } (both possibly null) or null if nothing matched.
async function matchAssignmentRule({ type, departmentId, priority }) {
  const rules = await AssignmentRule.findAll({ where: { isActive: true }, order: [['position', 'ASC']] });
  const match = rules.find((r) => (
    (!r.ticketType || r.ticketType === type)
    && (!r.departmentId || String(r.departmentId) === String(departmentId))
    && (!r.priority || r.priority === priority)
  ));
  if (!match) return null;
  return { assigneeId: match.assigneeId, teamId: match.teamId };
}

module.exports = { list, create, update, remove, reorder, matchAssignmentRule };
