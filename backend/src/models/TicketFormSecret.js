const { DataTypes, Model } = require('sequelize');

// A secure value recorded on a ticket form (PB): encrypted with
// utils/tokenCrypto, returned only by the reveal endpoint. The default scope
// leaves the ciphertext out so nothing else can send it by accident.
module.exports = (sequelize) => {
  class TicketFormSecret extends Model {}

  TicketFormSecret.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketFormId: { type: DataTypes.INTEGER, allowNull: false },
      itemKey: { type: DataTypes.STRING(60), allowNull: false },
      ciphertext: { type: DataTypes.TEXT, allowNull: false },
      setBy: { type: DataTypes.INTEGER, allowNull: true },
      setAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'TicketFormSecret',
      tableName: 'TicketFormSecrets',
      timestamps: false,
      defaultScope: { attributes: { exclude: ['ciphertext'] } },
      scopes: { withCiphertext: { attributes: { include: ['ciphertext'] } } },
    }
  );

  return TicketFormSecret;
};
