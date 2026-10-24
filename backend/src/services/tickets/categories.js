// Ticket categories (5c): loading the tree, plus the DB-side helpers built on
// the pure ones in categoryTree.js.
const { TicketCategory } = require('../../models');
const tree = require('./categoryTree');

async function loadTree({ transaction } = {}) {
  const rows = await TicketCategory.findAll({
    attributes: ['id', 'parentId', 'name', 'sortOrder', 'active', 'requireChild'],
    raw: true,
    transaction,
  });
  return new Map(rows.map((r) => [r.id, { ...r, active: !!r.active, requireChild: !!r.requireChild }]));
}

module.exports = { ...tree, loadTree };
