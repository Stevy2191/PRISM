// Project hour budgets (sub-project 6): the summary, the shared value check, and
// the 80% / 100% alerts to the project lead. Hours come from the time ledger
// (TimeEntries), billable or not; nothing here stores hours.
const { Op, QueryTypes } = require('sequelize');
const {
  Project, ProjectPhase, Task, TimeEntry, User, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { taskStatusBehaviorMap } = require('../tasks/statuses');
const { createNotification } = require('../notifications');

// 100,000 hours: far past any real project, well inside an INT.
const MAX_BUDGET_MINUTES = 6000000;

// A budget in whole minutes, or null for none. Used by the project and its phases.
function cleanBudgetMinutes(value) {
  if (value === null || value === '') return null;
  const n = typeof value === 'number' || (typeof value === 'string' && /^\d{1,9}$/.test(value.trim())) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_BUDGET_MINUTES) {
    throw new ApiError(400, `Hour budget must be a whole number of minutes, 0 to ${MAX_BUDGET_MINUTES}`, 'VALIDATION_ERROR');
  }
  return n;
}

// Seconds logged per task for the project (taskId null = no task).
async function secondsByTask(projectId) {
  const rows = await TimeEntry.findAll({
    where: { projectId },
    attributes: ['taskId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'seconds']],
    group: ['taskId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.taskId, Number(r.seconds) || 0]));
}

// Seconds per phase from every user's time on its tasks; an entry on a subtask
// counts toward its parent's phase.
async function phaseSeconds(projectId, byTask = null) {
  const seconds = byTask || await secondsByTask(projectId);
  const tasks = await Task.findAll({ where: { projectId }, attributes: ['id', 'parentTaskId', 'phaseId'], raw: true });
  const phaseOf = new Map(tasks.filter((t) => !t.parentTaskId).map((t) => [t.id, t.phaseId]));
  const out = new Map();
  for (const t of tasks) {
    const phaseId = t.parentTaskId ? phaseOf.get(t.parentTaskId) : t.phaseId;
    if (phaseId) out.set(phaseId, (out.get(phaseId) || 0) + (seconds.get(t.id) || 0));
  }
  return out;
}

// What is left of the estimates on open work: each unfinished task without
// subtasks, and each unfinished subtask, less its own logged time (never below 0).
async function remainingEstimate(projectId, seconds) {
  const tasks = await Task.findAll({ where: { projectId }, attributes: ['id', 'parentTaskId', 'statusId', 'estimateMinutes'], raw: true });
  const behavior = await taskStatusBehaviorMap();
  const parents = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId));
  let total = 0;
  for (const t of tasks) {
    if (parents.has(t.id) || !t.estimateMinutes || behavior.get(t.statusId) === 'closed') continue; // eslint-disable-line no-continue
    total += Math.max(0, t.estimateMinutes - Math.round((seconds.get(t.id) || 0) / 60));
  }
  return total;
}

async function budgetSummary(projectId) {
  const project = await Project.findByPk(projectId, { attributes: ['id', 'hourBudgetMinutes'] });
  const byTask = await secondsByTask(projectId);
  const phaseSecs = await phaseSeconds(projectId, byTask);
  const phases = await ProjectPhase.findAll({ where: { projectId }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const people = await sequelize.query(
    `SELECT userId, SUM(durationSeconds) AS seconds FROM TimeEntries WHERE projectId = :projectId GROUP BY userId ORDER BY seconds DESC, userId ASC`,
    { replacements: { projectId }, type: QueryTypes.SELECT },
  );
  const users = await User.findAll({ where: { id: people.map((p) => p.userId) }, attributes: ['id', 'displayName', 'username'] });
  const names = new Map(users.map((u) => [u.id, u.displayName || u.username]));
  const billable = await TimeEntry.sum('durationSeconds', { where: { projectId, billable: true } });
  const total = [...byTask.values()].reduce((n, s) => n + s, 0);
  return {
    budgetMinutes: project.hourBudgetMinutes ?? null,
    usedMinutes: Math.round(total / 60),
    billableMinutes: Math.round((Number(billable) || 0) / 60),
    remainingEstimateMinutes: await remainingEstimate(projectId, byTask),
    phases: phases.map((p) => ({
      id: p.id, name: p.name, budgetMinutes: p.hourBudgetMinutes ?? null, usedMinutes: Math.round((phaseSecs.get(p.id) || 0) / 60),
    })),
    noTaskMinutes: Math.round((byTask.get(null) || 0) / 60),
    people: people.map((p) => ({ userId: p.userId, name: names.get(p.userId) || null, minutes: Math.round(Number(p.seconds) / 60) })),
  };
}

// The level the project's hours sit at now: 0, 80 or 100.
async function currentLevel(project) {
  if (!project.hourBudgetMinutes) return 0;
  const seconds = Number(await TimeEntry.sum('durationSeconds', { where: { projectId: project.id } })) || 0;
  const budgetSeconds = project.hourBudgetMinutes * 60;
  if (seconds >= budgetSeconds) return 100;
  return seconds * 100 >= budgetSeconds * 80 ? 80 : 0;
}

// Lowers the remembered level to match the hours, without notifying. Run when
// the budget changes, and by checkBudgetAlerts when hours fall.
async function rearmBudgetAlerts(projectId) {
  const project = await Project.findByPk(projectId, { attributes: ['id', 'hourBudgetMinutes', 'budgetAlertLevel'] });
  if (!project || project.budgetAlertLevel === 0) return;
  const level = await currentLevel(project);
  if (level < project.budgetAlertLevel) {
    await Project.update({ budgetAlertLevel: level }, { where: { id: projectId, budgetAlertLevel: { [Op.gt]: level } } });
  }
}

// After a time-ledger change: raise the remembered level if the hours crossed
// 80% or 100%, and tell the lead if this call is the one that raised it
// (the conditional UPDATE has one winner). Lower it, quietly, if they fell.
// Only the project budget alerts; a phase budget never does.
async function checkBudgetAlerts(projectId) {
  const project = await Project.findByPk(projectId);
  if (!project) return;
  const level = await currentLevel(project);
  if (level < project.budgetAlertLevel) {
    await rearmBudgetAlerts(projectId);
    return;
  }
  if (level === project.budgetAlertLevel) return;
  const [won] = await Project.update({ budgetAlertLevel: level }, { where: { id: projectId, budgetAlertLevel: { [Op.lt]: level } } });
  if (!won || !project.assignedToUserId) return;
  // 100% with its alert off still warns when the hours jumped past 80% in one go.
  const type = level === 100 && project.budgetAlert100 ? 'budget_reached'
    : (project.budgetAlert80 && project.budgetAlertLevel < 80 ? 'budget_warning' : null);
  if (!type) return;
  const used = Math.round((Number(await TimeEntry.sum('durationSeconds', { where: { projectId } })) || 0) / 60);
  const hours = (m) => `${Math.round(m / 6) / 10}`;
  await createNotification({
    userId: project.assignedToUserId,
    type,
    message: type === 'budget_warning'
      ? `${project.name} is past 80% of its hour budget (${hours(used)} of ${hours(project.hourBudgetMinutes)} hours)`
      : `${project.name} has reached its hour budget (${hours(used)} of ${hours(project.hourBudgetMinutes)} hours)`,
    projectId,
  });
}

// For a request that has already committed its time change: never fails it.
async function checkBudgetAlertsSafely(projectId) {
  try {
    await checkBudgetAlerts(projectId);
  } catch (err) {
    console.error('[budget] alert check failed:', err.message);
  }
}

module.exports = {
  MAX_BUDGET_MINUTES, cleanBudgetMinutes, phaseSeconds, budgetSummary, checkBudgetAlerts, checkBudgetAlertsSafely, rearmBudgetAlerts,
};
