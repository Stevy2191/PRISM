const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, TeamMember, Role, sequelize } = require('../models');
const { authenticate: ldapAuthenticate, isConfigured: isLdapConfigured } = require('../config/ldap');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { resolveUserPermissions } = require('../services/permissionService');

const MIN_PASSWORD_LENGTH = 8;
const primaryRoleInclude = [{ model: Role, as: 'primaryRole' }];

// Admins and team leads may log time on tickets against another tech's name.
async function serializeUserWithFlags(user) {
  const canLogTimeForOthers =
    user.role === 'admin' || !!(await TeamMember.findOne({ where: { userId: user.id, isLead: true } }));
  return { ...user.toJSON(), canLogTimeForOthers };
}

// POST /auth/login
// Body: { username, password }
// Auth method is auto-detected: local accounts take priority; if no local
// account matches and LDAP is configured, AD authentication is attempted.
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    throw new ApiError(400, 'Username and password are required', 'MISSING_CREDENTIALS');
  }

  const { user, method } = await loginUnified(username, password);

  req.session.userId = user.id;
  req.user = user;
  user.lastLogin = new Date();
  await user.save();
  await writeAudit(req, 'auth.login', 'User', user.id, { method });

  res.json({ user: await serializeUserWithFlags(user), mustChangePassword: user.mustChangePassword });
});

// Try local first (by username or email), then fall back to AD if configured.
// Always returns the same generic error so we don't reveal which methods exist.
async function loginUnified(identifier, password) {
  // 1. Local account — look up by username OR email.
  const localUser = await User.findOne({
    where: {
      isLocalAccount: true,
      [Op.or]: [{ username: identifier }, { email: identifier }],
    },
    include: primaryRoleInclude,
  });

  if (localUser) {
    // Always run bcrypt (even when there is no hash) to avoid timing attacks.
    const hash = localUser.passwordHash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
    }
    return { user: localUser, method: 'local' };
  }

  // 2. No local account — try AD if it is configured.
  if (!isLdapConfigured()) {
    throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }

  const user = await loginAd(identifier, password);
  return { user, method: 'ldap' };
}

// Active Directory login via LDAP. Creates/updates the (non-local) user record.
async function loginAd(username, password) {
  let profile;
  try {
    profile = await ldapAuthenticate(username, password);
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') {
      throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
    }
    throw new ApiError(502, 'Unable to reach the directory server', 'LDAP_ERROR');
  }

  return sequelize.transaction(async (t) => {
    const existing = await User.findOne({
      where: { username: profile.username },
      include: primaryRoleInclude,
      transaction: t,
    });

    if (existing) {
      // Local accounts are never overwritten by directory sync.
      if (existing.isLocalAccount) {
        throw new ApiError(
          409,
          'A local account already exists with this username',
          'LOCAL_ACCOUNT_CONFLICT'
        );
      }
      existing.displayName = profile.displayName || existing.displayName;
      existing.email = profile.email || existing.email;
      await existing.save({ transaction: t });
      return existing;
    }

    // New AD users default to requester and are not local accounts.
    return User.create(
      {
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        role: 'requester',
        isLocalAccount: false,
        passwordHash: null,
        mustChangePassword: false,
      },
      { transaction: t }
    );
  });
}

// POST /auth/logout
const logout = asyncHandler(async (req, res) => {
  const userId = req.session?.userId;
  await new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
  res.clearCookie('prism.sid');
  res.json({ ok: true, userId });
});

// GET /auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ user: await serializeUserWithFlags(req.user), mustChangePassword: req.user.mustChangePassword });
});

// POST /auth/change-password
// Body: { currentPassword?, newPassword }
// Local accounts only. When mustChangePassword is set (forced first-login change),
// the current password is not required since the session is already authenticated.
const changePassword = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user.isLocalAccount) {
    throw new ApiError(
      400,
      'Password changes apply to local accounts only; AD passwords are managed in Active Directory',
      'NOT_LOCAL_ACCOUNT'
    );
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'WEAK_PASSWORD'
    );
  }

  // Verify the current password unless this is a forced first-login change.
  if (!user.mustChangePassword) {
    const ok = currentPassword && (await bcrypt.compare(currentPassword, user.passwordHash || ''));
    if (!ok) {
      throw new ApiError(400, 'Current password is incorrect', 'INVALID_CREDENTIALS');
    }
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  await user.save();
  await writeAudit(req, 'auth.change_password', 'User', user.id, null);

  res.json({ ok: true, user: await serializeUserWithFlags(user) });
});

// GET /auth/me/permissions — the logged-in user's fully resolved permission
// map, e.g. { "tickets.view_all": true, "projects.create": false, ... }.
// Consumed by the frontend to show/hide UI (buttons, menu items, tabs).
const myPermissions = asyncHandler(async (req, res) => {
  const permissions = await resolveUserPermissions(req.user.id);
  res.json({ permissions });
});

module.exports = { login, logout, me, changePassword, myPermissions };
