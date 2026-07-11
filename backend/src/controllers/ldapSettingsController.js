const { SystemSettings } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { encryptToken } = require('../utils/tokenCrypto');
const {
  resolveLdapConfig, readLdapSettingsRows, isConfigured, testBind, ATTR_DEFAULTS,
} = require('../config/ldap');

// Maps the form-facing field name to its SystemSettings key (ldap.* dot
// namespace, consistent with company.*/branding.*/integrations.* elsewhere
// in this app rather than the app_settings/snake_case naming a generic spec
// might suggest — there's one settings table here, and it's all dot-keys).
const FIELD_KEYS = {
  host: 'ldap.host',
  port: 'ldap.port',
  baseDN: 'ldap.baseDN',
  bindDN: 'ldap.bindDN',
  bindPassword: 'ldap.bindPassword', // write-only, encrypted — never read back raw
  useSSL: 'ldap.useSSL',
  usernameAttr: 'ldap.usernameAttr',
  emailAttr: 'ldap.emailAttr',
  displayNameAttr: 'ldap.displayNameAttr',
  firstNameAttr: 'ldap.firstNameAttr',
  lastNameAttr: 'ldap.lastNameAttr',
  phoneAttr: 'ldap.phoneAttr',
  searchFilter: 'ldap.searchFilter',
  pageSize: 'ldap.pageSize',
  timeout: 'ldap.timeout',
  followReferrals: 'ldap.followReferrals',
};
const BOOLEAN_FIELDS = new Set(['useSSL', 'followReferrals']);
const NUMBER_FIELDS = new Set(['port', 'pageSize', 'timeout']);

// GET /settings/ldap
const get = asyncHandler(async (req, res) => {
  const db = await readLdapSettingsRows();
  const resolved = await resolveLdapConfig(db);

  const useSSL = db['ldap.useSSL'] === 'true';
  res.json({
    host: db['ldap.host'] || '',
    port: db['ldap.port'] ? Number(db['ldap.port']) : (useSSL ? 636 : 389),
    baseDN: db['ldap.baseDN'] || '',
    bindDN: db['ldap.bindDN'] || '',
    bindPassword: db['ldap.bindPassword'] ? '***' : '',
    useSSL,
    usernameAttr: db['ldap.usernameAttr'] || ATTR_DEFAULTS.usernameAttr,
    emailAttr: db['ldap.emailAttr'] || ATTR_DEFAULTS.emailAttr,
    displayNameAttr: db['ldap.displayNameAttr'] || ATTR_DEFAULTS.displayNameAttr,
    firstNameAttr: db['ldap.firstNameAttr'] || ATTR_DEFAULTS.firstNameAttr,
    lastNameAttr: db['ldap.lastNameAttr'] || ATTR_DEFAULTS.lastNameAttr,
    phoneAttr: db['ldap.phoneAttr'] || ATTR_DEFAULTS.phoneAttr,
    searchFilter: db['ldap.searchFilter'] || '(objectClass=user)',
    pageSize: db['ldap.pageSize'] ? Number(db['ldap.pageSize']) : ATTR_DEFAULTS.pageSize,
    timeout: db['ldap.timeout'] ? Number(db['ldap.timeout']) : ATTR_DEFAULTS.timeout,
    followReferrals: db['ldap.followReferrals'] === 'true',
    // Reflects whatever is ACTUALLY active right now (database if
    // ldap.host is set, otherwise env fallback) — lets the status header
    // show "connected via .env" even when the form above is blank.
    source: resolved.source,
    configured: await isConfigured(),
    lastTestAt: db['ldap.lastTestAt'] || null,
  });
});

// PATCH /settings/ldap
const update = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const updates = [];

  for (const [field, key] of Object.entries(FIELD_KEYS)) {
    if (body[field] === undefined) continue; // eslint-disable-line no-continue

    if (field === 'bindPassword') {
      // Blank/"***" means "leave unchanged" — the GET response never sends
      // the real password back, so a normal load-form/save-other-fields
      // round trip must not wipe it out. Same write-only pattern as the
      // OAuth client secrets in settingsController.js.
      const raw = body.bindPassword;
      if (!raw || !String(raw).trim() || raw === '***') continue; // eslint-disable-line no-continue
      updates.push({ key, value: encryptToken(String(raw)) });
      continue; // eslint-disable-line no-continue
    }

    let value = body[field];
    if (BOOLEAN_FIELDS.has(field)) value = String(!!value);
    else if (NUMBER_FIELDS.has(field)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ApiError(400, `${field} must be a positive number`, 'VALIDATION_ERROR');
      }
      value = String(n);
    } else {
      value = String(value ?? '').trim();
    }
    updates.push({ key, value });
  }

  if (!updates.length) {
    return res.json({ ok: true });
  }

  await Promise.all(updates.map(({ key, value }) => SystemSettings.upsert({ key, value, updatedById: req.user.id })));
  await writeAudit(req, 'settings.ldap_update', 'SystemSettings', null, { fields: updates.map((u) => u.key) });

  res.json({ ok: true });
});

// Builds a full, resolvable LDAP config for testing from the currently
// saved config plus any overrides in the request body (unsaved form
// values) — lets "Test connection" work before "Save" is ever clicked.
async function buildCandidateConfig(overrides) {
  const saved = await resolveLdapConfig();
  if (!overrides || typeof overrides !== 'object' || !Object.keys(overrides).length) {
    return saved;
  }

  const useSSL = overrides.useSSL !== undefined ? !!overrides.useSSL : saved.useSSL;
  const host = overrides.host !== undefined ? String(overrides.host).trim() : saved.host;
  const port = overrides.port !== undefined ? Number(overrides.port) : (saved.port || (useSSL ? 636 : 389));
  // A blank/"***" password in the test request means "use the already-
  // saved one" — same write-only convention as PATCH.
  const bindPassword = overrides.bindPassword && overrides.bindPassword !== '***'
    ? String(overrides.bindPassword)
    : saved.bindPassword;
  const usernameAttr = overrides.usernameAttr || saved.usernameAttr;

  return {
    ...saved,
    source: 'database',
    url: host ? `${useSSL ? 'ldaps' : 'ldap'}://${host}:${port}` : saved.url,
    host,
    port,
    useSSL,
    baseDN: overrides.baseDN !== undefined ? String(overrides.baseDN).trim() : saved.baseDN,
    bindDN: overrides.bindDN !== undefined ? String(overrides.bindDN).trim() : saved.bindDN,
    bindPassword,
    usernameAttr,
    userFilter: `(${usernameAttr}={{username}})`,
    emailAttr: overrides.emailAttr || saved.emailAttr,
    displayNameAttr: overrides.displayNameAttr || saved.displayNameAttr,
    firstNameAttr: overrides.firstNameAttr || saved.firstNameAttr,
    lastNameAttr: overrides.lastNameAttr || saved.lastNameAttr,
    phoneAttr: overrides.phoneAttr || saved.phoneAttr,
    searchFilter: overrides.searchFilter || saved.searchFilter,
    pageSize: overrides.pageSize !== undefined ? Number(overrides.pageSize) : saved.pageSize,
    timeout: overrides.timeout !== undefined ? Number(overrides.timeout) : saved.timeout,
    followReferrals: overrides.followReferrals !== undefined ? !!overrides.followReferrals : saved.followReferrals,
  };
}

// POST /settings/ldap/test — Body (optional): any subset of the connection
// fields, to test unsaved edits before hitting Save. Omit the body (or send
// {}) to test the currently saved config.
const test = asyncHandler(async (req, res) => {
  const config = await buildCandidateConfig(req.body);
  const result = await testBind(config);

  if (result.success) {
    await SystemSettings.upsert({ key: 'ldap.lastTestAt', value: new Date().toISOString(), updatedById: req.user.id });
  }

  res.json(result);
});

module.exports = { get, update, test };
