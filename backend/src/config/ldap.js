// LDAP / Active Directory configuration and authentication helper.
//
// Authentication flow:
//   1. Bind with the service account (LDAP_BIND_DN / LDAP_BIND_PASSWORD).
//   2. Search for the user using LDAP_USER_FILTER (e.g. (sAMAccountName={{username}})).
//   3. Re-bind as the found user DN with the supplied password to verify credentials.
//   4. Return the user's directory attributes (displayName, mail, sAMAccountName).
const ldap = require('ldapjs');

const ldapConfig = {
  url: process.env.LDAP_URL || 'ldap://localhost:389',
  baseDN: process.env.LDAP_BASE_DN || '',
  bindDN: process.env.LDAP_BIND_DN || '',
  bindPassword: process.env.LDAP_BIND_PASSWORD || '',
  userFilter: process.env.LDAP_USER_FILTER || '(sAMAccountName={{username}})',
};

function createClient() {
  return ldap.createClient({
    url: ldapConfig.url,
    reconnect: false,
    timeout: 10000,
    connectTimeout: 10000,
  });
}

function bind(client, dn, password) {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function searchUser(client, username) {
  return new Promise((resolve, reject) => {
    const filter = ldapConfig.userFilter.replace('{{username}}', escapeFilter(username));
    const opts = {
      filter,
      scope: 'sub',
      attributes: ['dn', 'displayName', 'cn', 'mail', 'sAMAccountName', 'userPrincipalName'],
    };

    client.search(ldapConfig.baseDN, opts, (err, res) => {
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
  if (!entry) return null;
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
async function searchAllUsers() {
  if (!isConfigured()) {
    const e = new Error('LDAP is not configured');
    e.code = 'LDAP_NOT_CONFIGURED';
    throw e;
  }
  const client = createClient();
  try {
    await bind(client, ldapConfig.bindDN, ldapConfig.bindPassword);
    return await new Promise((resolve, reject) => {
      const entries = [];
      client.search(
        ldapConfig.baseDN,
        {
          scope: 'sub',
          filter: '(|(objectClass=person)(objectClass=user))',
          attributes: [
            'dn', 'givenName', 'sn', 'displayName', 'mail', 'sAMAccountName',
            'telephoneNumber', 'title', 'department', 'userAccountControl',
            'objectGUID', 'memberOf',
          ],
          paged: { pageSize: 500 },
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

  const serviceClient = createClient();
  try {
    // 1. Service bind
    await bind(serviceClient, ldapConfig.bindDN, ldapConfig.bindPassword);

    // 2. Find user
    const entry = await searchUser(serviceClient, username);
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
    const userClient = createClient();
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
      username: attr(entry, 'sAMAccountName') || username,
      displayName: attr(entry, 'displayName') || attr(entry, 'cn') || username,
      email: attr(entry, 'mail') || attr(entry, 'userPrincipalName') || null,
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

// Returns true when LDAP is configured for real (not stubs).
// New installs (setup.sh since the unified-login change) set LDAP_ENABLED
// explicitly. Legacy .env files without it fall back to a heuristic that
// excludes the placeholder URL setup.sh writes when AD is skipped.
function isConfigured() {
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

module.exports = {
  ldapConfig, authenticate, isConfigured, searchAllUsers,
  attr, attrAll, attrGuidHex, cnFromDn, isAccountDisabled,
};
