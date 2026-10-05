// Project members: list, add, remove.
const { Project, ProjectMember, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { logProjectActivity } = require('../../services/projectActivity');
const { canAccessProject } = require('../../services/permissionService');
const { userAttrs } = require('./shared');

// ==================== Members ====================

// GET /projects/:id/members
const listMembers = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

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
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

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
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await member.destroy();
  res.json({ ok: true });
});

module.exports = {
  listMembers,
  addMember,
  removeMember,
};
