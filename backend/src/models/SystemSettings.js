const { DataTypes, Model } = require('sequelize');

// Key/value store for global configuration (company info, branding, etc.).
// Values are stored as text; structured values are JSON-encoded by the caller.
module.exports = (sequelize) => {
  class SystemSettings extends Model {}

  SystemSettings.init(
    {
      key: {
        type: DataTypes.STRING(191),
        primaryKey: true,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      updatedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'SystemSettings',
      tableName: 'SystemSettings',
      timestamps: true,
      createdAt: false,
    }
  );

  return SystemSettings;
};
