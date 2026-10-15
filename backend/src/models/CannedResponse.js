const { DataTypes, Model } = require('sequelize');

// A reusable reply text (plain text with {{placeholders}}). Personal ones
// belong to one user and stay private; team ones are visible to the team's
// members and everyone ones to every staff user.
module.exports = (sequelize) => {
  class CannedResponse extends Model {}

  CannedResponse.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(200), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      visibility: { type: DataTypes.ENUM('personal', 'team', 'everyone'), allowNull: false, defaultValue: 'personal' },
      ownerId: { type: DataTypes.INTEGER, allowNull: false },
      teamId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'CannedResponse', tableName: 'CannedResponses', timestamps: true }
  );

  return CannedResponse;
};
