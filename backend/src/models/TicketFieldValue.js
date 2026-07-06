const { DataTypes, Model } = require('sequelize');

// Stores a ticket's value for an admin-defined CustomField.
module.exports = (sequelize) => {
  class TicketFieldValue extends Model {}

  TicketFieldValue.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      fieldId: { type: DataTypes.INTEGER, allowNull: false },
      // All values are stored as text; the field definition drives interpretation.
      value: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'TicketFieldValue',
      tableName: 'TicketFieldValues',
      timestamps: true,
      indexes: [{ unique: true, fields: ['ticketId', 'fieldId'] }],
    }
  );

  return TicketFieldValue;
};
