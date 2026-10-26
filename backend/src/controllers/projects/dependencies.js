// Dependencies between a project's top-level tasks, and shifting the tasks
// that wait on one. The rules live in services/projects/dependencies.
const { Project } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessProject, parseRecordId } = require('../../services/permissionService');
const tasks = require('../../services/tasks');
const deps = require('../../services/projects/dependencies');
const { assertCanEditProject } = require('./shared');

async function projectFor(req, { edit = true } = {}) {
  const projectId = parseRecordId(req.params.id);
  const project = projectId && await Project.findByPk(projectId);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  if (edit) await assertCanEditProject(req.user, project);
  return project;
}

// GET /projects/:id/dependencies
const listDependencies = asyncHandler(async (req, res) => {
  res.json({ dependencies: await deps.listLinks(await projectFor(req, { edit: false })) });
});

// POST /projects/:id/dependencies — { predecessorId, successorId }
const createDependency = asyncHandler(async (req, res) => {
  res.status(201).json(await deps.createLink(req, await projectFor(req), req.body));
});

// DELETE /projects/:id/dependencies/:depId
const removeDependency = asyncHandler(async (req, res) => {
  await deps.removeLink(req, await projectFor(req), req.params.depId);
  res.json({ ok: true });
});

// POST /projects/:id/tasks/:taskId/shift-dependents — { days: 1..365 }
const shiftDependents = asyncHandler(async (req, res) => {
  const project = await projectFor(req);
  const task = await tasks.findTask(tasks.projectParent(project), req.params.taskId);
  if (!task || task.parentTaskId) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  res.json({ moved: await deps.shiftDependents(req, project, task, req.body?.days) });
});

module.exports = {
  listDependencies, createDependency, removeDependency, shiftDependents,
};
