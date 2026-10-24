// Ticket categories (5c): loading the tree, plus the DB-side helpers built on
// the pure ones in categoryTree.js.
const { TicketCategory } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId } = require('../permissionService');
const tree = require('./categoryTree');

async function loadTree({ transaction } = {}) {
  const rows = await TicketCategory.findAll({
    attributes: ['id', 'parentId', 'name', 'sortOrder', 'active', 'requireChild'],
    raw: true,
    transaction,
  });
  return new Map(rows.map((r) => [r.id, { ...r, active: !!r.active, requireChild: !!r.requireChild }]));
}

const notFound = () => new ApiError(400, 'Category not found', 'VALIDATION_ERROR');

// The one check every write of a ticket's category goes through (create,
// update, bulk, recurring). `current` is the stored value: re-sending it
// unchanged is never re-checked, so a ticket whose category was retired (or
// gained requireChild) after it was set can still be saved. `undefined` =
// not being changed.
async function resolveCategoryForSave(raw, { current = undefined, required = false, tree: given = null } = {}) {
  if (raw === undefined) return current;
  if (raw === null || raw === '') {
    if (required) throw new ApiError(400, 'A category is required', 'VALIDATION_ERROR');
    return null;
  }
  const id = parseRecordId(raw);
  if (!id) throw notFound();
  if (current !== undefined && id === current) return id;
  const t = given || await loadTree();
  if (!tree.isEffectivelyActive(t, id)) throw notFound();
  const node = t.get(id);
  if (node.requireChild && tree.activeChildren(t, id).length) {
    throw new ApiError(400, `Choose a sub-category under ${node.name}`, 'VALIDATION_ERROR');
  }
  return id;
}

module.exports = { ...tree, loadTree, resolveCategoryForSave };
