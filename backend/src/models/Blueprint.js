const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Blueprint extends Model {}

  Blueprint.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      defaultTitle: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      defaultDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      defaultPriority: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: true,
      },
      defaultType: {
        type: DataTypes.ENUM('incident', 'request', 'problem', 'task', 'change'),
        allowNull: true,
      },
      defaultDepartmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Array of field definitions:
      //   { name, label, type: text|textarea|number|select|checkbox|date,
      //     options?: string[], required?: boolean }
      customFields: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },
      createdById: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Blueprint',
      tableName: 'Blueprints',
      timestamps: true,
    }
  );

  return Blueprint;
};
