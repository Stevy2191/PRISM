const bcrypt = require('bcryptjs');
const { User, sequelize } = require('../models');
const { authenticate: ldapAuthenticate } = require('../config/ldap');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

// POST /auth/login
// Authenticates against LDAP/AD. The bootstrap admin (BOOTSTRAP_ADMIN_USERNAME /
// BOOTSTRAP_ADMIN_PASSWORD) is the one local exception, allowing first-time access
// before any directory user has been promoted to admin.
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    throw new ApiError(400, 'Username and password are required', 'MISSING_CREDENTIALS');
  }

  const bootstrapUser = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const bootstrapPass = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  let profile;
  let isBootstrap = false;

  if (bootstrapUser && username === bootstrapUser) {
    if (!bootstrapPass || password !== bootstrapPass) {
      throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
    }
    isBootstrap = true;
    profile = {
      username: bootstrapUser,
      displayName: 'PRISM Administrator',
      email: process.env.BOOTSTRAP_ADMIN_EMAIL || null,
    };
  } else {
    try {
      profile = await ldapAuthenticate(username, password);
    } catch (err) {
      if (err.code === 'INVALID_CREDENTIALS') {
        throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
      }
      throw new ApiError(502, 'Unable to reach the directory server', 'LDAP_ERROR');
    }
  }

  // Upsert the user, syncing directory attributes on every login.
  const user = await sequelize.transaction(async (t) => {
    let existing = await User.findOne({ where: { username: profile.username }, transaction: t });

    if (!existing) {
      existing = await User.create(
        {
          username: profile.username,
          displayName: profile.displayName,
          email: profile.email,
          // Bootstrap account is admin; everyone else defaults to requester.
          role: isBootstrap ? 'admin' : 'requester',
          lastLogin: new Date(),
        },
        { transaction: t }
      );
    } else {
      existing.displayName = profile.displayName || existing.displayName;
      existing.email = profile.email || existing.email;
      if (isBootstrap) existing.role = 'admin';
      existing.lastLogin = new Date();
      await existing.save({ transaction: t });
    }
    return existing;
  });

  // Establish session.
  req.session.userId = user.id;
  req.user = user;
  await writeAudit(req, 'auth.login', 'User', user.id, { method: isBootstrap ? 'bootstrap' : 'ldap' });

  res.json({ user });
});

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
  res.json({ user: req.user });
});

module.exports = { login, logout, me };
