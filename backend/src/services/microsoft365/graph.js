// Read-only Microsoft Graph client for the client portal's Microsoft 365
// support (7b): app-only tokens per tenant, group members, one user, group
// membership checks and group search. Plain fetch, as microsoftCalendar.js
// does; no Microsoft SDK.
//
// Credentials are the portal's multi-tenant app (Settings → Client portal,
// secret decrypted by getPortalMicrosoftApp). Neither the secret nor a token
// is ever put in an error or a log line.
//
// MS_LOGIN_BASE and MS_GRAPH_BASE point it at a fake Microsoft in tests;
// they are read on every call.
const { getPortalMicrosoftApp } = require('../../controllers/settingsController');

const SCOPE = 'https://graph.microsoft.com/.default';
const USER_FIELDS = [
  'id', 'displayName', 'givenName', 'surname', 'mail', 'userPrincipalName', 'accountEnabled',
  'department', 'jobTitle', 'businessPhones', 'mobilePhone', 'onPremisesImmutableId',
].join(',');
const PAGE_SIZE = 999; // Graph's maximum for directory objects
const CHECK_GROUPS_MAX = 20; // checkMemberGroups takes at most 20 ids per call
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30000;
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loginBase = () => (process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com').replace(/\/$/, '');
const graphBase = () => (process.env.MS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');

class GraphError extends Error {
  constructor(status, code, message) {
    super(message || `Microsoft Graph request failed (${status ?? 'no response'}${code ? `, ${code}` : ''})`);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
  }

  toJSON() {
    return { name: this.name, status: this.status, code: this.code, message: this.message };
  }
}

// Every id goes into a URL path: refuse anything that isn't a GUID.
function assertGuid(id, what) {
  if (typeof id !== 'string' || !GUID.test(id)) throw new GraphError(null, 'BAD_ID', `Not a valid Microsoft ${what} id`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Seconds (or an HTTP date) from Retry-After; a short back-off without one.
function retryDelay(res, attempt) {
  const header = res.headers.get('retry-after');
  let ms = (2 ** attempt) * 1000;
  if (header !== null) {
    const seconds = Number(header);
    ms = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now());
  }
  return Math.min(Number.isFinite(ms) ? ms : 1000, MAX_RETRY_WAIT_MS);
}

// fetch, retrying throttling (429) and unavailability (503) up to
// MAX_RETRIES times. Network failures become a GraphError with no status.
async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, options); // eslint-disable-line no-await-in-loop
    } catch {
      throw new GraphError(null, 'NETWORK', 'Could not reach Microsoft');
    }
    if ((res.status !== 429 && res.status !== 503) || attempt >= MAX_RETRIES) return res;
    await sleep(retryDelay(res, attempt)); // eslint-disable-line no-await-in-loop
  }
}

// tenantId -> { token, clientId, refreshAt }
const tokenCache = new Map();

function clearTokenCache() {
  tokenCache.clear();
}

// An app-only token for a tenant (client credentials), cached until five
// minutes before it expires.
async function appToken(tenantId) {
  assertGuid(tenantId, 'tenant');
  const { clientId, clientSecret } = await getPortalMicrosoftApp();
  if (!clientId || !clientSecret) throw new GraphError(null, 'APP_NOT_CONFIGURED', 'The Microsoft app is not set up (Settings → Client portal)');
  const cached = tokenCache.get(tenantId);
  if (cached && cached.clientId === clientId && cached.refreshAt > Date.now()) return cached.token;

  const res = await fetchWithRetry(`${loginBase()}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: SCOPE,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Only the error code: Microsoft's description is not ours to repeat.
    const code = typeof body.error === 'string' ? body.error : 'TOKEN_FAILED';
    throw new GraphError(res.status, code, `Microsoft refused the app's sign-in (${res.status}, ${code})`);
  }
  const lifetimeMs = Number(body.expires_in || 0) * 1000;
  tokenCache.set(tenantId, { token: body.access_token, clientId, refreshAt: Date.now() + lifetimeMs - TOKEN_MARGIN_MS });
  return body.access_token;
}

// One Graph call. A 401 drops the cached token and tries once more with a
// fresh one. Returns the parsed body, or null for 404 when allow404.
async function graphRequest(tenantId, urlOrPath, { method = 'GET', body, headers = {}, allow404 = false } = {}) {
  const url = urlOrPath.startsWith('/') ? `${graphBase()}${urlOrPath}` : urlOrPath;
  // A paging link must stay on Graph: the token is never sent anywhere else.
  if (!url.startsWith(`${graphBase()}/`)) throw new GraphError(null, 'BAD_LINK', 'Microsoft returned a link outside Graph');
  for (let attempt = 0; ; attempt += 1) {
    const token = await appToken(tenantId); // eslint-disable-line no-await-in-loop
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchWithRetry(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      tokenCache.delete(tenantId);
      continue; // eslint-disable-line no-continue
    }
    if (res.status === 404 && allow404) return null;
    const data = await res.json().catch(() => ({})); // eslint-disable-line no-await-in-loop
    if (!res.ok) throw new GraphError(res.status, data.error?.code || null);
    return data;
  }
}

// Every user in a group, members of nested groups included, one page at a
// time, each user once.
async function* listGroupMembers(tenantId, groupId) {
  assertGuid(tenantId, 'tenant');
  assertGuid(groupId, 'group');
  const seen = new Set();
  let next = `/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=${USER_FIELDS}&$top=${PAGE_SIZE}`;
  while (next) {
    const page = await graphRequest(tenantId, next); // eslint-disable-line no-await-in-loop
    for (const item of page.value || []) {
      const isUser = !item['@odata.type'] || item['@odata.type'] === '#microsoft.graph.user';
      if (isUser && !seen.has(item.id)) {
        seen.add(item.id);
        const { '@odata.type': ignored, ...user } = item; // eslint-disable-line no-unused-vars
        yield user;
      }
    }
    next = page['@odata.nextLink'] || null;
  }
}

// One user, or null when they no longer exist.
async function getUser(tenantId, objectId) {
  assertGuid(tenantId, 'tenant');
  assertGuid(objectId, 'user');
  return graphRequest(tenantId, `/users/${objectId}?$select=${USER_FIELDS}`, { allow404: true });
}

// Is the user a member (directly or through nested groups) of any of these
// groups? A user who no longer exists is in none.
async function memberOfAny(tenantId, objectId, groupIds) {
  assertGuid(tenantId, 'tenant');
  assertGuid(objectId, 'user');
  const ids = [...new Set(groupIds || [])];
  ids.forEach((id) => assertGuid(id, 'group'));
  for (let i = 0; i < ids.length; i += CHECK_GROUPS_MAX) {
    // eslint-disable-next-line no-await-in-loop
    const res = await graphRequest(tenantId, `/users/${objectId}/checkMemberGroups`, {
      method: 'POST', body: { groupIds: ids.slice(i, i + CHECK_GROUPS_MAX) }, allow404: true,
    });
    if (!res) return false;
    if ((res.value || []).length) return true;
  }
  return false;
}

// Groups whose name contains q (the sync-group picker); the first 25 groups
// when q is blank.
async function searchGroups(tenantId, q) {
  assertGuid(tenantId, 'tenant');
  const term = String(q || '').replace(/["\\]/g, '').trim().slice(0, 100);
  const params = new URLSearchParams({ $select: 'id,displayName', $top: '25' });
  const headers = {};
  if (term) {
    params.set('$search', `"displayName:${term}"`);
    headers.ConsistencyLevel = 'eventual';
  }
  const res = await graphRequest(tenantId, `/groups?${params.toString()}`, { headers });
  return (res.value || []).map((g) => ({ id: g.id, name: g.displayName }));
}

module.exports = {
  GraphError, appToken, clearTokenCache, listGroupMembers, getUser, memberOfAny, searchGroups,
};
