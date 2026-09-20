// Single sign-on endpoints. These are the only unauthenticated routes that
// can create a session, so each one is deliberate about what it trusts.
const crypto = require('crypto');
const { SsoProvider } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const ssoService = require('../services/sso/ssoService');
const oidc = require('../services/sso/oidc');
const saml = require('../services/sso/saml');

const DEFAULT_RETURN_TO = '/dashboard';

// Callback URLs have to be absolute and must match what the IdP has
// registered, so they are derived from PUBLIC_APP_URL rather than from
// request headers — Host and X-Forwarded-Host are attacker-controllable, and
// using them here would let someone redirect an authorization code to a host
// of their choosing.
function publicBaseUrl() {
  const configured = process.env.PUBLIC_APP_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  return `http://localhost:${process.env.APP_PORT || 8080}`;
}

function callbackUrlFor(provider) {
  const path = provider.protocol === 'saml' ? 'acs' : 'callback';
  return `${publicBaseUrl()}/api/v1/sso/${provider.slug}/${path}`;
}

// Sends the browser back to the app with an error the login page can show,
// rather than rendering an error document from the API origin.
function failRedirect(res, message) {
  const url = `${publicBaseUrl()}/login?ssoError=${encodeURIComponent(message)}`;
  return res.redirect(302, url);
}

// GET /sso/providers — public. Drives the buttons on the login page, so it
// exposes only what is needed to render one.
const listPublicProviders = asyncHandler(async (req, res) => {
  const providers = await SsoProvider.findAll({
    where: { isEnabled: true },
    attributes: ['id', 'slug', 'name', 'buttonLabel', 'protocol'],
    order: [['name', 'ASC']],
  });
  res.json({
    providers: providers.map((p) => ({
      slug: p.slug,
      name: p.name,
      label: p.buttonLabel || `Sign in with ${p.name}`,
      protocol: p.protocol,
    })),
  });
});

// GET /sso/:slug/start — begins an SP-initiated login.
const start = asyncHandler(async (req, res) => {
  const provider = await ssoService.getEnabledProviderBySlug(req.params.slug);
  const callbackUrl = callbackUrlFor(provider);
  const returnTo = ssoService.safeReturnTo(req.query.returnTo);

  if (provider.protocol === 'oidc') {
    const { url, state, nonce, codeVerifier } = await oidc.buildAuthorizationRequest(provider, callbackUrl);
    await ssoService.createAuthRequest({ provider, state, nonce, codeVerifier, returnTo });
    return res.redirect(302, url);
  }

  // SAML: our state travels as RelayState and comes back on the ACS POST.
  const state = crypto.randomBytes(24).toString('base64url');
  await ssoService.createAuthRequest({ provider, state, returnTo });
  const { url } = await saml.buildAuthorizationRequest(provider, callbackUrl, state);
  return res.redirect(302, url);
});

// Shared tail of both callbacks: establish the session for a resolved user.
async function establishSession(req, user, provider, method) {
  await new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== 'function') return resolve();
    // Regenerated for the same reason password login is: an attacker who
    // planted a session id must not still hold one that is now authenticated.
    return req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.userId = user.id;
  req.user = user;
  await user.update({ lastLogin: new Date() });
  await writeAudit(req, 'auth.login', 'User', user.id, { method, provider: provider.slug });
}

// GET /sso/:slug/callback — OIDC redirect back from the IdP.
const oidcCallback = asyncHandler(async (req, res) => {
  const provider = await ssoService.getEnabledProviderBySlug(req.params.slug);

  // The IdP reports user-facing failures (consent denied, MFA abandoned) as
  // an error parameter rather than an HTTP error.
  if (req.query.error) {
    return failRedirect(res, String(req.query.error_description || req.query.error).slice(0, 200));
  }

  let request;
  let user;
  try {
    request = await ssoService.consumeAuthRequest(req.query.state, provider.id);
    const currentUrl = new URL(`${callbackUrlFor(provider)}${req.originalUrl.slice(req.originalUrl.indexOf('?'))}`);
    const profile = await oidc.completeAuthorization(provider, {
      currentUrl,
      state: request.state,
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
    });
    user = await ssoService.resolveIdentity(provider, profile);
  } catch (err) {
    if (err instanceof ApiError) return failRedirect(res, err.message);
    throw err;
  }

  await establishSession(req, user, provider, 'oidc');
  return res.redirect(302, `${publicBaseUrl()}${request.returnTo || DEFAULT_RETURN_TO}`);
});

// POST /sso/:slug/acs — SAML assertion consumer service.
//
// This arrives as a cross-site form POST, so the session cookie is absent
// (sameSite=lax) and there is no CSRF token to check. RelayState is the only
// context that survives, which is why login state is a single-use server-side
// row keyed by it.
const samlAcs = asyncHandler(async (req, res) => {
  const provider = await ssoService.getEnabledProviderBySlug(req.params.slug);

  let request;
  let user;
  try {
    request = await ssoService.consumeAuthRequest(req.body?.RelayState, provider.id);
    const profile = await saml.completeAuthorization(provider, callbackUrlFor(provider), req.body);
    user = await ssoService.resolveIdentity(provider, profile);
  } catch (err) {
    if (err instanceof ApiError) return failRedirect(res, err.message);
    throw err;
  }

  await establishSession(req, user, provider, 'saml');
  return res.redirect(302, `${publicBaseUrl()}${request.returnTo || DEFAULT_RETURN_TO}`);
});

// GET /sso/:slug/metadata — SP metadata XML for configuring the IdP.
const samlMetadata = asyncHandler(async (req, res) => {
  const provider = await ssoService.getEnabledProviderBySlug(req.params.slug);
  if (provider.protocol !== 'saml') {
    throw new ApiError(404, 'This provider does not use SAML', 'NOT_FOUND');
  }
  const xml = saml.serviceProviderMetadata(provider, callbackUrlFor(provider));
  res.type('application/xml').send(xml);
});

module.exports = {
  listPublicProviders,
  start,
  oidcCallback,
  samlAcs,
  samlMetadata,
  callbackUrlFor,
  publicBaseUrl,
};
