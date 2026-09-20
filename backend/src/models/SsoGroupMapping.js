const { DataTypes, Model } = require('sequelize');

// Maps a group/role claim value asserted by an IdP to a PRISM role. Applied on
// every login, so removing a user from a group at the IdP revokes the role
// here on their next sign-in.
module.exports = (sequelize) => {
  class SsoGroupMapping extends Model {}

  SsoGroupMapping.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      providerId: { type: DataTypes.INTEGER, allowNull: false },
      claimValue: { type: DataTypes.STRING(255), allowNull: false },
      roleId: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'SsoGroupMapping',
      tableName: 'SsoGroupMappings',
      timestamps: true,
      indexes: [{ unique: true, fields: ['providerId', 'claimValue'] }],
    }
  );

  return SsoGroupMapping;
};
