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

module.exports = router;
module.exports.whenOn = whenOn;
module.exports.oauthError = oauthError;
