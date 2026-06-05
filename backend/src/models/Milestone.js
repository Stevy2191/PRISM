const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Milestone extends Model {}

  Milestone.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      completed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'Milestone',
      tableName: 'Milestones',
      timestamps: true,
      updatedAt: false,
    }
  );

  return Milestone;
};
