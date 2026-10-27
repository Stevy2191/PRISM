// Client-portal sign-in: email + password, the invite link (set your first
// password), forgot / reset password, sign-out and "who am I".
const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const { sequelize, Contact } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { validatePassword, describeProblems } = require('../../utils/passwordPolicy');
const { getAllSettings } = require('../settingsController');
const {
  isPortalEnabled, mayUsePortal, destroySession, accessEnded, loadPortalContact,
} = require('../../middleware/portalAuth');
const { issuePortalToken, consumePortalToken, findUsableToken } = require('../../services/portal/tokens');
const { sendPortalLink } = require('../../services/portal/portalMail');
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
    Contact.scope('withPassword').findByPk(contact.id, { attributes: ['id', 'passwordHash'] }),
  ]);
  return {
    id: contact.id,
    displayName: displayName(contact),
    email: contact.email,
    company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
    department: contact.department ? { id: contact.department.id, name: contact.department.name } : null,
    isCompanyAdmin: companyAdmin,
    adminDepartmentIds: deptIds,
    signInMethod: withHash && withHash.passwordHash ? 'password' : null,
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

function assertStrongPassword(password, contact) {
  const policy = validatePassword(password, {
    email: contact.email, displayName: contact.displayName, firstName: contact.firstName, lastName: contact.lastName,
  });
  if (!policy.ok) throw new ApiError(400, describeProblems(policy.problems), 'WEAK_PASSWORD');
}

// GET /portal/config — public: what the sign-in page needs.
const config = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  res.json({
    enabled: values['portal.enabled'] === 'true',
    microsoft: false,
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
async function signIn(req, contact, method) {
  await regenerateSession(req);
  req.session.contactId = contact.id;
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
  const full = await loadPortalContact(contact.id);
  res.json({ email: contact.email, companyName: full.company ? full.company.name : '' });
});

// POST /portal/auth/invite/accept { token, password } — sets the password
// and signs the contact in.
const acceptInvite = asyncHandler(async (req, res) => {
  const contact = await setPasswordFromLink(req, 'invite');
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
  if (!mayUsePortal(contact)) return;
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

module.exports = {
  config, login, logout, me, checkInvite, acceptInvite, resetPassword, forgot, contactPayload, displayName,
};
