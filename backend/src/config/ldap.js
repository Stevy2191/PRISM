// LDAP / Active Directory configuration and authentication helper.
//
// Config resolution order (see resolveLdapConfig()):
//   1. Database — SystemSettings rows keyed "ldap.*" (Settings -> General
//      Settings -> Active Directory / LDAP). Used wholesale if ldap.host is
//      set — no partial DB/env mixing.
//   2. Environment variables (LDAP_URL / LDAP_BASE_DN / etc) — unchanged
//      legacy behavior for installs that were configured before this UI
//      existed, or that just prefer .env.
// This means every exported function that talks to LDAP is now async (it
// has to resolve config, possibly from the DB, before it can do anything).
//
// Authentication flow:
//   1. Bind with the service account (bindDN / bindPassword).
//   2. Search for the user using the configured username attribute
//      (e.g. (sAMAccountName={{username}})).
//   3. Re-bind as the found user DN with the supplied password to verify credentials.
//   4. Return the user's directory attributes (displayName, mail, username).
const ldap = require('ldapjs');
const { Op } = require('sequelize');
const { SystemSettings } = require('../models');
const { decryptToken } = require('../utils/tokenCrypto');

// Field-level defaults — used both when resolving a DB-configured install
// (per-field fallback if a particular ldap.* key was never set) and as the
// UI's pre-filled form defaults (see ldapSettingsController.js's `get`).
const ATTR_DEFAULTS = {
  usernameAttr: 'sAMAccountName',
  emailAttr: 'mail',
  displayNameAttr: 'displayName',
  firstNameAttr: 'givenName',
  lastNameAttr: 'sn',
  phoneAttr: 'telephoneNumber',
  pageSize: 1000,
  timeout: 10,
};

async function readLdapSettingsRows() {
  const rows = await SystemSettings.findAll({ where: { key: { [Op.like]: 'ldap.%' } } });
  const db = {};
  rows.forEach((r) => { db[r.key] = r.value; });
  return db;
}

// Builds the *saved* config (DB if configured, else env). Every exported
// function below calls this first. `db` can be passed in by callers that
// already fetched the rows (e.g. the settings controller) to avoid a
// redundant query.
async function resolveLdapConfig(db) {
  const values = db || await readLdapSettingsRows();

  if (values['ldap.host']) {
    const useSSL = values['ldap.useSSL'] === 'true';
    const host = values['ldap.host'];
    const port = values['ldap.port'] ? Number(values['ldap.port']) : (useSSL ? 636 : 389);
    const usernameAttr = values['ldap.usernameAttr'] || ATTR_DEFAULTS.usernameAttr;
    return {
      source: 'database',
      url: `${useSSL ? 'ldaps' : 'ldap'}://${host}:${port}`,
      host,
      port,
      useSSL,
      baseDN: values['ldap.baseDN'] || '',
      bindDN: values['ldap.bindDN'] || '',
      bindPassword: values['ldap.bindPassword'] ? (decryptToken(values['ldap.bindPassword']) || '') : '',
      userFilter: `(${usernameAttr}={{username}})`,
      usernameAttr,
      emailAttr: values['ldap.emailAttr'] || ATTR_DEFAULTS.emailAttr,
      displayNameAttr: values['ldap.displayNameAttr'] || ATTR_DEFAULTS.displayNameAttr,
      firstNameAttr: values['ldap.firstNameAttr'] || ATTR_DEFAULTS.firstNameAttr,
      lastNameAttr: values['ldap.lastNameAttr'] || ATTR_DEFAULTS.lastNameAttr,
      phoneAttr: values['ldap.phoneAttr'] || ATTR_DEFAULTS.phoneAttr,
      // (objectClass=user) is the new UI's stated default for a *fresh*
      // DB-configured install — deliberately NOT the same as the env
      // fallback's default below, which stays exactly what it always was
      // so existing env-configured installs never change behavior.
      searchFilter: values['ldap.searchFilter'] || '(objectClass=user)',
      pageSize: values['ldap.pageSize'] ? Number(values['ldap.pageSize']) : ATTR_DEFAULTS.pageSize,
      timeout: values['ldap.timeout'] ? Number(values['ldap.timeout']) : ATTR_DEFAULTS.timeout,
      followReferrals: values['ldap.followReferrals'] === 'true',
      lastTestAt: values['ldap.lastTestAt'] || null,
    };
  }

  return {
    source: 'env',
    url: process.env.LDAP_URL || 'ldap://localhost:389',
    baseDN: process.env.LDAP_BASE_DN || '',
    bindDN: process.env.LDAP_BIND_DN || '',
    bindPassword: process.env.LDAP_BIND_PASSWORD || '',
    userFilter: process.env.LDAP_USER_FILTER || '(sAMAccountName={{username}})',
    usernameAttr: ATTR_DEFAULTS.usernameAttr,
    emailAttr: ATTR_DEFAULTS.emailAttr,
    displayNameAttr: ATTR_DEFAULTS.displayNameAttr,
    firstNameAttr: ATTR_DEFAULTS.firstNameAttr,
    lastNameAttr: ATTR_DEFAULTS.lastNameAttr,
    phoneAttr: ATTR_DEFAULTS.phoneAttr,
    // Preserves the exact pre-this-feature default (broader than the new
    // UI's (objectClass=user) default) so env-configured installs keep
    // returning exactly the same sync results they always did.
    searchFilter: '(|(objectClass=person)(objectClass=user))',
    pageSize: ATTR_DEFAULTS.pageSize,
    timeout: ATTR_DEFAULTS.timeout,
    followReferrals: false,
    lastTestAt: null,
  };
}

function createClient(config) {
  const client = ldap.createClient({
    url: config.url,
    reconnect: false,
    timeout: (config.timeout || ATTR_DEFAULTS.timeout) * 1000,
    connectTimeout: (config.timeout || ATTR_DEFAULTS.timeout) * 1000,
  });
  // ldapjs's client is an EventEmitter — a connection-level failure (wrong
  // host, unreachable server, connect timeout) that happens outside any
  // in-flight bind()/search() callback gets raised as a raw 'error' event
  // on the client itself, not surfaced through those callbacks' Promise
  // chain. Node's default behavior for an 'error' event with no listener is
  // to throw it as an uncaught exception, which crashes the whole process —
  // confirmed by actually crashing the dev server while testing an
  // unreachable host against this exact code path. Every caller below
  // already handles connection failures via its own bind()/search()
  // rejection; this listener exists purely to stop ldapjs's internal retry
  // machinery from taking the process down when that failure is reported
  // asynchronously instead.
  client.on('error', () => {});
  return client;
}

function bind(client, dn, password) {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function searchUser(client, username, config) {
  return new Promise((resolve, reject) => {
    const filter = config.userFilter.replace('{{username}}', escapeFilter(username));
    const opts = {
      filter,
      scope: 'sub',
      attributes: ['dn', config.displayNameAttr, 'cn', config.emailAttr, config.usernameAttr, 'userPrincipalName'],
    };

    client.search(config.baseDN, opts, (err, res) => {
      if (err) return reject(err);

      let entry = null;
      res.on('searchEntry', (e) => {
        // ldapjs v3 exposes parsed attributes on e.pojo / e.object
        entry = e.pojo || e.object || e;
      });
      res.on('error', (e) => reject(e));
      res.on('end', () => resolve(entry));
    });
  });
}

// Escape characters that are special in LDAP search filters (RFC 4515).
function escapeFilter(input) {
  return String(input)
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

function attr(entry, name) {
  if (!entry || !name) return null;
  // Normalize across the shapes ldapjs may return.
  if (entry.attributes && Array.isArray(entry.attributes)) {
    const found = entry.attributes.find((a) => a.type === name);
    if (found) return Array.isArray(found.values) ? found.values[0] : found.values;
  }
  if (entry[name] !== undefined) {
    return Array.isArray(entry[name]) ? entry[name][0] : entry[name];
  }
  return null;
}

// All values of a multi-valued attribute (e.g. memberOf) — `attr()` only
// returns the first.
function attrAll(entry, name) {
  if (!entry || !entry.attributes || !Array.isArray(entry.attributes)) return [];
  const found = entry.attributes.find((a) => a.type === name);
  if (!found) return [];
  return Array.isArray(found.values) ? found.values : [found.values].filter(Boolean);
}

// objectGUID is a binary attribute — ldapjs's string-decoded `.values` mangle
// it, so this reads the raw bytes (`.buffers`, only present on the
// un-pojo'd SearchEntry) and hex-encodes them into a stable, storable id.
function attrGuidHex(entry) {
  if (!entry || !entry.attributes || !Array.isArray(entry.attributes)) return null;
  const found = entry.attributes.find((a) => a.type === 'objectGUID');
  const buf = found?.buffers?.[0];
  return buf ? Buffer.from(buf).toString('hex') : null;
}

// Extracts the CN out of a group DN, e.g. "CN=IT-Staff,OU=Groups,DC=x,DC=y" -> "IT-Staff".
function cnFromDn(dn) {
  const m = /^CN=([^,]+)/i.exec(String(dn || ''));
  return m ? m[1] : null;
}

// Bit 2 (0x0002) of userAccountControl = ACCOUNTDISABLE.
function isAccountDisabled(userAccountControl) {
  const n = parseInt(userAccountControl, 10);
  return Number.isFinite(n) && (n & 0x2) !== 0;
}

// Lists every person/user entry under baseDN — used for AD contact sync
// (distinct from `authenticate`, which looks up and verifies exactly one
// user). Reuses the same service-bind connection as authenticate().
// AD limits unpaged searches to ~1000 results by default, so this pages.
// `preResolvedConfig` lets adContactSync.js resolve config once and reuse
// it for both this call and parsing the returned entries' attributes.
async function searchAllUsers(preResolvedConfig) {
  const config = preResolvedConfig || await resolveLdapConfig();
  if (!isConfiguredFromResolved(config)) {
    const e = new Error('LDAP is not configured');
    e.code = 'LDAP_NOT_CONFIGURED';
    throw e;
  }
  const client = createClient(config);
  try {
    await bind(client, config.bindDN, config.bindPassword);
    return await new Promise((resolve, reject) => {
      const entries = [];
      client.search(
        config.baseDN,
        {
          scope: 'sub',
          filter: config.searchFilter,
          attributes: [
            'dn', config.firstNameAttr, config.lastNameAttr, config.displayNameAttr,
            config.emailAttr, config.usernameAttr, config.phoneAttr,
            'title', 'department', 'userAccountControl', 'objectGUID', 'memberOf',
          ],
          paged: { pageSize: config.pageSize || 500 },
        },
        (err, res) => {
          if (err) return reject(err);
          res.on('searchEntry', (entry) => entries.push(entry));
          res.on('error', (searchErr) => reject(searchErr));
          res.on('end', () => resolve(entries));
        }
      );
    });
  } finally {
    client.unbind(() => {});
  }
}

/**
 * Authenticate a user against LDAP/AD.
 * @returns {Promise<{username, displayName, email, dn}>}
 * @throws Error with code 'INVALID_CREDENTIALS' or 'LDAP_ERROR'
 */
async function authenticate(username, password) {
  if (!username || !password) {
    const e = new Error('Username and password are required');
    e.code = 'INVALID_CREDENTIALS';
    throw e;
  }

  const config = await resolveLdapConfig();
  const serviceClient = createClient(config);
  try {
    // 1. Service bind
    await bind(serviceClient, config.bindDN, config.bindPassword);

    // 2. Find user
    const entry = await searchUser(serviceClient, username, config);
    if (!entry) {
      const e = new Error('Invalid username or password');
      e.code = 'INVALID_CREDENTIALS';
      throw e;
    }

    const userDN = entry.objectName || entry.dn || attr(entry, 'dn');
    if (!userDN) {
      const e = new Error('Could not resolve user DN');
      e.code = 'LDAP_ERROR';
      throw e;
    }

    // 3. Verify password by binding as the user
    const userClient = createClient(config);
    try {
      await bind(userClient, userDN, password);
    } catch (err) {
      const e = new Error('Invalid username or password');
      e.code = 'INVALID_CREDENTIALS';
      throw e;
    } finally {
      userClient.unbind(() => {});
    }

    // 4. Extract profile attributes
    return {
      username: attr(entry, config.usernameAttr) || username,
      displayName: attr(entry, config.displayNameAttr) || attr(entry, 'cn') || username,
      email: attr(entry, config.emailAttr) || attr(entry, 'userPrincipalName') || null,
      dn: userDN,
    };
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') throw err;
    const e = new Error(err.message || 'LDAP authentication failed');
    e.code = 'LDAP_ERROR';
    throw e;
  } finally {
    serviceClient.unbind(() => {});
  }
}

// Env-only heuristic (legacy) — "not stubs" for an install that has never
// touched the DB config at all. New installs (setup.sh since the unified-
// login change) set LDAP_ENABLED explicitly; legacy .env files without it
// fall back to excluding the placeholder URL setup.sh writes when AD is
// skipped.
function isEnvConfigured() {
  if (process.env.LDAP_ENABLED !== undefined) {
    return process.env.LDAP_ENABLED === 'true';
  }
  const url = process.env.LDAP_URL || '';
  return !!(
    url &&
    url !== 'ldap://placeholder.example.local' &&
    process.env.LDAP_BIND_DN &&
    process.env.LDAP_BIND_PASSWORD
  );
}

function isConfiguredFromResolved(config) {
  if (config.source === 'database') return !!(config.host && config.bindDN && config.bindPassword);
  return isEnvConfigured();
}

// Returns true when LDAP is configured for real (not stubs) — checks the
// database first, env vars second, matching resolveLdapConfig()'s own
// priority order.
async function isConfigured() {
  const config = await resolveLdapConfig();
  return isConfiguredFromResolved(config);
}

// LDAP result-code / Node socket-error classification — best-effort pattern
// matching against ldapjs's error names/messages and standard Node network
// error codes, not an exhaustive mapping of every possible directory error.
function classifyBindError(err) {
  const name = String(err?.name || '');
  const code = String(err?.code || '');
  const msg = String(err?.message || '');

  if (/InvalidCredentials/i.test(name) || /invalid.*credentials/i.test(msg)) {
    return { success: false, message: 'Authentication failed: Invalid bind DN or password' };
  }
  if (/NoSuchObject/i.test(name) || /no such object/i.test(msg)) {
    return { success: false, message: 'Invalid base DN: no such object' };
  }
  if (code === 'ECONNREFUSED' || /connection refused/i.test(msg)) {
    return { success: false, message: 'Server unreachable: connection refused' };
  }
  if (code === 'ENOTFOUND' || /not found|getaddrinfo/i.test(msg)) {
    return { success: false, message: 'Server unreachable: hostname could not be resolved' };
  }
  if (code === 'ETIMEDOUT' || /TimeoutError/i.test(name) || /timeout|timed out/i.test(msg)) {
    return { success: false, message: 'Server unreachable: connection timed out' };
  }
  return { success: false, message: `Connection failed: ${msg || 'Unknown error'}` };
}

function countEntries(client, config) {
  return new Promise((resolve, reject) => {
    let count = 0;
    client.search(
      config.baseDN,
      { scope: 'sub', filter: config.searchFilter, attributes: ['dn'], paged: { pageSize: config.pageSize || 1000 } },
      (err, res) => {
        if (err) return reject(err);
        res.on('searchEntry', () => { count += 1; });
        res.on('error', (searchErr) => reject(searchErr));
        res.on('end', () => resolve(count));
      }
    );
  });
}

// Attempts a real service-account bind + a quick user count against a
// fully-resolved config object (see ldapSettingsController.js, which builds
// this either from the saved config or from unsaved form values). Never
// throws; always resolves with { success, message }.
async function testBind(config) {
  if (!config.bindDN || !config.bindPassword || !config.baseDN) {
    return { success: false, message: 'Hostname, base DN, bind DN, and bind password are all required.' };
  }
  const client = createClient(config);
  try {
    await bind(client, config.bindDN, config.bindPassword);
  } catch (err) {
    client.unbind(() => {});
    return classifyBindError(err);
  }
  let userCount = null;
  try {
    userCount = await countEntries(client, config);
  } catch {
    // A successful bind but failed search likely means the base DN is
    // wrong — still report the bind as a partial success rather than a
    // flat failure, since credentials themselves are confirmed valid.
  } finally {
    client.unbind(() => {});
  }
  return {
    success: true,
    message: userCount != null
      ? `Connected successfully. Found ${userCount} user${userCount === 1 ? '' : 's'} in base DN.`
      : `Connected successfully as ${config.bindDN}, but the base DN search failed — double-check it.`,
  };
}

module.exports = {
  resolveLdapConfig, readLdapSettingsRows, authenticate, isConfigured, searchAllUsers, testBind,
  attr, attrAll, attrGuidHex, cnFromDn, isAccountDisabled,
  ATTR_DEFAULTS,
};
