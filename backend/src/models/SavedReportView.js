const { DataTypes, Model } = require('sequelize');

// A user's saved filter combination (date range, department, assignee) for
// one specific report — mirrors SavedFilter (tickets), scoped per report.
module.exports = (sequelize) => {
  class SavedReportView extends Model {}

  SavedReportView.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      reportType: { type: DataTypes.STRING(50), allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      filters: { type: DataTypes.JSON, allowNull: false },
    },
    {
      sequelize,
      modelName: 'SavedReportView',
      tableName: 'SavedReportViews',
      timestamps: true,
      updatedAt: false,
    }
  );

  return SavedReportView;
};
