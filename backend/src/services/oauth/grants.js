// The OAuth flow for Claude's connection to /mcp (MCP-O): authorize →
// consent → code → tokens → refresh → revoke, and checking an access token.
const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  OAuthRequest, OAuthConnection, OAuthClient, User,
} = require('../../models');
const { writeAudit } = require('../../middleware/audit');
const { resolveClient } = require('./clients');
const {
  sha256, newToken, verifyPkce, ACCESS_TTL_MS, REFRESH_TTL_MS, CODE_TTL_MS,
} = require('./tokens');

const LAST_USED_EVERY_MS = 60 * 1000;

class GrantError extends Error {
  constructor(error, description, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

// Audit rows written outside a staff request (token endpoint) name the
// connection's person.
const asUser = (userId) => ({ user: { id: userId } });

function sameResource(given, config) {
  if (given === undefined || given === null || given === '') return true;
  return typeof given === 'string' && given.replace(/\/+$/, '') === config.resource;
}

function withParams(uri, params) {
  const u = new URL(uri);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, v); });
  return u.toString();
}

// GET /authorize. Returns { requestId } for the consent page, { redirect }
// to send an error back to the app, or { errorPage } when the app or its
// redirect can't be trusted (never redirected to).
async function startAuthorization(query, config) {
  const client = await resolveClient(query.client_id);
  if (!client) return { errorPage: 'unknown_client' };
  let redirectUri = query.redirect_uri;
  if (!redirectUri && client.redirectUris.length === 1) [redirectUri] = client.redirectUris;
  if (typeof redirectUri !== 'string' || !client.redirectUris.includes(redirectUri)) return { errorPage: 'bad_redirect' };

  const state = typeof query.state === 'string' ? query.state.slice(0, 2048) : undefined;
  const back = (error, description) => ({
    redirect: withParams(redirectUri, {
      error, error_description: description, state, iss: config.issuer,
    }),
  });

  if (query.response_type !== 'code') return back('unsupported_response_type', 'Only the authorization code flow is supported');
  if (typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(query.code_challenge)) {
    return back('invalid_request', 'A PKCE code_challenge is required');
  }
  if (query.code_challenge_method !== 'S256') return back('invalid_request', 'code_challenge_method must be S256');
  if (!sameResource(query.resource, config)) return back('invalid_target', `The only resource is ${config.resource}`);
  // offline_access is tolerated (refresh tokens are issued anyway); any
  // other scope than prism is refused.
  const scopes = String(query.scope || config.scope).split(/\s+/).filter((s) => s && s !== 'offline_access');
  if (scopes.some((s) => s !== config.scope)) return back('invalid_scope', `The only scope is ${config.scope}`);

  const request = await OAuthRequest.create({
    id: crypto.randomBytes(24).toString('base64url'),
    clientId: client.id,
    redirectUri,
    state: state === undefined ? null : state,
    codeChallenge: query.code_challenge,
    scope: config.scope,
    resource: config.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return { requestId: request.id };
}

async function pendingRequest(id) {
  if (typeof id !== 'string' || !id) return null;
  return OAuthRequest.findOne({
    where: {
      id, userId: null, usedAt: null, expiresAt: { [Op.gt]: new Date() },
    },
    include: [{ model: OAuthClient, as: 'client' }],
  });
}

async function describeRequest(id, user, config) {
  const request = await pendingRequest(id);
  if (!request) return null;
  return {
    id: request.id,
    client: { name: request.client.name },
    redirectHost: new URL(request.redirectUri).host,
    user: { id: user.id, username: user.username, displayName: user.displayName },
    allowWrites: config.allowWrites,
    expiresAt: request.expiresAt,
  };
}

// The person's answer. Returns { redirectTo } for the browser, or null if
// the request is gone (answered, expired, unknown).
async function decide(id, user, allow, config, req) {
  const request = await pendingRequest(id);
  if (!request) return null;
  const state = request.state === null ? undefined : request.state;
  if (!allow) {
    const [n] = await OAuthRequest.update({ usedAt: new Date() }, { where: { id, usedAt: null, userId: null } });
    if (!n) return null;
    await writeAudit(req, 'oauth.deny', 'OAuthClient', request.clientId, { client: request.client.name });
    return { redirectTo: withParams(request.redirectUri, { error: 'access_denied', state, iss: config.issuer }) };
  }
  const code = newToken('prism_oac_');
  const [n] = await OAuthRequest.update(
    { userId: user.id, codeHash: code.hash, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    { where: { id, usedAt: null, userId: null } },
  );
  if (!n) return null;
  return { redirectTo: withParams(request.redirectUri, { code: code.plaintext, state, iss: config.issuer }) };
}

function tokenResponse(access, refresh, scope) {
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope,
  };
}

function freshTokens() {
  const access = newToken('prism_oat_');
  const refresh = newToken('prism_ort_');
  const now = Date.now();
  return {
    access,
    refresh,
    fields: {
      accessHash: access.hash,
      accessExpiresAt: new Date(now + ACCESS_TTL_MS),
      refreshHash: refresh.hash,
      refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
    },
  };
}

const invalidGrant = (why) => new GrantError('invalid_grant', why);

// grant_type=authorization_code
async function exchangeCode(body, config) {
  if (typeof body.code !== 'string' || !body.code) throw new GrantError('invalid_request', 'code is required');
  const request = await OAuthRequest.findOne({
    where: { codeHash: sha256(body.code) },
    include: [{ model: OAuthClient, as: 'client' }],
  });
  if (!request || request.usedAt) throw invalidGrant('The code is not valid');
  // Spent whatever happens next: a code is good for one try.
  const [n] = await OAuthRequest.update({ usedAt: new Date() }, { where: { id: request.id, usedAt: null } });
  if (!n) throw invalidGrant('The code is not valid');
  if (request.expiresAt <= new Date()) throw invalidGrant('The code has expired');
  if (request.client.clientId !== body.client_id) throw invalidGrant('The code was issued to another client');
  if (body.redirect_uri !== request.redirectUri) throw invalidGrant('redirect_uri does not match the authorization request');
  if (!verifyPkce(body.code_verifier, request.codeChallenge)) throw invalidGrant('code_verifier does not match');
  if (!sameResource(body.resource, config)) throw new GrantError('invalid_target', `The only resource is ${config.resource}`);
  const user = await User.findByPk(request.userId);
  if (!user || !user.isActive) throw invalidGrant('The account is not active');

  const t = freshTokens();
  const connection = await OAuthConnection.create({
    clientId: request.clientId, userId: user.id, scope: request.scope, resource: request.resource, ...t.fields,
  });
  await writeAudit(asUser(user.id), 'oauth.connect', 'OAuthConnection', connection.id, { client: request.client.name });
  return tokenResponse(t.access.plaintext, t.refresh.plaintext, connection.scope);
}

async function revokeConnection(connection, reason, actor) {
  if (connection.revokedAt) return;
  await connection.update({ revokedAt: new Date(), revokedReason: reason });
  await writeAudit(actor || asUser(connection.userId), 'oauth.revoke', 'OAuthConnection', connection.id, { reason });
}

// grant_type=refresh_token. Every refresh rotates the refresh token; the
// one it replaced is remembered, and if that is ever presented again (a
// copy was stolen and used first, or the other way round), the connection
// is revoked.
async function refresh(body) {
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw new GrantError('invalid_request', 'refresh_token is required');
  const hash = sha256(body.refresh_token);
  const include = [{ model: OAuthClient, as: 'client' }, { model: User, as: 'user' }];
  const connection = await OAuthConnection.findOne({ where: { refreshHash: hash }, include });
  if (!connection) {
    const replayed = await OAuthConnection.findOne({ where: { previousRefreshHash: hash } });
    if (replayed) await revokeConnection(replayed, 'refresh_reuse');
    throw invalidGrant('The refresh token is not valid');
  }
  if (connection.revokedAt || connection.refreshExpiresAt <= new Date()) throw invalidGrant('The refresh token is not valid');
  if (connection.client.clientId !== body.client_id) throw invalidGrant('The refresh token was issued to another client');
  if (!connection.user || !connection.user.isActive) throw invalidGrant('The account is not active');

  const t = freshTokens();
  const [n] = await OAuthConnection.update(
    { ...t.fields, previousRefreshHash: hash },
    { where: { id: connection.id, refreshHash: hash, revokedAt: null } },
  );
  if (!n) throw invalidGrant('The refresh token is not valid');
  return tokenResponse(t.access.plaintext, t.refresh.plaintext, connection.scope);
}

// RFC 7009: revoke by access or refresh token; unknown tokens are fine.
async function revokeToken(token) {
  if (typeof token !== 'string' || !token) return;
  const hash = sha256(token);
  const connection = await OAuthConnection.findOne({ where: { [Op.or]: [{ accessHash: hash }, { refreshHash: hash }] } });
  if (connection) await revokeConnection(connection, 'client');
}

// /mcp: the connection and person an access token stands for, or null.
async function connectionForAccessToken(token, config) {
  if (typeof token !== 'string' || !/^prism_oat_[0-9a-f]{64}$/.test(token)) return null;
  const connection = await OAuthConnection.findOne({
    where: { accessHash: sha256(token), revokedAt: null, accessExpiresAt: { [Op.gt]: new Date() } },
    include: [{ model: User, as: 'user' }, { model: OAuthClient, as: 'client' }],
  });
  if (!connection || connection.resource !== config.resource) return null;
  if (!connection.user || !connection.user.isActive) return null;
  if (!connection.lastUsedAt || Date.now() - connection.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await connection.update({ lastUsedAt: new Date() });
  }
  return { connection, user: connection.user };
}

module.exports = {
  GrantError,
  startAuthorization,
  describeRequest,
  decide,
  exchangeCode,
  refresh,
  revokeToken,
  revokeConnection,
  connectionForAccessToken,
};
