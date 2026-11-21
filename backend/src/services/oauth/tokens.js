// OAuth tokens for Claude's connection to /mcp (MCP-O): opaque random
// values, stored only as their SHA-256, and the PKCE S256 check.
const crypto = require('crypto');

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, rotated on use
const CODE_TTL_MS = 10 * 60 * 1000; // authorization codes and pending consent

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function newToken(prefix) {
  const plaintext = `${prefix}${crypto.randomBytes(32).toString('hex')}`;
  return { plaintext, hash: sha256(plaintext) };
}

// RFC 7636 S256: BASE64URL(SHA256(verifier)) === challenge, compared in
// constant time. A verifier is 43-128 characters by the RFC.
function verifyPkce(verifier, challenge) {
  if (typeof verifier !== 'string' || typeof challenge !== 'string') return false;
  if (verifier.length < 43 || verifier.length > 128) return false;
  const expected = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  sha256, newToken, verifyPkce, ACCESS_TTL_MS, REFRESH_TTL_MS, CODE_TTL_MS,
};
