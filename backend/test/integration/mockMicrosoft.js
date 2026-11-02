// A fake Microsoft for the Microsoft 365 tests (client portal 7b): the
// identity platform's client-credentials token endpoint and the few Microsoft
// Graph v1.0 endpoints PRISM reads. Plain http, like mockIdp.js; nothing here
// talks to the real Microsoft.
//
// Point graph.js at it with
//   process.env.MS_LOGIN_BASE = ms.loginBase;  process.env.MS_GRAPH_BASE = ms.graphBase;
//
// State is plain data the tests edit directly:
//   ms.tenants[tenantId] = { users: { [id]: GraphUser }, groups: { [id]: { name, members: [userId|groupId] } } }
//   ms.failures          queue of { match: RegExp, status, retryAfter?, code? } consumed in order
//                        by the first request whose "METHOD path" matches
//   ms.pageSize          members per page (default 2, so 5 members = 3 pages)
//   ms.tokenRequests     how many tokens were issued
//   ms.requests          every "METHOD path?query" served, oldest first
// Sign-in (OpenID Connect) endpoints are added with the sign-in task.
const http = require('http');
const crypto = require('crypto');

async function startMockMicrosoft({ clientId = 'ms-test-client', clientSecret = 'ms-test-secret', expiresIn = 3600 } = {}) {
  const state = {
    tenants: {},
    failures: [],
    pageSize: 2,
    tokenRequests: 0,
    requests: [],
    expiresIn,
  };
  // token -> tenantId
  const tokens = new Map();

  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const json = (body, status = 200, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const graphError = (status, code, message = code) => json({ error: { code, message } }, status);
    state.requests.push(`${req.method} ${url.pathname}${url.search}`);

    const failureAt = state.failures.findIndex((f) => f.match.test(`${req.method} ${url.pathname}`));
    if (failureAt !== -1) {
      const [f] = state.failures.splice(failureAt, 1);
      const headers = f.retryAfter !== undefined ? { 'Retry-After': String(f.retryAfter) } : {};
      return json({ error: { code: f.code || 'Failure', message: 'Injected failure' } }, f.status, headers);
    }

    // POST /{tenant}/oauth2/v2.0/token (client credentials)
    let m = url.pathname.match(/^\/([^/]+)\/oauth2\/v2\.0\/token$/);
    if (m && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const tenantId = decodeURIComponent(m[1]);
      if (form.get('grant_type') !== 'client_credentials') return json({ error: 'unsupported_grant_type' }, 400);
      if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
        return json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, 401);
      }
      if (form.get('scope') !== 'https://graph.microsoft.com/.default') return json({ error: 'invalid_scope' }, 400);
      if (!state.tenants[tenantId]) return json({ error: 'invalid_request', error_description: 'AADSTS90002: Tenant not found.' }, 400);
      state.tokenRequests += 1;
      const token = crypto.randomBytes(16).toString('hex');
      tokens.set(token, tenantId);
      return json({ token_type: 'Bearer', expires_in: state.expiresIn, access_token: token });
    }

    // Everything below is Graph: needs a token, and answers for its tenant.
    m = url.pathname.match(/^\/v1\.0(\/.*)$/);
    if (!m) return graphError(404, 'NotFound');
    const tenantId = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!tenantId) return graphError(401, 'InvalidAuthenticationToken');
    const tenant = state.tenants[tenantId];
    const path = m[1];

    // Users in a group, nested groups included (Graph's transitive members,
    // cast to users only), paged with a skip token.
    m = path.match(/^\/groups\/([^/]+)\/transitiveMembers\/microsoft\.graph\.user$/);
    if (m && req.method === 'GET') {
      if (!tenant.groups[m[1]]) return graphError(404, 'Request_ResourceNotFound');
      const seen = new Set();
      const walk = (groupId) => {
        for (const id of tenant.groups[groupId]?.members || []) {
          if (tenant.groups[id]) walk(id);
          else if (tenant.users[id]) seen.add(id);
        }
      };
      walk(m[1]);
      const all = [...seen].map((id) => tenant.users[id]);
      const skip = Number(url.searchParams.get('$skiptoken') || 0);
      const top = Math.min(Number(url.searchParams.get('$top') || state.pageSize), state.pageSize);
      const value = all.slice(skip, skip + top).map((u) => ({ '@odata.type': '#microsoft.graph.user', ...u }));
      const body = { value };
      if (skip + top < all.length) {
        const next = new URL(url.href.replace('http://mock', `http://127.0.0.1:${server.address().port}`));
        next.searchParams.set('$skiptoken', String(skip + top));
        body['@odata.nextLink'] = next.toString();
      }
      return json(body);
    }

    m = path.match(/^\/users\/([^/]+)\/checkMemberGroups$/);
    if (m && req.method === 'POST') {
      if (!tenant.users[m[1]]) return graphError(404, 'Request_ResourceNotFound');
      const { groupIds = [] } = JSON.parse((await readBody(req)) || '{}');
      if (groupIds.length > 20) return graphError(400, 'Request_BadRequest', 'At most 20 group ids');
      const inGroup = (groupId, userId) => (tenant.groups[groupId]?.members || [])
        .some((id) => id === userId || (tenant.groups[id] && inGroup(id, userId)));
      return json({ value: groupIds.filter((g) => inGroup(g, m[1])) });
    }

    m = path.match(/^\/users\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const user = tenant.users[m[1]];
      return user ? json(user) : graphError(404, 'Request_ResourceNotFound');
    }

    if (path === '/groups' && req.method === 'GET') {
      const search = url.searchParams.get('$search');
      if (search && req.headers.consistencylevel !== 'eventual') return graphError(400, 'Request_UnsupportedQuery');
      const q = (search || '').match(/^"displayName:(.*)"$/)?.[1]?.toLowerCase() || '';
      const value = Object.entries(tenant.groups)
        .filter(([, g]) => g.name.toLowerCase().includes(q))
        .map(([id, g]) => ({ id, displayName: g.name }));
      return json({ value });
    }

    return graphError(404, 'NotFound');
  });

  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return Object.assign(state, {
    clientId,
    clientSecret,
    loginBase: base,
    graphBase: `${base}/v1.0`,
    close: () => new Promise((resolve) => { server.close(resolve); }),
  });
}

module.exports = { startMockMicrosoft };
