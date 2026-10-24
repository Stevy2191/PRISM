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

// Would a new save accept this category now? (Effectively active, and not a
// requireChild node that still has active children.) Recurring runs use it
// to leave a since-retired template category off instead of failing.
function isUsableOnRun(t, id) {
  if (!tree.isEffectivelyActive(t, id)) return false;
  const node = t.get(Number(id));
  return !(node.requireChild && tree.activeChildren(t, node.id).length);
}

// A JSON id list as stored (MariaDB can hand JSON columns back as strings).
function idList(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : [];
}

// A custom field limited to category branches applies to a ticket whose
// category is one of those nodes or below one. Unscoped fields apply always.
function fieldAppliesToCategory(field, t, categoryId) {
  const scope = idList(field.categoryIds);
  if (!scope.length) return true;
  if (!categoryId) return false;
  return tree.pathOf(t, categoryId).some((n) => scope.includes(n.id));
}

module.exports = {
  ...tree, loadTree, resolveCategoryForSave, isUsableOnRun, idList, fieldAppliesToCategory,
};
