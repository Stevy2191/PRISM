const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Department, Role, UserRole } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { invalidateUserPermissions } = require('../services/permissionService');

const MIN_PASSWORD_LENGTH = 8;
const userInclude = [{ model: Department, as: 'department' }];

// The legacy role enum still drives this endpoint; keep the new roles/
// permissions system's primary role assignment in sync so the two don't
// diverge until role assignment fully moves onto UserRoles (see people.js /
// Prompt 3).
const LEGACY_ROLE_TO_SEED_ROLE = {
  admin: 'System Administrator',
  technician: 'System Technician',
  requester: 'Requester',
};

async function syncSeedRoleAssignment(user, legacyRole, assignedBy) {
  const seedRoleName = LEGACY_ROLE_TO_SEED_ROLE[legacyRole];
  const seedRole = seedRoleName ? await Role.findOne({ where: { name: seedRoleName, isSystemRole: true } }) : null;
  if (!seedRole) return;
  await UserRole.destroy({ where: { userId: user.id } });
  await UserRole.create({ userId: user.id, roleId: seedRole.id, assignedAt: new Date(), assignedBy: assignedBy || null });
  await user.update({ roleId: seedRole.id });
  invalidateUserPermissions(user.id);
}

// GET /users — Admin only
const list = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    include: userInclude,
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// GET /users/assignable — any authenticated user. Minimal fields for
// populating "assignee" pickers/filters; only staff can be assigned tickets.
const listAssignable = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: { role: { [Op.in]: ['admin', 'technician'] } },
    attributes: ['id', 'displayName'],
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// GET /users/directory — any authenticated user. Every user (any role),
// minimal fields, for the "customer"/watcher pickers on ticket creation.
const listDirectory = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    attributes: ['id', 'displayName', 'username', 'role', 'departmentId'],
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// POST /users — Admin only. Creates a LOCAL account (username/password).
// Directory (AD) users are never created here — they are provisioned on first
// LDAP login. New local accounts must change their password on first login.
const create = asyncHandler(async (req, res) => {
  const { username, displayName, email, role, departmentId, password } = req.body || {};
  if (!username || !username.trim()) {
    throw new ApiError(400, 'Username is required', 'VALIDATION_ERROR');
  }
  if (!displayName || !displayName.trim()) {
    throw new ApiError(400, 'Display name is required', 'VALIDATION_ERROR');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'WEAK_PASSWORD'
    );
  }
  if (role && !['admin', 'technician', 'requester'].includes(role)) {
    throw new ApiError(400, 'Invalid role', 'VALIDATION_ERROR');
  }
  const existing = await User.findOne({ where: { username: username.trim() } });
  if (existing) {
    throw new ApiError(409, 'A user with this username already exists', 'USERNAME_TAKEN');
  }
  if (departmentId) {
    const dept = await Department.findByPk(departmentId);
    if (!dept) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    username: username.trim(),
    displayName: displayName.trim(),
    email: email || null,
    role: role || 'requester',
    departmentId: departmentId || null,
    passwordHash,
    isLocalAccount: true,
    mustChangePassword: true,
  });
  await syncSeedRoleAssignment(user, user.role, req.user.id);
  await writeAudit(req, 'user.create_local', 'User', user.id, { username: user.username, role: user.role });

  const fresh = await User.findByPk(user.id, { include: userInclude });
  res.status(201).json({ user: fresh });
});

// GET /users/:id — self or admin
const get = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new ApiError(403, 'You may only view your own profile', 'FORBIDDEN');
  }
  const user = await User.findByPk(id, { include: userInclude });
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  res.json({ user });
});

// PATCH /users/:id — Admin only (role, department)
const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  const { role, departmentId, password } = req.body || {};
  const changes = {};

  if (role !== undefined) {
    if (!['admin', 'technician', 'requester'].includes(role)) {
      throw new ApiError(400, 'Invalid role', 'VALIDATION_ERROR');
    }
    changes.role = role;
  }
  if (departmentId !== undefined) {
    if (departmentId !== null) {
      const dept = await Department.findByPk(departmentId);
      if (!dept) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');
    }
    changes.departmentId = departmentId;
  }
  // Admin password reset for local accounts: sets a new password and forces a
  // change on next login.
  if (password !== undefined) {
    if (!user.isLocalAccount) {
      throw new ApiError(400, 'Cannot set a password on a directory (AD) account', 'NOT_LOCAL_ACCOUNT');
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'WEAK_PASSWORD');
    }
    changes.passwordHash = await bcrypt.hash(password, 12);
    changes.mustChangePassword = true;
  }

  await user.update(changes);
  if (changes.role !== undefined) {
    await syncSeedRoleAssignment(user, changes.role, req.user.id);
  }
  const audited = { ...changes };
  if (audited.passwordHash) {
    delete audited.passwordHash;
    audited.passwordReset = true;
  }
  await writeAudit(req, 'user.update', 'User', user.id, audited);

  const fresh = await User.findByPk(id, { include: userInclude });
  res.json({ user: fresh });
});

// PATCH /users/:id/preferences — self or admin. Timer behavior settings.
const updatePreferences = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new ApiError(403, 'You may only update your own preferences', 'FORBIDDEN');
  }
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  const { timerMode, timerMinThreshold, timerPromptBeforeLog } = req.body || {};
  const changes = {};

  if (timerMode !== undefined) {
    if (!['manual', 'automatic'].includes(timerMode)) {
      throw new ApiError(400, 'timerMode must be "manual" or "automatic"', 'VALIDATION_ERROR');
    }
    changes.timerMode = timerMode;
  }
  if (timerMinThreshold !== undefined) {
    const val = parseInt(timerMinThreshold, 10);
    if (Number.isNaN(val) || val < 0) {
      throw new ApiError(400, 'timerMinThreshold must be a non-negative number of seconds', 'VALIDATION_ERROR');
    }
    changes.timerMinThreshold = val;
  }
  if (timerPromptBeforeLog !== undefined) {
    changes.timerPromptBeforeLog = !!timerPromptBeforeLog;
  }

  await user.update(changes);
  res.json({ user });
});

// DELETE /users/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    throw new ApiError(400, 'You cannot delete your own account', 'SELF_DELETE');
  }
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  await user.destroy();
  await writeAudit(req, 'user.delete', 'User', id, { username: user.username });
  res.json({ ok: true });
});

module.exports = { list, create, get, update, remove, listAssignable, listDirectory, updatePreferences };
