const { DataTypes, Model } = require('sequelize');

// One action on a WorkflowRule, executed in position order when the rule's
// conditions match. actionValue shape depends on actionType — see
// services/workflowEngine.js's executeAction() for the contract.
module.exports = (sequelize) => {
  class WorkflowAction extends Model {}

  WorkflowAction.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ruleId: { type: DataTypes.INTEGER, allowNull: false },
      actionType: {
        type: DataTypes.ENUM(
          'assign_to_user', 'assign_to_team', 'assign_round_robin', 'set_status', 'set_priority',
          'add_tag', 'remove_tag', 'set_due_date', 'send_notification', 'add_private_comment',
          'escalate_to_user'
        ),
        allowNull: false,
      },
      actionValue: { type: DataTypes.JSON, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'WorkflowAction',
      tableName: 'WorkflowActions',
      timestamps: true,
      updatedAt: false,
    }
  );

  return WorkflowAction;
};
