const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectExpense extends Model {}

  ProjectExpense.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      description: { type: DataTypes.STRING(500), allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      category: {
        type: DataTypes.ENUM('materials', 'labor', 'travel', 'equipment', 'other'),
        allowNull: false,
        defaultValue: 'other',
      },
      entryDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: () => new Date().toISOString().slice(0, 10),
      },
      loggedBy: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'ProjectExpense',
      tableName: 'ProjectExpenses',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ProjectExpense;
};
