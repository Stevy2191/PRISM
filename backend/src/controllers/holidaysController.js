const { HolidayList, Holiday, Department } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const include = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: Holiday, as: 'holidays', separate: true, order: [['date', 'ASC']] },
];

// GET /holiday-lists
const list = asyncHandler(async (req, res) => {
  const lists = await HolidayList.findAll({ include, order: [['name', 'ASC']] });
  res.json({ holidayLists: lists });
});

// POST /holiday-lists — Admin
const create = asyncHandler(async (req, res) => {
  const { name, departmentId } = req.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
  const hl = await HolidayList.create({ name: name.trim(), departmentId: departmentId || null });
  await writeAudit(req, 'holidayList.create', 'HolidayList', hl.id, { name: hl.name });
  const fresh = await HolidayList.findByPk(hl.id, { include });
  res.status(201).json({ holidayList: fresh });
});

// PATCH /holiday-lists/:id — Admin
const update = asyncHandler(async (req, res) => {
  const hl = await HolidayList.findByPk(req.params.id);
  if (!hl) throw new ApiError(404, 'Holiday list not found', 'NOT_FOUND');
  const changes = {};
  if (req.body.name !== undefined) changes.name = req.body.name.trim();
  if (req.body.departmentId !== undefined) changes.departmentId = req.body.departmentId || null;
  await hl.update(changes);
  await writeAudit(req, 'holidayList.update', 'HolidayList', hl.id, { name: hl.name });
  const fresh = await HolidayList.findByPk(hl.id, { include });
  res.json({ holidayList: fresh });
});

// DELETE /holiday-lists/:id — Admin
const remove = asyncHandler(async (req, res) => {
  const hl = await HolidayList.findByPk(req.params.id);
  if (!hl) throw new ApiError(404, 'Holiday list not found', 'NOT_FOUND');
  await hl.destroy();
  await writeAudit(req, 'holidayList.delete', 'HolidayList', hl.id, { name: hl.name });
  res.json({ ok: true });
});

// POST /holiday-lists/:id/holidays — Admin
const addHoliday = asyncHandler(async (req, res) => {
  const hl = await HolidayList.findByPk(req.params.id);
  if (!hl) throw new ApiError(404, 'Holiday list not found', 'NOT_FOUND');
  const { name, date } = req.body || {};
  if (!name || !name.trim() || !date) {
    throw new ApiError(400, 'Holiday name and date are required', 'VALIDATION_ERROR');
  }
  const holiday = await Holiday.create({ holidayListId: hl.id, name: name.trim(), date });
  await writeAudit(req, 'holiday.create', 'Holiday', holiday.id, { holidayListId: hl.id });
  res.status(201).json({ holiday });
});

// DELETE /holiday-lists/:id/holidays/:holidayId — Admin
const removeHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findOne({
    where: { id: req.params.holidayId, holidayListId: req.params.id },
  });
  if (!holiday) throw new ApiError(404, 'Holiday not found', 'NOT_FOUND');
  await holiday.destroy();
  await writeAudit(req, 'holiday.delete', 'Holiday', holiday.id, { holidayListId: req.params.id });
  res.json({ ok: true });
});

module.exports = { list, create, update, remove, addHoliday, removeHoliday };
