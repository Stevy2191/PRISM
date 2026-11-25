const { DataTypes, Model } = require('sequelize');

// A contractor's or supplier's bill (Phase 3, step 2): received → entered
// (owed; posted to the ledger) → paid, or void (reversed).
module.exports = (sequelize) => {
  class Bill extends Model {}
  Bill.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      vendorCompanyId: { type: DataTypes.INTEGER, allowNull: false },
      billNumber: { type: DataTypes.STRING(100), allowNull: false },
      billDate: { type: DataTypes.DATEONLY, allowNull: false },
      dueDate: { type: DataTypes.DATEONLY, allowNull: true },
      status: { type: DataTypes.ENUM('received', 'entered', 'paid', 'void'), allowNull: false, defaultValue: 'received' },
      externalRef: { type: DataTypes.STRING(100), allowNull: true },
      total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      paidOn: { type: DataTypes.DATEONLY, allowNull: true },
      paidMethod: { type: DataTypes.STRING(40), allowNull: true },
      paidRef: { type: DataTypes.STRING(100), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      fileName: { type: DataTypes.STRING(255), allowNull: true },
      filePath: { type: DataTypes.STRING(255), allowNull: true },
      ledgerEntryId: { type: DataTypes.INTEGER, allowNull: true },
      paymentEntryId: { type: DataTypes.INTEGER, allowNull: true },
      voidReason: { type: DataTypes.STRING(255), allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Bill', tableName: 'Bills' }
  );
  return Bill;
};
