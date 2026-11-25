const { DataTypes, Model } = require('sequelize');

// A purchase order (Phase 3, step 2): draft → ordered → partly received →
// received, or cancelled. For a ticket, a project, or the shelf.
module.exports = (sequelize) => {
  class PurchaseOrder extends Model {}
  PurchaseOrder.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      number: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      vendorCompanyId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.ENUM('draft', 'ordered', 'partly_received', 'received', 'cancelled'), allowNull: false, defaultValue: 'draft' },
      orderedOn: { type: DataTypes.DATEONLY, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'PurchaseOrder', tableName: 'PurchaseOrders' }
  );
  return PurchaseOrder;
};
