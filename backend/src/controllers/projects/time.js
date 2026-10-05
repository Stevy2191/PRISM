// Project time entries: list, log, edit, delete.
const { Project, ProjectTask, ProjectTimeEntry, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logProjectActivity } = require('../../services/projectActivity');
const { calculateLaborCost } = require('../../utils/laborCost');
const { parsePagination, paginated } = require('../../utils/pagination');
const { canAccessProject, hasPermission } = require('../../services/permissionService');
const {
  SUBLIST_LIMIT, SUBLIST_MAX, userAttrs, canLogForOthers, resolveProjectTaskId,
} = require('./shared');

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
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await ProjectTimeEntry.findAndCountAll({
    where: { projectId: project.id },
    include: timeEntryInclude,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  // Both headline figures cover the whole project, not the loaded page. Labor
  // cost in particular used to be summed in the browser over every entry —
  // doing that over one page would under-report the project's real cost.
  const [totalSeconds, totalLaborCost] = await Promise.all([
    ProjectTimeEntry.sum('durationSeconds', { where: { projectId: project.id } }),
    ProjectTimeEntry.sum('laborCost', { where: { projectId: project.id } }),
  ]);
  res.json({
    ...paginated('entries', { rows, count }, { page, limit }),
    totalSeconds: Number(totalSeconds) || 0,
    // Null (rather than 0) when no entry carries a cost, so the UI can tell
    // "no contractor time logged" from "zero cost".
    totalLaborCost: totalLaborCost == null ? null : Number(totalLaborCost),
  });
});

// POST /projects/:id/time-entries
const createTimeEntry = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const { taskId, description, startTime, endTime, entryDate, loggedForUserId } = req.body || {};

  const startDt = new Date(startTime);
  const endDt = new Date(endTime);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
    throw new ApiError(400, 'Invalid start/end time', 'VALIDATION_ERROR');
  }
  const durationSeconds = Math.round((endDt.getTime() - startDt.getTime()) / 1000);
  if (durationSeconds <= 0) throw new ApiError(400, 'End time must be after start time', 'VALIDATION_ERROR');

  const resolvedTaskId = await resolveProjectTaskId(project, taskId);

  let targetUserId = req.user.id;
  let targetUser = req.user;
  if (loggedForUserId !== undefined && loggedForUserId !== null && Number(loggedForUserId) !== req.user.id) {
    if (!(await canLogForOthers(req.user))) {
      throw new ApiError(403, 'Only admins and team leads can log time for other users', 'FORBIDDEN');
    }
    targetUser = await User.findByPk(loggedForUserId);
    if (!targetUser || !(await hasPermission(targetUser.id, 'projects.log_time'))) throw new ApiError(400, 'Invalid user to log time for', 'VALIDATION_ERROR');
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
    taskId: resolvedTaskId,
    userId: req.user.id,
    loggedForUserId: targetUserId,
    description: description || null,
    startTime: startDt,
    endTime: endDt,
    durationSeconds,
    entryDate: resolvedEntryDate,
    laborCost: calculateLaborCost(targetUser, { durationSeconds }),
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
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only edit your own time entries', 'FORBIDDEN');
  }

  const { description, startTime, endTime, entryDate, taskId } = req.body || {};
  const changes = {};
  if (description !== undefined) changes.description = description;
  if (taskId !== undefined) changes.taskId = await resolveProjectTaskId(project, taskId);
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
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only remove your own time entries', 'FORBIDDEN');
  }
  await entry.destroy();
  await writeAudit(req, 'project_time.delete', 'ProjectTimeEntry', entry.id, { projectId: req.params.id });
  res.json({ ok: true });
});

module.exports = {
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  removeTimeEntry,
};
