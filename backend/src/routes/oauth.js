// /api/v1/oauth: PRISM as the authorization server for Claude's connection
// to /mcp (MCP-O). Mounted outside the staff guard: apps call these without
// a PRISM session. Errors here use OAuth's shape ({ error,
// error_description }), not PRISM's.
const express = require('express');
const { asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { oauthLimiter } = require('../middleware/rateLimit');
const { oauthConfig } = require('../services/oauth/config');
const { registerClient, registrationResponse, ClientError } = require('../services/oauth/clients');
const grants = require('../services/oauth/grants');
const { authenticate } = require('../middleware/auth');
const { blockUntilPasswordChanged } = require('../middleware/role');
const { ApiError } = require('../middleware/error');

const router = express.Router();

const oauthError = (res, status, error, description) => res.status(status).json({ error, error_description: description });

// Everything but the Owner's settings answers 404 while connections are off.
const whenOn = asyncHandler(async (req, res, next) => {
  const config = await oauthConfig();
  if (!config.enabled) return oauthError(res, 404, 'not_found', 'Claude connections are turned off');
  req.oauthConfig = config;
  return next();
});

router.post('/register', oauthLimiter, whenOn, asyncHandler(async (req, res) => {
  try {
    const client = await registerClient(req.body || {});
    await writeAudit(req, 'oauth.client.register', 'OAuthClient', client.id, { name: client.name, redirectUris: client.redirectUris });
    res.set('Cache-Control', 'no-store');
    return res.status(201).json(registrationResponse(client));
  } catch (err) {
    if (err instanceof ClientError) return oauthError(res, 400, err.error, err.message);
    throw err;
  }
}));

// GET /authorize: the browser arrives from the app; PRISM keeps the request
// and sends the person to the consent page (signing in first if needed).
router.get('/authorize', oauthLimiter, whenOn, asyncHandler(async (req, res) => {
  const config = req.oauthConfig;
  const result = await grants.startAuthorization(req.query, config);
  if (result.errorPage) return res.redirect(302, `${config.issuer}/oauth/consent/error?reason=${result.errorPage}`);
  if (result.redirect) return res.redirect(302, result.redirect);
  return res.redirect(302, `${config.issuer}/oauth/consent/${encodeURIComponent(result.requestId)}`);
}));

// The consent page's API: only a person signed in to PRISM in the browser
// (a session, never an API key) sees or answers a consent. Writes are also
// behind sameOriginWrites, like every /api/v1 write.
const personInBrowser = [authenticate, blockUntilPasswordChanged, (req, res, next) => (
  req.authMethod === 'session' ? next() : next(new ApiError(403, 'Sign in to PRISM in your browser to connect an app', 'SESSION_REQUIRED'))
)];

router.get('/requests/:id', whenOn, personInBrowser, asyncHandler(async (req, res) => {
  const described = await grants.describeRequest(req.params.id, req.user, req.oauthConfig);
  if (!described) throw new ApiError(404, 'This request has expired or was already answered. Start again from the app.', 'NOT_FOUND');
  res.json(described);
}));

router.post('/requests/:id/decision', whenOn, personInBrowser, asyncHandler(async (req, res) => {
  const allow = req.body && req.body.allow === true;
  const result = await grants.decide(req.params.id, req.user, allow, req.oauthConfig, req);
  if (!result) throw new ApiError(404, 'This request has expired or was already answered. Start again from the app.', 'NOT_FOUND');
  res.json(result);
}));

// POST /token (form-encoded, as OAuth clients send it; JSON also accepted).
router.post('/token', oauthLimiter, whenOn, asyncHandler(async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const body = req.body || {};
  try {
    if (body.grant_type === 'authorization_code') return res.json(await grants.exchangeCode(body, req.oauthConfig));
    if (body.grant_type === 'refresh_token') return res.json(await grants.refresh(body));
    return oauthError(res, 400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  } catch (err) {
    if (err instanceof grants.GrantError) return oauthError(res, err.status, err.error, err.message);
    throw err;
  }
}));

// POST /revoke (RFC 7009): always 200.
router.post('/revoke', oauthLimiter, whenOn, asyncHandler(async (req, res) => {
  await grants.revokeToken((req.body || {}).token);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({});
}));

module.exports = router;
module.exports.whenOn = whenOn;
module.exports.oauthError = oauthError;
