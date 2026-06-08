const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Team extends Model {}

  Team.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Team',
      tableName: 'Teams',
      timestamps: true,
      updatedAt: false,
    }
  );

  return Team;
};
