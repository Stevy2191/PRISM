const { DataTypes, Model } = require('sequelize');

// A one-time client-portal link: an invite (set your first password) or a
// password reset. Only the sha256 of the token is stored; the token itself
// exists only in the email. Spent once used or past expiresAt.
module.exports = (sequelize) => {
  class PortalToken extends Model {}

  PortalToken.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.ENUM('invite', 'reset'), allowNull: false },
      tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'PortalToken',
      tableName: 'PortalTokens',
      timestamps: true,
      updatedAt: false,
    }
  );

  return PortalToken;
};
