const { DataTypes, Model } = require('sequelize');

// Admin-defined custom fields that appear dynamically on ticket forms.
// Scoped by ticketTypes (null/empty = applies to every ticket type).
module.exports = (sequelize) => {
  class CustomField extends Model {}

  CustomField.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      label: { type: DataTypes.STRING(255), allowNull: false },
      // Auto-generated slug from label on create (e.g. "asset_tag"); editable,
      // must stay unique and match ^[a-z0-9_]+$.
      fieldKey: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      fieldType: {
        type: DataTypes.ENUM(
          'text', 'textarea', 'number', 'date', 'datetime',
          'dropdown', 'multiselect', 'checkbox', 'url', 'email', 'phone'
        ),
        allowNull: false,
        defaultValue: 'text',
      },
      // JSON array of ticket type strings; null/empty = every type.
      ticketTypes: { type: DataTypes.JSON, allowNull: true },
      isRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      placeholder: { type: DataTypes.STRING(255), allowNull: true },
      defaultValue: { type: DataTypes.TEXT, allowNull: true },
      // JSON array of option strings (dropdown/multiselect only).
      options: { type: DataTypes.JSON, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'CustomField',
      tableName: 'CustomFields',
      timestamps: true,
    }
  );

  return CustomField;
};
