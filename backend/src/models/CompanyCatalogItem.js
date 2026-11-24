const { DataTypes, Model } = require('sequelize');

// One entry on a company's list (9): an app its people use, for now. A
// category step can ask "which app?" and the ticket records the answer.
module.exports = (sequelize) => {
  class CompanyCatalogItem extends Model {}

  CompanyCatalogItem.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      kind: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'software' },
      name: { type: DataTypes.STRING(255), allowNull: false },
      publisher: { type: DataTypes.STRING(255), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'CompanyCatalogItem', tableName: 'CompanyCatalogItems' }
  );

  return CompanyCatalogItem;
};
