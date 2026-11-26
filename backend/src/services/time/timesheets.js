// Timesheets (Phase 3, step 3): each person's week, built from the time they
// logged. They submit it; someone holding money.timesheets.approve approves
// it or sends it back with a note — a department's managers for its people,
// anyone who sees everyone's reports (reports.view_all) for everyone. A submitted or approved week
// is locked to its owner (an approver may still correct an entry, which is
// audited as usual). Works with Customer billing off: it's for the
// internal team too.
const { Op } = require('sequelize');
const {
  Timesheet, TimeEntry, User, SystemSettings, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { hasPermission, activeUserIdsWithPermission, parseRecordId } = require('../permissionService');
const { createNotification } = require('../notifications');
const { orgToday, addDays } = require('../../utils/orgTime');

const LOCKED = ['submitted', 'approved'];
// Department managers hold time.manage_others too, so "decides for everyone"
// follows the reports scope: whoever sees everyone's reports.
const EVERYONE = 'reports.view_all';
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const notFound = () => new ApiError(404, 'Timesheet not found', 'NOT_FOUND');

// 1 = Monday (default) … 0 = Sunday.
async function weekStartsOn() {
  const row = await SystemSettings.findByPk('timesheets.weekStartsOn', { attributes: ['value'] });
  if (!row || row.value === null || row.value === '') return 1;
  const n = Number(row.value);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
}
function weekStartOf(date, startsOn) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day - startsOn + 7) % 7));
}
async function readWeek(raw) {
  const date = raw || await orgToday();
  if (!isDate(date)) throw new ApiError(400, 'The week is not a date', 'VALIDATION_ERROR');
  return weekStartOf(date, await weekStartsOn());
}

async function entriesOf(userId, weekStart, transaction) {
  return TimeEntry.findAll({
    where: { userId, entryDate: { [Op.between]: [weekStart, addDays(weekStart, 6)] } },
    attributes: ['id', 'ticketId', 'projectId', 'taskId', 'entryDate', 'durationSeconds', 'note', 'billable', 'billingStatus'],
    order: [['entryDate', 'ASC'], ['id', 'ASC']],
    transaction,
  });
}

function sheetJson(sheet, weekStart, entries) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const own = entries ? entries.filter((e) => e.entryDate === date) : [];
    return { date, seconds: own.reduce((s, e) => s + e.durationSeconds, 0), entries: own.map((e) => e.toJSON()) };
  });
  return {
    id: sheet ? sheet.id : null,
    userId: sheet ? sheet.userId : null,
    user: sheet && sheet.user ? { id: sheet.user.id, displayName: sheet.user.displayName } : undefined,
    weekStart,
    status: sheet ? sheet.status : 'open',
    totalSeconds: entries ? entries.reduce((s, e) => s + e.durationSeconds, 0) : (sheet ? sheet.totalSeconds : 0),
    submittedAt: sheet ? sheet.submittedAt : null,
    decidedAt: sheet ? sheet.decidedAt : null,
    decidedById: sheet ? sheet.decidedById : null,
    note: sheet ? sheet.note : null,
    days: entries ? days : undefined,
  };
}

async function weekOf(userId, rawWeek) {
  const weekStart = await readWeek(rawWeek);
  const [sheet, entries] = await Promise.all([Timesheet.findOne({ where: { userId, weekStart } }), entriesOf(userId, weekStart)]);
  return sheetJson(sheet, weekStart, entries);
}

// Who decides a person's week: approvers in their department, else (no
// department, or nobody there) approvers who decide for everyone.
async function approversFor(user) {
  const ids = await activeUserIdsWithPermission('money.timesheets.approve');
  const people = ids.length ? await User.findAll({ where: { id: ids.filter((id) => id !== user.id) }, attributes: ['id', 'departmentId'] }) : [];
  const near = people.filter((p) => user.departmentId && p.departmentId === user.departmentId).map((p) => p.id);
  if (near.length) return near;
  const out = [];
  for (const p of people) if (await hasPermission(p.id, EVERYONE)) out.push(p.id); // eslint-disable-line no-await-in-loop
  return out;
}

async function submit(user, rawWeek) {
  const weekStart = await readWeek(rawWeek);
  await sequelize.transaction(async (t) => {
    const [row] = await Timesheet.findOrCreate({ where: { userId: user.id, weekStart }, defaults: { status: 'open' }, transaction: t });
    const sheet = await Timesheet.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (LOCKED.includes(sheet.status)) throw new ApiError(409, 'This week has already been submitted', 'TIMESHEET_LOCKED');
    const entries = await entriesOf(user.id, weekStart, t);
    await sheet.update({
      status: 'submitted', submittedAt: new Date(), decidedAt: null, decidedById: null, totalSeconds: entries.reduce((s, e) => s + e.durationSeconds, 0),
    }, { transaction: t });
  });
  const me = await User.findByPk(user.id, { attributes: ['id', 'displayName', 'departmentId'] });
  for (const userId of await approversFor(me)) {
    // eslint-disable-next-line no-await-in-loop
    await createNotification({ userId, type: 'timesheet_submitted', message: `${me.displayName} submitted their timesheet for the week of ${weekStart}` });
  }
  return weekOf(user.id, weekStart);
}

// The people whose weeks the actor decides: null = everyone.
async function scopeFor(actor) {
  if (await hasPermission(actor.id, EVERYONE)) return null;
  const me = await User.findByPk(actor.id, { attributes: ['departmentId'] });
  return me && me.departmentId ? { departmentId: me.departmentId } : { id: -1 };
}

async function pending(actor, { status = 'submitted' } = {}) {
  const scope = await scopeFor(actor);
  const rows = await Timesheet.findAll({
    where: { status: ['open', 'submitted', 'approved', 'rejected'].includes(status) ? status : 'submitted' },
    include: [{
      model: User, as: 'user', attributes: ['id', 'displayName', 'departmentId'], ...(scope ? { where: scope, required: true } : {}),
    }],
    order: [['weekStart', 'DESC'], ['id', 'ASC']],
    limit: 500,
  });
  return rows.map((r) => sheetJson(r, r.weekStart, null));
}

async function decide(actor, rawId, { approve, note }) {
  const scope = await scopeFor(actor);
  const sheet = await Timesheet.findByPk(parseRecordId(rawId) || 0, { include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'departmentId'] }] });
  if (!sheet || !sheet.user || (scope && (scope.id === -1 || sheet.user.departmentId !== scope.departmentId))) throw notFound();
  if (sheet.userId === actor.id) throw new ApiError(403, 'Someone else approves your own timesheet', 'FORBIDDEN');
  const why = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
  if (!approve && !why) throw new ApiError(400, 'Say what needs changing', 'VALIDATION_ERROR');
  const [n] = await Timesheet.update(
    {
      status: approve ? 'approved' : 'rejected', decidedAt: new Date(), decidedById: actor.id, note: approve ? (why || null) : why,
    },
    { where: { id: sheet.id, status: 'submitted' } },
  );
  if (!n) throw new ApiError(409, 'Only a submitted timesheet can be approved or sent back', 'TIMESHEET_STATE');
  if (!approve) {
    await createNotification({ userId: sheet.userId, type: 'timesheet_rejected', message: `Your timesheet for the week of ${sheet.weekStart} was sent back: ${why}` });
  }
  const fresh = await Timesheet.findByPk(sheet.id, { include: [{ model: User, as: 'user', attributes: ['id', 'displayName'] }] });
  return sheetJson(fresh, fresh.weekStart, null);
}

// Refuses an owner's change to time in a submitted or approved week.
async function assertWeekOpen(actorId, userId, date) {
  if (!date || actorId !== userId) return;
  const weekStart = weekStartOf(date, await weekStartsOn());
  if (await Timesheet.count({ where: { userId, weekStart, status: LOCKED } })) {
    throw new ApiError(409, 'That week\'s timesheet has been submitted. Ask your manager to send it back to change it.', 'TIMESHEET_LOCKED');
  }
}

// Once a week is over: a reminder to everyone who logged time in it and
// hasn't submitted it, once.
async function remindOpenWeeks({ today } = {}) {
  const day = today || await orgToday();
  const weekStart = weekStartOf(addDays(day, -7), await weekStartsOn());
  const rows = await TimeEntry.findAll({
    where: { entryDate: { [Op.between]: [weekStart, addDays(weekStart, 6)] } }, attributes: ['userId'], group: ['userId'], raw: true,
  });
  const reminded = [];
  for (const { userId } of rows) {
    // eslint-disable-next-line no-await-in-loop
    const [sheet] = await Timesheet.findOrCreate({ where: { userId, weekStart }, defaults: { status: 'open' } });
    if (LOCKED.includes(sheet.status) || sheet.remindedAt) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const [n] = await Timesheet.update({ remindedAt: new Date() }, { where: { id: sheet.id, remindedAt: null } });
    if (!n) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await createNotification({ userId, type: 'timesheet_due', message: `Your timesheet for the week of ${weekStart} is ready to submit` });
    reminded.push(userId);
  }
  return { weekStart, reminded };
}

let started = false;
function startTimesheetScheduler() {
  if (started) return;
  started = true;
  const tick = () => remindOpenWeeks().catch((err) => console.error('[timesheets] reminders failed:', err));
  tick();
  setInterval(tick, 60 * 60 * 1000);
}

module.exports = {
  weekStartOf, weekOf, submit, pending, decide, assertWeekOpen, remindOpenWeeks, startTimesheetScheduler,
};
