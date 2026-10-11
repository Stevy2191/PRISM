// Helpers shared by the project controller modules.
const { Op } = require('sequelize');
const {
  Project,
  ProjectMember,
  Task,
  TimeEntry,
  ProjectExpense,
  ProjectMaterial,
  Department,
  User,
  Ticket,
  Team,
  Company,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const {
  parseRecordId, canEditProject, canModerateProjectContent, hasPermission,
} = require('../../services/permissionService');
const { canWorkCompany } = require('../../services/ticketPeople');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const { computeProjectCompletion } = require('../../services/projectCompletion');

// Chunk size for the "load more" lists on a project's detail page. Tasks are
// deliberately excluded — they are drag-reorderable, and a reorder that can
// only see one page of the ordering would corrupt it.
const SUBLIST_LIMIT = 25;

// The detail-page lists grow by "load more", which asks for a larger single
// page rather than a second one — so their ceiling is higher than the shared
// 200 used for browsable tables.
const SUBLIST_MAX = 500;

const userAttrs = ['id', 'displayName', 'username', 'email'];

const projectInclude = [
  { model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] },
  { model: Department, as: 'forDepartment', attributes: ['id', 'name'] },
  { model: User, as: 'lead', attributes: userAttrs },
  { model: Team, as: 'team', attributes: ['id', 'name'] },
  { model: Company, as: 'company', attributes: ['id', 'name'] },
];

async function buildProjectStats(project) {
  const projectId = project.id;
  const [completion, timeSum, laborSum, expenseSum, materialSum, ticketBuckets] = await Promise.all([
    computeProjectCompletion(projectId),
    TimeEntry.sum('durationSeconds', { where: { projectId } }),
    TimeEntry.sum('laborCost', { where: { projectId } }),
    ProjectExpense.sum('amount', { where: { projectId } }),
    ProjectMaterial.sum('totalCost', { where: { projectId } }),
    getTicketStatusBuckets(),
  ]);
  // Tickets in the project's company only (a link can outlive a move).
  const openTicketsCount = await Ticket.count({ where: { projectId, companyId: project.companyId, status: { [Op.in]: ticketBuckets.open } } });
  return {
    completionPercent: completion.percent,
    totalTasks: completion.totalTasks,
    closedTasks: completion.closedTasks,
    totalTimeSeconds: Number(timeSum || 0),
    // Q11: labour is part of the cost, as in every report.
    laborCost: Number(laborSum || 0),
    totalCost: Number(expenseSum || 0) + Number(materialSum || 0) + Number(laborSum || 0),
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
  const stats = await buildProjectStats(project);
  const json = project.toJSON();
  json.stats = stats;
  return json;
}

// A task named on a project record (time, expense, material, file) must
// belong to that project (S13) — the record's include would otherwise show
// another project's task title. Returns the task's id, or null when the
// body clears the task.
async function resolveProjectTaskId(project, taskId) {
  if (taskId === undefined || taskId === null || taskId === '') return null;
  const id = parseRecordId(taskId);
  const task = id && await Task.findOne({ where: { id, projectId: project.id } });
  if (!task) throw new ApiError(400, 'Task does not belong to this project', 'VALIDATION_ERROR');
  return task.id;
}

// Changing a project's own data needs the edit tier on it (Q26); call after
// the view check, which answers "can't see it" first.
async function assertCanEditProject(user, project) {
  if (!(await canEditProject(user, project))) throw new ApiError(403, 'You do not have permission to edit this project', 'FORBIDDEN');
}

// The lead and members are active users who can work for the project's
// company; a lead is also a member (Q30), so it is checked like one. The same
// answer for a missing, inactive or fenced-off user.
async function assertCanWorkProject(rawUserId, companyId, label) {
  const user = await canWorkCompany(rawUserId, companyId);
  if (!user) throw new ApiError(400, `${label} can't work for this company`, 'VALIDATION_ERROR');
  return user.id;
}

// Naming a lead or members makes them members, so it needs the members
// permission as well as the edit tier (or projects.create).
async function assertCanManageMembers(user, what) {
  if (!(await hasPermission(user.id, 'projects.manage_members'))) {
    throw new ApiError(403, `${what} needs permission to manage members`, 'FORBIDDEN');
  }
}

// Q30: after the lead changed, the new lead is a member with the lead role
// and the old lead stays a plain member.
async function syncLeadMembership(project, previousLeadId) {
  if (project.assignedToUserId === previousLeadId) return;
  if (previousLeadId) await ProjectMember.update({ role: 'member' }, { where: { projectId: project.id, userId: previousLeadId } });
  if (project.assignedToUserId) {
    const [member] = await ProjectMember.findOrCreate({
      where: { projectId: project.id, userId: project.assignedToUserId }, defaults: { role: 'lead' },
    });
    if (member.role !== 'lead') await member.update({ role: 'lead' });
  }
}

// What the viewer may do with this project, for the screens to follow.
async function projectAccessFor(viewer, project) {
  const edit = await canEditProject(viewer, project);
  return {
    edit,
    moderate: await canModerateProjectContent(viewer, project),
    delete: edit && (await hasPermission(viewer.id, 'projects.delete')),
  };
}

module.exports = {
  assertCanEditProject,
  projectAccessFor,
  assertCanWorkProject,
  assertCanManageMembers,
  syncLeadMembership,
  resolveProjectTaskId,
  projectInclude,
  userAttrs,
  getProjectWithDetail,
  buildProjectStats,
  SUBLIST_LIMIT,
  SUBLIST_MAX,
};
