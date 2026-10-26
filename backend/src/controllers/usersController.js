const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  User, Department, Role, UserRole, UserCompanyAccess, Permission, UserPermissionOverride, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { sanitizeRichHtml } = require('../utils/richHtml');
const { validEmailPrefs } = require('../services/email/notificationMail');
const { parsePagination, paginated } = require('../utils/pagination');
const { writeAudit, writeSystemAudit } = require('../middleware/audit');
const {
  invalidateUserPermissions, hasPermission, getUserCompanyIds, canAccessCompany, parseRecordId,
} = require('../services/permissionService');
const { assertCanHandOutRole, assertCanSetLegacyRole, assertCanGrantPermissions } = require('../services/roleGrant');
const {
  normalizeUsername, assertUsernameFree, rethrowIfUsernameTaken, assertLocalEmailFree,
} = require('../utils/username');
const { settleAccountRoles } = require('../services/accountRoles');
const { computeDisplayName } = require('../utils/userDisplay');
const { normalizePhone } = require('../utils/phone');
const { validWorkHours } = require('../services/workload/capacity');
const { validatePassword, describeProblems } = require('../utils/passwordPolicy');
const { getAllSettings } = require('./settingsController');
const {
  assertCanManageAccount, assertKeepsSystemAdmin, assertNotTheOwner, isOwner, isAdministrator, isTopRole, SYSTEM_ADMIN,
} = require('../services/ownership');

const userInclude = [{ model: Department, as: 'department' }, { model: Role, as: 'primaryRole' }];

// The legacy role enum still drives this endpoint; keep the new roles/
// permissions system's primary role assignment in sync so the two don't
// diverge until role assignment fully moves onto UserRoles (see people.js /
// Prompt 3).
const LEGACY_ROLE_TO_SEED_ROLE = {
  admin: 'System Administrator',
  technician: 'System Technician',
};

async function syncSeedRoleAssignment(user, legacyRole, assignedBy, transaction) {
  const seedRoleName = LEGACY_ROLE_TO_SEED_ROLE[legacyRole];
  const seedRole = seedRoleName ? await Role.findOne({ where: { name: seedRoleName, isSystemRole: true }, transaction }) : null;
  if (!seedRole) return;
  await UserRole.destroy({ where: { userId: user.id }, transaction });
  await UserRole.create({ userId: user.id, roleId: seedRole.id, assignedAt: new Date(), assignedBy: assignedBy || null }, { transaction });
  await user.update({ roleId: seedRole.id }, { transaction });
  await settleAccountRoles(user, { transaction });
}

// New users get the role chosen for them; otherwise their department's
// configured default role (Settings → Departments) when one is set; otherwise
// the legacy role enum mapping above. A chosen department role applies within
// the account's department.
async function assignInitialRole(user, legacyRole, departmentId, assignedBy, chosenRole, transaction) {
  const department = departmentId ? await Department.findByPk(departmentId, { transaction }) : null;
  const role = chosenRole || null;
  const roleIdToAssign = role ? role.id : department?.defaultRoleId;
  if (roleIdToAssign) {
    const scopedTo = role && role.scope === 'department' ? departmentId : null;
    await UserRole.destroy({ where: { userId: user.id }, transaction });
    await UserRole.create({
      userId: user.id, roleId: roleIdToAssign, departmentId: scopedTo, assignedAt: new Date(), assignedBy: assignedBy || null,
    }, { transaction });
    await user.update({ roleId: roleIdToAssign }, { transaction });
    await settleAccountRoles(user, { transaction });
    return;
  }
  await syncSeedRoleAssignment(user, legacyRole, assignedBy, transaction);
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
    where = canViewAll ? {} : { departmentId: req.user.departmentId || -1 }; // no department -> match nothing, not everything
  }
  const { page, limit, offset } = parsePagination(req);
  const { rows, count } = await User.findAndCountAll({
    where,
    include: userInclude,
    order: [['displayName', 'ASC'], ['id', 'ASC']],
    limit,
    offset,
    distinct: true,
  });
  // administrator: the screen keeps these rows read-only for anyone but an
  // Owner (the server refuses the changes either way).
  const topRoles = await Role.findAll({ where: { name: SYSTEM_ADMIN, isSystemRole: true }, attributes: ['id'] });
  const topIds = topRoles.map((r) => r.id);
  const holders = rows.length && topIds.length
    ? await UserRole.findAll({ where: { userId: rows.map((u) => u.id), roleId: topIds }, attributes: ['userId'], raw: true })
    : [];
  const admins = new Set(holders.map((h) => h.userId));
  const users = rows.map((u) => ({
    ...u.toJSON(), administrator: u.role === 'admin' || !!u.ownerLevel || topIds.includes(u.roleId) || admins.has(u.id),
  }));
  res.json(paginated('users', { rows: users, count }, { page, limit }));
});

// GET /users/assignable — any authenticated user. Minimal fields for
// populating "assignee" pickers/filters; only staff can be assigned tickets.
//
// Deliberately NOT paginated, unlike GET /users. This is a dropdown's option
// list: truncating it would silently hide assignees with no way for the user
// to tell. It is bounded by staff headcount and carries two columns.
// ?companyId= narrows a picker to people who can reach that company (an
// assignee or watcher must be able to open the ticket — plan 2b). A company
// the caller can't reach is refused like a missing one.
async function narrowToCompany(req, users) {
  const raw = req.query.companyId;
  if (raw === undefined || raw === '') return users;
  const companyId = parseRecordId(raw);
  if (!companyId || !(await canAccessCompany(req.user, companyId))) {
    throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  }
  const full = await User.findAll({ where: { id: users.map((u) => u.id) }, attributes: ['id', 'role', 'roleId', 'allCompanies'] });
  const reach = new Set();
  for (const u of full) {
    if (await canAccessCompany(u, companyId)) reach.add(u.id); // eslint-disable-line no-await-in-loop
  }
  return users.filter((u) => reach.has(u.id));
}

const listAssignable = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: { role: { [Op.in]: ['admin', 'technician'] }, isActive: true },
    attributes: ['id', 'displayName'],
    order: [['displayName', 'ASC']],
  });
  res.json({ users: await narrowToCompany(req, users) });
});

// GET /users/directory — any authenticated user. Every active user, minimal
// fields, for the watcher picker on ticket creation. Unpaginated for the same
// reason as /users/assignable — it populates pickers, not a browsable table.
const listDirectory = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: { isActive: true },
    attributes: ['id', 'displayName', 'username', 'role', 'departmentId'],
    order: [['displayName', 'ASC']],
  });
  res.json({ users: await narrowToCompany(req, users) });
});

// The permission overrides a new account starts with: checked in full before
// the account exists, like its role.
async function parseNewOverrides(actor, overrides) {
  if (overrides === undefined || overrides === null) return [];
  if (!Array.isArray(overrides)) throw new ApiError(400, 'overrides must be a list', 'VALIDATION_ERROR');
  if (!overrides.length) return [];
  if (!(await hasPermission(actor.id, 'people.manage_permission_overrides'))) {
    throw new ApiError(403, 'Adding permission overrides needs people.manage_permission_overrides', 'FORBIDDEN');
  }
  const seen = new Set();
  const rows = [];
  for (const o of overrides) {
    const permissionKey = o && typeof o.permissionKey === 'string' ? o.permissionKey : '';
    // eslint-disable-next-line no-await-in-loop
    if (!(await Permission.findOne({ where: { key: permissionKey }, attributes: ['key'] }))) {
      throw new ApiError(400, `Unknown permission: ${permissionKey}`, 'VALIDATION_ERROR');
    }
    if (seen.has(permissionKey)) throw new ApiError(400, `${permissionKey} is listed twice`, 'VALIDATION_ERROR');
    seen.add(permissionKey);
    if (typeof o.granted !== 'boolean') throw new ApiError(400, 'granted must be true or false', 'VALIDATION_ERROR');
    let expiresAt = null;
    if (o.expiresAt) {
      expiresAt = new Date(o.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) throw new ApiError(400, 'Invalid expiresAt', 'VALIDATION_ERROR');
    }
    rows.push({
      permissionKey, granted: o.granted, reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim() : null, expiresAt,
    });
  }
  await assertCanGrantPermissions(actor, rows.filter((r) => r.granted).map((r) => r.permissionKey));
  return rows;
}

// POST /users — Admin only. Creates a LOCAL account (username/password).
// Directory (AD) users are never created here — they are provisioned on first
// LDAP login. New local accounts must change their password on first login.
// The account, its role and its permission overrides are made together, in
// one transaction: a refused grant leaves no account behind.
const create = asyncHandler(async (req, res) => {
  const {
    username: rawUsername, displayName, email, role, departmentId, password,
    firstName, lastName, phone, jobTitle, roleId, overrides,
  } = req.body || {};
  if (!rawUsername || !String(rawUsername).trim()) {
    throw new ApiError(400, 'Username is required', 'VALIDATION_ERROR');
  }
  const username = normalizeUsername(rawUsername);
  const resolvedDisplayName = computeDisplayName({ firstName, lastName, fallback: displayName?.trim() });
  if (!resolvedDisplayName) {
    throw new ApiError(400, 'Display name is required (or provide first/last name)', 'VALIDATION_ERROR');
  }
  const policy = validatePassword(password, { username, displayName, firstName, lastName, email });
  if (!policy.ok) {
    throw new ApiError(400, describeProblems(policy.problems), 'WEAK_PASSWORD');
  }
  if (role && !['admin', 'technician'].includes(role)) {
    throw new ApiError(400, 'Invalid role', 'VALIDATION_ERROR');
  }
  await assertUsernameFree(username);
  await assertLocalEmailFree(email ? String(email).trim() : null);
  let dept = null;
  if (departmentId) {
    dept = await Department.findByPk(departmentId);
    if (!dept) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');
  }
  // The role a new account starts with is a grant (S11). Choosing one beyond
  // the default needs people.manage_roles; whichever it ends up being —
  // chosen, or the department's default — must be one the creator may grant.
  // Validated before the account exists, so a refused or bad role fails the
  // request outright rather than leaving a user with the wrong permissions.
  const choosesRoleId = roleId !== undefined && roleId !== null && roleId !== '';
  if ((choosesRoleId || role === 'admin') && !(await hasPermission(req.user.id, 'people.manage_roles'))) {
    throw new ApiError(403, 'Choosing a role needs people.manage_roles', 'FORBIDDEN');
  }
  let requestedRole = null;
  if (choosesRoleId) {
    requestedRole = await Role.findByPk(roleId);
    if (!requestedRole) throw new ApiError(400, 'Role does not exist', 'VALIDATION_ERROR');
    await assertCanHandOutRole(req.user, requestedRole);
  } else if (dept && dept.defaultRoleId) {
    const defaultRole = await Role.findByPk(dept.defaultRoleId);
    if (defaultRole) await assertCanHandOutRole(req.user, defaultRole);
  }
  // The legacy role is stored on the account whatever role row it gets, and
  // 'admin' alone makes it a System Administrator — so it's checked on its
  // own, never skipped because a roleId or department default also applies.
  // Choosing System Administrator sets it too: older gates still read it.
  const legacyRole = isTopRole(requestedRole) ? 'admin' : (role || 'technician');
  await assertCanSetLegacyRole(req.user, legacyRole);
  if (requestedRole && requestedRole.scope === 'department' && !dept) {
    throw new ApiError(400, `Choose a department: the ${requestedRole.name} role applies within one`, 'VALIDATION_ERROR');
  }
  const overrideRows = await parseNewOverrides(req.user, overrides);
  // A fenced creator can't make an account that reaches more than they do:
  // it starts with the creator's own companies.
  const creatorCompanyIds = await getUserCompanyIds(req.user);

  const passwordHash = await bcrypt.hash(password, 12);
  // System-wide time-tracking defaults (Settings -> Time Tracking) seed a
  // new user's own timer preferences — after creation, Preferences fully
  // overrides these per-user, this is only the initial value.
  const settings = await getAllSettings();
  const user = await sequelize.transaction(async (transaction) => {
    const made = await User.create({
      username,
      displayName: resolvedDisplayName,
      firstName: firstName ? firstName.trim() : null,
      lastName: lastName ? lastName.trim() : null,
      phone: normalizePhone(phone),
      jobTitle: jobTitle ? jobTitle.trim() : null,
      email: email || null,
      role: legacyRole,
      departmentId: departmentId || null,
      passwordHash,
      isLocalAccount: true,
      mustChangePassword: true,
      timerMode: ['manual', 'automatic'].includes(settings['timeTracking.defaultMode']) ? settings['timeTracking.defaultMode'] : 'manual',
      timerMinThreshold: Number(settings['timeTracking.defaultMinThreshold']) || 0,
      allCompanies: creatorCompanyIds === null,
    }, { transaction }).catch(rethrowIfUsernameTaken);
    if (creatorCompanyIds && creatorCompanyIds.length) {
      await UserCompanyAccess.bulkCreate(creatorCompanyIds.map((companyId) => ({ userId: made.id, companyId })), { transaction });
    }
    await assignInitialRole(made, made.role, made.departmentId, req.user.id, requestedRole, transaction);
    if (overrideRows.length) {
      await UserPermissionOverride.bulkCreate(overrideRows.map((o) => ({ ...o, userId: made.id, grantedBy: req.user.id })), { transaction });
    }
    return made;
  });
  invalidateUserPermissions(user.id);
  await writeAudit(req, 'user.create_local', 'User', user.id, {
    username: user.username, role: user.role, roleId: user.roleId, overrides: overrideRows.map((o) => ({ permissionKey: o.permissionKey, granted: o.granted })),
  });
  for (const o of overrideRows) {
    // eslint-disable-next-line no-await-in-loop
    await writeSystemAudit(req, 'override_granted', user.id, o);
  }

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
  // administrator / owner: the screens keep an administrator's account
  // read-only for anyone but an Owner (the server decides).
  res.json({ user: { ...user.toJSON(), administrator: await isAdministrator(user), owner: await isOwner(user) } });
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
  // An administrator's account is changed only by an Owner (user decision 2026-10-11).
  if (!isSelf) await assertCanManageAccount(req.user, user);

  const {
    role, departmentId, password, firstName, lastName, phone, jobTitle, email, userType, hourlyRate, username,
  } = req.body || {};
  const changes = {};

  // A rename (user request 2026-10-11). Sending the current name back (the
  // whole form comes back) isn't one. Sessions hold the account's id, so its
  // holder stays signed in.
  if (username !== undefined && username !== user.username) {
    if (!canEditUsers) throw new ApiError(403, 'Changing a username needs people.edit_users', 'FORBIDDEN');
    // Directory sign-in finds its account by username: a renamed one would be
    // made again at the next sign-in.
    if (!user.isLocalAccount) {
      throw new ApiError(400, 'A directory or single sign-on account keeps the username its provider gives it', 'NOT_LOCAL_ACCOUNT');
    }
    changes.username = normalizeUsername(username);
    await assertUsernameFree(changes.username, user.id);
  }

  if (role !== undefined || departmentId !== undefined || password !== undefined
    || userType !== undefined || hourlyRate !== undefined) {
    if (!canEditUsers) {
      throw new ApiError(403, 'You do not have permission to change role, department, password, or contractor status', 'FORBIDDEN');
    }
  }

  if (role !== undefined) {
    if (!['admin', 'technician'].includes(role)) {
      throw new ApiError(400, 'Invalid role', 'VALIDATION_ERROR');
    }
    // A role change is a grant (S11). Re-sending the current role (the whole
    // form comes back) isn't.
    if (role !== user.role) {
      if (!(await hasPermission(req.user.id, 'people.manage_roles'))) {
        throw new ApiError(403, 'Changing a role needs people.manage_roles', 'FORBIDDEN');
      }
      await assertCanSetLegacyRole(req.user, role, user.id);
      if (role !== 'admin') await assertKeepsSystemAdmin(user); // an owner stays a System Administrator
      changes.role = role;
    }
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
    // Resetting a password lets you sign in as that account (S11).
    // (An administrator's password: covered by assertCanManageAccount above.)
    const resetPolicy = validatePassword(password, {
      username: user.username,
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
    if (!resetPolicy.ok) {
      throw new ApiError(400, describeProblems(resetPolicy.problems), 'WEAK_PASSWORD');
    }
    changes.passwordHash = await bcrypt.hash(password, 12);
    changes.mustChangePassword = true;
  }

  if (userType !== undefined) {
    if (!['internal', 'contractor'].includes(userType)) {
      throw new ApiError(400, 'userType must be "internal" or "contractor"', 'VALIDATION_ERROR');
    }
    changes.userType = userType;
    // Switching back to internal clears any stale rate rather than leaving
    // an orphaned hourlyRate that would silently resurrect if re-flipped.
    if (userType === 'internal' && hourlyRate === undefined) changes.hourlyRate = null;
  }
  if (hourlyRate !== undefined) {
    if (hourlyRate !== null) {
      const rate = Number(hourlyRate);
      if (Number.isNaN(rate) || rate < 0) {
        throw new ApiError(400, 'hourlyRate must be a non-negative number', 'VALIDATION_ERROR');
      }
      changes.hourlyRate = rate;
    } else {
      changes.hourlyRate = null;
    }
  }
  if (firstName !== undefined) changes.firstName = firstName ? firstName.trim() : null;
  if (lastName !== undefined) changes.lastName = lastName ? lastName.trim() : null;
  if (phone !== undefined) changes.phone = normalizePhone(phone);
  if (jobTitle !== undefined) changes.jobTitle = jobTitle ? jobTitle.trim() : null;
  if (email !== undefined) {
    const next = email ? String(email).trim() : null;
    // An address decides who counts as staff on inbound mail, so only
    // people who can edit users change it (user decision 2026-10-15).
    if ((next || '').toLowerCase() !== (user.email || '').toLowerCase()) {
      if (!canEditUsers) throw new ApiError(403, 'Changing an email address needs people.edit_users', 'FORBIDDEN');
      changes.email = next;
      if (user.isLocalAccount) await assertLocalEmailFree(changes.email, user.id);
    }
  }

  if (firstName !== undefined || lastName !== undefined) {
    const resolvedFirst = changes.firstName !== undefined ? changes.firstName : user.firstName;
    const resolvedLast = changes.lastName !== undefined ? changes.lastName : user.lastName;
    changes.displayName = computeDisplayName({ firstName: resolvedFirst, lastName: resolvedLast, fallback: user.displayName });
  }

  const previousUsername = user.username;
  await user.update(changes).catch(rethrowIfUsernameTaken);
  if (changes.username !== undefined) {
    await writeAudit(req, 'user.rename', 'User', user.id, { from: previousUsername, to: changes.username });
  }
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
  if (req.user.id !== id) await assertCanManageAccount(req.user, user); // Owner review L3

  const {
    timerMode, timerMinThreshold, timerPromptBeforeLog, timerReminderMinutes, timerReminderRepeatMinutes,
    emailSignature, notificationEmailPrefs,
  } = req.body || {};
  const changes = {};

  // Email on/off per notification event; null = follow the admin defaults.
  if (notificationEmailPrefs !== undefined) {
    const checked = validEmailPrefs(notificationEmailPrefs);
    if (!checked.ok) throw new ApiError(400, 'notificationEmailPrefs must be on/off per notification event', 'VALIDATION_ERROR');
    changes.notificationEmailPrefs = checked.value;
  }

  // Rich HTML added to emailed replies: sanitized here, on save.
  if (emailSignature !== undefined) {
    if (emailSignature !== null && typeof emailSignature !== 'string') {
      throw new ApiError(400, 'emailSignature must be text', 'VALIDATION_ERROR');
    }
    const clean = sanitizeRichHtml(emailSignature || '');
    if (clean.length > 20000) {
      throw new ApiError(400, 'The signature can be at most 20,000 characters', 'VALIDATION_ERROR');
    }
    changes.emailSignature = clean || null;
  }

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
  // Reminders for timers left running: the first after 0 (off) to 24 hours,
  // then every 15 minutes to 24 hours.
  const minutes = (value, name, min) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > 1440) {
      throw new ApiError(400, `${name} must be a whole number of minutes from ${min} to 1440`, 'VALIDATION_ERROR');
    }
    return n;
  };
  if (timerReminderMinutes !== undefined) changes.timerReminderMinutes = minutes(timerReminderMinutes, 'timerReminderMinutes', 0);
  if (timerReminderRepeatMinutes !== undefined) {
    changes.timerReminderRepeatMinutes = minutes(timerReminderRepeatMinutes, 'timerReminderRepeatMinutes', 15);
  }

  await user.update(changes);
  if (Object.keys(changes).length) await writeAudit(req, 'user.preferences_update', 'User', user.id, { fields: Object.keys(changes) });
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
  await assertCanManageAccount(req.user, user);
  await assertNotTheOwner(user);

  // Nothing the account held outlives it: its grants must not pass to
  // whoever might ever get its id.
  await sequelize.transaction(async (transaction) => {
    await UserRole.destroy({ where: { userId: user.id }, transaction });
    await UserPermissionOverride.destroy({ where: { userId: user.id }, transaction });
    await UserCompanyAccess.destroy({ where: { userId: user.id }, transaction });
    await user.destroy({ transaction });
  });
  await writeAudit(req, 'user.delete', 'User', id, { username: user.username });
  res.json({ ok: true });
});

// PATCH /users/:id/work-hours — settings.manage_business_hours (the route
// checks it). { workHours: { "1": 480, ... } } sets this person's minutes per
// ISO weekday; { workHours: null } goes back to the system default.
const updateWorkHours = asyncHandler(async (req, res) => {
  const id = parseRecordId(req.params.id);
  const user = id && await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  const raw = (req.body || {}).workHours;
  if (raw === undefined) throw new ApiError(400, 'workHours is required (an object, or null for the default)', 'VALIDATION_ERROR');
  const workHours = raw === null ? null : validWorkHours(raw);
  if (raw !== null && !workHours) {
    throw new ApiError(400, 'Work hours are whole minutes from 0 to 1440, keyed by weekday 1 (Monday) to 7 (Sunday)', 'VALIDATION_ERROR');
  }
  const previous = user.workHours ?? null;
  await user.update({ workHours });
  await writeAudit(req, 'user.workHours', 'User', user.id, { from: previous, to: workHours });
  // Only the hours: this permission is not a licence to read the account.
  res.json({ user: { id: user.id, workHours: user.workHours ?? null } });
});

module.exports = {
  list, create, get, update, remove, listAssignable, listDirectory, updatePreferences, updateWorkHours,
};
