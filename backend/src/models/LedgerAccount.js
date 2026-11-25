const { DataTypes, Model } = require('sequelize');

// An account in the ledger's fixed chart (Phase 3, level A books).
module.exports = (sequelize) => {
  class LedgerAccount extends Model {}
  LedgerAccount.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      code: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      type: { type: DataTypes.ENUM('asset', 'liability', 'income', 'expense', 'equity'), allowNull: false },
      system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { sequelize, modelName: 'LedgerAccount', tableName: 'LedgerAccounts' }
  );
  return LedgerAccount;
};
