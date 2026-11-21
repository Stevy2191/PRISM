// How /mcp's tools reach PRISM's API as the connected person (MCP-O)
// without forwarding their OAuth token, which the MCP spec forbids.
//
// The backend answers the tools on a second, internal listener bound to
// 127.0.0.1. Each MCP request gets a random grant that lives in this
// process's memory for that request only; the tools send it as
// X-PRISM-MCP-Grant, and auth.js honours it only on requests that came in on
// the internal listener (req.prismInternal), so the header means nothing on
// PRISM's public side.
const crypto = require('crypto');
const http = require('http');

const grants = new Map();
let listening = null;

function internalBaseUrl(app) {
  if (!listening) {
    listening = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        req.prismInternal = true;
        app(req, res);
      });
      // Not kept alive by the process on its own: it only serves /mcp.
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
    listening.catch(() => { listening = null; });
  }
  return listening;
}

// Runs fn(grant) with a grant for `user`; the grant is gone when fn settles.
async function withGrant(user, fn) {
  const grant = crypto.randomBytes(32).toString('hex');
  grants.set(grant, user.id);
  try {
    return await fn(grant);
  } finally {
    grants.delete(grant);
  }
}

function userIdForGrant(grant) {
  if (typeof grant !== 'string' || grant.length !== 64) return null;
  return grants.get(grant) || null;
}

module.exports = { internalBaseUrl, withGrant, userIdForGrant };
