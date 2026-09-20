// Administration of SSO providers and their group mappings.
// Settings -> Single Sign-On. Guarded by settings.manage_system.
const {
  SsoProvider, SsoGroupMapping, SsoIdentity, Role, User, SystemSettings,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { encryptToken } = require('../utils/tokenCrypto');
const { getAllSettings } = require('./settingsController');
const { callbackUrlFor } = require('./ssoController');
const { clearDiscoveryCache } = require('../services/sso/oidc');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

// Only these keys are persisted into `config`, per protocol — an admin
// posting arbitrary JSON must not be able to set options the adapters treat
// as trusted (for example turning off signature checks on a SAML provider by
// smuggling in a flag the UI never shows).
const OIDC_CONFIG_KEYS = ['issuerUrl', 'clientId', 'scopes', 'groupsClaim', 'allowInsecureIssuer'];
const SAML_CONFIG_KEYS = [
  'entryPoint', 'issuer', 'idpCert', 'groupsAttribute', 'signatureAlgorithm', 'digestAlgorithm',
  'identifierFormat', 'audience', 'clockSkewMs', 'wantAssertionsSigned', 'wantAuthnResponseSigned',
  'disableRequestedAuthnContext',
];

function pickConfig(protocol, input) {
  const allowed = protocol === 'saml' ? SAML_CONFIG_KEYS : OIDC_CONFIG_KEYS;
  const out = {};
  allowed.forEach((key) => {
    if (input && input[key] !== undefined) out[key] = input[key];
  });
  return out;
}

const listProviders = asyncHandler(async (req, res) => {
  const providers = await SsoProvider.findAll({
    order: [['name', 'ASC']],
    include: [{ model: Role, as: 'defaultRole', attributes: ['id', 'name'] }],
  });
  // toJSON strips the encrypted secrets and reports only whether they are set.
  res.json({
    providers: providers.map((p) => ({ ...p.toJSON(), callbackUrl: callbackUrlFor(p) })),
  });
});

const getProvider = asyncHandler(async (req, res) => {
  const provider = await SsoProvider.findByPk(req.params.id, {
    include: [
      { model: SsoGroupMapping, as: 'groupMappings', include: [{ model: Role, as: 'role', attributes: ['id', 'name'] }] },
      { model: Role, as: 'defaultRole', attributes: ['id', 'name'] },
    ],
  });
  if (!provider) throw new ApiError(404, 'Provider not found', 'NOT_FOUND');
  res.json({ provider: { ...provider.toJSON(), callbackUrl: callbackUrlFor(provider) } });
});

const createProvider = asyncHandler(async (req, res) => {
  const {
    name, slug, protocol, buttonLabel, config, clientSecret, spPrivateKey,
    allowJit, defaultRoleId, isEnabled,
  } = req.body || {};

  if (!name || !String(name).trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
  if (!['oidc', 'saml'].includes(protocol)) {
    throw new ApiError(400, 'Protocol must be "oidc" or "saml"', 'VALIDATION_ERROR');
  }
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(normalizedSlug)) {
    throw new ApiError(
      400,
      'Slug must be 3-60 characters, lowercase letters, numbers and hyphens, and cannot start or end with a hyphen',
      'VALIDATION_ERROR'
    );
  }
  if (await SsoProvider.findOne({ where: { slug: normalizedSlug } })) {
    throw new ApiError(409, 'A provider with this slug already exists', 'SLUG_TAKEN');
  }
  if (defaultRoleId && !(await Role.findByPk(defaultRoleId))) {
    throw new ApiError(400, 'Default role does not exist', 'VALIDATION_ERROR');
  }

  const provider = await SsoProvider.create({
    name: String(name).trim(),
    slug: normalizedSlug,
    protocol,
    buttonLabel: buttonLabel ? String(buttonLabel).trim() : null,
    config: JSON.stringify(pickConfig(protocol, config)),
    clientSecret: clientSecret ? encryptToken(clientSecret) : null,
    spPrivateKey: spPrivateKey ? encryptToken(spPrivateKey) : null,
    allowJit: allowJit !== false,
    defaultRoleId: defaultRoleId || null,
    isEnabled: !!isEnabled,
  });

  await writeAudit(req, 'sso.provider_create', 'SsoProvider', provider.id, { name: provider.name, protocol });
  res.status(201).json({ provider: { ...provider.toJSON(), callbackUrl: callbackUrlFor(provider) } });
});

const updateProvider = asyncHandler(async (req, res) => {
  const provider = await SsoProvider.findByPk(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found', 'NOT_FOUND');

  const {
    name, buttonLabel, config, clientSecret, spPrivateKey, allowJit, defaultRoleId, isEnabled,
  } = req.body || {};
  const changes = {};

  if (name !== undefined) {
    if (!String(name).trim()) throw new ApiError(400, 'Name cannot be empty', 'VALIDATION_ERROR');
    changes.name = String(name).trim();
  }
  if (buttonLabel !== undefined) changes.buttonLabel = buttonLabel ? String(buttonLabel).trim() : null;
  if (config !== undefined) {
    changes.config = JSON.stringify({ ...provider.parsedConfig(), ...pickConfig(provider.protocol, config) });
  }
  // An empty string means "leave the stored secret alone"; null means clear it.
  if (clientSecret) changes.clientSecret = encryptToken(clientSecret);
  if (clientSecret === null) changes.clientSecret = null;
  if (spPrivateKey) changes.spPrivateKey = encryptToken(spPrivateKey);
  if (spPrivateKey === null) changes.spPrivateKey = null;
  if (allowJit !== undefined) changes.allowJit = !!allowJit;
  if (isEnabled !== undefined) changes.isEnabled = !!isEnabled;
  if (defaultRoleId !== undefined) {
    if (defaultRoleId && !(await Role.findByPk(defaultRoleId))) {
      throw new ApiError(400, 'Default role does not exist', 'VALIDATION_ERROR');
    }
    changes.defaultRoleId = defaultRoleId || null;
  }

  await provider.update(changes);
  // Issuer or client id may have changed; drop any cached discovery.
  clearDiscoveryCache();
  await writeAudit(req, 'sso.provider_update', 'SsoProvider', provider.id, { fields: Object.keys(changes) });
  res.json({ provider: { ...provider.toJSON(), callbackUrl: callbackUrlFor(provider) } });
});

const removeProvider = asyncHandler(async (req, res) => {
  const provider = await SsoProvider.findByPk(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found', 'NOT_FOUND');

  // Users provisioned through this provider keep their accounts; only the
  // federation link goes away, so nobody's tickets or history are orphaned.
  const linked = await SsoIdentity.count({ where: { providerId: provider.id } });
  await SsoGroupMapping.destroy({ where: { providerId: provider.id } });
  await SsoIdentity.destroy({ where: { providerId: provider.id } });
  await provider.destroy();
  clearDiscoveryCache();

  await writeAudit(req, 'sso.provider_delete', 'SsoProvider', provider.id, { name: provider.name, unlinkedIdentities: linked });
  res.json({ ok: true, unlinkedIdentities: linked });
});

// ---- Group mappings ----

const listMappings = asyncHandler(async (req, res) => {
  const mappings = await SsoGroupMapping.findAll({
    where: { providerId: req.params.id },
    include: [{ model: Role, as: 'role', attributes: ['id', 'name'] }],
    order: [['claimValue', 'ASC']],
  });
  res.json({ mappings });
});

const createMapping = asyncHandler(async (req, res) => {
  const provider = await SsoProvider.findByPk(req.params.id);
  if (!provider) throw new ApiError(404, 'Provider not found', 'NOT_FOUND');

  const { claimValue, roleId } = req.body || {};
  if (!claimValue || !String(claimValue).trim()) {
    throw new ApiError(400, 'Group claim value is required', 'VALIDATION_ERROR');
  }
  if (!(await Role.findByPk(roleId))) throw new ApiError(400, 'Role does not exist', 'VALIDATION_ERROR');

  const value = String(claimValue).trim();
  if (await SsoGroupMapping.findOne({ where: { providerId: provider.id, claimValue: value } })) {
    throw new ApiError(409, 'This group is already mapped for this provider', 'MAPPING_EXISTS');
  }

  const mapping = await SsoGroupMapping.create({ providerId: provider.id, claimValue: value, roleId });
  await writeAudit(req, 'sso.mapping_create', 'SsoGroupMapping', mapping.id, { providerId: provider.id, claimValue: value, roleId });
  res.status(201).json({ mapping });
});

const removeMapping = asyncHandler(async (req, res) => {
  const mapping = await SsoGroupMapping.findOne({
    where: { id: req.params.mappingId, providerId: req.params.id },
  });
  if (!mapping) throw new ApiError(404, 'Mapping not found', 'NOT_FOUND');
  await mapping.destroy();
  await writeAudit(req, 'sso.mapping_delete', 'SsoGroupMapping', mapping.id, { providerId: mapping.providerId });
  res.json({ ok: true });
});

// ---- Enforcement ----

const getEnforcement = asyncHandler(async (req, res) => {
  const settings = await getAllSettings();
  const breakGlass = await User.findAll({
    where: { isBreakGlass: true },
    attributes: ['id', 'username', 'displayName', 'isActive'],
  });
  res.json({
    ssoOnly: settings['sso.enforced'] === 'true',
    breakGlassAccounts: breakGlass,
  });
});

const setEnforcement = asyncHandler(async (req, res) => {
  const { ssoOnly } = req.body || {};

  if (ssoOnly) {
    // Turning this on without a working escape hatch is how an organisation
    // locks itself out of its own helpdesk when an IdP misbehaves.
    const enabledProviders = await SsoProvider.count({ where: { isEnabled: true } });
    if (!enabledProviders) {
      throw new ApiError(400, 'Enable at least one SSO provider before requiring SSO', 'NO_SSO_PROVIDER');
    }
    const breakGlass = await User.count({ where: { isBreakGlass: true, isActive: true, isLocalAccount: true } });
    if (!breakGlass) {
      throw new ApiError(
        400,
        'Designate at least one active local break-glass account before requiring SSO, '
        + 'otherwise a problem with your identity provider would lock everyone out',
        'NO_BREAK_GLASS'
      );
    }
  }

  // Written directly rather than through the generic settings upsert: that
  // path is gated on a WRITABLE_KEYS allow-list which also covers integration
  // secrets, and there is no reason to widen it for one boolean owned by this
  // controller.
  await SystemSettings.upsert({
    key: 'sso.enforced',
    value: ssoOnly ? 'true' : 'false',
    updatedById: req.user?.id || null,
  });
  await writeAudit(req, 'sso.enforcement_update', 'SystemSettings', null, { ssoOnly: !!ssoOnly });
  res.json({ ssoOnly: !!ssoOnly });
});

// Flags an account as exempt from SSO-only enforcement.
const setBreakGlass = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.userId);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  const enabled = !!(req.body || {}).isBreakGlass;
  if (enabled && !user.isLocalAccount) {
    throw new ApiError(
      400,
      'Only local accounts can be break-glass accounts — a directory or SSO account depends on the very system it needs to bypass',
      'NOT_LOCAL_ACCOUNT'
    );
  }

  // Removing the last one while enforcement is on would strand everybody.
  if (!enabled) {
    const settings = await getAllSettings();
    if (settings['sso.enforced'] === 'true') {
      const others = await User.count({
        where: { isBreakGlass: true, isActive: true, isLocalAccount: true },
      });
      if (others <= 1 && user.isBreakGlass) {
        throw new ApiError(400, 'This is the only break-glass account while SSO is required', 'LAST_BREAK_GLASS');
      }
    }
  }

  await user.update({ isBreakGlass: enabled });
  await writeAudit(req, 'sso.break_glass_update', 'User', user.id, { isBreakGlass: enabled });
  res.json({ ok: true, userId: user.id, isBreakGlass: enabled });
});

module.exports = {
  listProviders, getProvider, createProvider, updateProvider, removeProvider,
  listMappings, createMapping, removeMapping,
  getEnforcement, setEnforcement, setBreakGlass,
};
