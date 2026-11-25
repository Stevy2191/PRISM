'use strict';

// Purchase orders (Phase 3, step 2): ordered from a vendor for a job (or for
// the shelf), received in full or in part.
//   + PurchaseOrders, PurchaseOrderLines.
//   + CatalogProducts.assetCategoryId: what a serialized product becomes.
//   + foreign keys from BillLines and ProjectMaterials to the PO line.

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const LINKS = [['BillLines', 'purchaseOrderLineId', 'bill_lines_po_line'], ['ProjectMaterials', 'poLineId', 'materials_po_line']];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const fk = (model, onDelete = 'SET NULL', allowNull = true) => ({
      type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onDelete,
    });
    const tables = await tableNames(qi);
    if (!tables.includes('PurchaseOrders')) {
      await qi.createTable('PurchaseOrders', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        number: { type: dt.STRING(20), allowNull: false, unique: true },
        vendorCompanyId: fk('Companies', 'RESTRICT', false),
        ticketId: fk('Tickets'),
        projectId: fk('Projects'),
        status: { type: dt.ENUM('draft', 'ordered', 'partly_received', 'received', 'cancelled'), allowNull: false, defaultValue: 'draft' },
        orderedOn: { type: dt.DATEONLY, allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdBy: fk('Users'),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('PurchaseOrderLines')) {
      await qi.createTable('PurchaseOrderLines', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        purchaseOrderId: fk('PurchaseOrders', 'CASCADE', false),
        catalogProductId: fk('CatalogProducts'),
        description: { type: dt.STRING(500), allowNull: false },
        quantity: { type: dt.DECIMAL(12, 4), allowNull: false },
        unitCost: { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
        forStock: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        receivedQuantity: { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      });
    }
    const cp = await qi.describeTable('CatalogProducts');
    if (!cp.assetCategoryId) await qi.addColumn('CatalogProducts', 'assetCategoryId', fk('AssetCategories'));
    for (const [table, column, name] of LINKS) {
      // eslint-disable-next-line no-await-in-loop
      const fks = await qi.getForeignKeyReferencesForTable(table);
      if (!fks.some((f) => f.columnName === column)) {
        // eslint-disable-next-line no-await-in-loop
        await qi.addConstraint(table, {
          fields: [column], type: 'foreign key', name, references: { table: 'PurchaseOrderLines', field: 'id' }, onDelete: 'SET NULL',
        });
      }
    }
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    for (const [table, column] of LINKS) {
      // eslint-disable-next-line no-await-in-loop
      const fks = await qi.getForeignKeyReferencesForTable(table);
      const fk = fks.find((f) => f.columnName === column);
      if (fk) await qi.removeConstraint(table, fk.constraintName); // eslint-disable-line no-await-in-loop
    }
    const cp = await qi.describeTable('CatalogProducts');
    if (cp.assetCategoryId) {
      const fks = await qi.getForeignKeyReferencesForTable('CatalogProducts');
      const fk = fks.find((f) => f.columnName === 'assetCategoryId');
      if (fk) await qi.removeConstraint('CatalogProducts', fk.constraintName);
      await qi.removeColumn('CatalogProducts', 'assetCategoryId');
    }
    const tables = await tableNames(qi);
    if (tables.includes('PurchaseOrderLines')) await qi.dropTable('PurchaseOrderLines');
    if (tables.includes('PurchaseOrders')) await qi.dropTable('PurchaseOrders');
  },
};
