const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AssetTicket extends Model {}

  AssetTicket.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      linkedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      linkedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AssetTicket',
      tableName: 'AssetTickets',
      timestamps: false,
    }
  );

  return AssetTicket;
};
