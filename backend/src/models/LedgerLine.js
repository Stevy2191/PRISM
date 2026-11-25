const { DataTypes, Model } = require('sequelize');

// One side of a ledger entry: a debit or a credit on one account.
const neverChanged = () => { throw new Error('Ledger entries are never changed; post a reversal instead'); };

module.exports = (sequelize) => {
  class LedgerLine extends Model {}
  LedgerLine.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      entryId: { type: DataTypes.INTEGER, allowNull: false },
      accountId: { type: DataTypes.INTEGER, allowNull: false },
      debit: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      credit: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'LedgerLine',
      tableName: 'LedgerLines',
      timestamps: false,
      hooks: {
        beforeUpdate: neverChanged, beforeDestroy: neverChanged, beforeBulkUpdate: neverChanged, beforeBulkDestroy: neverChanged,
      },
    }
  );
  return LedgerLine;
};
