// Project templates (sub-project 6): the day-offset snapshot of a project,
// and making a project from a structure (a template or another project). A
// template keeps phases, tasks, subtasks, milestones, estimates, priorities,
// dependencies, the hour budget and tags; never assignees, time, files or
// costs. Dates are 'YYYY-MM-DD' strings.
const {
  Project, ProjectPhase, Task, TaskDependency,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { daysBetween } = require('./schedule');
const { planFromTemplate } = require('./templatePlan');
const { defaultTaskStatus } = require('../tasks/statuses');
const { formatTaskCode, formatSubtaskCode } = require('../tasks/codes');
const { LIMITS } = require('./templateStructure');

const clampDays = (n) => Math.min(Math.max(n, 0), LIMITS.days);

// The project as a template structure. Offsets count from the project's
// startDate, or else from its earliest task date; a task with no dates gets
// day 1, one day long; a milestone is 0 days long.
async function snapshotProject(projectId) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  const phases = await ProjectPhase.findAll({ where: { projectId }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const rows = await Task.findAll({ where: { projectId }, order: [['position', 'ASC'], ['id', 'ASC']] });
  if (rows.length > LIMITS.tasks) throw new ApiError(400, `A template can have at most ${LIMITS.tasks} tasks`, 'TEMPLATE_TOO_LARGE');
  if (phases.length > LIMITS.phases) throw new ApiError(400, `A template can have at most ${LIMITS.phases} phases`, 'TEMPLATE_TOO_LARGE');

  const firstOf = (t) => t.startDate || t.dueDate || null;
  let origin = project.startDate || null;
  for (const t of rows) {
    const d = firstOf(t);
    if (d && (!origin || d < origin)) origin = d;
  }
  const bar = (t) => {
    const start = firstOf(t);
    if (!start) return { startDay: 1, lengthDays: t.isMilestone ? 0 : 1 };
    const end = t.dueDate && t.dueDate > start ? t.dueDate : start;
    return {
      startDay: clampDays(daysBetween(origin, start)) + 1,
      lengthDays: t.isMilestone ? 0 : Math.max(1, clampDays(daysBetween(start, end) + 1)),
    };
  };
  const top = rows.filter((t) => !t.parentTaskId);
  const topIds = new Set(top.map((t) => t.id));
  const sub = rows.filter((t) => t.parentTaskId && topIds.has(t.parentTaskId));
  const links = top.length ? await TaskDependency.findAll({ where: { predecessorId: top.map((t) => t.id) }, order: [['id', 'ASC']] }) : [];
  return {
    hourBudgetMinutes: project.hourBudgetMinutes || null,
    tags: Array.isArray(project.tags) && project.tags.length ? project.tags : null,
    phases: phases.map((p) => ({ id: p.id, name: p.name, hourBudgetMinutes: p.hourBudgetMinutes })),
    tasks: [...top, ...sub].map((t) => ({
      id: t.id,
      parentId: t.parentTaskId,
      phaseId: t.parentTaskId ? null : t.phaseId,
      title: t.title,
      description: t.description,
      ...bar(t),
      estimateMinutes: t.isMilestone ? null : t.estimateMinutes,
      priority: t.priority,
      isMilestone: t.isMilestone,
    })),
    dependencies: links.filter((d) => topIds.has(d.successorId)).map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId })),
  };
}

// Creates the project and everything in the shape, inside the caller's
// transaction. `form.values` are the already-checked Project fields (company,
// departments, code, lead...); the shape supplies the structure, the hour
// budget (unless the form has one) and the tags (unless the form has some).
// Task codes use the same formats as every other task. Nobody is assigned.
async function instantiate(req, shape, form, transaction) {
  const plan = planFromTemplate(shape, { startDate: form.startDate, finishDate: form.finishDate });
  const status = plan.tasks.length ? await defaultTaskStatus('project') : null;
  if (plan.tasks.length && !status) throw new ApiError(400, 'No open task status is configured', 'VALIDATION_ERROR');

  const values = { ...form.values };
  values.startDate = form.startDate;
  values.templateId = form.templateId || null;
  if (values.hourBudgetMinutes === undefined) values.hourBudgetMinutes = shape.hourBudgetMinutes || null;
  if (!values.tags) values.tags = shape.tags && shape.tags.length ? shape.tags : null;
  if (!values.dueDate) values.dueDate = form.finishDate || (plan.tasks.length ? plan.finishDate : null);
  const project = await Project.create(values, { transaction });

  const phaseIds = new Map();
  for (const [i, p] of plan.phases.entries()) {
    const row = await ProjectPhase.create({ projectId: project.id, name: p.name, position: i + 1, hourBudgetMinutes: p.hourBudgetMinutes || null }, { transaction }); // eslint-disable-line no-await-in-loop
    phaseIds.set(p.id, row.id);
  }

  const parent = { kind: 'project', record: project };
  const taskIds = new Map();
  const codes = new Map();
  const counters = new Map();
  const ordered = [...plan.tasks.filter((t) => !t.parentId), ...plan.tasks.filter((t) => t.parentId)];
  for (const t of ordered) {
    const key = t.parentId === null || t.parentId === undefined ? '' : String(t.parentId);
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    const code = key ? formatSubtaskCode(codes.get(key), n) : formatTaskCode(parent, n);
    const row = await Task.create({ // eslint-disable-line no-await-in-loop
      projectId: project.id,
      parentTaskId: key ? taskIds.get(t.parentId) : null,
      code,
      title: t.title,
      description: t.description || null,
      statusId: status.id,
      priority: t.priority || 'medium',
      assigneeId: null,
      startDate: t.startDate,
      dueDate: t.dueDate,
      estimateMinutes: t.isMilestone ? null : t.estimateMinutes || null,
      phaseId: key || !t.phaseId ? null : phaseIds.get(t.phaseId) || null,
      isMilestone: Boolean(t.isMilestone),
      position: n,
      createdBy: req.user.id,
    }, { transaction });
    taskIds.set(t.id, row.id);
    codes.set(String(t.id), code);
  }
  if (plan.dependencies.length) {
    await TaskDependency.bulkCreate(
      plan.dependencies.map((d) => ({ predecessorId: taskIds.get(d.predecessorId), successorId: taskIds.get(d.successorId), createdBy: req.user.id })),
      { transaction }
    );
  }
  return project;
}

module.exports = { snapshotProject, planFromTemplate, instantiate };
