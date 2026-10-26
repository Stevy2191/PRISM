// Helpers on a project task or subtask (spec decision 15): extra people beside
// the main assignee. Each logs their own time; the task's hours are everyone's.
const {
  Task, TaskAssignee, ProjectMember, User, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId, canEditProject } = require('../permissionService');
const { canWorkCompany } = require('../ticketPeople');
const { createNotification } = require('../notifications');
const { loadTask } = require('../tasks');

// The main assignee first, then the helpers; no nulls. Takes a task row or
// JSON with its helpers loaded (an array of users or of ids).
function peopleOn(task) {
  const helperIds = (task.helpers || []).map((h) => (typeof h === 'object' ? h.id : h));
  return [task.assigneeId, ...helperIds].filter((id, i, all) => id && all.indexOf(id) === i);
}

const alreadyOnTask = () => new ApiError(409, 'That person is already on this task', 'ALREADY_ON_TASK');

function requireProjectTask(parent) {
  if (parent.kind !== 'project') throw new ApiError(400, 'Helpers can only be added to project tasks', 'PROJECT_TASK_ONLY');
}

// Edit tier on the project, or the task's main assignee.
async function canManageHelpers(req, parent, task) {
  return task.assigneeId === req.user.id || canEditProject(req.user, parent.record);
}

async function addHelper(req, parent, task, rawUserId) {
  requireProjectTask(parent);
  if (!(await canManageHelpers(req, parent, task))) {
    throw new ApiError(403, 'You do not have permission to add helpers to this task', 'FORBIDDEN');
  }
  const userId = parseRecordId(rawUserId);
  if (!userId) throw new ApiError(400, 'userId is required', 'VALIDATION_ERROR');
  if (task.assigneeId === userId) throw alreadyOnTask();
  const person = await canWorkCompany(userId, parent.companyId);
  if (!person) throw new ApiError(400, "That person can't work for this company", 'VALIDATION_ERROR');
  let autoAdded = false;
  try {
    await sequelize.transaction(async (transaction) => {
      await TaskAssignee.create({ taskId: task.id, userId, addedBy: req.user.id }, { transaction });
      const [, created] = await ProjectMember.findOrCreate({
        where: { projectId: parent.record.id, userId }, defaults: { role: 'helper' }, transaction,
      });
      autoAdded = created;
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw alreadyOnTask();
    throw err;
  }
  await writeAudit(req, 'task.helperAdd', 'Task', task.id, { projectId: parent.record.id, userId });
  if (autoAdded) await writeAudit(req, 'projectMember.autoAdd', 'Project', parent.record.id, { userId, taskId: task.id, role: 'helper' });
  if (userId !== req.user.id) {
    // The helper is saved; a failed notice must not turn that into a 500.
    try {
      const actor = await User.findByPk(req.user.id, { attributes: ['displayName', 'username'] });
      await createNotification({
        userId,
        type: 'task_added',
        message: `${actor?.displayName || actor?.username || 'Someone'} added you to ${task.code} on ${parent.record.name}`,
        projectId: parent.record.id,
      });
    } catch (err) {
      console.error('[helpers] task_added notice failed:', err.message);
    }
  }
  return loadTask(parent, task.id, req.user);
}

// Ruling R17 (least privilege): a 'helper' membership exists only because of
// helping (R7), so it goes with the person's last helper row in the project.
// 'member' and 'lead' rows stay; logged time is untouched. Someone who is
// still the main assignee of a task here (a helper made main assignee) keeps
// it too, or they'd lose sight of their own task. Call inside the transaction
// that removed the rows; returns the user ids whose membership went.
async function dropIdleHelperMemberships(projectId, userIds, transaction) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  const tasks = await Task.findAll({ where: { projectId }, attributes: ['id', 'assigneeId'], raw: true, transaction });
  const taskIds = tasks.map((t) => t.id);
  const stillHelping = new Set(tasks.map((t) => t.assigneeId));
  if (taskIds.length) {
    const rows = await TaskAssignee.findAll({ where: { userId: ids, taskId: taskIds }, attributes: ['userId'], raw: true, transaction });
    rows.forEach((r) => stillHelping.add(r.userId));
  }
  const idle = ids.filter((id) => !stillHelping.has(id));
  if (!idle.length) return [];
  const rows = await ProjectMember.findAll({ where: { projectId, userId: idle, role: 'helper' }, attributes: ['id', 'userId'], transaction });
  if (!rows.length) return [];
  await ProjectMember.destroy({ where: { id: rows.map((r) => r.id) }, transaction });
  return rows.map((r) => r.userId);
}

async function auditAutoRemoved(req, projectId, userIds, meta = {}) {
  for (const userId of userIds) {
    await writeAudit(req, 'projectMember.autoRemove', 'Project', projectId, { userId, role: 'helper', ...meta }); // eslint-disable-line no-await-in-loop
  }
}

async function removeHelper(req, parent, task, rawUserId) {
  requireProjectTask(parent);
  const userId = parseRecordId(rawUserId);
  const link = userId && await TaskAssignee.findOne({ where: { taskId: task.id, userId } });
  if (!link) throw new ApiError(404, 'Helper not found', 'NOT_FOUND');
  if (userId !== req.user.id && !(await canManageHelpers(req, parent, task))) {
    throw new ApiError(403, 'You do not have permission to remove helpers from this task', 'FORBIDDEN');
  }
  const projectId = parent.record.id;
  const dropped = await sequelize.transaction(async (transaction) => {
    await link.destroy({ transaction });
    return dropIdleHelperMemberships(projectId, [userId], transaction);
  });
  await writeAudit(req, 'task.helperRemove', 'Task', task.id, { projectId, userId });
  await auditAutoRemoved(req, projectId, dropped, { taskId: task.id });
  // Removing yourself can take away your view of the project.
  if (dropped.includes(req.user.id)) {
    const { canAccessProject } = require('../permissionService'); // eslint-disable-line global-require
    if (!(await canAccessProject(req.user, parent.record))) return null;
  }
  return loadTask(parent, task.id, req.user);
}

module.exports = {
  peopleOn, addHelper, removeHelper, dropIdleHelperMemberships, auditAutoRemoved,
};
