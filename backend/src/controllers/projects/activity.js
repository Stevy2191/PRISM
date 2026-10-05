// Project activity feed and the PDF report.
const { Project, ProjectActivity, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { generateProjectReport } = require('../../services/projectReport');
const { canAccessProject } = require('../../services/permissionService');
const { userAttrs } = require('./shared');

// ==================== Activity ====================

// GET /projects/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const activity = await ProjectActivity.findAll({
    where: { projectId: project.id },
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
