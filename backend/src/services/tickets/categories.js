// Ticket categories (5c): loading the tree, plus the DB-side helpers built on
// the pure ones in categoryTree.js.
const { TicketCategory, sequelize } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId } = require('../permissionService');
const tree = require('./categoryTree');

async function loadTree({ transaction } = {}) {
  const rows = await TicketCategory.findAll({
    attributes: ['id', 'companyId', 'parentId', 'name', 'sortOrder', 'active', 'requireChild', 'ticketType'],
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
// not being changed. `companyId` is the ticket's company (9): a category of
// any other company is refused like a missing one.
// `unsure` (9): "Other / I'm not sure" at this level, so a category part way
// down is fine (requireChild isn't asked), and none at all is fine too.
async function resolveCategoryForSave(raw, {
  current = undefined, required = false, tree: given = null, companyId = null, unsure = false, ticketType = null,
} = {}) {
  if (raw === undefined) return current;
  if (raw === null || raw === '') {
    if (required && !unsure) throw new ApiError(400, 'A category is required', 'VALIDATION_ERROR');
    return null;
  }
  const id = parseRecordId(raw);
  if (!id) throw notFound();
  if (current !== undefined && id === current) return id;
  const t = given || await loadTree();
  if (!tree.isEffectivelyActive(t, id)) throw notFound();
  const node = t.get(id);
  if (companyId != null && node.companyId !== Number(companyId)) throw notFound();
  // An incident takes incident (or both) categories, a request request ones.
  if (ticketType && !tree.fitsType(t, id, ticketType)) throw notFound();
  if (!unsure && node.requireChild && tree.activeChildren(t, id).length) {
    throw new ApiError(400, `Choose a sub-category under ${node.name}`, 'VALIDATION_ERROR');
  }
  return id;
}

// Would a new save accept this category now? (Effectively active, of the
// ticket's company when given, and not a requireChild node that still has
// active children.) Recurring runs use it
// to leave a since-retired template category off instead of failing.
function isUsableOnRun(t, id, companyId = null, ticketType = null) {
  if (!tree.isEffectivelyActive(t, id)) return false;
  const node = t.get(Number(id));
  if (companyId != null && node.companyId !== Number(companyId)) return false;
  if (ticketType && !tree.fitsType(t, id, ticketType)) return false;
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

// Every change to the tree runs inside this: a locking read of the whole
// table (next-key locks, so concurrent inserts wait too) serializes tree
// writes, and the tree handed to `fn` is read after the lock is held.
// Two such locks taken at once on an (almost) empty table can deadlock on
// their gap locks; InnoDB rolls one back, and that one is simply run again —
// it then sees the other's committed change.
const isDeadlock = (err) => [err?.parent?.code, err?.original?.code, err?.code].includes('ER_LOCK_DEADLOCK');
async function withTreeLock(fn, { attempts = 5 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await sequelize.transaction(async (transaction) => {
        await sequelize.query('SELECT id FROM TicketCategories FOR UPDATE', { transaction });
        const t = await loadTree({ transaction });
        return fn(t, transaction);
      });
    } catch (err) {
      if (!isDeadlock(err) || attempt >= attempts) throw err;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 10 + Math.random() * 40 * attempt); });
    }
  }
}

// A save that will reference these categories (a custom field's branches, a
// workflow condition) takes a shared lock on them in its own transaction:
// a concurrent delete then waits for it and sees the new use, and a save
// that comes after a delete finds the category gone. Throws if one is gone.
async function lockCategoriesShared(ids, transaction) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!list.length) return;
  const rows = await sequelize.query('SELECT id FROM TicketCategories WHERE id IN (:ids) LOCK IN SHARE MODE', {
    replacements: { ids: list }, transaction, type: sequelize.QueryTypes.SELECT,
  });
  if (rows.length !== list.length) throw notFound();
}

// Does this company have a category to choose? (Required only then, 9.)
// (For a ticket type, only categories for that type or both count.)
async function companyHasCategories(companyId, given = null, ticketType = null) {
  const t = given || await loadTree();
  return tree.activeChildren(t, null, companyId).some((n) => tree.fitsType(t, n.id, ticketType));
}

module.exports = {
  ...tree, loadTree, companyHasCategories, resolveCategoryForSave, isUsableOnRun, idList, fieldAppliesToCategory, withTreeLock, lockCategoriesShared,
};
