// Client-portal sign-in: email + password, the invite link (set your first
// password), forgot / reset password, sign-out and "who am I".
const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const { sequelize, Contact } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { validatePassword, describeProblems } = require('../../utils/passwordPolicy');
const { getAllSettings, getPortalMicrosoftApp } = require('../settingsController');
const {
  isPortalEnabled, mayUsePortal, destroySession, accessEnded, loadPortalContact,
} = require('../../middleware/portalAuth');
const { issuePortalToken, consumePortalToken, findUsableToken } = require('../../services/portal/tokens');
const { sendPortalLink } = require('../../services/portal/portalMail');
const { signInMethod } = require('../../services/portal/signInMethod');
const {
  buildSignInRequest, completeSignIn, resolveMicrosoftSignIn, publicBaseUrl,
} = require('../../services/microsoft365/signIn');
const { isCompanyAdmin, adminDepartmentIds } = require('../../services/portal/scope');

// Compared against when there's no contact or no hash, so a wrong email
// costs the same bcrypt time as a wrong password.
const DUMMY_HASH = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
const BCRYPT_COST = 12;

const displayName = (c) => c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '';
const cleanEmail = (v) => (typeof v === 'string' ? v.trim() : '');

// Audit rows for portal actions: no staff user, the contact is the entity.
const portalAudit = (req, action, contactId, meta) => writeAudit({ user: null }, action, 'Contact', contactId, meta);

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

// The /me payload (also returned by login).
async function contactPayload(contact) {
  const [companyAdmin, deptIds, withHash] = await Promise.all([
    isCompanyAdmin(contact),
    adminDepartmentIds(contact),
    Contact.scope('withPassword').findByPk(contact.id, { attributes: ['id', 'passwordHash', 'msObjectId'] }),
  ]);
  return {
    id: contact.id,
    displayName: displayName(contact),
    email: contact.email,
    company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
    department: contact.department ? { id: contact.department.id, name: contact.department.name } : null,
    isCompanyAdmin: companyAdmin,
    adminDepartmentIds: deptIds,
    signInMethod: signInMethod(withHash),
  };
}

// Revoke every stored portal session of a contact except keepSid (after a
// password reset). Same approach as the staff side: match the JSON payload.
async function destroyPortalSessions(contactId, keepSid) {
  const rows = await sequelize.query('SELECT sid, data FROM Sessions', { type: QueryTypes.SELECT });
  const stale = rows.filter((row) => {
    if (row.sid === keepSid) return false;
    try { return JSON.parse(row.data)?.contactId === contactId; } catch { return false; }
  }).map((row) => row.sid);
  if (stale.length) await sequelize.query('DELETE FROM Sessions WHERE sid IN (:sids)', { replacements: { sids: stale } });
}

// A contact linked to a Microsoft person signs in only with Microsoft.
const useMicrosoft = () => new ApiError(400, 'Your account signs in with Microsoft. Use "Sign in with Microsoft".', 'USE_MICROSOFT');

function assertStrongPassword(password, contact) {
  const policy = validatePassword(password, {
    email: contact.email, displayName: contact.displayName, firstName: contact.firstName, lastName: contact.lastName,
  });
  if (!policy.ok) throw new ApiError(400, describeProblems(policy.problems), 'WEAK_PASSWORD');
}

// GET /portal/config — public: what the sign-in page needs.
const config = asyncHandler(async (req, res) => {
  const [values, msApp] = await Promise.all([getAllSettings(), getPortalMicrosoftApp()]);
  res.json({
    enabled: values['portal.enabled'] === 'true',
    microsoft: !!(msApp.clientId && msApp.clientSecret),
    branding: {
      appName: values['branding.appName'],
      tagline: values['branding.tagline'],
      logoUrl: values['company.logoFilename'] ? '/api/v1/settings/logo' : null,
    },
  });
});

// POST /portal/auth/login { email, password }
const login = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) throw new ApiError(400, 'Email and password are required', 'MISSING_CREDENTIALS');
  if (!(await isPortalEnabled())) throw new ApiError(403, 'The support portal is switched off', 'PORTAL_DISABLED');

  const contact = await Contact.scope('withPassword').findOne({ where: { email } });
  const ok = await bcrypt.compare(password, (contact && contact.passwordHash) || DUMMY_HASH);
  if (contact && contact.msObjectId) throw useMicrosoft();
  if (!contact || !contact.passwordHash || !ok) throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  // Only after the password verifies, so this can't be used to probe emails.
  if (!mayUsePortal(contact)) throw accessEnded();

  res.json({ contact: await signIn(req, contact, 'password') });
});

// POST /portal/auth/logout — ends the portal session only; a staff session in
// the same browser lives on its own cookie and is untouched.
const logout = asyncHandler(async (req, res) => {
  await destroySession(req);
  res.clearCookie('prism.portal.sid', { path: '/api/v1/portal' });
  res.json({ ok: true });
});

// GET /portal/me
const me = asyncHandler(async (req, res) => {
  res.json({ contact: await contactPayload(req.contact) });
});

// Starts a portal session for a contact who just proved who they are.
// extra: more session fields (a Microsoft sign-in's tenant and check time).
async function signIn(req, contact, method, extra = {}) {
  await regenerateSession(req);
  req.session.contactId = contact.id;
  Object.assign(req.session, extra);
  await Contact.update({ portalLastSignInAt: new Date() }, { where: { id: contact.id } });
  await portalAudit(req, 'portal.sign_in', contact.id, { method });
  return contactPayload(await loadPortalContact(contact.id));
}

// Shared by invite/accept and reset: check the link, check the password,
// then spend the link and save. A refused password leaves the link usable.
async function setPasswordFromLink(req, kind) {
  const { token, password } = req.body || {};
  const { contact } = await findUsableToken(token, kind);
  if (!mayUsePortal(contact) || !(await isPortalEnabled())) throw accessEnded();
  if (contact.msObjectId) throw useMicrosoft();
  assertStrongPassword(password, contact);
  await consumePortalToken(token, kind);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await Contact.scope('withPassword').update({ passwordHash }, { where: { id: contact.id } });
  return contact;
}

// POST /portal/auth/invite/check { token } — who the invite is for, so the
// page can show it. Spends nothing.
const checkInvite = asyncHandler(async (req, res) => {
  const { contact } = await findUsableToken((req.body || {}).token, 'invite');
  if (!mayUsePortal(contact) || !(await isPortalEnabled())) throw accessEnded();
  if (contact.msObjectId) throw useMicrosoft();
  const full = await loadPortalContact(contact.id);
  res.json({ email: contact.email, companyName: full.company ? full.company.name : '' });
});

// POST /portal/auth/invite/accept { token, password } — sets the password
// and signs the contact in.
const acceptInvite = asyncHandler(async (req, res) => {
  const contact = await setPasswordFromLink(req, 'invite');
  // A new invite to someone who had a password replaces it: like a reset,
  // every other session ends.
  await destroyPortalSessions(contact.id, req.sessionID);
  await portalAudit(req, 'portal.password_set', contact.id, { via: 'invite' });
  res.json({ contact: await signIn(req, contact, 'invite') });
});

// POST /portal/auth/reset { token, password } — ends every other portal
// session of the contact, then signs this one in.
const resetPassword = asyncHandler(async (req, res) => {
  const contact = await setPasswordFromLink(req, 'reset');
  await destroyPortalSessions(contact.id, req.sessionID);
  await portalAudit(req, 'portal.password_set', contact.id, { via: 'reset' });
  res.json({ contact: await signIn(req, contact, 'reset') });
});

// The work behind /forgot, after the response has gone: whether an email is
// known must show neither in the answer nor in how long it takes.
async function sendResetIfAllowed(email) {
  if (!(await isPortalEnabled())) return;
  const contact = await Contact.findOne({ where: { email } });
  if (!mayUsePortal(contact) || contact.msObjectId) return;
  const { token } = await issuePortalToken(contact.id, 'reset');
  await sendPortalLink('reset', contact, token);
  await portalAudit(null, 'portal.reset_sent', contact.id, null);
}

// POST /portal/auth/forgot { email } — always 202.
const forgot = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  res.status(202).json({ ok: true });
  if (!email) return;
  sendResetIfAllowed(email).catch((err) => console.error('[portal] reset email failed:', err.message));
});

// --- Sign in with Microsoft (7b) ---------------------------------------------

// How long the browser may spend at Microsoft between start and callback.
const MS_SIGN_IN_MAX_AGE_MS = 10 * 60 * 1000;
const refusedUrl = (code) => `${publicBaseUrl()}/portal/sign-in?refused=${encodeURIComponent(code)}`;

// GET /portal/auth/microsoft/start — off to Microsoft. The state, nonce and
// PKCE verifier stay in this browser's portal session (server-side) until
// the callback spends them.
const microsoftStart = asyncHandler(async (req, res) => {
  if (!(await isPortalEnabled())) return res.redirect(302, refusedUrl('unavailable'));
  let built;
  try {
    built = await buildSignInRequest();
  } catch {
    return res.redirect(302, refusedUrl('unavailable'));
  }
  req.session.msSignIn = { ...built.pending, at: Date.now() };
  return res.redirect(302, built.url);
});

// GET /portal/auth/microsoft/callback?code&state — back from Microsoft. The
// pending request is spent whatever happens next, so a callback URL works
// once, and only in the browser that started it.
const microsoftCallback = asyncHandler(async (req, res) => {
  // A tenant admin back from "Approve PRISM" (the app registers this one
  // address for both): on to that company's page. Nothing is recorded here,
  // as anyone can craft this URL; a successful Graph call marks the approval.
  const consent = typeof req.query.state === 'string' && /^consent-(\d{1,10})$/.exec(req.query.state);
  if (consent && (req.query.admin_consent !== undefined || req.query.error)) {
    const outcome = req.query.admin_consent === 'True' ? 'approved' : 'not_approved';
    return res.redirect(302, `${publicBaseUrl()}/companies/${consent[1]}?m365=${outcome}`);
  }
  const pending = req.session.msSignIn;
  delete req.session.msSignIn;
  const refuse = async (code, meta = {}) => {
    await portalAudit(req, 'portal.sign_in_refused', meta.contactId || null, { method: 'microsoft', reason: code, tenantId: meta.tenantId || null });
    return res.redirect(302, refusedUrl(code));
  };
  const fresh = pending && Date.now() - pending.at <= MS_SIGN_IN_MAX_AGE_MS;
  if (!fresh || typeof req.query.state !== 'string' || req.query.state !== pending.state || req.query.error) return refuse('failed');
  if (!(await isPortalEnabled())) return refuse('unavailable');

  let person;
  try {
    person = await completeSignIn({ code: req.query.code, nonce: pending.nonce, codeVerifier: pending.codeVerifier });
  } catch (err) {
    console.warn('[portal] Microsoft sign-in failed:', err.message);
    return refuse('failed');
  }
  const result = await resolveMicrosoftSignIn(person);
  if (result.refused) {
    if (result.error) console.warn('[portal] Microsoft group check failed:', result.error);
    return refuse(result.refused, { tenantId: person.tid, contactId: result.contact && result.contact.id });
  }
  if (result.created) await portalAudit(req, 'portal.contact_created', result.contact.id, { via: 'microsoft', companyId: result.company.id });
  await signIn(req, result.contact, 'microsoft', { msTenantId: person.tid, msCheckedAt: Date.now() });
  return res.redirect(302, `${publicBaseUrl()}/portal`);
});

module.exports = {
  microsoftStart, microsoftCallback,
  config, login, logout, me, checkInvite, acceptInvite, resetPassword, forgot, contactPayload, displayName,
};
