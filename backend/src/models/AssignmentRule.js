const { DataTypes, Model } = require('sequelize');

// Simple auto-assignment rules, deliberately separate from the full
// Workflow Rules engine — three fixed, optional AND'd conditions (ticket
// type / department / priority, null = "any") -> assign to a user or a
// team. Evaluated in `position` order on ticket creation, first match wins;
// only applied when the ticket wasn't already given an explicit
// assignee/team. See ticketsController.js's create handler.
module.exports = (sequelize) => {
  class AssignmentRule extends Model {}

  AssignmentRule.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ticketType: { type: DataTypes.ENUM('incident', 'request', 'problem', 'change'), allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      priority: { type: DataTypes.ENUM('critical', 'high', 'medium', 'low'), allowNull: true },
      assigneeId: { type: DataTypes.INTEGER, allowNull: true },
      teamId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssignmentRule',
      tableName: 'AssignmentRules',
      timestamps: true,
    }
  );

  return AssignmentRule;
};
