const { ldapConfig } = require('../config/ldap');
const { asyncHandler } = require('../middleware/error');

// GET /settings — Admin only. Read-only view of effective configuration.
// Secrets (bind password, session secret) are never returned; only whether they are set.
const get = asyncHandler(async (req, res) => {
  res.json({
    settings: {
      ldap: {
        url: ldapConfig.url,
        baseDN: ldapConfig.baseDN,
        bindDN: ldapConfig.bindDN,
        userFilter: ldapConfig.userFilter,
        bindPasswordSet: !!ldapConfig.bindPassword,
      },
      database: {
        host: process.env.DB_HOST || null,
        port: process.env.DB_PORT || null,
        name: process.env.DB_NAME || null,
        user: process.env.DB_USER || null,
      },
      app: {
        nodeEnv: process.env.NODE_ENV || 'development',
        sessionSecretSet: !!process.env.SESSION_SECRET,
      },
    },
  });
});

module.exports = { get };
