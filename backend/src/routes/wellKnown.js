// /.well-known: where Claude finds PRISM's sign-in for /mcp (MCP-O).
// RFC 9728 protected-resource metadata at both the path-specific and the
// root form; RFC 8414 authorization-server metadata (the issuer has no path).
// All 404 while Claude connections are off.
const express = require('express');
const { asyncHandler } = require('../middleware/error');
const { oauthConfig } = require('../services/oauth/config');

const router = express.Router();

function protectedResource(config) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.scope],
    bearer_methods_supported: ['header'],
    resource_name: 'PRISM',
  };
}

function authorizationServer(config) {
  const api = `${config.issuer}/api/v1/oauth`;
  return {
    issuer: config.issuer,
    authorization_endpoint: `${api}/authorize`,
    token_endpoint: `${api}/token`,
    registration_endpoint: `${api}/register`,
    revocation_endpoint: `${api}/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [config.scope],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

const whenOn = (build) => asyncHandler(async (req, res) => {
  const config = await oauthConfig();
  if (!config.enabled) return res.status(404).json({ error: 'not_found' });
  res.set('Cache-Control', 'public, max-age=300');
  return res.json(build(config));
});

router.get(['/oauth-protected-resource', '/oauth-protected-resource/mcp'], whenOn(protectedResource));
router.get('/oauth-authorization-server', whenOn(authorizationServer));

module.exports = router;
