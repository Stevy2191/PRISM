const {
  WorkflowRule, WorkflowCondition, WorkflowAction, WorkflowRuleLog, Ticket, User, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { testRule } = require('../services/workflowEngine');

const TRIGGER_EVENTS = [
  'ticket_created', 'ticket_updated', 'ticket_status_changed', 'ticket_priority_changed',
  'ticket_assigned', 'ticket_comment_added', 'ticket_due_date_approaching', 'ticket_overdue',
  'ticket_closed',
];
const OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than'];
const ACTION_TYPES = [
  'assign_to_user', 'assign_to_team', 'assign_round_robin', 'set_status', 'set_priority',
  'add_tag', 'remove_tag', 'set_due_date', 'send_notification', 'add_private_comment', 'escalate_to_user',
];

const detailInclude = [
  { model: WorkflowCondition, as: 'conditions', separate: true, order: [['position', 'ASC']] },
  { model: WorkflowAction, as: 'actions', separate: true, order: [['position', 'ASC']] },
  { model: User, as: 'creator', attributes: ['id', 'displayName'] },
];

function validateConditions(conditions) {
  if (!Array.isArray(conditions)) return [];
  return conditions.map((c, idx) => {
    if (!c.field || !String(c.field).trim()) {
      throw new ApiError(400, `Condition ${idx + 1} is missing a field`, 'VALIDATION_ERROR');
    }
    if (!OPERATORS.includes(c.operator)) {
      throw new ApiError(400, `Condition ${idx + 1} has an invalid operator`, 'VALIDATION_ERROR');
    }
    return { field: String(c.field).trim(), operator: c.operator, value: c.value ?? null, position: idx + 1 };
  });
}

function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new ApiError(400, 'At least one action is required', 'VALIDATION_ERROR');
  }
  return actions.map((a, idx) => {
    if (!ACTION_TYPES.includes(a.actionType)) {
      throw new ApiError(400, `Action ${idx + 1} has an invalid action type`, 'VALIDATION_ERROR');
    }
    return { actionType: a.actionType, actionValue: a.actionValue ?? null, position: idx + 1 };
  });
}

function validateRuleBody(body, partial = false) {
  const out = {};

  if (body.name !== undefined || !partial) {
    if (!body.name || !body.name.trim()) throw new ApiError(400, 'Rule name is required', 'VALIDATION_ERROR');
    out.name = body.name.trim();
  }
  if (body.description !== undefined) out.description = body.description || null;
  if (body.isActive !== undefined) out.isActive = !!body.isActive;

  if (body.triggerEvent !== undefined || !partial) {
    if (!TRIGGER_EVENTS.includes(body.triggerEvent)) {
      throw new ApiError(400, 'Invalid trigger event', 'VALIDATION_ERROR');
    }
    out.triggerEvent = body.triggerEvent;
  }
  if (body.conditionMatch !== undefined) {
    if (!['all', 'any'].includes(body.conditionMatch)) {
      throw new ApiError(400, 'conditionMatch must be "all" or "any"', 'VALIDATION_ERROR');
    }
    out.conditionMatch = body.conditionMatch;
  }
  if (body.triggerConfig !== undefined) out.triggerConfig = body.triggerConfig || null;

  return out;
}

// GET /workflow-rules
const list = asyncHandler(async (req, res) => {
  const rules = await WorkflowRule.findAll({
    include: [
      { model: WorkflowCondition, as: 'conditions', attributes: ['id'] },
      { model: WorkflowAction, as: 'actions', attributes: ['id'] },
    ],
    order: [['position', 'ASC'], ['id', 'ASC']],
  });
  res.json({
    rules: rules.map((r) => {
      const json = r.toJSON();
      return {
        ...json,
        conditionCount: json.conditions.length,
        actionCount: json.actions.length,
        conditions: undefined,
        actions: undefined,
      };
    }),
  });
});

const get = asyncHandler(async (req, res) => {
  const rule = await WorkflowRule.findByPk(req.params.id, { include: detailInclude });
  if (!rule) throw new ApiError(404, 'Workflow rule not found', 'NOT_FOUND');
  res.json({ rule });
});

// POST /workflow-rules
const create = asyncHandler(async (req, res) => {
  const data = validateRuleBody(req.body || {});
  const conditions = validateConditions(req.body?.conditions);
  const actions = validateActions(req.body?.actions);

  const maxPosition = await WorkflowRule.max('position');
  const rule = await sequelize.transaction(async (t) => {
    const created = await WorkflowRule.create(
      { ...data, position: (maxPosition || 0) + 1, createdBy: req.user.id },
      { transaction: t }
    );
    await Promise.all([
      ...conditions.map((c) => WorkflowCondition.create({ ...c, ruleId: created.id }, { transaction: t })),
      ...actions.map((a) => WorkflowAction.create({ ...a, ruleId: created.id }, { transaction: t })),
    ]);
    return created;
  });

  await writeAudit(req, 'workflowRule.create', 'WorkflowRule', rule.id, { name: rule.name });
  const fresh = await WorkflowRule.findByPk(rule.id, { include: detailInclude });
  res.status(201).json({ rule: fresh });
});

// PATCH /workflow-rules/:id — conditions/actions are replaced wholesale when provided.
const update = asyncHandler(async (req, res) => {
  const rule = await WorkflowRule.findByPk(req.params.id);
  if (!rule) throw new ApiError(404, 'Workflow rule not found', 'NOT_FOUND');

  const data = validateRuleBody(req.body || {}, true);
  const conditions = req.body?.conditions !== undefined ? validateConditions(req.body.conditions) : null;
  const actions = req.body?.actions !== undefined ? validateActions(req.body.actions) : null;

  await sequelize.transaction(async (t) => {
    await rule.update(data, { transaction: t });
    if (conditions) {
      await WorkflowCondition.destroy({ where: { ruleId: rule.id }, transaction: t });
      await Promise.all(conditions.map((c) => WorkflowCondition.create({ ...c, ruleId: rule.id }, { transaction: t })));
    }
    if (actions) {
      await WorkflowAction.destroy({ where: { ruleId: rule.id }, transaction: t });
      await Promise.all(actions.map((a) => WorkflowAction.create({ ...a, ruleId: rule.id }, { transaction: t })));
    }
  });

  await writeAudit(req, 'workflowRule.update', 'WorkflowRule', rule.id, { name: rule.name });
  const fresh = await WorkflowRule.findByPk(rule.id, { include: detailInclude });
  res.json({ rule: fresh });
});

// DELETE /workflow-rules/:id — no real FK constraints on these tables (this
// codebase's convention), so children are deleted explicitly rather than
// relying on the association's onDelete hint.
const remove = asyncHandler(async (req, res) => {
  const rule = await WorkflowRule.findByPk(req.params.id);
  if (!rule) throw new ApiError(404, 'Workflow rule not found', 'NOT_FOUND');

  await sequelize.transaction(async (t) => {
    await WorkflowCondition.destroy({ where: { ruleId: rule.id }, transaction: t });
    await WorkflowAction.destroy({ where: { ruleId: rule.id }, transaction: t });
    await WorkflowRuleLog.destroy({ where: { ruleId: rule.id }, transaction: t });
    await rule.destroy({ transaction: t });
  });

  await writeAudit(req, 'workflowRule.delete', 'WorkflowRule', rule.id, { name: rule.name });
  res.json({ ok: true });
});

// PATCH /workflow-rules/reorder — Body: { order: [id, id, ...] }
const reorder = asyncHandler(async (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order.map((v) => parseInt(v, 10)).filter(Boolean) : [];
  if (!order.length) throw new ApiError(400, 'order must be a non-empty array of rule ids', 'VALIDATION_ERROR');

  const rules = await WorkflowRule.findAll({ where: { id: order } });
  if (rules.length !== order.length) {
    throw new ApiError(400, 'One or more rules do not exist', 'VALIDATION_ERROR');
  }

  await Promise.all(order.map((id, idx) => WorkflowRule.update({ position: idx + 1 }, { where: { id } })));
  res.json({ ok: true });
});

// POST /workflow-rules/:id/test — Body: { ticketId }
const test = asyncHandler(async (req, res) => {
  const ticketId = parseInt(req.body?.ticketId, 10);
  if (!ticketId) throw new ApiError(400, 'ticketId is required', 'VALIDATION_ERROR');

  try {
    const result = await testRule(req.params.id, ticketId);
    res.json(result);
  } catch (err) {
    throw new ApiError(400, err.message, 'TEST_FAILED');
  }
});

// GET /workflow-rules/:id/logs — last 100 executions
const logs = asyncHandler(async (req, res) => {
  const rule = await WorkflowRule.findByPk(req.params.id);
  if (!rule) throw new ApiError(404, 'Workflow rule not found', 'NOT_FOUND');

  const rows = await WorkflowRuleLog.findAll({
    where: { ruleId: rule.id },
    include: [{ model: Ticket, as: 'ticket', attributes: ['id', 'title'] }],
    order: [['triggeredAt', 'DESC']],
    limit: 100,
  });
  res.json({ logs: rows });
});

module.exports = { list, get, create, update, remove, reorder, test, logs };
