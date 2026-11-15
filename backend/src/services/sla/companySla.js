// Each company's own SLA (CS part 2): its targets by ticket type and
// priority, its support hours and time zone, and its holidays, all in one
// SlaPolicy row (companyId). The row with no company holds the starting
// values, copied into a company when it is created.
const { Op } = require('sequelize');
const {
  sequelize, SlaPolicy, SlaTarget, Holiday, Company,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { isValidZone } = require('../../utils/orgTime');
const slaCalendar = require('./calendar');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TYPES = ['incident', 'request', 'problem', 'change', 'task'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const CLOCKS = ['assign', 'response', 'resolution'];
const UNITS = ['minutes', 'business_days'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_MINUTES = 60 * 24 * 365;

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

async function startingValues(transaction) {
  const row = await SlaPolicy.findOne({ where: { companyId: null }, order: [['isDefault', 'DESC'], ['id', 'ASC']], transaction });
  if (!row) throw new ApiError(500, 'The SLA starting values are missing', 'SLA_MISSING');
  return row;
}

// A copy of `source` (targets, hours, zone, holidays) for a company.
async function copyPolicy(source, { companyId, name }, transaction) {
  const row = await SlaPolicy.create({
    name: String(name || 'Company').slice(0, 100),
    isDefault: false,
    companyId,
    warnAtPercent: source.warnAtPercent,
    timezone: source.timezone,
    is24x7: source.is24x7,
    schedule: source.schedule,
  }, { transaction });
  const targets = await SlaTarget.findAll({ where: { slaPolicyId: source.id }, raw: true, transaction });
  if (targets.length) {
    await SlaTarget.bulkCreate(targets.map(({ id, createdAt, updatedAt, ...t }) => ({ ...t, slaPolicyId: row.id })), { transaction }); // eslint-disable-line no-unused-vars
  }
  const days = await Holiday.findAll({ where: { slaPolicyId: source.id }, raw: true, transaction });
  if (days.length) await Holiday.bulkCreate(days.map(({ id, ...h }) => ({ ...h, slaPolicyId: row.id })), { transaction }); // eslint-disable-line no-unused-vars
  return row;
}

// The company's own row, made from the starting values the first time.
async function ensureCompanySla(company, transaction) {
  const existing = await SlaPolicy.findOne({ where: { companyId: company.id }, transaction });
  if (existing) return existing;
  return copyPolicy(await startingValues(transaction), { companyId: company.id, name: company.name }, transaction);
}

// The SLA row a ticket of this company uses: its own, else the starting values.
async function policyIdForCompany(companyId, transaction) {
  if (companyId) {
    const own = await SlaPolicy.findOne({ where: { companyId }, attributes: ['id'], transaction });
    if (own) return own.id;
  }
  const start = await SlaPolicy.findOne({ where: { companyId: null }, order: [['isDefault', 'DESC'], ['id', 'ASC']], attributes: ['id'], transaction });
  return start ? start.id : null;
}

// ---- Reading and writing one (a company's, or the starting values) ----------

function presentTargets(targets) {
  const out = {};
  for (const type of TYPES) {
    out[type] = {};
    for (const priority of PRIORITIES) {
      const t = targets.find((x) => x.ticketType === type && x.priority === priority);
      out[type][priority] = Object.fromEntries(CLOCKS.flatMap((c) => [
        [`${c}Minutes`, t ? t[`${c}Minutes`] : null],
        [`${c}Unit`, t ? (t[`${c}Unit`] || 'minutes') : 'minutes'],
      ]).concat([['useBusinessHours', t ? !!t.useBusinessHours : true]]));
    }
  }
  return out;
}

async function presentSla(row) {
  const [targets, holidays] = await Promise.all([
    SlaTarget.findAll({ where: { slaPolicyId: row.id }, raw: true }),
    Holiday.findAll({ where: { slaPolicyId: row.id }, order: [['date', 'ASC']], raw: true }),
  ]);
  return {
    id: row.id,
    companyId: row.companyId,
    warnAtPercent: row.warnAtPercent,
    timezone: row.timezone,
    is24x7: !!row.is24x7,
    schedule: row.schedule || Object.fromEntries(DAYS.map((d) => [d, { enabled: !['saturday', 'sunday'].includes(d), start: '08:00', end: '17:00' }])),
    targets: presentTargets(targets),
    holidays: holidays.map((h) => ({ id: h.id, name: h.name, date: String(h.date).slice(0, 10) })),
  };
}

function cleanSchedule(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Support hours need a day-by-day schedule');
  const out = {};
  for (const d of DAYS) {
    const day = raw[d] || {};
    const enabled = day.enabled === true;
    if (enabled && (!HHMM.test(day.start || '') || !HHMM.test(day.end || '') || day.end <= day.start)) {
      throw bad(`${d[0].toUpperCase()}${d.slice(1)} needs an opening time before its closing time`);
    }
    out[d] = enabled ? { enabled: true, start: day.start, end: day.end } : { enabled: false, start: day.start || '08:00', end: day.end || '17:00' };
  }
  if (!DAYS.some((d) => out[d].enabled)) throw bad('Open at least one day, or choose around the clock');
  return out;
}

function cleanTarget(raw = {}) {
  const t = {};
  for (const c of CLOCKS) {
    const v = raw[`${c}Minutes`];
    if (v === null || v === undefined || v === '') t[`${c}Minutes`] = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) throw bad('A target is a whole number of minutes, at least 1');
      t[`${c}Minutes`] = n;
    }
    const unit = raw[`${c}Unit`] || 'minutes';
    if (!UNITS.includes(unit)) throw bad('A target is in minutes or business days');
    t[`${c}Unit`] = unit;
  }
  t.useBusinessHours = raw.useBusinessHours !== false;
  return t;
}

// PUT body: { warnAtPercent?, timezone?, is24x7?, schedule?, targets? }
async function saveSla(row, body = {}) {
  const changes = {};
  if (body.warnAtPercent !== undefined) {
    const n = Number(body.warnAtPercent);
    if (!Number.isInteger(n) || n < 1 || n > 99) throw bad('Warn between 1% and 99% of the time');
    changes.warnAtPercent = n;
  }
  if (body.timezone !== undefined) {
    if (!isValidZone(body.timezone)) throw bad('Choose a real time zone');
    changes.timezone = body.timezone;
  }
  if (body.is24x7 !== undefined) changes.is24x7 = body.is24x7 === true;
  if (body.schedule !== undefined) changes.schedule = cleanSchedule(body.schedule);
  if ((changes.is24x7 === false || (changes.is24x7 === undefined && !row.is24x7)) && !changes.schedule && !row.schedule) {
    throw bad('Set the support hours, or choose around the clock');
  }
  await sequelize.transaction(async (transaction) => {
    if (Object.keys(changes).length) await row.update(changes, { transaction });
    if (body.targets && typeof body.targets === 'object') {
      for (const type of TYPES) {
        for (const priority of PRIORITIES) {
          const given = body.targets[type] && body.targets[type][priority];
          if (!given) continue; // eslint-disable-line no-continue
          const values = cleanTarget(given);
          // eslint-disable-next-line no-await-in-loop
          const [target, made] = await SlaTarget.findOrCreate({
            where: { slaPolicyId: row.id, ticketType: type, priority }, defaults: { slaPolicyId: row.id, ticketType: type, priority, ...values }, transaction,
          });
          if (!made) await target.update(values, { transaction }); // eslint-disable-line no-await-in-loop
        }
      }
    }
  });
  slaCalendar.invalidate();
  return row;
}

async function addHoliday(row, { name, date } = {}) {
  const label = String(name || '').trim().slice(0, 255);
  if (!label) throw bad('Name the day off');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || Number.isNaN(Date.parse(date))) throw bad('Choose a date');
  if (await Holiday.findOne({ where: { slaPolicyId: row.id, date } })) throw bad('That day is already a holiday');
  const day = await Holiday.create({ slaPolicyId: row.id, name: label, date });
  slaCalendar.invalidate();
  return day;
}

async function removeHoliday(row, holidayId) {
  const n = await Holiday.destroy({ where: { slaPolicyId: row.id, id: Number(holidayId) || 0 } });
  if (!n) throw new ApiError(404, 'Holiday not found', 'NOT_FOUND');
  slaCalendar.invalidate();
}

// Replaces a company's targets, hours and holidays with the starting values.
async function resetToStartingValues(row) {
  const start = await startingValues();
  await sequelize.transaction(async (transaction) => {
    await row.update({
      warnAtPercent: start.warnAtPercent, timezone: start.timezone, is24x7: start.is24x7, schedule: start.schedule,
    }, { transaction });
    await SlaTarget.destroy({ where: { slaPolicyId: row.id }, transaction });
    await Holiday.destroy({ where: { slaPolicyId: row.id }, transaction });
    const targets = await SlaTarget.findAll({ where: { slaPolicyId: start.id }, raw: true, transaction });
    await SlaTarget.bulkCreate(targets.map(({ id, createdAt, updatedAt, ...t }) => ({ ...t, slaPolicyId: row.id })), { transaction }); // eslint-disable-line no-unused-vars
    const days = await Holiday.findAll({ where: { slaPolicyId: start.id }, raw: true, transaction });
    if (days.length) await Holiday.bulkCreate(days.map(({ id, ...h }) => ({ ...h, slaPolicyId: row.id })), { transaction }); // eslint-disable-line no-unused-vars
  });
  slaCalendar.invalidate();
}

// The time zone a company's tickets' due dates are in: its support hours'
// zone (CS decision 5), else your organization's.
async function zoneForCompany(companyId, transaction) {
  const row = companyId ? await SlaPolicy.findOne({ where: { companyId }, attributes: ['timezone'], transaction }) : null;
  if (row && isValidZone(row.timezone)) return row.timezone;
  return require('../../utils/orgTime').orgTimeZone({ transaction }); // eslint-disable-line global-require
}

// Your own company's holiday dates from `since` on: the days your staff are
// off in Workload.
async function staffHolidays(since) {
  const internal = await Company.findOne({ where: { isInternal: true }, attributes: ['id'] });
  const row = internal && await SlaPolicy.findOne({ where: { companyId: internal.id }, attributes: ['id'] });
  if (!row) return [];
  return Holiday.findAll({ where: { slaPolicyId: row.id, date: { [Op.gte]: since } }, attributes: ['name', 'date'], raw: true });
}

module.exports = {
  ensureCompanySla, policyIdForCompany, zoneForCompany, startingValues, presentSla, saveSla, addHoliday, removeHoliday, resetToStartingValues, staffHolidays, copyPolicy,
};
