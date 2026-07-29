const { DataTypes, Model } = require('sequelize');

// File attached to a KB article (uploaded how-to / PDF / Word doc). One model
// per parent type, same convention as LicenseAttachment/AssetAttachment.
// Stored on disk under {UPLOAD_ROOT}/knowledge/{articleId}/.
module.exports = (sequelize) => {
  class KbAttachment extends Model {}

  KbAttachment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      articleId: { type: DataTypes.INTEGER, allowNull: false },
      filename: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      mimeType: { type: DataTypes.STRING(100), allowNull: true },
      size: { type: DataTypes.INTEGER, allowNull: true },
      uploadedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'KbAttachment',
      tableName: 'KbAttachments',
      timestamps: true,
      updatedAt: false,
    }
  );

  return KbAttachment;
};
