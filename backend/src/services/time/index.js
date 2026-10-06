// The one time ledger's rules (sub-project 3): logging, editing and deleting
// time on a ticket or a project, the same on both sides. Controllers find the
// parent and check access; the timer logs through logTimerEntry.
const { Op } = require('sequelize');
const {
  TimeEntry, Task, User, WorkType, TeamMember,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../ticketActivity');
const { logProjectActivity } = require('../projectActivity');
const { canWorkCompany } = require('../ticketPeople');
const { hasPermission, parseRecordId } = require('../permissionService');
const { calculateLaborCost } = require('../../utils/laborCost');
const {
  orgTimeZone, todayInZone, dateInZone, toDateString,
} = require('../../utils/orgTime');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const entryInclude = [
  { model: User, as: 'user', attributes: userAttrs },
  { model: User, as: 'loggedBy', attributes: userAttrs },
  { model: Task, as: 'task', attributes: ['id', 'title', 'code'] },
  { model: WorkType, as: 'workType', attributes: ['id', 'name'] },
];
// A new entry's work type when none is sent: by side, else the first active one.
const DEFAULT_WORK_TYPE = { ticket: 'Remote support', project: 'Project work' };
const NEWEST_FIRST = [['createdAt', 'DESC'], ['id', 'DESC']];

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const given = (v) => v !== undefined && v !== null && v !== '';
const cleanNote = (v) => (given(v) ? String(v).trim() || null : null);
const displayMinutes = (seconds) => Math.max(1, Math.round(seconds / 60));

const loadEntry = (id) => TimeEntry.findByPk(id, { include: entryInclude });

async function findEntry(parent, rawId) {
  const id = parseRecordId(rawId);
  return id ? TimeEntry.findOne({ where: { id, ...parent.where } }) : null;
}

async function listEntries(parent, { limit, offset }) {
  const { rows, count } = await TimeEntry.findAndCountAll({
    where: parent.where, include: entryInclude, order: NEWEST_FIRST, limit, offset,
  });
  // The headline totals cover the whole ticket or project, not the page.
  const [seconds, labour] = await Promise.all([
    TimeEntry.sum('durationSeconds', { where: parent.where }),
    TimeEntry.sum('laborCost', { where: parent.where }),
  ]);
  return {
    rows, count, totalSeconds: Number(seconds) || 0, totalLaborCost: labour == null ? null : Number(labour),
  };
}

// ---- Body rules ----

function parseSpan(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad('Invalid start/end time');
  const durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
  if (durationSeconds <= 0) throw bad('End time must be after start time');
  return { startTime: start, endTime: end, durationSeconds };
}

// durationMinutes, or startTime + endTime (a full span wins when both come).
function readDuration(body, required) {
  const hasStart = given(body.startTime);
  const hasEnd = given(body.endTime);
  if (hasStart && hasEnd) return parseSpan(body.startTime, body.endTime);
  if (body.durationMinutes !== undefined) {
    const raw = body.durationMinutes;
    const n = Number(raw);
    if ((typeof raw !== 'number' && typeof raw !== 'string') || raw === '' || !Number.isInteger(n) || n < 1) {
      throw bad('durationMinutes must be a positive whole number');
    }
    return { startTime: null, endTime: null, durationSeconds: n * 60 };
  }
  if (hasStart || hasEnd) throw bad('Send both startTime and endTime');
  if (required) throw bad('Send durationMinutes, or startTime and endTime');
  return null;
}

// The work date: never in the future, where "today" is the organization's (Q3, Q14).
async function resolveEntryDate(value, { onEdit }) {
  const today = todayInZone(await orgTimeZone());
  if (!given(value)) {
    if (onEdit) throw bad('Invalid entry date');
    return today;
  }
  const date = toDateString(value);
  if (!date) throw bad('Invalid entry date');
  if (date > today) throw bad('Entry date cannot be in the future');
  return date;
}

// A task or subtask under the same ticket or project (S13).
async function resolveTaskId(parent, value) {
  if (!given(value)) return null;
  const id = parseRecordId(value);
  const task = id && await Task.findOne({ where: { id, ...parent.where }, attributes: ['id'] });
  if (!task) throw bad(`Task does not belong to this ${parent.kind}`);
  return task.id;
}

async function defaultWorkType(parent) {
  return (await WorkType.findOne({ where: { name: DEFAULT_WORK_TYPE[parent.kind], isActive: true } }))
    || WorkType.findOne({ where: { isActive: true }, order: [['position', 'ASC'], ['id', 'ASC']] });
}

// An inactive work type is refused, unless the entry already has it.
async function resolveWorkType(value, currentId = null) {
  const id = parseRecordId(value);
  const type = id && await WorkType.findByPk(id);
  if (!type || (!type.isActive && type.id !== currentId)) throw bad('Unknown work type');
  return type;
}

function resolveBillable(value) {
  if (value !== true && value !== false) throw bad('billable must be true or false');
  return value;
}

// ---- Who may log for whom (Q4, Q6, Q21) ----

async function isLeadOf(leadId, memberId) {
  const led = await TeamMember.findAll({ where: { userId: leadId, isLead: true }, attributes: ['teamId'] });
  if (!led.length) return false;
  const member = await TeamMember.findOne({
    where: { userId: memberId, teamId: { [Op.in]: led.map((m) => m.teamId) } }, attributes: ['teamId'],
  });
  return !!member;
}

// time.manage_others, or leading a team the person is in.
async function canManageTimeFor(actor, userId) {
  if (!userId) return false;
  if (await hasPermission(actor.id, 'time.manage_others')) return true;
  return isLeadOf(actor.id, userId);
}

// Who the time is for. Someone else needs the right to manage their time,
// and must be active, able to log time, and able to open the parent's company.
async function resolveTarget(req, parent, value) {
  if (!given(value)) return req.user;
  const id = parseRecordId(value);
  if (!id) throw bad('Invalid user to log time for');
  if (id === req.user.id) return req.user;
  if (!(await canManageTimeFor(req.user, id))) {
    throw new ApiError(403, 'You can only log time for yourself or people you manage', 'FORBIDDEN');
  }
  const target = await User.findByPk(id);
  if (!target || !target.isActive || !(await hasPermission(target.id, 'time.log'))
    || !(await canWorkCompany(target.id, parent.companyId))) {
    throw bad('Invalid user to log time for');
  }
  return target;
}

// An entry is yours if it's for you or you entered it (Q4).
async function assertCanChange(req, entry, verb) {
  const own = entry.userId === req.user.id || entry.loggedById === req.user.id;
  if (own || (await canManageTimeFor(req.user, entry.userId))) return;
  throw new ApiError(403, `You can only ${verb} your own time entries`, 'FORBIDDEN');
}

// ---- Create / edit / delete ----

async function logged(req, parent, entry, action) {
  await writeAudit(req, action, 'TimeEntry', entry.id, { ...parent.where, durationSeconds: entry.durationSeconds });
  const minutes = displayMinutes(entry.durationSeconds);
  if (parent.kind === 'ticket') await logActivity(parent.record.id, req.user.id, 'time_logged', null, `${minutes}m`);
  else await logProjectActivity(parent.record.id, req.user.id, 'time_logged', { minutes });
}

async function createEntry(req, parent, body = {}) {
  const duration = readDuration(body, true);
  const target = await resolveTarget(req, parent, body.userId);
  const entryDate = await resolveEntryDate(body.entryDate, { onEdit: false });
  const taskId = await resolveTaskId(parent, body.taskId);
  const workType = given(body.workTypeId) ? await resolveWorkType(body.workTypeId) : await defaultWorkType(parent);
  if (!workType) throw bad('No active work type is configured');
  const entry = await TimeEntry.create({
    ...parent.where,
    taskId,
    userId: target.id,
    loggedById: req.user.id,
    entryDate,
    ...duration,
    billable: body.billable === undefined ? workType.billableDefault : resolveBillable(body.billable),
    workTypeId: workType.id,
    note: cleanNote(body.note),
    laborCost: calculateLaborCost(target, { durationSeconds: duration.durationSeconds }),
  });
  await logged(req, parent, entry, 'time.create');
  return loadEntry(entry.id);
}

async function updateEntry(req, parent, entry, body = {}) {
  await assertCanChange(req, entry, 'edit');
  const changes = {};
  const duration = readDuration(body, false);
  if (duration) Object.assign(changes, duration);
  let target = null;
  // null or '' is "no change", never "move it to me".
  if (given(body.userId) && parseRecordId(body.userId) !== entry.userId) {
    target = await resolveTarget(req, parent, body.userId);
    changes.userId = target.id;
  }
  if (body.entryDate !== undefined) changes.entryDate = await resolveEntryDate(body.entryDate, { onEdit: true });
  if (body.taskId !== undefined) changes.taskId = await resolveTaskId(parent, body.taskId);
  if (body.workTypeId !== undefined) changes.workTypeId = (await resolveWorkType(body.workTypeId, entry.workTypeId)).id;
  if (body.billable !== undefined) changes.billable = resolveBillable(body.billable);
  if (body.note !== undefined) changes.note = cleanNote(body.note);
  if (changes.durationSeconds !== undefined || changes.userId !== undefined) { // Q1
    const forUser = target || await User.findByPk(entry.userId);
    changes.laborCost = calculateLaborCost(forUser, { durationSeconds: changes.durationSeconds ?? entry.durationSeconds });
  }
  await entry.update(changes);
  await writeAudit(req, 'time.update', 'TimeEntry', entry.id, { ...parent.where, fields: Object.keys(changes) }); // Q2
  return loadEntry(entry.id);
}

async function deleteEntry(req, parent, entry) {
  await assertCanChange(req, entry, 'remove');
  await entry.destroy();
  await writeAudit(req, 'time.delete', 'TimeEntry', entry.id, { ...parent.where, durationSeconds: entry.durationSeconds });
}

// The running timer's time: a span from its start, by the person running it,
// dated on the organization's calendar (Q5). Under a second still counts one.
async function logTimerEntry(req, parent, { startedAt, endedAt, taskId, note }) {
  const start = new Date(startedAt);
  const durationSeconds = Math.max(1, Math.floor((new Date(endedAt).getTime() - start.getTime()) / 1000));
  const task = taskId ? await Task.findOne({ where: { id: taskId, ...parent.where }, attributes: ['id'] }) : null;
  const workType = await defaultWorkType(parent);
  if (!workType) throw bad('No active work type is configured');
  const entry = await TimeEntry.create({
    ...parent.where,
    taskId: task ? task.id : null,
    userId: req.user.id,
    loggedById: req.user.id,
    entryDate: dateInZone(start, await orgTimeZone()),
    startTime: start,
    endTime: new Date(start.getTime() + durationSeconds * 1000),
    durationSeconds,
    billable: workType.billableDefault,
    workTypeId: workType.id,
    note: cleanNote(note) || 'Timer',
    laborCost: calculateLaborCost(req.user, { durationSeconds }),
  });
  await logged(req, parent, entry, 'timer.log');
  return loadEntry(entry.id);
}

module.exports = {
  listEntries, findEntry, createEntry, updateEntry, deleteEntry, logTimerEntry, canManageTimeFor,
};
