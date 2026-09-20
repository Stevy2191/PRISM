// Protocol-agnostic single sign-on logic: turning a verified assertion from
// an identity provider into a PRISM user, and managing the short-lived state
// that ties a login round-trip together.
//
// The OIDC and SAML adapters are responsible for *verifying* their protocol's
// response; everything that happens afterwards is identical and lives here.
const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  SsoProvider, SsoIdentity, SsoGroupMapping, SsoAuthRequest, User, UserRole, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { invalidateUserPermissions } = require('../permissionService');
const { computeDisplayName } = require('../../utils/userDisplay');

// A login round-trip has to survive a redirect to the IdP and back, but not
// much longer. Long enough for a password prompt and MFA, short enough that a
// leaked state value is nearly worthless.
const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-flight login state
// ---------------------------------------------------------------------------

async function createAuthRequest({ provider, state, nonce, codeVerifier, returnTo }) {
  return SsoAuthRequest.create({
    state,
    providerId: provider.id,
    nonce: nonce || null,
    codeVerifier: codeVerifier || null,
    returnTo: safeReturnTo(returnTo),
    expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS),
  });
}

// Redeems a state value exactly once. Every failure mode — unknown, expired,
// already used, or belonging to a different provider — is reported the same
// way, since the distinction is only useful to an attacker.
async function consumeAuthRequest(state, providerId) {
  if (!state) throw new ApiError(400, 'Invalid or expired login request', 'SSO_INVALID_STATE');

  const request = await SsoAuthRequest.findOne({ where: { state } });
  if (!request || request.providerId !== providerId || !request.isUsable()) {
    throw new ApiError(400, 'Invalid or expired login request', 'SSO_INVALID_STATE');
  }

  // Marking consumed under a conditional update makes the redemption atomic:
  // two simultaneous callbacks for the same state cannot both succeed.
  const [updated] = await SsoAuthRequest.update(
    { consumedAt: new Date() },
    { where: { id: request.id, consumedAt: null } }
  );
  if (!updated) {
    throw new ApiError(400, 'Invalid or expired login request', 'SSO_INVALID_STATE');
  }

  return request;
}

// Expired and consumed rows are not needed once the round-trip is over.
async function pruneAuthRequests() {
  return SsoAuthRequest.destroy({
    where: {
      [Op.or]: [
        { expiresAt: { [Op.lt]: new Date() } },
        { consumedAt: { [Op.lt]: new Date(Date.now() - AUTH_REQUEST_TTL_MS) } },
      ],
    },
  });
}

// Only a same-site path is ever used to redirect after login. An absolute URL
// (or a protocol-relative "//evil.test" one, which `new URL` on a base would
// happily resolve off-site) turns the callback into an open redirect.
function safeReturnTo(value) {
  if (typeof value !== 'string' || !value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  return value.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

// Takes a verified assertion and returns the PRISM user it authenticates.
//
// `profile` is whatever the adapter extracted: { subject, email, displayName,
// firstName, lastName, groups }. `subject` is the only field trusted for
// identity — email is synced as an attribute, never matched on, because an
// IdP that asserts an unverified or recycled address would otherwise be able
// to take over an existing account.
async function resolveIdentity(provider, profile) {
  if (!profile || !profile.subject) {
    throw new ApiError(401, 'The identity provider did not return a subject identifier', 'SSO_NO_SUBJECT');
  }

  const existing = await SsoIdentity.findOne({
    where: { providerId: provider.id, subject: String(profile.subject) },
    include: [{ model: User, as: 'user' }],
  });

  let user = existing ? existing.user : null;

  if (!user) {
    if (!provider.allowJit) {
      throw new ApiError(
        403,
        'No PRISM account is linked to this identity, and automatic provisioning is disabled for this provider',
        'SSO_NO_ACCOUNT'
      );
    }
    user = await provisionUser(provider, profile);
  } else {
    await syncProfile(user, profile);
  }

  if (!user.isActive) {
    throw new ApiError(401, 'This account has been deactivated', 'ACCOUNT_DEACTIVATED');
  }

  await applyGroupMappings(provider, user, profile.groups);

  await SsoIdentity.update(
    { lastLoginAt: new Date() },
    { where: { providerId: provider.id, subject: String(profile.subject) } }
  );

  return user;
}

// Usernames are unique, so a JIT user needs one that cannot collide with an
// existing local or directory account.
async function allocateUsername(profile) {
  const base = (profile.preferredUsername
    || (profile.email ? String(profile.email).split('@')[0] : null)
    || `sso-${crypto.randomBytes(4).toString('hex')}`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40) || `sso-${crypto.randomBytes(4).toString('hex')}`;

  if (!(await User.findOne({ where: { username: base } }))) return base;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${base}-${i}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await User.findOne({ where: { username: candidate } }))) return candidate;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

// A JIT user is created with no roles at all. Permissions arrive only from a
// matching group mapping or the provider's configured default role — the same
// fail-closed posture directory provisioning already has.
async function provisionUser(provider, profile) {
  const username = await allocateUsername(profile);
  const displayName = computeDisplayName({
    firstName: profile.firstName,
    lastName: profile.lastName,
    fallback: profile.displayName || profile.email || username,
  }) || username;

  return sequelize.transaction(async (t) => {
    const user = await User.create(
      {
        username,
        displayName,
        firstName: profile.firstName || null,
        lastName: profile.lastName || null,
        email: profile.email || null,
        role: 'technician', // legacy enum; grants nothing on its own
        isLocalAccount: false,
        passwordHash: null,
        mustChangePassword: false,
        isActive: true,
        roleId: null,
      },
      { transaction: t }
    );

    await SsoIdentity.create(
      { providerId: provider.id, subject: String(profile.subject), userId: user.id, lastLoginAt: new Date() },
      { transaction: t }
    );

    return user;
  });
}

// Directory attributes are authoritative for display fields, so they are
// refreshed on every login — but only when the provider actually asserted
// them, so a sparse assertion never blanks out existing data.
async function syncProfile(user, profile) {
  const changes = {};
  if (profile.email && profile.email !== user.email) changes.email = profile.email;
  if (profile.firstName && profile.firstName !== user.firstName) changes.firstName = profile.firstName;
  if (profile.lastName && profile.lastName !== user.lastName) changes.lastName = profile.lastName;

  const displayName = computeDisplayName({
    firstName: changes.firstName || user.firstName,
    lastName: changes.lastName || user.lastName,
    fallback: profile.displayName || user.displayName,
  });
  if (displayName && displayName !== user.displayName) changes.displayName = displayName;

  if (Object.keys(changes).length) await user.update(changes);
  return user;
}

// Roles are recomputed from the asserted groups on every login, so removing
// someone from a group at the IdP actually revokes their access here rather
// than leaving a stale grant behind.
//
// Only roles that this provider maps are touched. A role an administrator
// assigned by hand is left alone — otherwise SSO would silently undo manual
// grants on every sign-in.
async function applyGroupMappings(provider, user, groups) {
  const mappings = await SsoGroupMapping.findAll({ where: { providerId: provider.id } });
  if (!mappings.length) {
    if (provider.defaultRoleId) await ensureDefaultRole(user, provider.defaultRoleId);
    return;
  }

  const asserted = new Set((Array.isArray(groups) ? groups : []).map((g) => String(g)));
  const managedRoleIds = new Set(mappings.map((m) => m.roleId));
  const grantedRoleIds = new Set(
    mappings.filter((m) => asserted.has(String(m.claimValue))).map((m) => m.roleId)
  );

  if (!grantedRoleIds.size && provider.defaultRoleId) grantedRoleIds.add(provider.defaultRoleId);

  const current = await UserRole.findAll({ where: { userId: user.id } });
  const currentRoleIds = new Set(current.map((ur) => ur.roleId));

  const toAdd = [...grantedRoleIds].filter((id) => !currentRoleIds.has(id));
  const toRemove = current.filter((ur) => managedRoleIds.has(ur.roleId) && !grantedRoleIds.has(ur.roleId));

  if (!toAdd.length && !toRemove.length) return;

  await sequelize.transaction(async (t) => {
    if (toRemove.length) {
      await UserRole.destroy({ where: { id: toRemove.map((ur) => ur.id) }, transaction: t });
    }
    for (const roleId of toAdd) {
      // eslint-disable-next-line no-await-in-loop
      await UserRole.create(
        { userId: user.id, roleId, assignedAt: new Date(), assignedBy: null },
        { transaction: t }
      );
    }
  });

  // User.roleId is the "primary" role the UI displays; keep it pointing at
  // something the user actually holds.
  const remaining = await UserRole.findAll({ where: { userId: user.id } });
  const primary = remaining.length ? remaining[0].roleId : null;
  if (user.roleId !== primary) await user.update({ roleId: primary });

  invalidateUserPermissions(user.id);
}

async function ensureDefaultRole(user, roleId) {
  const existing = await UserRole.findOne({ where: { userId: user.id, roleId } });
  if (existing) return;
  await UserRole.create({ userId: user.id, roleId, assignedAt: new Date(), assignedBy: null });
  if (!user.roleId) await user.update({ roleId });
  invalidateUserPermissions(user.id);
}

// ---------------------------------------------------------------------------
// Provider lookup
// ---------------------------------------------------------------------------

async function getEnabledProviderBySlug(slug) {
  const provider = await SsoProvider.findOne({ where: { slug, isEnabled: true } });
  if (!provider) throw new ApiError(404, 'Unknown or disabled sign-on provider', 'SSO_UNKNOWN_PROVIDER');
  return provider;
}

module.exports = {
  createAuthRequest,
  consumeAuthRequest,
  pruneAuthRequests,
  safeReturnTo,
  resolveIdentity,
  applyGroupMappings,
  getEnabledProviderBySlug,
  AUTH_REQUEST_TTL_MS,
};
