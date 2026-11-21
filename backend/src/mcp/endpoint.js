// POST /mcp: Claude's connection to PRISM (MCP-O). MCP Streamable HTTP,
// stateless, JSON responses. Claude sends the OAuth access token it got
// when the person connected; the tools then reach PRISM's API through the
// internal listener as that person (./internalApi), never with the token.
const { oauthConfig } = require('../services/oauth/config');
const { connectionForAccessToken } = require('../services/oauth/grants');
const { internalBaseUrl, withGrant } = require('./internalApi');
const { loadMcp } = require('./tools');

function bearer(header) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header || '');
  return m ? m[1] : null;
}

function rpcError(res, status, message, headers = {}) {
  res.status(status).set(headers).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

// RFC 6750 / RFC 9728: tells Claude where to sign in.
function challenge(config, invalidToken) {
  const base = `Bearer resource_metadata="${config.issuer}/.well-known/oauth-protected-resource/mcp", scope="${config.scope}"`;
  return invalidToken ? `${base}, error="invalid_token"` : base;
}

function mcpHandler(app) {
  return async (req, res, next) => {
    try {
      const config = await oauthConfig();
      if (!config.enabled) return res.status(404).json({ error: true, message: 'Not found', code: 'NOT_FOUND' });
      if (req.method !== 'POST') return rpcError(res, 405, 'Method not allowed', { Allow: 'POST' });

      const token = bearer(req.get('Authorization'));
      const found = token ? await connectionForAccessToken(token, config) : null;
      if (!found) {
        return rpcError(res, 401, token ? 'The access token is not valid' : 'Sign in to PRISM to connect', {
          'WWW-Authenticate': challenge(config, !!token),
        });
      }

      const { createMcpServer, PrismClient, StreamableHTTPServerTransport } = await loadMcp();
      const base = await internalBaseUrl(app);
      return await withGrant(found.user, async (grant) => {
        const client = new PrismClient({ url: `${base}/api/v1`, headers: { 'X-PRISM-MCP-Grant': grant } });
        const server = createMcpServer(client, { readOnly: !config.allowWrites });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        try {
          await server.connect(transport);
          // The grant must outlive the whole response, so wait for it here.
          const finished = new Promise((resolve) => { res.on('close', resolve); });
          await transport.handleRequest(req, res, req.body);
          await finished;
        } finally {
          transport.close();
          server.close();
        }
      });
    } catch (err) {
      if (res.headersSent) return undefined;
      return next(err);
    }
  };
}

module.exports = { mcpHandler, challenge };
