// Apps that may ask a person to connect them (MCP-O).
//
// - Registered automatically (RFC 7591 DCR): anyone may register, but every
//   redirect URI must be on an allowed domain, and the consent page shows
//   where the person will be sent back to.
// - Client ID metadata documents (CIMD): a client_id that is an https URL on
//   an allowed domain is fetched and describes the app. Nothing is fetched
//   from any other host, which keeps PRISM from being pointed at internal
//   addresses.
const crypto = require('crypto');
const { OAuthClient } = require('../../models');
const { oauthConfig, hostAllowed, redirectAllowed } = require('./config');

const CIMD_TIMEOUT_MS = 5000;
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_REDIRECTS = 10;

class ClientError extends Error {
  constructor(error, description) {
    super(description);
    this.error = error;
  }
}

function cleanName(raw, fallback) {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) : '';
  return name || fallback;
}

function checkRedirects(uris, domains) {
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_REDIRECTS) return false;
  return uris.every((u) => typeof u === 'string' && u.length <= 1024 && redirectAllowed(u, domains));
}

// RFC 7591: public clients only (PKCE, no secret).
async function registerClient(body = {}) {
  const { allowedDomains } = await oauthConfig();
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') {
    throw new ClientError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") can register');
  }
  if (!checkRedirects(body.redirect_uris, allowedDomains)) {
    throw new ClientError('invalid_redirect_uri', `Redirect URIs must be https on an allowed domain (${allowedDomains.join(', ')}), or http on localhost`);
  }
  return OAuthClient.create({
    clientId: crypto.randomBytes(24).toString('base64url'),
    kind: 'dcr',
    name: cleanName(body.client_name, 'An app'),
    redirectUris: body.redirect_uris,
  });
}

function registrationResponse(client) {
  return {
    client_id: client.clientId,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
  };
}

async function readCapped(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > CIMD_MAX_BYTES) {
      reader.cancel();
      throw new Error('Client metadata document is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchMetadataDocument(url, domains) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const doc = JSON.parse(await readCapped(res));
  if (!doc || doc.client_id !== url) return null;
  if (!checkRedirects(doc.redirect_uris, domains)) return null;
  return { name: cleanName(doc.client_name, new URL(url).hostname), redirectUris: doc.redirect_uris };
}

function isCimdUrl(clientId, domains) {
  let u;
  try {
    u = new URL(clientId);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.pathname !== '/' && hostAllowed(u.hostname, domains);
}

// The client for a client_id, or null. A CIMD client is fetched the first
// time and again once a day; if a refresh fails, the stored copy is used.
async function resolveClient(clientId) {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 512) return null;
  const existing = await OAuthClient.findOne({ where: { clientId } });
  if (existing && existing.kind === 'dcr') return existing;

  const { allowedDomains } = await oauthConfig();
  if (!isCimdUrl(clientId, allowedDomains)) return null;
  if (existing && Date.now() - new Date(existing.fetchedAt).getTime() < CIMD_REFRESH_MS) return existing;

  let doc = null;
  try {
    doc = await fetchMetadataDocument(clientId, allowedDomains);
  } catch {
    doc = null;
  }
  if (!doc) return existing || null;
  if (existing) return existing.update({ ...doc, fetchedAt: new Date() });
  return OAuthClient.create({ clientId, kind: 'cimd', ...doc, fetchedAt: new Date() });
}

module.exports = {
  registerClient, registrationResponse, resolveClient, ClientError,
};
