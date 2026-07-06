const { DataTypes, Model } = require('sequelize');

// One condition on a WorkflowRule, e.g. { field: 'priority', operator:
// 'equals', value: 'critical' }. All conditions on a rule are combined per
// the rule's conditionMatch (ALL/ANY).
module.exports = (sequelize) => {
  class WorkflowCondition extends Model {}

  WorkflowCondition.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ruleId: { type: DataTypes.INTEGER, allowNull: false },
      field: { type: DataTypes.STRING(100), allowNull: false },
      operator: {
        type: DataTypes.ENUM(
          'equals', 'not_equals', 'contains', 'not_contains',
          'is_empty', 'is_not_empty', 'greater_than', 'less_than'
        ),
        allowNull: false,
      },
      value: { type: DataTypes.TEXT, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'WorkflowCondition',
      tableName: 'WorkflowConditions',
      timestamps: true,
      updatedAt: false,
    }
  );

  return WorkflowCondition;
};
