const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');
const { User, TeamMember, Role, sequelize } = require('../models');
const { authenticate: ldapAuthenticate, isConfigured: isLdapConfigured } = require('../config/ldap');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { resolveUserPermissions } = require('../services/permissionService');
const { validatePassword, describeProblems } = require('../utils/passwordPolicy');
const { getAllSettings } = require('./settingsController');

const primaryRoleInclude = [{ model: Role, as: 'primaryRole' }];

// Admins and team leads may log time on tickets against another tech's name.
async function serializeUserWithFlags(user) {
  const canLogTimeForOthers =
    user.role === 'admin' || !!(await TeamMember.findOne({ where: { userId: user.id, isLead: true } }));
  return { ...user.toJSON(), canLogTimeForOthers };
}


// Issue a brand-new session id for the authenticated user. Express-session
// reuses the existing id by default, so an attacker who could plant a session
// cookie in someone's browser (a shared kiosk, a network position on a plain
// HTTP deployment, XSS on an adjacent origin) still held a valid handle on
// that session after the victim logged in — classic session fixation. The
// pre-login session is destroyed and replaced, so any previously-known id is
// worthless.
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== 'function') return resolve();
    return req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}


// Revoke every stored session belonging to a user except the one making the
// request. connect-session-sequelize keeps the serialized session in the
// `data` column, so the owning user is matched on the JSON payload rather
// than a dedicated column. Best-effort: a failure here must not block the
// password change that triggered it.
async function destroyOtherSessionsForUser(userId, keepSid) {
  try {
    const rows = await sequelize.query(
      'SELECT sid, data FROM Sessions',
      { type: QueryTypes.SELECT }
    );
    const stale = rows.filter((row) => {
      if (!row || row.sid === keepSid) return false;
      try {
        return JSON.parse(row.data)?.userId === userId;
      } catch {
        return false;
      }
    });
    if (!stale.length) return;
    await sequelize.query('DELETE FROM Sessions WHERE sid IN (:sids)', {
      replacements: { sids: stale.map((row) => row.sid) },
      type: QueryTypes.DELETE,
    });
  } catch (err) {
    console.error('[auth] could not revoke other sessions for user', userId, err);
  }
}


// When an administrator requires SSO, password and directory logins are
// refused — except for accounts explicitly designated break-glass. Without
// that exemption a misconfigured or unreachable identity provider would lock
// an organisation out of its own helpdesk with no way back in.
async function assertPasswordLoginAllowed(user) {
  const settings = await getAllSettings();
  if (settings['sso.enforced'] !== 'true') return;
  if (user && user.isBreakGlass && user.isLocalAccount) return;
  throw new ApiError(
    403,
    'This organisation requires single sign-on. Use one of the sign-on options on the login page.',
    'SSO_REQUIRED'
  );
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

  await regenerateSession(req);
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
    if (!localUser.isActive) {
      throw new ApiError(401, 'This account has been deactivated', 'ACCOUNT_DEACTIVATED');
    }
    // Checked only after the password verifies, so the error cannot be used
    // to enumerate which accounts hold the break-glass exemption.
    await assertPasswordLoginAllowed(localUser);
    return { user: localUser, method: 'local' };
  }

  // 2. No local account — try AD if it is configured.
  if (!(await isLdapConfigured())) {
    throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }

  const user = await loginAd(identifier, password);
  if (!user.isActive) {
    throw new ApiError(401, 'This account has been deactivated', 'ACCOUNT_DEACTIVATED');
  }
  // A directory account can never be break-glass (it depends on the same
  // infrastructure SSO does), so enforcement always applies here.
  await assertPasswordLoginAllowed(user);
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

    // Every PRISM user is staff — customers/end-users are Contacts, who
    // don't have (or need) a directory login. New AD users default to the
    // baseline technician role.
    return User.create(
      {
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        role: 'technician',
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
  res.clearCookie('prism.sid', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
  });
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
  const policy = validatePassword(newPassword, {
    username: user.username,
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  });
  if (!policy.ok) {
    throw new ApiError(400, describeProblems(policy.problems), 'WEAK_PASSWORD');
  }

  // A new password identical to the current one defeats the point of
  // changing it — particularly on the forced first-login change.
  if (user.passwordHash && (await bcrypt.compare(newPassword, user.passwordHash))) {
    throw new ApiError(400, 'New password must be different from your current password', 'WEAK_PASSWORD');
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

  // Re-issue this session and drop every other one belonging to the account,
  // so a stolen pre-change session cannot outlive the password it was
  // obtained with.
  await destroyOtherSessionsForUser(user.id, req.sessionID);
  await regenerateSession(req);
  req.session.userId = user.id;

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
