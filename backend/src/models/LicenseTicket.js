const { DataTypes, Model } = require('sequelize');

// Scheduler plumbing only (see licenseContractAlertScheduler.js) — traces an
// auto-created expiry-reminder ticket back to its license so the scheduler
// can check whether that ticket is still open before creating a duplicate.
module.exports = (sequelize) => {
  class LicenseTicket extends Model {}

  LicenseTicket.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenseId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      linkedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      linkedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LicenseTicket',
      tableName: 'LicenseTickets',
      timestamps: false,
    }
  );

  return LicenseTicket;
};
