const { BusinessHours, Department, HolidayList } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { isValidZone } = require('../utils/orgTime');
const slaCalendar = require('../services/sla/calendar');

const include = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: HolidayList, as: 'holidayList', attributes: ['id', 'name'] },
];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// SLA clocks count on these: a real zone and well-formed day entries.
function assertValidHours({ timezone, schedule }) {
  if (timezone !== undefined && !isValidZone(timezone)) throw new ApiError(400, 'Unknown time zone', 'VALIDATION_ERROR');
  if (schedule === undefined || schedule === null) return;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) throw new ApiError(400, 'Schedule must be a set of days', 'VALIDATION_ERROR');
  Object.entries(schedule).forEach(([day, v]) => {
    if (!DAYS.includes(day) || !v || typeof v !== 'object' || !HHMM.test(v.start) || !HHMM.test(v.end)) {
      throw new ApiError(400, 'Each day needs a start and end time as HH:MM', 'VALIDATION_ERROR');
    }
  });
}

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
  assertValidHours({ timezone: timezone || 'UTC', schedule });
  const bh = await BusinessHours.create({
    name: name.trim(),
    departmentId: departmentId || null,
    timezone: timezone || 'UTC',
    schedule: schedule || defaultSchedule(),
    is24x7: !!is24x7,
    holidayListId: holidayListId || null,
  });
  await writeAudit(req, 'businessHours.create', 'BusinessHours', bh.id, { name: bh.name });
  slaCalendar.invalidate();
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
  assertValidHours(changes);
  await bh.update(changes);
  await writeAudit(req, 'businessHours.update', 'BusinessHours', bh.id, { name: bh.name });
  slaCalendar.invalidate();
  const fresh = await BusinessHours.findByPk(bh.id, { include });
  res.json({ businessHours: fresh });
});

const remove = asyncHandler(async (req, res) => {
  const bh = await BusinessHours.findByPk(req.params.id);
  if (!bh) throw new ApiError(404, 'Schedule not found', 'NOT_FOUND');
  await bh.destroy();
  await writeAudit(req, 'businessHours.delete', 'BusinessHours', bh.id, { name: bh.name });
  slaCalendar.invalidate();
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
  slaCalendar.invalidate();
  const fresh = await BusinessHours.findByPk(copy.id, { include });
  res.status(201).json({ businessHours: fresh });
});

module.exports = { list, create, update, remove, clone, defaultSchedule };
