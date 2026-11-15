// CN: a company's projects in its portal: status, progress, phases and
// milestones only (no tasks, people, time, costs, files or notes).
// Who sees which (services/portal/scope.js portalProjectWhere): company
// admins every project shown in the portal; department admins their
// departments' and the company-wide ones; anyone named on a project that one.
const { Op } = require('sequelize');
const {
  Project, ProjectStatus, ProjectPhase, Task, Department,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { portalProjectWhere } = require('../../services/portal/scope');
const { parseRecordId } = require('../../services/permissionService');

const ATTRS = ['id', 'projectCode', 'name', 'status', 'startDate', 'dueDate', 'closedAt', 'forDepartmentId', 'companyId'];

async function statusBehaviors() {
  const rows = await ProjectStatus.findAll({ attributes: ['name', 'behaviorType'] });
  return new Map(rows.map((r) => [r.name, r.behaviorType]));
}

// Done = tasks closed, out of all tasks (subtasks count; milestones don't).
async function progressOf(projectIds) {
  const rows = projectIds.length ? await Task.findAll({
    where: { projectId: projectIds, isMilestone: false },
    attributes: ['projectId', 'completedAt'],
    raw: true,
  }) : [];
  const byProject = new Map(projectIds.map((id) => [id, { done: 0, total: 0 }]));
  rows.forEach((t) => {
    const p = byProject.get(t.projectId);
    p.total += 1;
    if (t.completedAt) p.done += 1;
  });
  byProject.forEach((p) => { p.percent = p.total ? Math.round((p.done / p.total) * 100) : 0; });
  return byProject;
}

function view(project, behaviors, progress, departments) {
  const dept = project.forDepartmentId ? departments.get(project.forDepartmentId) : null;
  return {
    id: project.id,
    projectCode: project.projectCode,
    name: project.name,
    status: project.status,
    statusBehavior: behaviors.get(project.status) || 'open',
    startDate: project.startDate,
    dueDate: project.dueDate,
    completedAt: project.closedAt,
    forDepartment: dept ? { id: dept.id, name: dept.name } : null,
    progress: progress.get(project.id) || { done: 0, total: 0, percent: 0 },
  };
}

async function departmentsOf(projects) {
  const ids = [...new Set(projects.map((p) => p.forDepartmentId).filter(Boolean))];
  const rows = ids.length ? await Department.findAll({ where: { id: ids }, attributes: ['id', 'name'] }) : [];
  return new Map(rows.map((d) => [d.id, d]));
}

// GET /portal/c/:slug/projects
const list = asyncHandler(async (req, res) => {
  const projects = await Project.findAll({
    where: await portalProjectWhere(req.contact),
    attributes: ATTRS,
    order: [['closedAt', 'ASC'], ['dueDate', 'ASC'], ['id', 'DESC']],
    limit: 200,
  });
  const [behaviors, progress, departments] = await Promise.all([
    statusBehaviors(), progressOf(projects.map((p) => p.id)), departmentsOf(projects),
  ]);
  // Open ones first, then the closed ones.
  const shown = projects.map((p) => view(p, behaviors, progress, departments));
  shown.sort((a, b) => Number(a.statusBehavior === 'closed') - Number(b.statusBehavior === 'closed'));
  res.json({ projects: shown });
});

// Phases (with the dates of their tasks) and milestones, in date order.
async function stepsOf(projectId) {
  const [phases, tasks] = await Promise.all([
    ProjectPhase.findAll({ where: { projectId }, attributes: ['id', 'name', 'position'], order: [['position', 'ASC'], ['id', 'ASC']] }),
    Task.findAll({ where: { projectId }, attributes: ['id', 'title', 'phaseId', 'parentTaskId', 'startDate', 'dueDate', 'completedAt', 'isMilestone'], raw: true }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const phaseOf = (t) => (t.parentTaskId ? (byId.get(t.parentTaskId) || {}).phaseId : t.phaseId);
  const steps = phases.map((ph) => {
    const own = tasks.filter((t) => !t.isMilestone && phaseOf(t) === ph.id);
    const starts = own.map((t) => t.startDate).filter(Boolean).sort();
    const dues = own.map((t) => t.dueDate).filter(Boolean).sort();
    const done = own.length > 0 && own.every((t) => t.completedAt);
    const begun = own.some((t) => t.completedAt) || (starts[0] && starts[0] <= today);
    return {
      kind: 'phase', id: ph.id, name: ph.name, startDate: starts[0] || null, dueDate: dues[dues.length - 1] || null, state: done ? 'done' : (begun ? 'active' : 'todo'), order: ph.position,
    };
  });
  tasks.filter((t) => t.isMilestone).forEach((m) => {
    steps.push({
      kind: 'milestone', id: m.id, name: m.title, startDate: m.startDate, dueDate: m.dueDate || m.startDate, state: m.completedAt ? 'done' : 'todo',
    });
  });
  // By date (a phase by its start), undated last, phases in their own order.
  const when = (s) => (s.kind === 'phase' ? s.startDate : s.dueDate) || '9999-12-31';
  steps.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : (a.order ?? 0) - (b.order ?? 0)));
  return steps.map(({ order, ...s }) => s); // eslint-disable-line no-unused-vars
}

// GET /portal/c/:slug/projects/:id
const get = asyncHandler(async (req, res) => {
  const id = parseRecordId(req.params.id);
  const project = id ? await Project.findOne({
    where: { [Op.and]: [{ id }, await portalProjectWhere(req.contact)] },
    attributes: ATTRS,
  }) : null;
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  const [behaviors, progress, departments, steps] = await Promise.all([
    statusBehaviors(), progressOf([project.id]), departmentsOf([project]), stepsOf(project.id),
  ]);
  res.json({ project: { ...view(project, behaviors, progress, departments), steps } });
});

module.exports = { list, get };
