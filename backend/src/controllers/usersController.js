const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Department, Role, UserRole } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { invalidateUserPermissions, hasPermission } = require('../services/permissionService');
const { computeDisplayName } = require('../utils/userDisplay');
const { normalizePhone } = require('../utils/phone');

const MIN_PASSWORD_LENGTH = 8;
const userInclude = [{ model: Department, as: 'department' }, { model: Role, as: 'primaryRole' }];

// The legacy role enum still drives this endpoint; keep the new roles/
// permissions system's primary role assignment in sync so the two don't
// diverge until role assignment fully moves onto UserRoles (see people.js /
// Prompt 3).
const LEGACY_ROLE_TO_SEED_ROLE = {
  admin: 'System Administrator',
  technician: 'System Technician',
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

// New users get their department's configured default role (Settings →
// Departments) when one is set; otherwise fall back to the legacy role enum
// mapping above.
async function assignInitialRole(user, legacyRole, departmentId, assignedBy) {
  const department = departmentId ? await Department.findByPk(departmentId) : null;
  if (department && department.defaultRoleId) {
    await UserRole.destroy({ where: { userId: user.id } });
    await UserRole.create({ userId: user.id, roleId: department.defaultRoleId, assignedAt: new Date(), assignedBy: assignedBy || null });
    await user.update({ roleId: department.defaultRoleId });
    invalidateUserPermissions(user.id);
    return;
  }
  await syncSeedRoleAssignment(user, legacyRole, assignedBy);
}

// GET /users?scope=department|assignment — department scoping is opt-in via
// ?scope=department (used by pages that manage/filter people BY department,
// e.g. the User Management list and the dashboard's admin "Viewing" filter)
// and is scoped to the caller's department unless they hold people.view_all.
// The default (no scope param, or scope=assignment) always returns every
// user regardless of department — department affects what tickets/projects
// someone can SEE, never who can be assigned work, so any assignment-context
// picker must never filter by department. (Route guard already requires
// view_own_department minimum just to call this endpoint at all.)
const list = asyncHandler(async (req, res) => {
  let where = {};
  if (req.query.scope === 'department') {
    const canViewAll = await hasPermission(req.user.id, 'people.view_all');
    where = canViewAll ? {} : { departmentId: req.user.departmentId };
  }
  const users = await User.findAll({
    where,
    include: userInclude,
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// GET /users/assignable — any authenticated user. Minimal fields for
// populating "assignee" pickers/filters; only staff can be assigned tickets.
const listAssignable = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: { role: { [Op.in]: ['admin', 'technician'] }, isActive: true },
    attributes: ['id', 'displayName'],
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// GET /users/directory — any authenticated user. Every active user, minimal
// fields, for the watcher picker on ticket creation.
const listDirectory = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: { isActive: true },
    attributes: ['id', 'displayName', 'username', 'role', 'departmentId'],
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// POST /users — Admin only. Creates a LOCAL account (username/password).
// Directory (AD) users are never created here — they are provisioned on first
// LDAP login. New local accounts must change their password on first login.
const create = asyncHandler(async (req, res) => {
  const {
    username, displayName, email, role, departmentId, password,
    firstName, lastName, phone, jobTitle,
  } = req.body || {};
  if (!username || !username.trim()) {
    throw new ApiError(400, 'Username is required', 'VALIDATION_ERROR');
  }
  const resolvedDisplayName = computeDisplayName({ firstName, lastName, fallback: displayName?.trim() });
  if (!resolvedDisplayName) {
    throw new ApiError(400, 'Display name is required (or provide first/last name)', 'VALIDATION_ERROR');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'WEAK_PASSWORD'
    );
  }
  if (role && !['admin', 'technician'].includes(role)) {
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
    displayName: resolvedDisplayName,
    firstName: firstName ? firstName.trim() : null,
    lastName: lastName ? lastName.trim() : null,
    phone: normalizePhone(phone),
    jobTitle: jobTitle ? jobTitle.trim() : null,
    email: email || null,
    role: role || 'technician',
    departmentId: departmentId || null,
    passwordHash,
    isLocalAccount: true,
    mustChangePassword: true,
  });
  await assignInitialRole(user, user.role, user.departmentId, req.user.id);
  await writeAudit(req, 'user.create_local', 'User', user.id, { username: user.username, role: user.role });

  const fresh = await User.findByPk(user.id, { include: userInclude });
  res.status(201).json({ user: fresh });
});

// GET /users/:id — self, or people.edit_users
const get = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.id !== id && !(await hasPermission(req.user.id, 'people.edit_users'))) {
    throw new ApiError(403, 'You may only view your own profile', 'FORBIDDEN');
  }
  const user = await User.findByPk(id, { include: userInclude });
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  res.json({ user });
});

// PATCH /users/:id — self (profile fields only) or people.edit_users (everything).
// Self-editing without people.edit_users may only touch the plain profile
// fields (name/contact info) — role, department, and password stay admin-only
// here (self password changes go through the dedicated change-password flow).
const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  const isSelf = req.user.id === id;
  const canEditUsers = await hasPermission(req.user.id, 'people.edit_users');
  if (!isSelf && !canEditUsers) {
    throw new ApiError(403, 'You may only edit your own profile', 'FORBIDDEN');
  }

  const {
    role, departmentId, password, firstName, lastName, phone, jobTitle, email,
  } = req.body || {};
  const changes = {};

  if (role !== undefined || departmentId !== undefined || password !== undefined) {
    if (!canEditUsers) {
      throw new ApiError(403, 'You do not have permission to change role, department, or password', 'FORBIDDEN');
    }
  }

  if (role !== undefined) {
    if (!['admin', 'technician'].includes(role)) {
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

  if (firstName !== undefined) changes.firstName = firstName ? firstName.trim() : null;
  if (lastName !== undefined) changes.lastName = lastName ? lastName.trim() : null;
  if (phone !== undefined) changes.phone = normalizePhone(phone);
  if (jobTitle !== undefined) changes.jobTitle = jobTitle ? jobTitle.trim() : null;
  if (email !== undefined) changes.email = email ? email.trim() : null;

  if (firstName !== undefined || lastName !== undefined) {
    const resolvedFirst = changes.firstName !== undefined ? changes.firstName : user.firstName;
    const resolvedLast = changes.lastName !== undefined ? changes.lastName : user.lastName;
    changes.displayName = computeDisplayName({ firstName: resolvedFirst, lastName: resolvedLast, fallback: user.displayName });
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
