const { DataTypes, Model } = require('sequelize');

// Admin-defined custom fields that appear dynamically on ticket forms.
// Applicability is scoped by ticketType and/or department (null = applies to all).
module.exports = (sequelize) => {
  class CustomField extends Model {}

  CustomField.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      fieldType: {
        type: DataTypes.ENUM('text', 'textarea', 'number', 'select', 'checkbox', 'date', 'url'),
        allowNull: false,
        defaultValue: 'text',
      },
      // JSON array of options (for select fields).
      options: { type: DataTypes.JSON, allowNull: true },
      required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // null = applies to every ticket type.
      ticketType: {
        type: DataTypes.ENUM('incident', 'request', 'problem', 'task', 'change'),
        allowNull: true,
      },
      // null = applies to every department.
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      displayOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'CustomField',
      tableName: 'CustomFields',
      timestamps: true,
      updatedAt: false,
    }
  );

  return CustomField;
};
