const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const {
  Project, ProjectMember, ProjectTask, ProjectSubtask, ProjectTimeEntry,
  ProjectExpense, ProjectMaterial, ProjectFile, ProjectActivity, ProjectStatus,
  Department, User, Ticket, Team, TeamMember,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { logProjectActivity } = require('../services/projectActivity');
const {
  getProjectStatusBuckets,
  getFirstProjectStatusByBehavior,
  getProjectStatusIdBehaviorMap,
  getTicketStatusBuckets,
} = require('../services/statusBehavior');
const { computeProjectCompletion } = require('../services/projectCompletion');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { getUserProjectScope } = require('../services/permissionService');

const userAttrs = ['id', 'displayName', 'username', 'email'];

const projectInclude = [
  { model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] },
  { model: Department, as: 'forDepartment', attributes: ['id', 'name'] },
  { model: User, as: 'lead', attributes: userAttrs },
  { model: Team, as: 'team', attributes: ['id', 'name'] },
];

async function canLogForOthers(user) {
  if (user.role === 'admin') return true;
  const lead = await TeamMember.findOne({ where: { userId: user.id, isLead: true } });
  return !!lead;
}
const isStaff = (user) => user.role === 'admin' || user.role === 'technician';

// Requesters are read-only, scoped to projects that are FOR their own
// department (the "who benefits" side, not "who does the work").
function assertCanViewProject(req, project) {
  if (
    req.user.role === 'requester' &&
    (!req.user.departmentId || project.forDepartmentId !== req.user.departmentId)
  ) {
    throw new ApiError(403, 'You may only access projects for your department', 'FORBIDDEN');
  }
}

async function buildProjectStats(projectId) {
  const [completion, timeSum, expenseSum, materialSum, ticketBuckets] = await Promise.all([
    computeProjectCompletion(projectId),
    ProjectTimeEntry.sum('durationSeconds', { where: { projectId } }),
    ProjectExpense.sum('amount', { where: { projectId } }),
    ProjectMaterial.sum('totalCost', { where: { projectId } }),
    getTicketStatusBuckets(),
  ]);
  const openTicketsCount = await Ticket.count({ where: { projectId, status: { [Op.in]: ticketBuckets.open } } });
  return {
    completionPercent: completion.percent,
    totalTasks: completion.totalTasks,
    closedTasks: completion.closedTasks,
    totalTimeSeconds: Number(timeSum || 0),
    totalCost: Number(expenseSum || 0) + Number(materialSum || 0),
    openTicketsCount,
  };
}

async function getProjectWithDetail(id) {
  const project = await Project.findByPk(id, {
    include: [
      ...projectInclude,
      {
        model: ProjectMember,
        as: 'members',
        include: [{ model: User, as: 'user', attributes: userAttrs }],
      },
    ],
  });
  if (!project) return null;
  const stats = await buildProjectStats(project.id);
  const json = project.toJSON();
  json.stats = stats;
  return json;
}

// ==================== Projects ====================

// GET /projects — filters: status, ownerDept, forDept, assignee, myProjects,
// myDepartment, overdue, search. Requesters see only projects FOR their own department.
const list = asyncHandler(async (req, res) => {
  const where = {};
  const { status, ownerDept, forDept, assignee, myProjects, myDepartment, overdue, search } = req.query;

  // Scope filtering from the resolved permission set (projects.view_all >
  // projects.view_department > projects.view_own — see permissionService).
  const scope = await getUserProjectScope(req.user.id);

  if (scope === 'own') {
    const memberships = await ProjectMember.findAll({ where: { userId: req.user.id }, attributes: ['projectId'], raw: true });
    const memberProjectIds = memberships.map((m) => m.projectId);
    if (memberProjectIds.length === 0) return res.json({ projects: [] });
    where.id = { [Op.in]: memberProjectIds };
  } else if (scope === 'department') {
    const memberships = await ProjectMember.findAll({ where: { userId: req.user.id }, attributes: ['projectId'], raw: true });
    const memberProjectIds = memberships.map((m) => m.projectId);
    const or = [{ ownerDepartmentId: req.user.departmentId }, { forDepartmentId: req.user.departmentId }];
    if (memberProjectIds.length) or.push({ id: { [Op.in]: memberProjectIds } });
    where[Op.and] = [{ [Op.or]: or }];
    if (ownerDept) where.ownerDepartmentId = ownerDept;
    if (forDept) where.forDepartmentId = forDept;
  } else {
    if (ownerDept) where.ownerDepartmentId = ownerDept;
    if (forDept) where.forDepartmentId = forDept;
  }

  // "My department" quick filter — narrows to the caller's own department
  // regardless of scope tier (meaningful for 'all'/'department' scopes; a
  // 'department'-scope caller may otherwise also see cross-department
  // projects they're personally a member of via the scope OR above).
  if (myDepartment === 'true' && req.user.departmentId) {
    const deptClause = { [Op.or]: [{ ownerDepartmentId: req.user.departmentId }, { forDepartmentId: req.user.departmentId }] };
    where[Op.and] = where[Op.and] ? [...where[Op.and], deptClause] : [deptClause];
  }

  const buckets = (status === 'closed' || overdue === 'true') ? await getProjectStatusBuckets() : null;
  if (status) where.status = status === 'closed' ? { [Op.in]: buckets.closed } : status;
  if (assignee) where.assignedToUserId = assignee;
  if (overdue === 'true') {
    where.dueDate = { [Op.lt]: new Date().toISOString().slice(0, 10) };
    if (!status) where.status = { [Op.in]: buckets.open };
  }
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { description: { [Op.like]: `%${search}%` } },
    ];
  }

  if (myProjects === 'true') {
    const memberships = await ProjectMember.findAll({
      where: { userId: req.user.id },
      attributes: ['projectId'],
      raw: true,
    });
    const ids = memberships.map((m) => m.projectId);
    if (ids.length === 0) return res.json({ projects: [] });
    where.id = { [Op.in]: ids };
  }

  const projects = await Project.findAll({
    where,
    include: [
      ...projectInclude,
      { model: ProjectMember, as: 'members', include: [{ model: User, as: 'user', attributes: userAttrs }] },
    ],
    order: [['updatedAt', 'DESC']],
  });

  const statusRows = await ProjectStatus.findAll({ attributes: ['name', 'color'] });
  const colorByName = new Map(statusRows.map((s) => [s.name, s.color]));

  const withStats = await Promise.all(
    projects.map(async (project) => {
      const [completion, expenseSum, materialSum] = await Promise.all([
        computeProjectCompletion(project.id),
        ProjectExpense.sum('amount', { where: { projectId: project.id } }),
        ProjectMaterial.sum('totalCost', { where: { projectId: project.id } }),
      ]);
      const json = project.toJSON();
      json.statusColor = colorByName.get(project.status) || null;
      json.completion = { percent: completion.percent, totalTasks: completion.totalTasks, closedTasks: completion.closedTasks };
      json.totalCost = Number(expenseSum || 0) + Number(materialSum || 0);
      return json;
    })
  );

  res.json({ projects: withStats });
});

// POST /projects — Admin/Technician
const create = asyncHandler(async (req, res) => {
  const {
    name, description, status, ownerDepartmentId, forDepartmentId,
    assignedToUserId, teamId, dueDate, memberIds,
  } = req.body || {};

  if (!name || !name.trim()) throw new ApiError(400, 'Project name is required', 'VALIDATION_ERROR');
  if (!ownerDepartmentId) throw new ApiError(400, 'Owned by department is required', 'VALIDATION_ERROR');

  const ownerDept = await Department.findByPk(ownerDepartmentId);
  if (!ownerDept) throw new ApiError(400, 'Owned-by department does not exist', 'VALIDATION_ERROR');
  if (forDepartmentId) {
    const forDept = await Department.findByPk(forDepartmentId);
    if (!forDept) throw new ApiError(400, 'For-department does not exist', 'VALIDATION_ERROR');
  }

  let resolvedStatus = status;
  if (!resolvedStatus) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    resolvedStatus = firstOpen ? firstOpen.name : 'Active';
  }

  const project = await Project.create({
    name: name.trim(),
    description: description || null,
    status: resolvedStatus,
    ownerDepartmentId,
    forDepartmentId: forDepartmentId || ownerDepartmentId,
    assignedToUserId: assignedToUserId || null,
    teamId: teamId || null,
    dueDate: dueDate || null,
    createdBy: req.user.id,
  });

  const memberSet = new Set((Array.isArray(memberIds) ? memberIds : []).map(Number));
  if (assignedToUserId) memberSet.add(Number(assignedToUserId));
  await Promise.all(
    [...memberSet].map((userId) =>
      ProjectMember.create({
        projectId: project.id,
        userId,
        role: Number(userId) === Number(assignedToUserId) ? 'lead' : 'member',
      })
    )
  );

  await writeAudit(req, 'project.create', 'Project', project.id, { name: project.name });
  await logProjectActivity(project.id, req.user.id, 'project_created', { name: project.name });

  res.status(201).json({ project: await getProjectWithDetail(project.id) });
});

// GET /projects/:id — full detail with stats, members, task counts
const get = asyncHandler(async (req, res) => {
  const project = await getProjectWithDetail(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);
  res.json({ project });
});

// PATCH /projects/:id — Admin/Technician. Updates any field.
const update = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const allowed = [
    'name', 'description', 'status', 'ownerDepartmentId', 'forDepartmentId',
    'assignedToUserId', 'teamId', 'dueDate',
  ];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  const statusChanged = changes.status !== undefined && changes.status !== project.status;
  const previousStatus = project.status;

  await project.update(changes);
  await writeAudit(req, 'project.update', 'Project', project.id, changes);
  if (statusChanged) {
    await logProjectActivity(project.id, req.user.id, 'status_changed', { from: previousStatus, to: changes.status });
  }

  res.json({ project: await getProjectWithDetail(project.id) });
});

// DELETE /projects/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const filesDir = path.join(UPLOAD_ROOT, 'projects', String(project.id));
  await project.destroy();
  fs.rm(filesDir, { recursive: true, force: true }, () => {});
  await writeAudit(req, 'project.delete', 'Project', project.id, { name: project.name });
  res.json({ ok: true });
});

// GET /projects/:id/stats
const getStats = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);
  res.json({ stats: await buildProjectStats(project.id) });
});

// ==================== Tasks ====================

const taskInclude = [
  { model: User, as: 'assignee', attributes: userAttrs },
  { model: ProjectStatus, as: 'status' },
  { model: Ticket, as: 'linkedTicket', attributes: ['id', 'title'] },
  { model: ProjectSubtask, as: 'subtasks', include: [{ model: User, as: 'assignee', attributes: userAttrs }, { model: ProjectStatus, as: 'status' }] },
];

// GET /projects/:id/tasks — list with subtasks
const listTasks = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const statusIdBehavior = await getProjectStatusIdBehaviorMap();
  const tasks = await ProjectTask.findAll({
    where: { projectId: project.id },
    include: taskInclude,
    order: [['position', 'ASC'], ['id', 'ASC']],
  });

  const { isTaskComplete, subtaskCompletionPercent } = require('../services/projectCompletion');
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

  const { title, description, statusId, priority, assignedToUserId, dueDate, linkedTicketId } = req.body || {};
  if (!title || !title.trim()) throw new ApiError(400, 'Task title is required', 'VALIDATION_ERROR');

  let resolvedStatusId = statusId;
  if (!resolvedStatusId) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    if (!firstOpen) throw new ApiError(400, 'No open-behavior project status is configured', 'VALIDATION_ERROR');
    resolvedStatusId = firstOpen.id;
  }

  const maxPos = await ProjectTask.max('position', { where: { projectId: project.id } });
  const task = await ProjectTask.create({
    projectId: project.id,
    title: title.trim(),
    description: description || null,
    statusId: resolvedStatusId,
    priority: priority || 'medium',
    assignedToUserId: assignedToUserId || null,
    dueDate: dueDate || null,
    linkedTicketId: linkedTicketId || null,
    position: (Number.isFinite(maxPos) ? maxPos : 0) + 1,
    createdBy: req.user.id,
  });
  await logProjectActivity(project.id, req.user.id, 'task_created', { taskId: task.id, title: task.title });

  const fresh = await ProjectTask.findByPk(task.id, { include: taskInclude });
  res.status(201).json({ task: fresh });
});

// PATCH /projects/:id/tasks/:taskId
const updateTask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');

  const allowed = ['title', 'description', 'statusId', 'priority', 'assignedToUserId', 'dueDate', 'linkedTicketId', 'position'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
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
      await logProjectActivity(req.params.id, req.user.id, 'task_closed', { taskId: task.id, title: task.title });
    }
  }

  const fresh = await ProjectTask.findByPk(task.id, { include: taskInclude });
  res.json({ task: fresh });
});

// DELETE /projects/:id/tasks/:taskId
const removeTask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  await task.destroy();
  await logProjectActivity(req.params.id, req.user.id, 'task_deleted', { taskId: task.id, title: task.title });
  res.json({ ok: true });
});

// ==================== Subtasks ====================

// POST /projects/:id/tasks/:taskId/subtasks
const createSubtask = asyncHandler(async (req, res) => {
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');

  const { title, statusId, assignedToUserId, dueDate } = req.body || {};
  if (!title || !title.trim()) throw new ApiError(400, 'Subtask title is required', 'VALIDATION_ERROR');

  let resolvedStatusId = statusId;
  if (!resolvedStatusId) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    if (!firstOpen) throw new ApiError(400, 'No open-behavior project status is configured', 'VALIDATION_ERROR');
    resolvedStatusId = firstOpen.id;
  }

  const maxPos = await ProjectSubtask.max('position', { where: { taskId: task.id } });
  const subtask = await ProjectSubtask.create({
    taskId: task.id,
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
    await logProjectActivity(req.params.id, req.user.id, 'subtask_closed', { subtaskId: subtask.id, title: subtask.title });
  }

  const fresh = await ProjectSubtask.findByPk(subtask.id, {
    include: [{ model: User, as: 'assignee', attributes: userAttrs }, { model: ProjectStatus, as: 'status' }],
  });
  res.json({ subtask: fresh });
});

// DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId
const removeSubtask = asyncHandler(async (req, res) => {
  const subtask = await ProjectSubtask.findOne({ where: { id: req.params.subtaskId, taskId: req.params.taskId } });
  if (!subtask) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  await subtask.destroy();
  res.json({ ok: true });
});

// ==================== Time entries ====================

const timeEntryInclude = [
  { model: User, as: 'user', attributes: userAttrs },
  { model: User, as: 'loggedFor', attributes: userAttrs },
  { model: ProjectTask, as: 'task', attributes: ['id', 'title'] },
];

// GET /projects/:id/time-entries
const listTimeEntries = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const entries = await ProjectTimeEntry.findAll({
    where: { projectId: project.id },
    include: timeEntryInclude,
    order: [['createdAt', 'DESC']],
  });
  const totalSeconds = entries.reduce((sum, e) => sum + (e.durationSeconds || 0), 0);
  res.json({ entries, totalSeconds });
});

// POST /projects/:id/time-entries
const createTimeEntry = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const { taskId, description, startTime, endTime, entryDate, loggedForUserId } = req.body || {};

  const startDt = new Date(startTime);
  const endDt = new Date(endTime);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
    throw new ApiError(400, 'Invalid start/end time', 'VALIDATION_ERROR');
  }
  const durationSeconds = Math.round((endDt.getTime() - startDt.getTime()) / 1000);
  if (durationSeconds <= 0) throw new ApiError(400, 'End time must be after start time', 'VALIDATION_ERROR');

  if (taskId) {
    const task = await ProjectTask.findOne({ where: { id: taskId, projectId: project.id } });
    if (!task) throw new ApiError(400, 'Task does not belong to this project', 'VALIDATION_ERROR');
  }

  let targetUserId = req.user.id;
  if (loggedForUserId !== undefined && loggedForUserId !== null && Number(loggedForUserId) !== req.user.id) {
    if (!(await canLogForOthers(req.user))) {
      throw new ApiError(403, 'Only admins and team leads can log time for other users', 'FORBIDDEN');
    }
    const targetUser = await User.findByPk(loggedForUserId);
    if (!targetUser || !isStaff(targetUser)) throw new ApiError(400, 'Invalid user to log time for', 'VALIDATION_ERROR');
    targetUserId = targetUser.id;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let resolvedEntryDate = todayStr;
  if (entryDate) {
    const d = String(entryDate).slice(0, 10);
    if (d > todayStr) throw new ApiError(400, 'Entry date cannot be in the future', 'VALIDATION_ERROR');
    resolvedEntryDate = d;
  }

  const entry = await ProjectTimeEntry.create({
    projectId: project.id,
    taskId: taskId || null,
    userId: req.user.id,
    loggedForUserId: targetUserId,
    description: description || null,
    startTime: startDt,
    endTime: endDt,
    durationSeconds,
    entryDate: resolvedEntryDate,
  });
  await writeAudit(req, 'project_time.create', 'ProjectTimeEntry', entry.id, { projectId: project.id, durationSeconds });
  await logProjectActivity(project.id, req.user.id, 'time_logged', { minutes: Math.round(durationSeconds / 60) });

  const fresh = await ProjectTimeEntry.findByPk(entry.id, { include: timeEntryInclude });
  res.status(201).json({ entry: fresh });
});

// PATCH /projects/:id/time-entries/:entryId
const updateTimeEntry = asyncHandler(async (req, res) => {
  const entry = await ProjectTimeEntry.findOne({ where: { id: req.params.entryId, projectId: req.params.id } });
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only edit your own time entries', 'FORBIDDEN');
  }

  const { description, startTime, endTime, entryDate, taskId } = req.body || {};
  const changes = {};
  if (description !== undefined) changes.description = description;
  if (taskId !== undefined) changes.taskId = taskId || null;
  if (entryDate !== undefined) changes.entryDate = entryDate;
  if (startTime !== undefined && endTime !== undefined) {
    const startDt = new Date(startTime);
    const endDt = new Date(endTime);
    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
      throw new ApiError(400, 'Invalid start/end time', 'VALIDATION_ERROR');
    }
    const durationSeconds = Math.round((endDt.getTime() - startDt.getTime()) / 1000);
    if (durationSeconds <= 0) throw new ApiError(400, 'End time must be after start time', 'VALIDATION_ERROR');
    changes.startTime = startDt;
    changes.endTime = endDt;
    changes.durationSeconds = durationSeconds;
  }

  await entry.update(changes);
  const fresh = await ProjectTimeEntry.findByPk(entry.id, { include: timeEntryInclude });
  res.json({ entry: fresh });
});

// DELETE /projects/:id/time-entries/:entryId
const removeTimeEntry = asyncHandler(async (req, res) => {
  const entry = await ProjectTimeEntry.findOne({ where: { id: req.params.entryId, projectId: req.params.id } });
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only remove your own time entries', 'FORBIDDEN');
  }
  await entry.destroy();
  await writeAudit(req, 'project_time.delete', 'ProjectTimeEntry', entry.id, { projectId: req.params.id });
  res.json({ ok: true });
});

// ==================== Expenses ====================

const expenseInclude = [
  { model: User, as: 'loggedByUser', attributes: userAttrs },
  { model: ProjectTask, as: 'task', attributes: ['id', 'title'] },
];

// GET /projects/:id/expenses
const listExpenses = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const expenses = await ProjectExpense.findAll({
    where: { projectId: project.id },
    include: expenseInclude,
    order: [['entryDate', 'DESC'], ['id', 'DESC']],
  });
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  res.json({ expenses, total });
});

// POST /projects/:id/expenses
const createExpense = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const { description, amount, category, entryDate, taskId } = req.body || {};
  if (!description || !description.trim()) throw new ApiError(400, 'Description is required', 'VALIDATION_ERROR');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) throw new ApiError(400, 'Amount must be a non-negative number', 'VALIDATION_ERROR');

  const expense = await ProjectExpense.create({
    projectId: project.id,
    taskId: taskId || null,
    description: description.trim(),
    amount: amt,
    category: category || 'other',
    entryDate: entryDate || new Date().toISOString().slice(0, 10),
    loggedBy: req.user.id,
  });
  await logProjectActivity(project.id, req.user.id, 'expense_added', { expenseId: expense.id, description: expense.description, amount: amt });

  const fresh = await ProjectExpense.findByPk(expense.id, { include: expenseInclude });
  res.status(201).json({ expense: fresh });
});

// PATCH /projects/:id/expenses/:expenseId
const updateExpense = asyncHandler(async (req, res) => {
  const expense = await ProjectExpense.findOne({ where: { id: req.params.expenseId, projectId: req.params.id } });
  if (!expense) throw new ApiError(404, 'Expense not found', 'NOT_FOUND');

  const allowed = ['description', 'amount', 'category', 'entryDate', 'taskId'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  await expense.update(changes);
  const fresh = await ProjectExpense.findByPk(expense.id, { include: expenseInclude });
  res.json({ expense: fresh });
});

// DELETE /projects/:id/expenses/:expenseId
const removeExpense = asyncHandler(async (req, res) => {
  const expense = await ProjectExpense.findOne({ where: { id: req.params.expenseId, projectId: req.params.id } });
  if (!expense) throw new ApiError(404, 'Expense not found', 'NOT_FOUND');
  await expense.destroy();
  res.json({ ok: true });
});

// ==================== Materials ====================

const materialInclude = [
  { model: User, as: 'addedByUser', attributes: userAttrs },
  { model: ProjectTask, as: 'task', attributes: ['id', 'title'] },
];

// GET /projects/:id/materials
const listMaterials = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const materials = await ProjectMaterial.findAll({
    where: { projectId: project.id },
    include: materialInclude,
    order: [['createdAt', 'DESC']],
  });
  const total = materials.reduce((sum, m) => sum + Number(m.totalCost), 0);
  res.json({ materials, total });
});

// POST /projects/:id/materials
const createMaterial = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const { itemName, vendor, modelNumber, serialNumber, quantity, unitCost, taskId, notes } = req.body || {};
  if (!itemName || !itemName.trim()) throw new ApiError(400, 'Item name is required', 'VALIDATION_ERROR');

  const qty = quantity !== undefined ? Number(quantity) : 1;
  const cost = unitCost !== undefined ? Number(unitCost) : 0;
  if (!Number.isFinite(qty) || qty < 1) throw new ApiError(400, 'Quantity must be a positive number', 'VALIDATION_ERROR');
  if (!Number.isFinite(cost) || cost < 0) throw new ApiError(400, 'Unit cost must be a non-negative number', 'VALIDATION_ERROR');

  const serials = Array.isArray(serialNumber)
    ? serialNumber.filter(Boolean)
    : (serialNumber ? [String(serialNumber)] : []);

  const material = await ProjectMaterial.create({
    projectId: project.id,
    taskId: taskId || null,
    itemName: itemName.trim(),
    vendor: vendor || null,
    modelNumber: modelNumber || null,
    serialNumber: serials,
    quantity: qty,
    unitCost: cost,
    totalCost: Math.round(qty * cost * 100) / 100,
    notes: notes || null,
    addedBy: req.user.id,
  });
  await logProjectActivity(project.id, req.user.id, 'material_added', { materialId: material.id, itemName: material.itemName });

  const fresh = await ProjectMaterial.findByPk(material.id, { include: materialInclude });
  res.status(201).json({ material: fresh });
});

// PATCH /projects/:id/materials/:materialId
const updateMaterial = asyncHandler(async (req, res) => {
  const material = await ProjectMaterial.findOne({ where: { id: req.params.materialId, projectId: req.params.id } });
  if (!material) throw new ApiError(404, 'Material not found', 'NOT_FOUND');

  const allowed = ['itemName', 'vendor', 'modelNumber', 'serialNumber', 'quantity', 'unitCost', 'taskId', 'notes'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (Array.isArray(changes.serialNumber)) changes.serialNumber = changes.serialNumber.filter(Boolean);

  const qty = changes.quantity !== undefined ? Number(changes.quantity) : Number(material.quantity);
  const cost = changes.unitCost !== undefined ? Number(changes.unitCost) : Number(material.unitCost);
  if (changes.quantity !== undefined || changes.unitCost !== undefined) {
    changes.totalCost = Math.round(qty * cost * 100) / 100;
  }

  await material.update(changes);
  const fresh = await ProjectMaterial.findByPk(material.id, { include: materialInclude });
  res.json({ material: fresh });
});

// DELETE /projects/:id/materials/:materialId
const removeMaterial = asyncHandler(async (req, res) => {
  const material = await ProjectMaterial.findOne({ where: { id: req.params.materialId, projectId: req.params.id } });
  if (!material) throw new ApiError(404, 'Material not found', 'NOT_FOUND');
  await material.destroy();
  res.json({ ok: true });
});

// ==================== Members ====================

// GET /projects/:id/members
const listMembers = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const members = await ProjectMember.findAll({
    where: { projectId: project.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['role', 'ASC'], ['addedAt', 'ASC']],
  });
  res.json({ members });
});

// POST /projects/:id/members
const addMember = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const { userId, role } = req.body || {};
  if (!userId) throw new ApiError(400, 'userId is required', 'VALIDATION_ERROR');
  const user = await User.findByPk(userId);
  if (!user) throw new ApiError(400, 'User does not exist', 'VALIDATION_ERROR');

  const existing = await ProjectMember.findOne({ where: { projectId: project.id, userId } });
  if (existing) throw new ApiError(409, 'User is already a member of this project', 'ALREADY_MEMBER');

  const member = await ProjectMember.create({
    projectId: project.id,
    userId,
    role: role === 'lead' ? 'lead' : 'member',
  });
  await logProjectActivity(project.id, req.user.id, 'member_added', { userId, displayName: user.displayName });

  const fresh = await ProjectMember.findByPk(member.id, { include: [{ model: User, as: 'user', attributes: userAttrs }] });
  res.status(201).json({ member: fresh });
});

// DELETE /projects/:id/members/:userId
const removeMember = asyncHandler(async (req, res) => {
  const member = await ProjectMember.findOne({ where: { projectId: req.params.id, userId: req.params.userId } });
  if (!member) throw new ApiError(404, 'Member not found', 'NOT_FOUND');
  await member.destroy();
  res.json({ ok: true });
});

// ==================== Files ====================

// GET /projects/:id/files
const listFiles = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const files = await ProjectFile.findAll({
    where: { projectId: project.id },
    include: [{ model: User, as: 'uploadedByUser', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ files });
});

// POST /projects/:id/files
const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');
  const project = await Project.findByPk(req.params.id);
  if (!project) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  }

  const { taskId } = req.body || {};
  const file = await ProjectFile.create({
    projectId: project.id,
    taskId: taskId || null,
    filename: req.file.originalname,
    filepath: req.file.path,
    filesize: req.file.size,
    uploadedBy: req.user.id,
  });
  await logProjectActivity(project.id, req.user.id, 'file_uploaded', { fileId: file.id, filename: file.filename });

  const fresh = await ProjectFile.findByPk(file.id, { include: [{ model: User, as: 'uploadedByUser', attributes: userAttrs }] });
  res.status(201).json({ file: fresh });
});

// GET /projects/:id/files/:fileId/download
const downloadFile = asyncHandler(async (req, res) => {
  const file = await ProjectFile.findOne({ where: { id: req.params.fileId, projectId: req.params.id } });
  if (!file) throw new ApiError(404, 'File not found', 'NOT_FOUND');
  res.download(file.filepath, file.filename);
});

// DELETE /projects/:id/files/:fileId
const removeFile = asyncHandler(async (req, res) => {
  const file = await ProjectFile.findOne({ where: { id: req.params.fileId, projectId: req.params.id } });
  if (!file) throw new ApiError(404, 'File not found', 'NOT_FOUND');
  await file.destroy();
  fs.rm(file.filepath, { force: true }, () => {});
  res.json({ ok: true });
});

// ==================== Activity ====================

// GET /projects/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  assertCanViewProject(req, project);

  const activity = await ProjectActivity.findAll({
    where: { projectId: project.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity });
});

module.exports = {
  list, create, get, update, remove, getStats,
  listTasks, createTask, updateTask, removeTask,
  createSubtask, updateSubtask, removeSubtask,
  listTimeEntries, createTimeEntry, updateTimeEntry, removeTimeEntry,
  listExpenses, createExpense, updateExpense, removeExpense,
  listMaterials, createMaterial, updateMaterial, removeMaterial,
  listMembers, addMember, removeMember,
  listFiles, uploadFile, downloadFile, removeFile,
  listActivity,
};
