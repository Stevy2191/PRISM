const { DataTypes, Model } = require('sequelize');

// Links an IdP subject to a PRISM user. Unique on (providerId, subject), and
// separate from Users because one person may hold identities at more than one
// provider.
module.exports = (sequelize) => {
  class SsoIdentity extends Model {}

  SsoIdentity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      providerId: { type: DataTypes.INTEGER, allowNull: false },
      // OIDC `sub` / SAML NameID. Stable and opaque — email is deliberately
      // not used to decide identity.
      subject: { type: DataTypes.STRING(255), allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'SsoIdentity',
      tableName: 'SsoIdentities',
      timestamps: true,
      indexes: [{ unique: true, fields: ['providerId', 'subject'] }],
    }
  );

  return SsoIdentity;
};
