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
        where: { projectId: parent.record.id, userId }, defaults: { role: 'member' }, transaction,
      });
      autoAdded = created;
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw alreadyOnTask();
    throw err;
  }
  await writeAudit(req, 'task.helperAdd', 'Task', task.id, { projectId: parent.record.id, userId });
  if (autoAdded) await writeAudit(req, 'projectMember.autoAdd', 'Project', parent.record.id, { userId, taskId: task.id });
  if (userId !== req.user.id) {
    const actor = await User.findByPk(req.user.id, { attributes: ['displayName', 'username'] });
    await createNotification({
      userId,
      type: 'task_added',
      message: `${actor?.displayName || actor?.username || 'Someone'} added you to ${task.code} on ${parent.record.name}`,
      projectId: parent.record.id,
    });
  }
  return loadTask(parent, task.id, req.user);
}

async function removeHelper(req, parent, task, rawUserId) {
  requireProjectTask(parent);
  const userId = parseRecordId(rawUserId);
  const link = userId && await TaskAssignee.findOne({ where: { taskId: task.id, userId } });
  if (!link) throw new ApiError(404, 'Helper not found', 'NOT_FOUND');
  if (userId !== req.user.id && !(await canManageHelpers(req, parent, task))) {
    throw new ApiError(403, 'You do not have permission to remove helpers from this task', 'FORBIDDEN');
  }
  await link.destroy();
  await writeAudit(req, 'task.helperRemove', 'Task', task.id, { projectId: parent.record.id, userId });
  return loadTask(parent, task.id, req.user);
}

module.exports = { peopleOn, addHelper, removeHelper };
