// Claude connections (MCP-O): whether they're on, and the addresses PRISM
// advertises. Settings are SystemSettings rows written only through the
// Owner-only /oauth/settings endpoint; their defaults are here (not in
// settingsController's DEFAULTS, which PATCH /settings may write).
const { SystemSettings } = require('../../models');

const DEFAULTS = {
  'mcp.enabled': 'false',
  'mcp.allowWrites': 'false',
  'mcp.allowedDomains': 'claude.ai,claude.com,localhost,127.0.0.1',
};
const SCOPE = 'prism';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function issuerUrl() {
  return (process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

function parseDomains(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''))
    .filter(Boolean);
}

async function oauthConfig() {
  const rows = await SystemSettings.findAll({ where: { key: Object.keys(DEFAULTS) } });
  const values = { ...DEFAULTS };
  rows.forEach((r) => { values[r.key] = r.value; });
  const issuer = issuerUrl();
  const httpsReady = /^https:\/\/[^/]+/i.test(issuer);
  return {
    // Never on without an https issuer: tokens would cross the network in
    // the clear and claude.ai can't reach it anyway.
    enabled: values['mcp.enabled'] === 'true' && httpsReady,
    enabledSetting: values['mcp.enabled'] === 'true',
    allowWrites: values['mcp.allowWrites'] === 'true',
    allowedDomains: parseDomains(values['mcp.allowedDomains']),
    issuer,
    resource: `${issuer}/mcp`,
    httpsReady,
    scope: SCOPE,
  };
}

// The host is an allowed domain or a subdomain of one. "claude.ai.evil.test"
// is not under "claude.ai".
function hostAllowed(host, domains) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

// A redirect URI an app may register: https on an allowed domain, or http
// only for this computer (localhost apps such as Claude Code). No fragment.
function redirectAllowed(uri, domains) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'http:') {
    // [::1] counts as localhost.
    return LOOPBACK_HOSTS.has(host) && domains.includes(host === '[::1]' ? 'localhost' : host);
  }
  if (u.protocol !== 'https:') return false;
  return hostAllowed(host, domains);
}

module.exports = {
  oauthConfig, hostAllowed, redirectAllowed, parseDomains, DEFAULTS, SCOPE,
};
