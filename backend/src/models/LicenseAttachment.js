const { DataTypes, Model } = require('sequelize');

// One model per parent type (same convention as AssetAttachment/ProjectFile)
// rather than a polymorphic FK.
module.exports = (sequelize) => {
  class LicenseAttachment extends Model {}

  LicenseAttachment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenseId: { type: DataTypes.INTEGER, allowNull: false },
      filename: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      mimeType: { type: DataTypes.STRING(100), allowNull: true },
      size: { type: DataTypes.INTEGER, allowNull: true },
      uploadedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LicenseAttachment',
      tableName: 'LicenseAttachments',
      timestamps: true,
      updatedAt: false,
    }
  );

  return LicenseAttachment;
};
