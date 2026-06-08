const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class CsatResponse extends Model {}

  CsatResponse.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      rating: {
        type: DataTypes.ENUM('happy', 'neutral', 'unhappy'),
        allowNull: false,
      },
      comment: { type: DataTypes.TEXT, allowNull: true },
      respondedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'CsatResponse',
      tableName: 'CsatResponses',
      timestamps: false,
    }
  );

  return CsatResponse;
};
