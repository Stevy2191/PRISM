// Editing the task status lists (one per scope: ticket, project). Reading
// is GET /task-statuses (workCatalogController). A status in use can't be
// deleted, a protected one never, each scope keeps at least one open and one
// closed status, and the default (what a new task gets) is an open one.
const { Op } = require('sequelize');
const { TaskStatus, Task, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');

const SCOPES = ['ticket', 'project'];
const BEHAVIORS = ['open', 'closed', 'archived'];
const SCOPE_LABEL = { ticket: 'ticket task', project: 'project task' };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ORDER = [['position', 'ASC'], ['id', 'ASC']];
const bad = (message, code = 'VALIDATION_ERROR') => new ApiError(400, message, code);
const cleanName = (name) => (typeof name === 'string' ? name.trim() : '');

async function statusFor(rawId) {
  const id = parseRecordId(rawId);
  const status = id && await TaskStatus.findByPk(id);
  if (!status) throw new ApiError(404, 'Status not found', 'NOT_FOUND');
  return status;
}

function checkColor(color) {
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) throw bad('Color must be a hex color like #3b82f6');
}

async function assertNameFree(scope, name, exceptId = 0) {
  const clash = await TaskStatus.findOne({ where: { scope, name, id: { [Op.ne]: exceptId } } });
  if (clash) throw bad(`A ${SCOPE_LABEL[scope]} status with that name already exists`);
}

// After a change, the scope must still have an open and a closed status.
async function assertBothBehaviors(scope, transaction) {
  const rows = await TaskStatus.findAll({ where: { scope }, attributes: ['behaviorType'], transaction });
  const kinds = new Set(rows.map((r) => r.behaviorType));
  if (!kinds.has('open') || !kinds.has('closed')) throw bad('Each list needs at least one open and one closed status');
}

// POST /task-statuses { scope, name, color?, behaviorType? }
const create = asyncHandler(async (req, res) => {
  const { scope, color, behaviorType } = req.body || {};
  if (!SCOPES.includes(scope)) throw bad('scope must be ticket or project');
  const name = cleanName(req.body?.name);
  if (!name) throw bad('Status name is required');
  if (behaviorType !== undefined && !BEHAVIORS.includes(behaviorType)) throw bad('Invalid behaviorType');
  if (color !== undefined) checkColor(color);
  await assertNameFree(scope, name);
  const maxPosition = await TaskStatus.max('position', { where: { scope } });
  const status = await TaskStatus.create({
    scope, name, color: color || '#3b82f6', behaviorType: behaviorType || 'open',
    position: (Number.isFinite(maxPosition) ? maxPosition : -1) + 1,
  });
  await writeAudit(req, 'taskStatus.create', 'TaskStatus', status.id, { scope, name });
  res.status(201).json({ status });
});

// PATCH /task-statuses/:id { name?, color?, behaviorType?, isDefault? }
const update = asyncHandler(async (req, res) => {
  const status = await statusFor(req.params.id);
  const { color, behaviorType, isDefault } = req.body || {};
  const changes = {};
  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) throw bad('Status name is required');
    if (name !== status.name) { await assertNameFree(status.scope, name, status.id); changes.name = name; }
  }
  if (color !== undefined) { checkColor(color); changes.color = color; }
  if (behaviorType !== undefined) {
    if (!BEHAVIORS.includes(behaviorType)) throw bad('Invalid behaviorType');
    changes.behaviorType = behaviorType;
  }
  if (isDefault !== undefined) changes.isDefault = !!isDefault;
  // A default that stops being open stops being the default (the first open one takes over).
  else if (status.isDefault && changes.behaviorType && changes.behaviorType !== 'open') changes.isDefault = false;
  const willBeDefault = changes.isDefault ?? status.isDefault;
  if (willBeDefault && (changes.behaviorType ?? status.behaviorType) !== 'open') throw bad('The default status must be an open one');
  await sequelize.transaction(async (transaction) => {
    if (changes.isDefault) await TaskStatus.update({ isDefault: false }, { where: { scope: status.scope }, transaction });
    await status.update(changes, { transaction });
    await assertBothBehaviors(status.scope, transaction);
  });
  await writeAudit(req, 'taskStatus.update', 'TaskStatus', status.id, changes);
  res.json({ status });
});

// DELETE /task-statuses/:id
const remove = asyncHandler(async (req, res) => {
  const status = await statusFor(req.params.id);
  if (status.isProtected) throw bad('This status is protected and cannot be deleted', 'PROTECTED_STATUS');
  const used = await Task.count({ where: { statusId: status.id } });
  if (used) throw bad(`This status is used by ${used} task${used === 1 ? '' : 's'}; move them to another status first`, 'STATUS_IN_USE');
  await sequelize.transaction(async (transaction) => {
    await status.destroy({ transaction });
    await assertBothBehaviors(status.scope, transaction);
  });
  await writeAudit(req, 'taskStatus.delete', 'TaskStatus', status.id, { scope: status.scope, name: status.name });
  res.json({ ok: true });
});

// PUT /task-statuses/reorder { scope, order: [id, ...] } — the scope's whole list.
const reorder = asyncHandler(async (req, res) => {
  const { scope } = req.body || {};
  if (!SCOPES.includes(scope)) throw bad('scope must be ticket or project');
  const order = Array.isArray(req.body.order) ? req.body.order.map(parseRecordId) : [];
  const ids = (await TaskStatus.findAll({ where: { scope }, attributes: ['id'] })).map((s) => s.id);
  if (order.length !== ids.length || new Set(order).size !== ids.length || order.some((id) => !ids.includes(id))) {
    throw bad('order must list every status in the scope exactly once');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [i, id] of order.entries()) {
      await TaskStatus.update({ position: i }, { where: { id }, transaction }); // eslint-disable-line no-await-in-loop
    }
  });
  await writeAudit(req, 'taskStatus.reorder', 'TaskStatus', null, { scope, order });
  res.json({ statuses: await TaskStatus.findAll({ where: { scope }, order: ORDER }) });
});

module.exports = { create, update, remove, reorder };
