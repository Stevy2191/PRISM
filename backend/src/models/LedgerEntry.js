const { DataTypes, Model } = require('sequelize');

// A ledger entry (Phase 3): written once by services/money/ledger.js and
// never changed or deleted; a correction is a reversing entry.
const neverChanged = () => { throw new Error('Ledger entries are never changed; post a reversal instead'); };

module.exports = (sequelize) => {
  class LedgerEntry extends Model {}
  LedgerEntry.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      entryDate: { type: DataTypes.DATEONLY, allowNull: false },
      memo: { type: DataTypes.STRING(255), allowNull: true },
      sourceType: { type: DataTypes.STRING(40), allowNull: false },
      sourceId: { type: DataTypes.INTEGER, allowNull: true },
      companyId: { type: DataTypes.INTEGER, allowNull: true },
      reversesId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'LedgerEntry',
      tableName: 'LedgerEntries',
      updatedAt: false,
      hooks: {
        beforeUpdate: neverChanged, beforeDestroy: neverChanged, beforeBulkUpdate: neverChanged, beforeBulkDestroy: neverChanged,
      },
    }
  );
  return LedgerEntry;
};
