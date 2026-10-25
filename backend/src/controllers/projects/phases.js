// Project phases: named, ordered groups of a project's top-level tasks. A
// phase's dates and counts are derived from its tasks, never stored.
const { Op } = require('sequelize');
const {
  Project, ProjectPhase, Task, TimeEntry, sequelize,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { canAccessProject, parseRecordId } = require('../../services/permissionService');
const { taskStatusBehaviorMap } = require('../../services/tasks/statuses');
const { isTaskComplete } = require('../../services/projectCompletion');
const { phaseSpan } = require('../../services/projects/schedule');
const { assertCanEditProject } = require('./shared');

const ORDER = [['position', 'ASC'], ['id', 'ASC']];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const notFound = () => new ApiError(404, 'Phase not found', 'NOT_FOUND');

async function projectFor(req, { edit = true } = {}) {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  if (edit) await assertCanEditProject(req.user, project);
  return project;
}

// A phase id from the URL must belong to the project, else 404 before anything else.
async function phaseFor(project, rawId) {
  const id = parseRecordId(rawId);
  const phase = id && await ProjectPhase.findOne({ where: { id, projectId: project.id } });
  if (!phase) throw notFound();
  return phase;
}

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw bad('Phase name is required');
  if (name.length > 100) throw bad('Phase name is too long');
  return name;
}

function cleanBudget(value) {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw bad('Hour budget must be a whole number of minutes');
  return n;
}

async function phaseSummaries(project) {
  const phases = await ProjectPhase.findAll({ where: { projectId: project.id }, order: ORDER });
  if (!phases.length) return [];
  const tasks = await Task.findAll({
    where: { projectId: project.id, phaseId: { [Op.ne]: null }, parentTaskId: null },
    include: [{ model: Task, as: 'subtasks', separate: true }],
  });
  const behavior = await taskStatusBehaviorMap();
  // Time on a phase's tasks and their subtasks, from every user (the ledger).
  const ids = tasks.flatMap((t) => [t.id, ...t.subtasks.map((s) => s.id)]);
  const rows = ids.length ? await TimeEntry.findAll({
    where: { projectId: project.id, taskId: ids },
    attributes: ['taskId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'seconds']],
    group: ['taskId'],
    raw: true,
  }) : [];
  const seconds = new Map(rows.map((r) => [r.taskId, Number(r.seconds) || 0]));
  return phases.map((phase) => {
    const own = tasks.filter((t) => t.phaseId === phase.id);
    const span = phaseSpan(own) || { startDate: null, dueDate: null };
    const secs = own.reduce((n, t) => n + (seconds.get(t.id) || 0) + t.subtasks.reduce((m, s) => m + (seconds.get(s.id) || 0), 0), 0);
    return {
      id: phase.id,
      name: phase.name,
      position: phase.position,
      hourBudgetMinutes: phase.hourBudgetMinutes,
      startDate: span.startDate,
      dueDate: span.dueDate,
      taskCount: own.length,
      doneCount: own.filter((t) => isTaskComplete(t, t.subtasks, behavior)).length,
      loggedMinutes: Math.round(secs / 60),
      estimateMinutes: own.reduce((n, t) => n + (t.estimateMinutes || 0), 0),
    };
  });
}

const audit = (req, action, project, phaseId, meta = {}) => writeAudit(req, `projectPhase.${action}`, 'ProjectPhase', phaseId, { projectId: project.id, ...meta });

// GET /projects/:id/phases
const listPhases = asyncHandler(async (req, res) => {
  res.json({ phases: await phaseSummaries(await projectFor(req, { edit: false })) });
});

// POST /projects/:id/phases — { name }
const createPhase = asyncHandler(async (req, res) => {
  const project = await projectFor(req);
  const name = cleanName(req.body?.name);
  const maxPos = await ProjectPhase.max('position', { where: { projectId: project.id } });
  const phase = await ProjectPhase.create({ projectId: project.id, name, position: (Number.isFinite(maxPos) ? maxPos : 0) + 1 });
  await audit(req, 'create', project, phase.id, { name });
  res.status(201).json({ phase: phase.toJSON() });
});

// PATCH /projects/:id/phases/:phaseId — { name?, hourBudgetMinutes? }
const updatePhase = asyncHandler(async (req, res) => {
  const project = await projectFor(req);
  const phase = await phaseFor(project, req.params.phaseId);
  const changes = {};
  if (req.body?.name !== undefined) changes.name = cleanName(req.body.name);
  if (req.body?.hourBudgetMinutes !== undefined) changes.hourBudgetMinutes = cleanBudget(req.body.hourBudgetMinutes);
  if (Object.keys(changes).length) {
    await phase.update(changes);
    await audit(req, 'update', project, phase.id, { fields: Object.keys(changes) });
  }
  res.json({ phase: phase.toJSON() });
});

// PATCH /projects/:id/phases/reorder — { ids: [phaseId, ...] }, every phase once
const reorderPhases = asyncHandler(async (req, res) => {
  const project = await projectFor(req);
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!raw || !raw.length) throw bad('ids must be a non-empty array of phase IDs');
  const ids = raw.map(parseRecordId);
  const phases = await ProjectPhase.findAll({ where: { projectId: project.id }, attributes: ['id'] });
  const known = new Set(phases.map((p) => p.id));
  if (ids.some((id) => !id || !known.has(id))) throw notFound();
  if (new Set(ids).size !== ids.length || ids.length !== known.size) throw bad('ids must list every phase exactly once');
  await sequelize.transaction(async (transaction) => {
    for (const [idx, id] of ids.entries()) {
      await ProjectPhase.update({ position: idx + 1 }, { where: { id }, transaction }); // eslint-disable-line no-await-in-loop
    }
  });
  await audit(req, 'reorder', project, null, { ids });
  res.json({ ok: true });
});

// DELETE /projects/:id/phases/:phaseId — its tasks stay, with no phase
const removePhase = asyncHandler(async (req, res) => {
  const project = await projectFor(req);
  const phase = await phaseFor(project, req.params.phaseId);
  await sequelize.transaction(async (transaction) => {
    await Task.update({ phaseId: null }, { where: { phaseId: phase.id }, transaction });
    await phase.destroy({ transaction });
  });
  await audit(req, 'delete', project, phase.id, { name: phase.name });
  res.json({ ok: true });
});

module.exports = {
  listPhases, createPhase, updatePhase, reorderPhases, removePhase,
};
