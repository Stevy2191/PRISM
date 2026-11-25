'use strict';

// Materials on tickets (Phase 3, step 2): the ProjectMaterials table now
// holds any job's materials — a project's or a ticket's (exactly one) — from
// the catalog or the shelf, with a price and a billing status.

const COLS = ['ticketId', 'catalogProductId', 'unitPrice', 'taxCategoryId', 'billable', 'fromStock', 'billingStatus', 'invoiceLineId', 'poLineId'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const t = await qi.describeTable('ProjectMaterials');
    const fk = (model) => ({ type: dt.INTEGER, allowNull: true, references: { model, key: 'id' }, onDelete: 'SET NULL' });
    if (!t.ticketId) await qi.addColumn('ProjectMaterials', 'ticketId', { ...fk('Tickets'), onDelete: 'CASCADE' });
    if (!t.catalogProductId) await qi.addColumn('ProjectMaterials', 'catalogProductId', fk('CatalogProducts'));
    if (!t.unitPrice) await qi.addColumn('ProjectMaterials', 'unitPrice', { type: dt.DECIMAL(12, 4), allowNull: true });
    if (!t.taxCategoryId) await qi.addColumn('ProjectMaterials', 'taxCategoryId', fk('TaxCategories'));
    if (!t.billable) await qi.addColumn('ProjectMaterials', 'billable', { type: dt.BOOLEAN, allowNull: false, defaultValue: true });
    if (!t.fromStock) await qi.addColumn('ProjectMaterials', 'fromStock', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    if (!t.billingStatus) {
      await qi.addColumn('ProjectMaterials', 'billingStatus', { type: dt.ENUM('unbilled', 'billed', 'non_billable'), allowNull: false, defaultValue: 'unbilled' });
    }
    if (!t.invoiceLineId) await qi.addColumn('ProjectMaterials', 'invoiceLineId', { type: dt.INTEGER, allowNull: true });
    if (!t.poLineId) await qi.addColumn('ProjectMaterials', 'poLineId', { type: dt.INTEGER, allowNull: true });
    // Quantities in usage units (300 ft, 2.5 hours of a rental): 4 decimals.
    await qi.changeColumn('ProjectMaterials', 'quantity', { type: dt.DECIMAL(12, 4), allowNull: false, defaultValue: 1 });
    await qi.changeColumn('ProjectMaterials', 'projectId', { type: dt.INTEGER, allowNull: true });
    const [checks] = await qi.sequelize.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ProjectMaterials' AND CONSTRAINT_NAME = 'materials_one_parent'");
    if (!checks.length) {
      await qi.sequelize.query('ALTER TABLE `ProjectMaterials` ADD CONSTRAINT `materials_one_parent` CHECK ((`ticketId` IS NULL) <> (`projectId` IS NULL))');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const t = await qi.describeTable('ProjectMaterials');
    const [checks] = await qi.sequelize.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ProjectMaterials' AND CONSTRAINT_NAME = 'materials_one_parent'");
    if (checks.length) await qi.sequelize.query('ALTER TABLE `ProjectMaterials` DROP CONSTRAINT `materials_one_parent`');
    // Ticket materials have nowhere to go in the older shape.
    if (t.ticketId) await qi.sequelize.query('DELETE FROM `ProjectMaterials` WHERE `projectId` IS NULL');
    await qi.changeColumn('ProjectMaterials', 'projectId', { type: Sequelize.INTEGER, allowNull: false });
    await qi.changeColumn('ProjectMaterials', 'quantity', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
    const fks = await qi.getForeignKeyReferencesForTable('ProjectMaterials');
    for (const col of COLS) {
      if (!t[col]) continue; // eslint-disable-line no-continue
      const fk = fks.find((f) => f.columnName === col);
      if (fk) await qi.removeConstraint('ProjectMaterials', fk.constraintName); // eslint-disable-line no-await-in-loop
      await qi.removeColumn('ProjectMaterials', col); // eslint-disable-line no-await-in-loop
    }
  },
};
