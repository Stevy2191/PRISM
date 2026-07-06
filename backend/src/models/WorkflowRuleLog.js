const { DataTypes, Model } = require('sequelize');

// One execution attempt of a WorkflowRule against a ticket — fired whether
// or not conditions actually matched, so admins can debug "why didn't this
// rule fire" from the log alone.
module.exports = (sequelize) => {
  class WorkflowRuleLog extends Model {}

  WorkflowRuleLog.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ruleId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      triggeredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      conditionsMet: { type: DataTypes.BOOLEAN, allowNull: false },
      // Array of action type strings actually executed (empty if conditions
      // didn't match, or an action was skipped due to an error).
      actionsExecuted: { type: DataTypes.JSON, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'WorkflowRuleLog',
      tableName: 'WorkflowRuleLogs',
      timestamps: true,
      updatedAt: false,
    }
  );

  return WorkflowRuleLog;
};
