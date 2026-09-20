'use strict';

// Single sign-on — SAML 2.0 and OIDC, alongside the existing local-account and
// LDAP authentication. Follows the conventions of the Assets/Licenses/KB
// migrations: no DB-level FK constraints (plain INTEGER FK columns + Sequelize
// associations), idempotent createTable/addColumn guards.
//
// See docs/superpowers/specs/2026-09-20-prism-sso-design.md.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

    // ---- Providers ----
    // One row per identity provider. `config` holds the protocol-specific
    // settings as JSON; secrets live in their own encrypted columns so they
    // are never accidentally serialized with the rest of the config.
    if (!tables.includes('SsoProviders')) {
      await queryInterface.createTable('SsoProviders', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(150), allowNull: false },
        // Appears in callback URLs, so it is URL-safe and stable.
        slug: { type: dt.STRING(60), allowNull: false, unique: true },
        protocol: { type: dt.ENUM('oidc', 'saml'), allowNull: false },
        isEnabled: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        buttonLabel: { type: dt.STRING(80), allowNull: true },
        config: { type: dt.TEXT('long'), allowNull: true },
        // Encrypted via utils/tokenCrypto — never read back to the UI.
        clientSecret: { type: dt.TEXT, allowNull: true },
        spPrivateKey: { type: dt.TEXT, allowNull: true },
        // When false, a subject with no existing identity is refused rather
        // than provisioned.
        allowJit: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        // Applied to JIT users when no group mapping matches. Null means the
        // user arrives with no permissions at all.
        defaultRoleId: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
    }

    // ---- Identities ----
    // (provider, subject) -> user. A table rather than a column on Users
    // because one person may hold identities at more than one provider.
    if (!tables.includes('SsoIdentities')) {
      await queryInterface.createTable('SsoIdentities', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        providerId: { type: dt.INTEGER, allowNull: false },
        // The IdP's stable subject claim (OIDC `sub` / SAML NameID). Email is
        // deliberately not used for matching.
        subject: { type: dt.STRING(255), allowNull: false },
        userId: { type: dt.INTEGER, allowNull: false },
        lastLoginAt: { type: dt.DATE, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('SsoIdentities', ['providerId', 'subject'], {
        unique: true, name: 'sso_identities_provider_subject',
      });
      await queryInterface.addIndex('SsoIdentities', ['userId'], { name: 'sso_identities_user' });
    }

    // ---- Group mappings ----
    // IdP group/role claim value -> PRISM role. Re-evaluated on every login,
    // so removing someone from a group in the IdP revokes in PRISM.
    if (!tables.includes('SsoGroupMappings')) {
      await queryInterface.createTable('SsoGroupMappings', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        providerId: { type: dt.INTEGER, allowNull: false },
        claimValue: { type: dt.STRING(255), allowNull: false },
        roleId: { type: dt.INTEGER, allowNull: false },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('SsoGroupMappings', ['providerId', 'claimValue'], {
        unique: true, name: 'sso_group_mappings_provider_claim',
      });
    }

    // ---- In-flight login state ----
    // Kept server-side rather than in the session: SAML's HTTP-POST binding
    // returns a cross-site POST, which the browser will not accompany with a
    // sameSite=lax session cookie. Keying on `state` also gives OIDC
    // single-use, expiring state through the same code path.
    if (!tables.includes('SsoAuthRequests')) {
      await queryInterface.createTable('SsoAuthRequests', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        state: { type: dt.STRING(128), allowNull: false, unique: true },
        providerId: { type: dt.INTEGER, allowNull: false },
        nonce: { type: dt.STRING(128), allowNull: true },
        codeVerifier: { type: dt.STRING(255), allowNull: true },
        // Where to send the browser once authenticated. Validated as a
        // same-site path before use.
        returnTo: { type: dt.STRING(500), allowNull: true },
        expiresAt: { type: dt.DATE, allowNull: false },
        // Set the moment the request is redeemed, making it single-use.
        consumedAt: { type: dt.DATE, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('SsoAuthRequests', ['expiresAt'], { name: 'sso_auth_requests_expires' });
    }

    // ---- Break-glass flag ----
    // Exempt from "SSO only" enforcement, so a misconfigured IdP cannot lock
    // an organisation out of its own helpdesk.
    const userColumns = await queryInterface.describeTable('Users');
    if (!userColumns.isBreakGlass) {
      await queryInterface.addColumn('Users', 'isBreakGlass', {
        type: dt.BOOLEAN, allowNull: false, defaultValue: false,
      });
    }
  },

  down: async (queryInterface) => {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    for (const table of ['SsoAuthRequests', 'SsoGroupMappings', 'SsoIdentities', 'SsoProviders']) {
      if (tables.includes(table)) await queryInterface.dropTable(table);
    }
    const userColumns = await queryInterface.describeTable('Users');
    if (userColumns.isBreakGlass) await queryInterface.removeColumn('Users', 'isBreakGlass');
  },
};
