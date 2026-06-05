const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Attachment extends Model {}

  Attachment.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      filename: {
        // On-disk name (unique, generated).
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      originalName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      mimeType: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      size: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      uploadedById: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'Attachment',
      tableName: 'Attachments',
      timestamps: true,
      updatedAt: false,
    }
  );

  return Attachment;
};
