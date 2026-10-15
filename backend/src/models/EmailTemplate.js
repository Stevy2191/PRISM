const { DataTypes, Model } = require('sequelize');

// An admin's override of one code-defined email template (see
// services/email/catalog.js). No row = the default; "Reset to default"
// deletes the row. bodyHtml is sanitized on save.
module.exports = (sequelize) => {
  class EmailTemplate extends Model {}

  EmailTemplate.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      key: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      subject: { type: DataTypes.STRING(255), allowNull: false },
      bodyHtml: { type: DataTypes.TEXT, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      updatedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'EmailTemplate',
      tableName: 'EmailTemplates',
      timestamps: true,
    }
  );

  return EmailTemplate;
};
