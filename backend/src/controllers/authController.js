const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, sequelize } = require('../models');
const { authenticate: ldapAuthenticate } = require('../config/ldap');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const MIN_PASSWORD_LENGTH = 8;

// POST /auth/login
// Body: { mode: 'ad' | 'local', username, password }
//   - 'ad' (default): authenticate against LDAP/AD, syncing the directory profile.
//   - 'local': authenticate a manually-created local account by username OR email.
const login = asyncHandler(async (req, res) => {
  const { username, password, mode } = req.body || {};
  if (!username || !password) {
    throw new ApiError(400, 'Username and password are required', 'MISSING_CREDENTIALS');
  }

  const user = mode === 'local'
    ? await loginLocal(username, password)
    : await loginAd(username, password);

  // Establish session.
  req.session.userId = user.id;
  req.user = user;
  user.lastLogin = new Date();
  await user.save();
  await writeAudit(req, 'auth.login', 'User', user.id, {
    method: mode === 'local' ? 'local' : 'ldap',
  });

  res.json({ user, mustChangePassword: user.mustChangePassword });
});

// Local account login: identifier may be a username or an email.
async function loginLocal(identifier, password) {
  const user = await User.findOne({
    where: {
      isLocalAccount: true,
      [Op.or]: [{ username: identifier }, { email: identifier }],
    },
  });
  // Always run a bcrypt compare (even on miss) to reduce timing signal.
  const hash = user?.passwordHash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) {
    throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }
  return user;
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
  res.json({ user: req.user, mustChangePassword: req.user.mustChangePassword });
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

  res.json({ ok: true, user });
});

module.exports = { login, logout, me, changePassword };
