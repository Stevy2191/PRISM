const { DataTypes, Model } = require('sequelize');

// One saved definition of a Form (PB). Never edited after it is made.
// definition: { sections: [{ key, title, showWhen?, items: [...] }] }, checked
// by services/playbooks/formDefinition.js.
module.exports = (sequelize) => {
  class FormVersion extends Model {}

  FormVersion.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      formId: { type: DataTypes.INTEGER, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false },
      definition: { type: DataTypes.JSON, allowNull: false },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize, modelName: 'FormVersion', tableName: 'FormVersions', timestamps: true, updatedAt: false,
    }
  );

  return FormVersion;
};
