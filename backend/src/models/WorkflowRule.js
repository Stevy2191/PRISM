const { DataTypes, Model } = require('sequelize');

// Admin-defined automation rule: fires `triggerEvent`, checks its
// WorkflowConditions (ALL/ANY per conditionMatch), then runs its
// WorkflowActions in position order. See services/workflowEngine.js.
module.exports = (sequelize) => {
  class WorkflowRule extends Model {}

  WorkflowRule.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      triggerEvent: {
        type: DataTypes.ENUM(
          'ticket_created', 'ticket_updated', 'ticket_status_changed', 'ticket_priority_changed',
          'ticket_assigned', 'ticket_comment_added', 'ticket_due_date_approaching', 'ticket_overdue',
          'ticket_closed'
        ),
        allowNull: false,
      },
      conditionMatch: { type: DataTypes.ENUM('all', 'any'), allowNull: false, defaultValue: 'all' },
      // e.g. { hoursBefore: 24 } for ticket_due_date_approaching.
      triggerConfig: { type: DataTypes.JSON, allowNull: true },
      lastTriggeredAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'WorkflowRule',
      tableName: 'WorkflowRules',
      timestamps: true,
    }
  );

  return WorkflowRule;
};
