// Editing the work types (Remote support, On-site, ...). Reading is
// GET /work-types (workCatalogController). A type in use is deactivated,
// never deleted, and at least one type stays active.
const { Op } = require('sequelize');
const { WorkType, TimeEntry } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');

const NAME_MAX = 100;
const bad = (message, code = 'VALIDATION_ERROR', status = 400) => new ApiError(status, message, code);

function cleanName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw bad('Work type name is required');
  if (name.length > NAME_MAX) throw bad(`Work type name must be ${NAME_MAX} characters or fewer`);
  return name;
}

async function typeFor(rawId) {
  const id = parseRecordId(rawId);
  const type = id && await WorkType.findByPk(id);
  if (!type) throw new ApiError(404, 'Work type not found', 'NOT_FOUND');
  return type;
}

async function assertNameFree(name, exceptId = 0) {
  if (await WorkType.findOne({ where: { name, id: { [Op.ne]: exceptId } } })) throw bad('A work type with that name already exists');
}

const othersActive = (type) => WorkType.count({ where: { isActive: true, id: { [Op.ne]: type.id } } });

// POST /work-types { name, billableDefault?, isActive? }
const create = asyncHandler(async (req, res) => {
  const name = cleanName(req.body?.name);
  await assertNameFree(name);
  const maxPosition = await WorkType.max('position');
  const workType = await WorkType.create({
    name,
    billableDefault: req.body.billableDefault === undefined ? true : !!req.body.billableDefault,
    isActive: req.body.isActive === undefined ? true : !!req.body.isActive,
    position: (Number.isFinite(maxPosition) ? maxPosition : -1) + 1,
  });
  await writeAudit(req, 'workType.create', 'WorkType', workType.id, { name });
  res.status(201).json({ workType });
});

// PATCH /work-types/:id { name?, billableDefault?, isActive? }
const update = asyncHandler(async (req, res) => {
  const workType = await typeFor(req.params.id);
  const changes = {};
  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (name !== workType.name) { await assertNameFree(name, workType.id); changes.name = name; }
  }
  if (req.body?.billableDefault !== undefined) changes.billableDefault = !!req.body.billableDefault;
  if (req.body?.isActive !== undefined) changes.isActive = !!req.body.isActive;
  if (changes.isActive === false && workType.isActive && !(await othersActive(workType))) {
    throw bad('At least one work type must stay active');
  }
  await workType.update(changes);
  await writeAudit(req, 'workType.update', 'WorkType', workType.id, changes);
  res.json({ workType });
});

// DELETE /work-types/:id — only a type no time entry uses.
const remove = asyncHandler(async (req, res) => {
  const workType = await typeFor(req.params.id);
  if (await TimeEntry.count({ where: { workTypeId: workType.id } })) {
    throw bad('This work type is used by time entries; deactivate it instead', 'WORK_TYPE_IN_USE', 409);
  }
  if (workType.isActive && !(await othersActive(workType))) throw bad('At least one work type must stay active');
  await workType.destroy();
  await writeAudit(req, 'workType.delete', 'WorkType', workType.id, { name: workType.name });
  res.json({ ok: true });
});

module.exports = { create, update, remove };
