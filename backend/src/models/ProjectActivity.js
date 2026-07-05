const { DataTypes, Model } = require('sequelize');

// Per-project activity timeline (Activity tab) — mirrors TicketActivity's
// role but stores a JSON `detail` blob instead of fromValue/toValue, since
// project events vary more in shape (task created, expense added, etc.).
module.exports = (sequelize) => {
  class ProjectActivity extends Model {}

  ProjectActivity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      action: { type: DataTypes.STRING(100), allowNull: false },
      detail: { type: DataTypes.JSON, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ProjectActivity',
      tableName: 'ProjectActivities',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ProjectActivity;
};
