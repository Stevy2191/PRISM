const { DataTypes, Model } = require('sequelize');

// Maps an AD group (by name/CN) to a PRISM department — a synced contact who
// is a member of a mapped group gets that department assigned.
module.exports = (sequelize) => {
  class AdGroupMapping extends Model {}

  AdGroupMapping.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      adGroupName: { type: DataTypes.STRING(255), allowNull: false },
      departmentId: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'AdGroupMapping',
      tableName: 'AdGroupMappings',
      timestamps: true,
      updatedAt: false,
    }
  );

  return AdGroupMapping;
};
