const { DataTypes, Model } = require('sequelize');

// "This account on this computer is that contact" (migration 090), for
// people whose sign-in carries no email PRISM can match.
module.exports = (sequelize) => {
  class AgentUserLink extends Model {}

  AgentUserLink.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      deviceId: { type: DataTypes.INTEGER, allowNull: false },
      account: { type: DataTypes.STRING(255), allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'staff' },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize, modelName: 'AgentUserLink', tableName: 'AgentUserLinks', timestamps: true,
    }
  );

  return AgentUserLink;
};
