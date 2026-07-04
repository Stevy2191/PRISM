const { BusinessHours, Department, HolidayList } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const include = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: HolidayList, as: 'holidayList', attributes: ['id', 'name'] },
];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function defaultSchedule() {
  const s = {};
  DAYS.forEach((d) => {
    const weekday = d !== 'saturday' && d !== 'sunday';
    s[d] = { start: '09:00', end: '17:00', enabled: weekday };
  });
  return s;
}

const list = asyncHandler(async (req, res) => {
  const schedules = await BusinessHours.findAll({ include, order: [['name', 'ASC']] });
  res.json({ businessHours: schedules });
});

const create = asyncHandler(async (req, res) => {
  const { name, departmentId, timezone, schedule, is24x7, holidayListId } = req.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
  const bh = await BusinessHours.create({
    name: name.trim(),
    departmentId: departmentId || null,
    timezone: timezone || 'UTC',
    schedule: schedule || defaultSchedule(),
    is24x7: !!is24x7,
    holidayListId: holidayListId || null,
  });
  await writeAudit(req, 'businessHours.create', 'BusinessHours', bh.id, { name: bh.name });
  const fresh = await BusinessHours.findByPk(bh.id, { include });
  res.status(201).json({ businessHours: fresh });
});

const update = asyncHandler(async (req, res) => {
  const bh = await BusinessHours.findByPk(req.params.id);
  if (!bh) throw new ApiError(404, 'Schedule not found', 'NOT_FOUND');
  const changes = {};
  for (const k of ['name', 'departmentId', 'timezone', 'schedule', 'is24x7', 'holidayListId']) {
    if (req.body[k] !== undefined) changes[k] = req.body[k] === '' ? null : req.body[k];
  }
  await bh.update(changes);
  await writeAudit(req, 'businessHours.update', 'BusinessHours', bh.id, { name: bh.name });
  const fresh = await BusinessHours.findByPk(bh.id, { include });
  res.json({ businessHours: fresh });
});

const remove = asyncHandler(async (req, res) => {
  const bh = await BusinessHours.findByPk(req.params.id);
  if (!bh) throw new ApiError(404, 'Schedule not found', 'NOT_FOUND');
  await bh.destroy();
  await writeAudit(req, 'businessHours.delete', 'BusinessHours', bh.id, { name: bh.name });
  res.json({ ok: true });
});

// POST /business-hours/:id/clone — duplicates name/days/times/timezone/
// department/24-7/holiday-list link so the admin can tweak a copy rather
// than re-entering every day from scratch.
const clone = asyncHandler(async (req, res) => {
  const original = await BusinessHours.findByPk(req.params.id);
  if (!original) throw new ApiError(404, 'Schedule not found', 'NOT_FOUND');
  const copy = await BusinessHours.create({
    name: `Copy of ${original.name}`,
    departmentId: original.departmentId,
    timezone: original.timezone,
    schedule: original.schedule,
    is24x7: original.is24x7,
    holidayListId: original.holidayListId,
  });
  await writeAudit(req, 'businessHours.clone', 'BusinessHours', copy.id, { name: copy.name, clonedFrom: original.id });
  const fresh = await BusinessHours.findByPk(copy.id, { include });
  res.status(201).json({ businessHours: fresh });
});

module.exports = { list, create, update, remove, clone, defaultSchedule };
