// Sign in to the client portal with a work Microsoft account (client portal
// 7b). OpenID Connect against Microsoft's multi-tenant "organizations"
// authority, with PKCE, a nonce and a single-use state.
//
// Microsoft's multi-tenant discovery document names its issuer with a
// "{tenantid}" placeholder, which a standard OIDC client can't check, so the
// ID token is verified here with jose instead: signature against Microsoft's
// published keys, audience = our client ID, expiry, then the issuer must be
// exactly the one for the token's own tenant (tid). A token whose tid and
// issuer disagree is refused.
//
// Who gets in is decided by resolveMicrosoftSignIn: the tenant must be linked
// to a company and the person must be in one of that company's sync groups
// (asked of Microsoft Graph, never taken from the token).
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Company, Contact } = require('../../models');
const { getPortalMicrosoftApp } = require('../../controllers/settingsController');
const graph = require('./graph');
const { resolveDepartment } = require('./departments');

const SCOPE = 'openid profile email';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loginBase = () => (process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com').replace(/\/$/, '');

// Callback addresses come from PUBLIC_APP_URL, never request headers (same
// reasoning as ssoController's publicBaseUrl).
function publicBaseUrl() {
  const configured = process.env.PUBLIC_APP_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  return `http://localhost:${process.env.APP_PORT || 8080}`;
}
// The redirect address to register on the Microsoft app (shown in Settings).
const microsoftRedirectUri = () => `${publicBaseUrl()}/api/v1/portal/auth/microsoft/callback`;

class SignInError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MicrosoftSignInError';
  }
}

let josePromise = null;
const loadJose = () => { josePromise = josePromise || import('jose'); return josePromise; };
// One key set per keys address; jose caches and refreshes the keys itself.
const keySets = new Map();
async function microsoftKeys() {
  const url = `${loginBase()}/common/discovery/v2.0/keys`;
  if (!keySets.has(url)) {
    const { createRemoteJWKSet } = await loadJose();
    keySets.set(url, createRemoteJWKSet(new URL(url)));
  }
  return keySets.get(url);
}

const random = () => crypto.randomBytes(32).toString('base64url');

// The redirect to Microsoft, plus what the callback needs to check it
// ({ state, nonce, codeVerifier }: keep it server-side, use it once).
async function buildSignInRequest() {
  const { clientId, clientSecret } = await getPortalMicrosoftApp();
  if (!clientId || !clientSecret) throw new SignInError('The Microsoft app is not set up');
  const pending = { state: random(), nonce: random(), codeVerifier: random() };
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: microsoftRedirectUri(),
    scope: SCOPE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: crypto.createHash('sha256').update(pending.codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${loginBase()}/organizations/oauth2/v2.0/authorize?${params}`, pending };
}

// Swaps the code for an ID token and verifies it. Returns the person's claims.
async function completeSignIn({ code, nonce, codeVerifier }) {
  const { clientId, clientSecret } = await getPortalMicrosoftApp();
  if (!clientId || !clientSecret) throw new SignInError('The Microsoft app is not set up');
  if (typeof code !== 'string' || !code) throw new SignInError('No code from Microsoft');
  let res;
  try {
    res = await fetch(`${loginBase()}/organizations/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: microsoftRedirectUri(),
        code_verifier: codeVerifier,
        scope: SCOPE,
      }).toString(),
    });
  } catch {
    throw new SignInError('Could not reach Microsoft');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) throw new SignInError(`Microsoft refused the code (${res.status}, ${body.error || 'no token'})`);

  const { jwtVerify } = await loadJose();
  let payload;
  try {
    ({ payload } = await jwtVerify(body.id_token, await microsoftKeys(), {
      audience: clientId, algorithms: ['RS256'], clockTolerance: 60,
    }));
  } catch (err) {
    throw new SignInError(`The Microsoft ID token did not verify (${err.code || 'invalid'})`);
  }
  if (typeof payload.tid !== 'string' || !GUID.test(payload.tid)) throw new SignInError('The ID token has no tenant');
  if (payload.iss !== `${loginBase()}/${payload.tid}/v2.0`) throw new SignInError('The ID token\'s issuer does not match its tenant');
  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) throw new SignInError('The ID token\'s nonce does not match');
  if (typeof payload.oid !== 'string' || !GUID.test(payload.oid)) throw new SignInError('The ID token has no object id');
  const email = [payload.email, payload.preferred_username].find((v) => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
  return {
    tid: payload.tid.toLowerCase(),
    oid: payload.oid.toLowerCase(),
    email: email ? email.trim() : null,
    name: typeof payload.name === 'string' ? payload.name.trim() : null,
    given: typeof payload.given_name === 'string' ? payload.given_name.trim() : null,
    family: typeof payload.family_name === 'string' ? payload.family_name.trim() : null,
  };
}

const isUniqueError = (err) => err && err.name === 'SequelizeUniqueConstraintError';

// Who this verified Microsoft person is in PRISM.
// → { contact, company, created?, linked? } or { refused, ... } with refused one of
//   not_linked     the tenant is linked to no (active) company
//   not_in_groups  not in any of the company's sync groups
//   other_company  their email is a contact of another company (nothing moves)
//   conflict       their email is a contact already linked to another Microsoft person
//   inactive       the contact is inactive
//   no_access      staff turned this contact's portal access off
//   unavailable    Microsoft could not be asked about the groups (fail closed)
async function resolveMicrosoftSignIn({
  tid, oid, email, name, given, family,
}) {
  const company = await Company.findOne({ where: { msTenantId: tid, status: 'active' } });
  if (!company) return { refused: 'not_linked' };
  const groupIds = (company.msSyncGroups || []).map((g) => g.id).filter(Boolean);
  if (!groupIds.length) return { refused: 'not_in_groups', company };
  try {
    if (!(await graph.memberOfAny(tid, oid, groupIds))) return { refused: 'not_in_groups', company };
  } catch (err) {
    return { refused: 'unavailable', company, error: err.code || err.message };
  }

  const check = (contact, extra = {}) => {
    if (contact.status !== 'active') return { refused: 'inactive', company, contact };
    if (!contact.portalAccess) return { refused: 'no_access', company, contact };
    return { contact, company, ...extra };
  };

  // 1. Seen before: their object id, whatever their email is now.
  let contact = await Contact.findOne({ where: { companyId: company.id, msObjectId: oid } });
  if (contact) return check(contact);

  // 2. Their email: link the contact if it is this company's.
  if (email) {
    contact = await Contact.findOne({ where: { email } });
    if (contact && contact.companyId !== company.id) return { refused: 'other_company', company, contact };
    if (contact && contact.msObjectId) return { refused: 'conflict', company, contact };
    if (contact) {
      if (contact.status !== 'active') return { refused: 'inactive', company, contact };
      // Everyone in the sync groups gets portal access; Microsoft replaces
      // their password, which stops working from here on.
      await Contact.scope('withPassword').update(
        { msObjectId: oid, portalAccess: true, passwordHash: null },
        { where: { id: contact.id, msObjectId: { [Op.is]: null } } }
      );
      return check(await Contact.findByPk(contact.id), { linked: true });
    }
  }

  // 3. New to PRISM: a contact of this company, portal access on, with the
  // department and job title Microsoft 365 has for them (if it can say).
  let profile = null;
  try {
    profile = await graph.getUser(tid, oid);
  } catch (err) {
    console.warn('[portal] could not read the new contact\'s Microsoft profile:', err.code || err.message);
  }
  const msDepartmentName = profile && profile.department ? String(profile.department).trim().slice(0, 150) : null;
  const departmentId = msDepartmentName ? await resolveDepartment(company.id, msDepartmentName) : null;
  const displayName = name || [given, family].filter(Boolean).join(' ') || email || 'Microsoft user';
  try {
    contact = await Contact.create({
      firstName: (given || name || email || 'Microsoft').slice(0, 100),
      lastName: (given ? family || '' : '').slice(0, 100),
      displayName: displayName.slice(0, 200),
      email,
      companyId: company.id,
      portalAccess: true,
      msObjectId: oid,
      msDepartmentName,
      departmentId,
      jobTitle: profile && profile.jobTitle ? String(profile.jobTitle).slice(0, 150) : null,
    });
  } catch (err) {
    // Two sign-ins of the same person at once: the other one made it.
    if (!isUniqueError(err)) throw err;
    contact = await Contact.findOne({ where: { companyId: company.id, msObjectId: oid } });
    if (!contact) return { refused: 'conflict', company };
    return check(contact);
  }
  return { contact, company, created: true };
}

module.exports = {
  buildSignInRequest, completeSignIn, resolveMicrosoftSignIn, microsoftRedirectUri, publicBaseUrl, SignInError,
};
