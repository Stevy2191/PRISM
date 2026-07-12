const { DataTypes, Model } = require('sequelize');

// Separate from the ticket-only `Attachment` model — this codebase's
// established pattern is one model per parent type (see ProjectFile as the
// project-attachment equivalent) rather than a polymorphic FK.
module.exports = (sequelize) => {
  class AssetAttachment extends Model {}

  AssetAttachment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      filename: { type: DataTypes.STRING(255), allowNull: false },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      mimeType: { type: DataTypes.STRING(100), allowNull: true },
      size: { type: DataTypes.INTEGER, allowNull: true },
      uploadedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssetAttachment',
      tableName: 'AssetAttachments',
      timestamps: true,
      updatedAt: false,
    }
  );

  return AssetAttachment;
};
