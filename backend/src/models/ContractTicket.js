const { DataTypes, Model } = require('sequelize');

// Scheduler plumbing only — see LicenseTicket.js's comment.
module.exports = (sequelize) => {
  class ContractTicket extends Model {}

  ContractTicket.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      contractId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      linkedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      linkedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ContractTicket',
      tableName: 'ContractTickets',
      timestamps: false,
    }
  );

  return ContractTicket;
};
