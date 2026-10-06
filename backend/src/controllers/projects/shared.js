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
const { parseRecordId } = require('../../services/permissionService');
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
  const [completion, timeSum, expenseSum, materialSum, ticketBuckets] = await Promise.all([
    computeProjectCompletion(projectId),
    TimeEntry.sum('durationSeconds', { where: { projectId } }),
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

module.exports = {
  resolveProjectTaskId,
  projectInclude,
  userAttrs,
  getProjectWithDetail,
  buildProjectStats,
  SUBLIST_LIMIT,
  SUBLIST_MAX,
};
