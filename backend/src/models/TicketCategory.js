const { DataTypes, Model } = require('sequelize');

// One node of a company's ticket category tree (5c; per company since 9). Depth (≤ 5), unique
// sibling names and cycles are enforced in the controller; see
// services/tickets/categoryTree.js for the tree helpers.
module.exports = (sequelize) => {
  class TicketCategory extends Model {}

  TicketCategory.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      parentId: { type: DataTypes.INTEGER, allowNull: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      requireChild: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, modelName: 'TicketCategory', tableName: 'TicketCategories', timestamps: true }
  );

  return TicketCategory;
};
