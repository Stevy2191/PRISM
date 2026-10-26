// The projects list (sub-project 6): the attention filters and tile counts, and
// the per-row figures (hours, current phase, next milestone), all in batched
// queries so a page of projects costs a handful of queries however long it is.
const { Op } = require('sequelize');
const {
  Project, ProjectPhase, Task, TimeEntry, sequelize,
} = require('../../models');
const { taskStatusBehaviorMap } = require('../tasks/statuses');
const { getProjectStatusBuckets } = require('../statusBehavior');
const { andWhere, projectScopeWhere } = require('../recordScope');
const { parseRecordId } = require('../permissionService');

const ATTENTION = ['over_budget', 'milestones_7d', 'unassigned'];

// 'YYYY-MM-DD' only if it is a real calendar date. No Date maths on the string
// beyond checking it round-trips.
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? value : null;
}

// The client's local date, else the server's own.
function todayFrom(query) {
  const given = validDay(query && query.today);
  if (given) return given;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function closedTaskStatusIds() {
  const behavior = await taskStatusBehaviorMap();
  return [...behavior].filter(([, b]) => b === 'closed').map(([id]) => id);
}

const idList = (ids) => (ids.length ? ids.map((n) => Number(n)).join(',') : '0');

// SQL for the tasks an attention kind counts, on a task table aliased `t`.
function taskWhereSql(kind, { today, closedIds }, t = 't') {
  const open = `${t}.statusId NOT IN (${idList(closedIds)})`;
  if (kind === 'unassigned') return `${t}.assigneeId IS NULL AND ${open}`;
  // The window runs from today to a week from today, inclusive. DATE_ADD does
  // the day maths in the database, on a date already checked by validDay.
  return `${t}.isMilestone = 1 AND ${t}.parentTaskId IS NULL AND ${open} AND ${t}.dueDate >= ${sequelize.escape(today)} AND ${t}.dueDate <= DATE_ADD(${sequelize.escape(today)}, INTERVAL 7 DAY)`;
}

// A where fragment on Project for one attention kind (open projects only).
async function attentionClause(kind, today) {
  if (!ATTENTION.includes(kind)) return { id: -1 };
  const buckets = await getProjectStatusBuckets();
  const open = { status: { [Op.in]: buckets.open } };
  if (kind === 'over_budget') {
    return andWhere(open, sequelize.literal(
      '(Project.hourBudgetMinutes IS NOT NULL AND (SELECT ROUND(COALESCE(SUM(te.durationSeconds), 0) / 60) FROM TimeEntries te WHERE te.projectId = Project.id) > Project.hourBudgetMinutes)',
    ));
  }
  const closedIds = await closedTaskStatusIds();
  return andWhere(open, sequelize.literal(
    `EXISTS (SELECT 1 FROM Tasks t WHERE t.projectId = Project.id AND ${taskWhereSql(kind, { today, closedIds })})`,
  ));
}

// The list's company and department filters, so the tiles count what the list
// would show. They only narrow; the viewer's scope is ANDed in separately.
function narrowingWhere(user, query) {
  const parts = [];
  const id = (v) => parseRecordId(v) || -1;
  if (query.companyId) parts.push({ companyId: id(query.companyId) });
  if (query.ownerDept) parts.push({ ownerDepartmentId: id(query.ownerDept) });
  if (query.forDept) parts.push({ forDepartmentId: id(query.forDept) });
  if (query.myDepartment === 'true' && user.departmentId) {
    parts.push({ [Op.or]: [{ ownerDepartmentId: user.departmentId }, { forDepartmentId: user.departmentId }] });
  }
  return andWhere(...parts);
}

// The three tile numbers for what this viewer can see: projects over budget,
// milestones due in the next 7 days, and tasks with no assignee. Open projects only.
async function attentionCounts(user, query) {
  const today = todayFrom(query);
  const buckets = await getProjectStatusBuckets();
  const base = andWhere({ status: { [Op.in]: buckets.open } }, narrowingWhere(user, query || {}), await projectScopeWhere(user));
  const overBudget = await Project.count({ where: andWhere(base, await attentionClause('over_budget', today)) });
  const visible = await Project.findAll({ where: base, attributes: ['id'], raw: true });
  const projectIds = visible.map((p) => p.id);
  if (!projectIds.length) return { overBudget, milestonesSoon: 0, unassignedTasks: 0 };
  const closedIds = await closedTaskStatusIds();
  const countTasks = (kind) => Task.count({
    where: andWhere({ projectId: { [Op.in]: projectIds } }, sequelize.literal(taskWhereSql(kind, { today, closedIds }, 'Task'))),
  });
  return {
    overBudget,
    milestonesSoon: await countTasks('milestones_7d'),
    unassignedTasks: await countTasks('unassigned'),
  };
}

// Figures for each listed project: { loggedMinutes, currentPhase, nextMilestone }.
async function rowFigures(projectIds) {
  const out = new Map(projectIds.map((id) => [id, { loggedMinutes: 0, currentPhase: null, nextMilestone: null }]));
  if (!projectIds.length) return out;
  const hours = await TimeEntry.findAll({
    where: { projectId: { [Op.in]: projectIds } },
    attributes: ['projectId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'seconds']],
    group: ['projectId'],
    raw: true,
  });
  for (const h of hours) out.get(h.projectId).loggedMinutes = Math.round(Number(h.seconds) / 60);

  const [phases, tasks, behavior] = await Promise.all([
    ProjectPhase.findAll({ where: { projectId: { [Op.in]: projectIds } }, attributes: ['id', 'projectId', 'name'], order: [['position', 'ASC'], ['id', 'ASC']], raw: true }),
    Task.findAll({
      where: { projectId: { [Op.in]: projectIds }, parentTaskId: null },
      attributes: ['id', 'projectId', 'phaseId', 'statusId', 'isMilestone', 'code', 'title', 'dueDate'],
      raw: true,
    }),
    taskStatusBehaviorMap(),
  ]);
  const isOpen = (t) => behavior.get(t.statusId) !== 'closed';
  const tasksOf = new Map();
  for (const t of tasks) {
    if (!tasksOf.has(t.projectId)) tasksOf.set(t.projectId, []);
    tasksOf.get(t.projectId).push(t);
  }
  const phasesOf = new Map();
  for (const ph of phases) {
    if (!phasesOf.has(ph.projectId)) phasesOf.set(ph.projectId, []);
    phasesOf.get(ph.projectId).push(ph);
  }
  for (const [projectId, figures] of out) {
    const mine = tasksOf.get(projectId) || [];
    for (const ph of phasesOf.get(projectId) || []) {
      const inPhase = mine.filter((t) => t.phaseId === ph.id);
      if (inPhase.some(isOpen)) {
        figures.currentPhase = { name: ph.name, doneCount: inPhase.filter((t) => !isOpen(t)).length, taskCount: inPhase.length };
        break;
      }
    }
    // Earliest open milestone, undated ones last, ties by id.
    const next = mine.filter((t) => t.isMilestone && isOpen(t)).sort((x, y) => {
      if (!x.dueDate !== !y.dueDate) return x.dueDate ? -1 : 1;
      if (x.dueDate !== y.dueDate) return x.dueDate < y.dueDate ? -1 : 1;
      return x.id - y.id;
    })[0];
    if (next) figures.nextMilestone = { id: next.id, code: next.code, title: next.title, dueDate: next.dueDate || null };
  }
  return out;
}

module.exports = {
  ATTENTION, validDay, todayFrom, attentionClause, attentionCounts, rowFigures,
};
