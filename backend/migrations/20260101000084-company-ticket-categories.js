'use strict';

// Each company has its own ticket categories (sub-project 9, Task 1). The
// tree that existed before belonged to everyone; it moves to the help desk's
// own company (the internal one), so nothing a client sees changes meaning.
// Tickets, custom fields, workflow rules and recurring tickets keep pointing
// at the same rows. Sibling names stay unique: children through the existing
// (parentId, name) index, roots per company in code.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const cols = await qi.describeTable('TicketCategories');
    if (!cols.companyId) {
      await qi.addColumn('TicketCategories', 'companyId', { type: Sequelize.INTEGER, allowNull: true });
      const [[internal]] = await qi.sequelize.query('SELECT id FROM Companies WHERE isInternal = 1 ORDER BY id LIMIT 1');
      if (internal) {
        await qi.sequelize.query('UPDATE TicketCategories SET companyId = ? WHERE companyId IS NULL', { replacements: [internal.id] });
      }
      await qi.changeColumn('TicketCategories', 'companyId', {
        type: Sequelize.INTEGER, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE',
      });
      await qi.addIndex('TicketCategories', ['companyId', 'parentId'], { name: 'ticket_categories_company_parent' });
    }
  },
  down: async (queryInterface) => {
    const qi = queryInterface;
    const cols = await qi.describeTable('TicketCategories');
    if (!cols.companyId) return;
    const fks = await qi.getForeignKeyReferencesForTable('TicketCategories');
    for (const fk of fks.filter((f) => f.columnName === 'companyId')) {
      await qi.removeConstraint('TicketCategories', fk.constraintName); // eslint-disable-line no-await-in-loop
    }
    const indexes = await qi.showIndex('TicketCategories');
    if (indexes.some((i) => i.name === 'ticket_categories_company_parent')) {
      await qi.removeIndex('TicketCategories', 'ticket_categories_company_parent');
    }
    await qi.removeColumn('TicketCategories', 'companyId');
  },
};
