// SAML 2.0 adapter. Wraps @node-saml/node-saml, which performs the parts of
// SAML that are historically where implementations get breached: XML
// signature verification, canonicalization, and the timestamp/audience
// checks. Nothing here parses XML by hand.
const { SAML } = require('@node-saml/node-saml');
const { ApiError } = require('../../middleware/error');
const { decryptToken } = require('../../utils/tokenCrypto');

// Attribute names vary wildly between IdPs; these are the common spellings
// used by ADFS, Entra ID and Okta.
const EMAIL_ATTRS = [
  'email', 'mail', 'emailAddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const FIRST_NAME_ATTRS = [
  'firstName', 'givenName', 'given_name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  'urn:oid:2.5.4.42',
];
const LAST_NAME_ATTRS = [
  'lastName', 'surname', 'sn', 'family_name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  'urn:oid:2.5.4.4',
];
const DISPLAY_NAME_ATTRS = [
  'displayName', 'name', 'cn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];

function buildSaml(provider, { callbackUrl }) {
  const config = provider.parsedConfig();
  if (!config.entryPoint || !config.idpCert) {
    throw new ApiError(500, `SSO provider "${provider.name}" is missing its sign-on URL or IdP certificate`, 'SSO_MISCONFIGURED');
  }

  const privateKey = provider.spPrivateKey ? decryptToken(provider.spPrivateKey) : null;

  return new SAML({
    entryPoint: config.entryPoint,
    // The SP entity id. Defaults to the callback URL, which is what most IdPs
    // expect when no explicit entity id is configured.
    issuer: config.issuer || callbackUrl,
    callbackUrl,
    idpCert: config.idpCert,
    privateKey: privateKey || undefined,
    signatureAlgorithm: config.signatureAlgorithm || 'sha256',
    digestAlgorithm: config.digestAlgorithm || 'sha256',
    identifierFormat: config.identifierFormat || null,
    // Assertions must be signed. node-saml accepts a signature on the
    // response, the assertion, or both; requiring the assertion specifically
    // closes the class of attack where only the envelope is signed.
    wantAssertionsSigned: config.wantAssertionsSigned !== false,
    wantAuthnResponseSigned: config.wantAuthnResponseSigned !== false,
    // InResponseTo is validated against our own request id by ssoService's
    // single-use state row, so node-saml's separate in-memory cache is not
    // needed and would not survive a restart anyway.
    validateInResponseTo: 'never',
    acceptedClockSkewMs: Number.isFinite(Number(config.clockSkewMs)) ? Number(config.clockSkewMs) : 5000,
    audience: config.audience || config.issuer || callbackUrl,
    disableRequestedAuthnContext: config.disableRequestedAuthnContext !== false,
  });
}

// Returns the redirect URL for an SP-initiated login. The state value travels
// as RelayState, which the IdP echoes back to the ACS endpoint — the only
// piece of our own context that survives the round-trip, since the session
// cookie will not accompany a cross-site POST.
async function buildAuthorizationRequest(provider, callbackUrl, state) {
  const saml = buildSaml(provider, { callbackUrl });
  try {
    const url = await saml.getAuthorizeUrlAsync(state, undefined, {});
    return { url, state };
  } catch (err) {
    throw new ApiError(502, `Could not build a sign-on request for "${provider.name}": ${err.message}`, 'SSO_REQUEST_FAILED');
  }
}

// Verifies a POSTed SAMLResponse and returns a normalized profile.
async function completeAuthorization(provider, callbackUrl, body) {
  const saml = buildSaml(provider, { callbackUrl });

  let result;
  try {
    result = await saml.validatePostResponseAsync(body);
  } catch (err) {
    throw new ApiError(401, `Sign-in with ${provider.name} failed: ${err.message}`, 'SSO_ASSERTION_INVALID');
  }

  const profile = result && result.profile;
  if (!profile) {
    throw new ApiError(401, `Sign-in with ${provider.name} returned no assertion`, 'SSO_ASSERTION_INVALID');
  }

  return profileToNormalized(profile, provider.parsedConfig());
}

function pick(profile, names) {
  for (const name of names) {
    const value = profile[name];
    if (value === undefined || value === null || value === '') continue;
    return Array.isArray(value) ? value[0] : String(value);
  }
  return null;
}

function profileToNormalized(profile, config) {
  const groupsAttr = config.groupsAttribute || 'groups';
  const rawGroups = profile[groupsAttr]
    ?? profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
    ?? profile.memberOf;
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map((g) => String(g))
    : (typeof rawGroups === 'string' && rawGroups ? [rawGroups] : []);

  return {
    // nameID is the stable subject. node-saml exposes it separately from the
    // attribute statement.
    subject: profile.nameID || profile.nameId || null,
    email: pick(profile, EMAIL_ATTRS),
    displayName: pick(profile, DISPLAY_NAME_ATTRS),
    firstName: pick(profile, FIRST_NAME_ATTRS),
    lastName: pick(profile, LAST_NAME_ATTRS),
    preferredUsername: null,
    groups,
  };
}

// SP metadata, so an administrator can configure their IdP by upload rather
// than by transcribing URLs.
function serviceProviderMetadata(provider, callbackUrl) {
  const saml = buildSaml(provider, { callbackUrl });
  return saml.generateServiceProviderMetadata(null, null);
}

module.exports = {
  buildAuthorizationRequest,
  completeAuthorization,
  serviceProviderMetadata,
  profileToNormalized,
};
