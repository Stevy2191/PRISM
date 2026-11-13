const { DataTypes, Model } = require('sequelize');

// A help-desk notice shown in the PRISM agent (migration 088): for one
// company's computers, or every company's when companyId is null.
module.exports = (sequelize) => {
  class AgentNotice extends Model {}

  AgentNotice.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: true },
      headline: { type: DataTypes.STRING(120), allowNull: false },
      message: { type: DataTypes.STRING(500), allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      removedAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize, modelName: 'AgentNotice', tableName: 'AgentNotices', timestamps: true,
    }
  );

  return AgentNotice;
};
