// Project activity feed and the PDF report.
const {
  Project, ProjectActivity, Task, User, sequelize,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { generateProjectReport } = require('../../services/projectReport');
const { canAccessProject, parseRecordId } = require('../../services/permissionService');
const { userAttrs } = require('./shared');

// ==================== Activity ====================

// GET /projects/:id/activity[?taskId=N] — taskId narrows it to one task of this
// project (a task of another project is a 404) and caps it at the latest 20.
const listActivity = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const where = { projectId: project.id };
  let limit;
  if (req.query.taskId !== undefined) {
    const taskId = parseRecordId(req.query.taskId);
    const task = taskId && await Task.findOne({ where: { id: taskId, projectId: project.id }, attributes: ['id'] });
    if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
    // The detail blob is JSON; compare its taskId as text.
    // (task.id is a checked integer, so it is safe to inline.)
    where[sequelize.Sequelize.Op.and] = sequelize.literal(
      `JSON_UNQUOTE(JSON_EXTRACT(\`ProjectActivity\`.\`detail\`, '$.taskId')) = '${Number(task.id)}'`,
    );
    limit = 20;
  }

  const activity = await ProjectActivity.findAll({
    where,
    limit,
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity });
});

// GET /projects/:id/report — streams a generated PDF report for this project.
const generateReport = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id, { attributes: ['id', 'ownerDepartmentId', 'forDepartmentId', 'companyId'] });
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  const ok = await generateProjectReport(project.id, res);
  if (!ok) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
});

module.exports = {
  listActivity,
  generateReport,
};
