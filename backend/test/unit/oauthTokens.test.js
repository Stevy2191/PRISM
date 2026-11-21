const {
  sha256, newToken, verifyPkce, ACCESS_TTL_MS, REFRESH_TTL_MS, CODE_TTL_MS,
} = require('../../src/services/oauth/tokens');

// MCP-O: opaque OAuth tokens stored as SHA-256, and PKCE S256 checks.

it('checks a PKCE S256 verifier against its challenge (RFC 7636 appendix B)', () => {
  expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
  expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXX', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  expect(verifyPkce('', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  expect(verifyPkce(undefined, undefined)).toBe(false);
  expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'short')).toBe(false);
});

it('makes prefixed random tokens and stores only their SHA-256', () => {
  const a = newToken('prism_oat_');
  const b = newToken('prism_oat_');
  expect(a.plaintext).toMatch(/^prism_oat_[0-9a-f]{64}$/);
  expect(a.hash).toBe(sha256(a.plaintext));
  expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(a.plaintext).not.toBe(b.plaintext);
});

it('has the lifetimes the design fixes', () => {
  expect(ACCESS_TTL_MS).toBe(60 * 60 * 1000);
  expect(REFRESH_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  expect(CODE_TTL_MS).toBe(10 * 60 * 1000);
});
