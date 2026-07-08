const { DataTypes, Model } = require('sequelize');

// A saved custom-report-builder configuration — distinct from
// SavedReportView (which only stores a filter combination for one of the
// existing fixed reports). This stores the whole builder state so a saved
// custom report can be re-run or re-opened for editing.
module.exports = (sequelize) => {
  class SavedCustomReport extends Model {}

  SavedCustomReport.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      dataSource: { type: DataTypes.STRING(50), allowNull: false },
      fields: { type: DataTypes.JSON, allowNull: false },
      filters: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      groupBy: { type: DataTypes.STRING(50), allowNull: true },
      visualization: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'table' },
      lastRunAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'SavedCustomReport',
      tableName: 'SavedCustomReports',
      timestamps: true,
    }
  );

  return SavedCustomReport;
};
