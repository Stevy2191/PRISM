const { DataTypes, Model } = require('sequelize');

// A reusable form (PB): sections of text, steps, fields and secure fields.
// Its definitions live in FormVersions; every save makes a new version, and
// a ticket form keeps the version it was created from.
// usage: 'ticket' (once per ticket) or 'device' (once per device, with
// device conditions and device actions).
module.exports = (sequelize) => {
  class Form extends Model {}

  Form.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      usage: { type: DataTypes.ENUM('ticket', 'device'), allowNull: false },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      currentVersionId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Form', tableName: 'Forms', timestamps: true }
  );

  return Form;
};
