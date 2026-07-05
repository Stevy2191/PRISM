const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectSubtask extends Model {}

  ProjectSubtask.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      taskId: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      statusId: { type: DataTypes.INTEGER, allowNull: false },
      assignedToUserId: { type: DataTypes.INTEGER, allowNull: true },
      dueDate: { type: DataTypes.DATEONLY, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'ProjectSubtask',
      tableName: 'ProjectSubtasks',
      timestamps: true,
    }
  );

  return ProjectSubtask;
};
