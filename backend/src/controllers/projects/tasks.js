// Project tasks and subtasks: CRUD, reorder, renumber.
const { Op } = require('sequelize');
const {
  Project,
  ProjectTask,
  ProjectSubtask,
  ProjectStatus,
  User,
  sequelize,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { logProjectActivity } = require('../../services/projectActivity');
const {
  getFirstProjectStatusByBehavior,
  getProjectStatusIdBehaviorMap,
} = require('../../services/statusBehavior');
const { isTaskComplete, subtaskCompletionPercent } = require('../../services/projectCompletion');
const {
  canAccessProject,
  findAccessibleTicket,
  parseTicketId,
} = require('../../services/permissionService');
const {
  generateTaskCode,
  generateSubtaskCode,
  formatTaskCode,
  formatSubtaskCode,
} = require('../../services/projectCodeService');
const { userAttrs, taskIncludeFor } = require('./shared');

// GET /projects/:id/tasks — list with subtasks
const listTasks = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const statusIdBehavior = await getProjectStatusIdBehaviorMap();
  const tasks = await ProjectTask.findAll({
    where: { projectId: project.id },
    include: taskIncludeFor(project),
    order: [['position', 'ASC'], ['id', 'ASC']],
  });

  const annotated = tasks.map((t) => {
    const json = t.toJSON();
    json.isComplete = isTaskComplete(t, t.subtasks || [], statusIdBehavior);
    json.subtaskPercent = subtaskCompletionPercent(t.subtasks || [], statusIdBehavior);
    return json;
  });

  res.json({ tasks: annotated });
});

// POST /projects/:id/tasks
const createTask = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const { title, description, statusId, priority, assignedToUserId, dueDate, linkedTicketId } = req.body || {};
  if (!title || !title.trim()) throw new ApiError(400, 'Task title is required', 'VALIDATION_ERROR');
  // Missing and out-of-scope tickets look the same (see findAccessibleTicket),
  // and the checked ticket's own id is what gets stored.
  let resolvedLinkedTicketId = null;
  if (linkedTicketId) {
    const linked = await findAccessibleTicket(req.user, linkedTicketId);
    if (!linked || linked.companyId !== project.companyId) throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
    resolvedLinkedTicketId = linked.id;
  }

  let resolvedStatusId = statusId;
  if (!resolvedStatusId) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    if (!firstOpen) throw new ApiError(400, 'No open-behavior project status is configured', 'VALIDATION_ERROR');
    resolvedStatusId = firstOpen.id;
  }

  const maxPos = await ProjectTask.max('position', { where: { projectId: project.id } });
  const taskCode = await generateTaskCode(project.id, project.projectCode);
  const task = await ProjectTask.create({
    projectId: project.id,
    taskCode,
    title: title.trim(),
    description: description || null,
    statusId: resolvedStatusId,
    priority: priority || 'medium',
    assignedToUserId: assignedToUserId || null,
    dueDate: dueDate || null,
    linkedTicketId: resolvedLinkedTicketId,
    position: (Number.isFinite(maxPos) ? maxPos : 0) + 1,
    createdBy: req.user.id,
  });
  await logProjectActivity(project.id, req.user.id, 'task_created', { taskId: task.id, title: task.title, taskCode: task.taskCode });

  const fresh = await ProjectTask.findByPk(task.id, { include: taskIncludeFor(project) });
  res.status(201).json({ task: fresh });
});

// PATCH /projects/:id/tasks/:taskId
const updateTask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const allowed = ['title', 'description', 'statusId', 'priority', 'assignedToUserId', 'dueDate', 'linkedTicketId', 'position'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (changes.linkedTicketId !== undefined) {
    if (!changes.linkedTicketId) {
      changes.linkedTicketId = null;
    } else if (parseTicketId(changes.linkedTicketId) === task.linkedTicketId) {
      // Re-sending the task's existing link (a client PATCHing the whole task
      // back) reveals nothing new, so it isn't re-checked.
      changes.linkedTicketId = task.linkedTicketId;
    } else {
      const linked = await findAccessibleTicket(req.user, changes.linkedTicketId);
      if (!linked || linked.companyId !== project.companyId) throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
      changes.linkedTicketId = linked.id;
    }
  }

  if (changes.statusId !== undefined && changes.statusId !== task.statusId) {
    const behaviorMap = await getProjectStatusIdBehaviorMap();
    const willBeClosed = behaviorMap.get(Number(changes.statusId)) === 'closed';
    changes.completedAt = willBeClosed ? new Date() : null;
  }

  await task.update(changes);
  if (changes.statusId !== undefined) {
    const behaviorMap = await getProjectStatusIdBehaviorMap();
    if (behaviorMap.get(Number(changes.statusId)) === 'closed') {
      await logProjectActivity(req.params.id, req.user.id, 'task_closed', { taskId: task.id, title: task.title, taskCode: task.taskCode });
    }
  }

  const fresh = await ProjectTask.findByPk(task.id, { include: taskIncludeFor(project) });
  res.json({ task: fresh });
});

// DELETE /projects/:id/tasks/:taskId
const removeTask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await task.destroy();
  await logProjectActivity(req.params.id, req.user.id, 'task_deleted', { taskId: task.id, title: task.title, taskCode: task.taskCode });
  res.json({ ok: true });
});

// PATCH /projects/:id/tasks/reorder — Body: { order: [taskId, taskId, ...] }
// Updates every affected task's position in one request (drag-and-drop and
// the up/down reorder buttons both call this instead of one PATCH per task).
const reorderTasks = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const order = Array.isArray(req.body?.order) ? req.body.order.map((v) => parseInt(v, 10)).filter(Boolean) : [];
  if (!order.length) throw new ApiError(400, 'order must be a non-empty array of task IDs', 'VALIDATION_ERROR');

  const tasks = await ProjectTask.findAll({ where: { id: order, projectId: project.id } });
  if (tasks.length !== order.length) {
    throw new ApiError(400, 'One or more tasks do not belong to this project', 'VALIDATION_ERROR');
  }

  await sequelize.transaction(async (t) => {
    await Promise.all(
      order.map((taskId, idx) => ProjectTask.update({ position: idx + 1 }, { where: { id: taskId }, transaction: t }))
    );
  });

  res.json({ ok: true });
});

// PATCH /projects/:id/tasks/:taskId/code — Body: { number } — renumbers just
// the -T## suffix; does not change position (see reorderTasks for that).
const renumberTask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const number = parseInt(req.body?.number, 10);
  if (!Number.isFinite(number) || number < 1 || number > 99) {
    throw new ApiError(400, 'Task number must be between 1 and 99', 'VALIDATION_ERROR');
  }

  const newCode = formatTaskCode(project.projectCode, number);
  if (newCode !== task.taskCode) {
    const conflict = await ProjectTask.findOne({
      where: { projectId: req.params.id, taskCode: newCode, id: { [Op.ne]: task.id } },
    });
    if (conflict) {
      throw new ApiError(
        409,
        `Task T${String(number).padStart(2, '0')} already exists in this project. Choose a different number.`,
        'TASK_CODE_CONFLICT'
      );
    }
  }

  await task.update({ taskCode: newCode });
  const fresh = await ProjectTask.findByPk(task.id, { include: taskIncludeFor(project) });
  res.json({ task: fresh });
});

// ==================== Subtasks ====================

// POST /projects/:id/tasks/:taskId/subtasks
const createSubtask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const { title, statusId, assignedToUserId, dueDate } = req.body || {};
  if (!title || !title.trim()) throw new ApiError(400, 'Subtask title is required', 'VALIDATION_ERROR');

  let resolvedStatusId = statusId;
  if (!resolvedStatusId) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    if (!firstOpen) throw new ApiError(400, 'No open-behavior project status is configured', 'VALIDATION_ERROR');
    resolvedStatusId = firstOpen.id;
  }

  const maxPos = await ProjectSubtask.max('position', { where: { taskId: task.id } });
  const subtaskCode = await generateSubtaskCode(task.id, task.taskCode);
  const subtask = await ProjectSubtask.create({
    taskId: task.id,
    subtaskCode,
    title: title.trim(),
    statusId: resolvedStatusId,
    assignedToUserId: assignedToUserId || null,
    dueDate: dueDate || null,
    position: (Number.isFinite(maxPos) ? maxPos : 0) + 1,
  });

  const fresh = await ProjectSubtask.findByPk(subtask.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }, { model: ProjectStatus, as: 'status' }],
  });
  res.status(201).json({ subtask: fresh });
});

// PATCH /projects/:id/tasks/:taskId/subtasks/:subtaskId
const updateSubtask = asyncHandler(async (req, res) => {
  const subtask = await ProjectSubtask.findOne({ where: { id: req.params.subtaskId, taskId: req.params.taskId } });
  if (!subtask) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const allowed = ['title', 'statusId', 'assignedToUserId', 'dueDate', 'position'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }

  let justClosed = false;
  if (changes.statusId !== undefined && changes.statusId !== subtask.statusId) {
    const behaviorMap = await getProjectStatusIdBehaviorMap();
    const willBeClosed = behaviorMap.get(Number(changes.statusId)) === 'closed';
    changes.completedAt = willBeClosed ? new Date() : null;
    justClosed = willBeClosed;
  }

  await subtask.update(changes);
  if (justClosed) {
    await logProjectActivity(req.params.id, req.user.id, 'subtask_closed', { subtaskId: subtask.id, title: subtask.title, subtaskCode: subtask.subtaskCode });
  }

  const fresh = await ProjectSubtask.findByPk(subtask.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }, { model: ProjectStatus, as: 'status' }],
  });
  res.json({ subtask: fresh });
});

// PATCH /projects/:id/tasks/:taskId/subtasks/:subtaskId/code — Body: { number }
const renumberSubtask = asyncHandler(async (req, res) => {
  const subtask = await ProjectSubtask.findOne({ where: { id: req.params.subtaskId, taskId: req.params.taskId } });
  if (!subtask) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const number = parseInt(req.body?.number, 10);
  if (!Number.isFinite(number) || number < 1 || number > 99) {
    throw new ApiError(400, 'Subtask number must be between 1 and 99', 'VALIDATION_ERROR');
  }

  const newCode = formatSubtaskCode(task.taskCode, number);
  if (newCode !== subtask.subtaskCode) {
    const conflict = await ProjectSubtask.findOne({
      where: { taskId: req.params.taskId, subtaskCode: newCode, id: { [Op.ne]: subtask.id } },
    });
    if (conflict) {
      throw new ApiError(
        409,
        `Subtask S${String(number).padStart(2, '0')} already exists in this task. Choose a different number.`,
        'SUBTASK_CODE_CONFLICT'
      );
    }
  }

  await subtask.update({ subtaskCode: newCode });
  const fresh = await ProjectSubtask.findByPk(subtask.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }, { model: ProjectStatus, as: 'status' }],
  });
  res.json({ subtask: fresh });
});

// DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId
const removeSubtask = asyncHandler(async (req, res) => {
  // The task is loaded through the project first: access is checked on
  // project :id, so a :taskId from another project must not be reachable
  // through it.
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const subtask = await ProjectSubtask.findOne({ where: { id: req.params.subtaskId, taskId: task.id } });
  if (!subtask) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await subtask.destroy();
  res.json({ ok: true });
});

module.exports = {
  listTasks,
  createTask,
  updateTask,
  removeTask,
  reorderTasks,
  renumberTask,
  createSubtask,
  updateSubtask,
  removeSubtask,
  renumberSubtask,
};
