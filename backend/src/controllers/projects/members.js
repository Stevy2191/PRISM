// Project members: list, add, remove.
const { Project, ProjectMember, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logProjectActivity } = require('../../services/projectActivity');
const { canAccessProject } = require('../../services/permissionService');
const {
  userAttrs, assertCanEditProject, assertCanWorkProject, syncLeadMembership,
} = require('./shared');
const { removeProjectFromExternalCalendars, syncProjectToExternalCalendars } = require('../../services/calendarPush');

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
  await assertCanEditProject(req.user, project);

  const { role } = req.body || {};
  if (!req.body?.userId) throw new ApiError(400, 'userId is required', 'VALIDATION_ERROR');
  // The same rule as the lead and members named on the project (Task 7).
  const userId = await assertCanWorkProject(req.body.userId, project.companyId, 'Member');
  const user = await User.findByPk(userId);

  const existing = await ProjectMember.findOne({ where: { projectId: project.id, userId } });
  if (existing) throw new ApiError(409, 'User is already a member of this project', 'ALREADY_MEMBER');

  const member = await ProjectMember.create({ projectId: project.id, userId, role: 'member' });
  if (role === 'lead') {
    // A project has one lead (Q30): adding someone as lead makes them the
    // project's lead, and the old lead stays a member.
    const previousLeadId = project.assignedToUserId;
    await project.update({ assignedToUserId: userId });
    await syncLeadMembership(project, previousLeadId);
    await member.reload();
    if (previousLeadId) removeProjectFromExternalCalendars(project.id, previousLeadId);
    syncProjectToExternalCalendars(project.id);
  }
  await writeAudit(req, 'project_member.add', 'Project', project.id, { userId: member.userId, role: member.role });
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
  await assertCanEditProject(req.user, project);
  await member.destroy();
  await writeAudit(req, 'project_member.remove', 'Project', project.id, { userId: member.userId });
  res.json({ ok: true });
});

module.exports = {
  listMembers,
  addMember,
  removeMember,
};
