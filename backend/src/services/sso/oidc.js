// OIDC adapter. Wraps openid-client v6, which is ESM-only — hence the cached
// dynamic import rather than a top-level require.
const { ApiError } = require('../../middleware/error');
const { decryptToken } = require('../../utils/tokenCrypto');

let clientModulePromise = null;
function loadClient() {
  if (!clientModulePromise) clientModulePromise = import('openid-client');
  return clientModulePromise;
}

// Discovery documents rarely change and each fetch is a network round-trip on
// the login path, so successful lookups are cached briefly per provider. The
// cache key includes the issuer and client id so editing either in the
// settings UI takes effect immediately rather than after a timeout.
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const discoveryCache = new Map();

function cacheKey(provider, config) {
  return `${provider.id}:${config.issuerUrl}:${config.clientId}`;
}

async function getConfiguration(provider) {
  const config = provider.parsedConfig();
  if (!config.issuerUrl || !config.clientId) {
    throw new ApiError(500, `SSO provider "${provider.name}" is missing its issuer URL or client ID`, 'SSO_MISCONFIGURED');
  }

  const key = cacheKey(provider, config);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.configuration;

  const client = await loadClient();
  const secret = provider.clientSecret ? decryptToken(provider.clientSecret) : null;

  let issuerUrl;
  try {
    issuerUrl = new URL(config.issuerUrl);
  } catch {
    throw new ApiError(500, `SSO provider "${provider.name}" has an invalid issuer URL`, 'SSO_MISCONFIGURED');
  }

  // http issuers are refused by default. Allowing them is gated on an
  // explicit per-provider flag so a test fixture (or a lab IdP) can opt in,
  // and a production misconfiguration cannot silently downgrade to cleartext.
  const options = [];
  if (issuerUrl.protocol === 'http:') {
    if (!config.allowInsecureIssuer) {
      throw new ApiError(
        500,
        `SSO provider "${provider.name}" uses an http:// issuer. Use https, or set allowInsecureIssuer for a test provider.`,
        'SSO_INSECURE_ISSUER'
      );
    }
    options.push(client.allowInsecureRequests);
  }

  let configuration;
  try {
    configuration = await client.discovery(
      issuerUrl,
      config.clientId,
      secret ? { client_secret: secret } : undefined,
      secret ? client.ClientSecretPost(secret) : client.None(),
      { execute: options }
    );
  } catch (err) {
    throw new ApiError(502, `Could not reach the identity provider for "${provider.name}": ${err.message}`, 'SSO_DISCOVERY_FAILED');
  }

  discoveryCache.set(key, { configuration, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return configuration;
}

function clearDiscoveryCache() {
  discoveryCache.clear();
}

// Builds the redirect to the IdP, returning the state/nonce/verifier the
// caller must persist for the callback.
async function buildAuthorizationRequest(provider, redirectUri) {
  const client = await loadClient();
  const configuration = await getConfiguration(provider);
  const config = provider.parsedConfig();

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const scope = (config.scopes && String(config.scopes).trim()) || 'openid profile email';

  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri,
    scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url: url.href, state, nonce, codeVerifier };
}

// Exchanges the authorization code and returns the verified claims as a
// normalized profile. openid-client validates the id_token signature,
// issuer, audience, expiry, nonce and PKCE binding.
async function completeAuthorization(provider, { currentUrl, state, nonce, codeVerifier }) {
  const client = await loadClient();
  const configuration = await getConfiguration(provider);
  const config = provider.parsedConfig();

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState: state,
    });
  } catch (err) {
    throw new ApiError(401, `Sign-in with ${provider.name} failed: ${err.message}`, 'SSO_EXCHANGE_FAILED');
  }

  const claims = tokens.claims() || {};
  let profile = claimsToProfile(claims, config);

  // Group claims are frequently omitted from the id_token and only present at
  // the userinfo endpoint (Okta and Auth0 both do this by default).
  const needsGroups = !profile.groups.length && config.groupsClaim;
  const needsName = !profile.email || !profile.displayName;
  if ((needsGroups || needsName) && configuration.serverMetadata().userinfo_endpoint) {
    try {
      const info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
      profile = claimsToProfile({ ...claims, ...info }, config);
    } catch {
      // Userinfo is supplementary — the id_token already authenticated the
      // user, so a failure here must not fail the login.
    }
  }

  return profile;
}

// Normalizes an IdP's claims into the shape ssoService expects.
function claimsToProfile(claims, config) {
  const groupsClaim = config.groupsClaim || 'groups';
  const raw = claims[groupsClaim];
  const groups = Array.isArray(raw)
    ? raw.map((g) => String(g))
    : (typeof raw === 'string' && raw ? raw.split(/[,\s]+/).filter(Boolean) : []);

  return {
    subject: claims.sub,
    email: claims.email || null,
    displayName: claims.name || null,
    firstName: claims.given_name || null,
    lastName: claims.family_name || null,
    preferredUsername: claims.preferred_username || null,
    groups,
  };
}

module.exports = {
  buildAuthorizationRequest,
  completeAuthorization,
  getConfiguration,
  clearDiscoveryCache,
  claimsToProfile,
};
