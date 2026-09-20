const { DataTypes, Model } = require('sequelize');

// An identity provider PRISM federates with. `config` is protocol-specific
// JSON; secrets live in their own columns, encrypted by utils/tokenCrypto, so
// they are never serialized alongside the rest of the configuration.
module.exports = (sequelize) => {
  class SsoProvider extends Model {
    // Secrets must never reach the client, the same way User strips
    // passwordHash. The settings UI shows only whether one is set.
    toJSON() {
      const values = { ...this.get() };
      values.hasClientSecret = !!values.clientSecret;
      values.hasSpPrivateKey = !!values.spPrivateKey;
      delete values.clientSecret;
      delete values.spPrivateKey;
      values.config = this.parsedConfig();
      return values;
    }

    // `config` is stored as TEXT so the column works identically across the
    // MariaDB versions this app supports; parsing is centralized here.
    parsedConfig() {
      if (!this.config) return {};
      try {
        return JSON.parse(this.config);
      } catch {
        return {};
      }
    }
  }

  SsoProvider.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      slug: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      protocol: { type: DataTypes.ENUM('oidc', 'saml'), allowNull: false },
      isEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      buttonLabel: { type: DataTypes.STRING(80), allowNull: true },
      config: { type: DataTypes.TEXT('long'), allowNull: true },
      clientSecret: { type: DataTypes.TEXT, allowNull: true },
      spPrivateKey: { type: DataTypes.TEXT, allowNull: true },
      allowJit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      defaultRoleId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'SsoProvider', tableName: 'SsoProviders', timestamps: true }
  );

  return SsoProvider;
};
