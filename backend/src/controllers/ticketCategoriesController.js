// Settings -> Ticket categories (5c): the global category tree. Any staff
// user may read it (no client data); writes need tickets.categories.manage.
// Every write runs under the tree lock (categories.withTreeLock), so two
// admins' changes can't combine into a cycle or a duplicate.
const { Op } = require('sequelize');
const {
  TicketCategory, Ticket, CustomField, WorkflowCondition, RecurringTicket, SystemSettings, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission, parseRecordId } = require('../services/permissionService');
const cat = require('../services/tickets/categories');

const MANAGE = 'tickets.categories.manage';
const REQUIRED_KEY = 'tickets.categoryRequired';
const bad = (message, code = 'VALIDATION_ERROR', status = 400) => new ApiError(status, message, code);

const nodeJson = (tree, n) => ({ ...n, effectiveActive: cat.isEffectivelyActive(tree, n.id) });
// Same rule as the database collation (accent- and case-insensitive), so the
// code check and the UNIQUE index agree, at the root as everywhere else.
const sameName = (a, b) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' }) === 0;
const duplicate = () => bad('A category with that name already exists here', 'DUPLICATE_NAME', 409);
// Anything the code check can't see still lands on the UNIQUE index.
const uniqueOr409 = (err) => {
  if (err && err.name === 'SequelizeUniqueConstraintError') throw duplicate();
  throw err;
};

function cleanName(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw bad('Name is required');
  const name = raw.trim();
  if (name.length > 100) throw bad('Name must be 100 characters or fewer');
  return name;
}

// undefined/null = root; anything else must be an existing node's id.
function cleanParent(tree, raw) {
  if (raw === undefined || raw === null) return null;
  const id = parseRecordId(raw);
  if (!id || !tree.has(id)) throw bad('Parent category not found');
  return id;
}

function cleanBool(raw, label) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') throw bad(`${label} must be true or false`);
  return raw;
}

// Siblings' names are unique. The UNIQUE index can't see NULL parents
// (roots), so this check is the real guard there.
function assertUniqueName(tree, parentId, name, selfId = null) {
  if (cat.childrenOf(tree, parentId).some((n) => n.id !== selfId && sameName(n.name, name))) throw duplicate();
}

function assertDepth(tree, parentId, height = 1) {
  if (cat.depthOf(tree, parentId) + height > cat.MAX_DEPTH) {
    throw bad(`Categories can be at most ${cat.MAX_DEPTH} levels deep`);
  }
}

const nextSortOrder = (tree, parentId) => {
  const kids = cat.childrenOf(tree, parentId);
  return kids.length ? Math.max(...kids.map((k) => k.sortOrder)) + 1 : 0;
};

function nodeIn(tree, rawId) {
  const id = parseRecordId(rawId);
  if (!id || !tree.has(id)) throw bad('Category not found', 'NOT_FOUND', 404);
  return { id, node: tree.get(id) };
}

// Uses of each category id, counted per node (not including descendants).
async function usageByNode(transaction) {
  const count = (Model) => Model.findAll({
    attributes: ['categoryId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    where: { categoryId: { [Op.ne]: null } },
    group: ['categoryId'],
    raw: true,
    transaction,
  });
  const [tickets, recurring, conditions, fields] = await Promise.all([
    count(Ticket),
    count(RecurringTicket),
    WorkflowCondition.findAll({ attributes: ['value'], where: { field: 'category' }, raw: true, transaction }),
    CustomField.findAll({ attributes: ['categoryIds'], raw: true, transaction }),
  ]);
  const usage = new Map();
  const bump = (id, key, by = 1) => {
    if (!usage.has(id)) usage.set(id, { tickets: 0, fields: 0, rules: 0, recurring: 0 });
    usage.get(id)[key] += by;
  };
  tickets.forEach((r) => bump(r.categoryId, 'tickets', Number(r.n)));
  recurring.forEach((r) => bump(r.categoryId, 'recurring', Number(r.n)));
  conditions.forEach((c) => { const id = parseRecordId(String(c.value ?? '').trim()); if (id) bump(id, 'rules'); });
  fields.forEach((f) => cat.idList(f.categoryIds).forEach((id) => bump(id, 'fields')));
  return usage;
}

const emptyUsage = () => ({ tickets: 0, fields: 0, rules: 0, recurring: 0 });

async function categoryRequired() {
  const row = await SystemSettings.findOne({ where: { key: REQUIRED_KEY } });
  return row?.value === 'true';
}

// GET /ticket-categories[?usage=1]
const list = asyncHandler(async (req, res) => {
  const tree = await cat.loadTree();
  const showUsage = req.query.usage === '1' && (await hasPermission(req.user.id, MANAGE));
  const usage = showUsage ? await usageByNode() : null;
  const categories = [...tree.values()]
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
    .map((n) => ({ ...nodeJson(tree, n), ...(usage ? { usage: usage.get(n.id) || emptyUsage() } : {}) }));
  res.json({ categories, categoryRequired: await categoryRequired() });
});

const fresh = async (id) => {
  const tree = await cat.loadTree();
  return nodeJson(tree, tree.get(id));
};

// POST /ticket-categories { name, parentId?, requireChild? }
const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = cleanName(body.name);
  const requireChild = cleanBool(body.requireChild, 'Require a sub-category') ?? false;
  const row = await cat.withTreeLock(async (tree, transaction) => {
    const parentId = cleanParent(tree, body.parentId);
    assertDepth(tree, parentId);
    assertUniqueName(tree, parentId, name);
    return TicketCategory.create({
      name, parentId, requireChild, sortOrder: nextSortOrder(tree, parentId),
    }, { transaction }).catch(uniqueOr409);
  });
  await writeAudit(req, 'ticketCategory.create', 'TicketCategory', row.id, { name, parentId: row.parentId });
  res.status(201).json({ category: await fresh(row.id) });
});

// PATCH /ticket-categories/:id { name?, requireChild?, active?, parentId? }
const update = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const requireChild = cleanBool(body.requireChild, 'Require a sub-category');
  const active = cleanBool(body.active, 'Active');
  const { id, audits } = await cat.withTreeLock(async (tree, transaction) => {
    const found = nodeIn(tree, req.params.id);
    const { node } = found;
    const changes = {};
    const done = [];
    const moving = Object.hasOwn(body, 'parentId');
    const parentId = moving ? cleanParent(tree, body.parentId) : node.parentId;
    if (moving && parentId !== node.parentId) {
      if (cat.wouldCycle(tree, found.id, parentId)) throw bad("A category can't be moved under itself or one of its sub-categories");
      assertDepth(tree, parentId, cat.subtreeHeight(tree, found.id));
      changes.parentId = parentId;
      changes.sortOrder = nextSortOrder(tree, parentId);
      done.push(['ticketCategory.move', { from: node.parentId, to: parentId }]);
    }
    const name = body.name !== undefined ? cleanName(body.name) : node.name;
    if (body.name !== undefined || changes.parentId !== undefined) assertUniqueName(tree, parentId, name, found.id);
    if (body.name !== undefined && name !== node.name) changes.name = name;
    if (requireChild !== undefined && requireChild !== node.requireChild) changes.requireChild = requireChild;
    if (changes.name !== undefined || changes.requireChild !== undefined) {
      done.push(['ticketCategory.update', { name: changes.name, requireChild: changes.requireChild }]);
    }
    if (active !== undefined && active !== node.active) {
      changes.active = active;
      done.push([active ? 'ticketCategory.restore' : 'ticketCategory.retire', null]);
    }
    if (Object.keys(changes).length) {
      await TicketCategory.update(changes, { where: { id: found.id }, transaction }).catch(uniqueOr409);
    }
    return { id: found.id, audits: done };
  });
  for (const [action, meta] of audits) {
    // eslint-disable-next-line no-await-in-loop
    await writeAudit(req, action, 'TicketCategory', id, meta);
  }
  res.json({ category: await fresh(id) });
});

// POST /ticket-categories/reorder { parentId, orderedIds } — exactly the
// parent's current children, in their new order.
const reorder = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { parentId, ids } = await cat.withTreeLock(async (tree, transaction) => {
    const pid = cleanParent(tree, body.parentId);
    const list = Array.isArray(body.orderedIds) ? body.orderedIds.map(parseRecordId) : null;
    const kids = cat.childrenOf(tree, pid).map((n) => n.id);
    const ok = list && list.every(Boolean) && new Set(list).size === list.length
      && list.length === kids.length && list.every((i) => kids.includes(i));
    if (!ok) throw bad('orderedIds must list every sub-category of that parent exactly once');
    for (const [i, cid] of list.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await TicketCategory.update({ sortOrder: i }, { where: { id: cid }, transaction });
    }
    return { parentId: pid, ids: list };
  });
  await writeAudit(req, 'ticketCategory.reorder', 'TicketCategory', parentId, { parentId, orderedIds: ids });
  res.json({ ok: true });
});

// DELETE /ticket-categories/:id — only when nothing uses it or anything
// below it; removes the whole (unused) subtree. Usage is counted under the
// tree lock: a field or rule being saved with this category holds a shared
// lock, so it is either counted here or finds the category gone.
const remove = asyncHandler(async (req, res) => {
  const { id, node, removed } = await cat.withTreeLock(async (tree, transaction) => {
    const found = nodeIn(tree, req.params.id);
    const subtree = cat.descendantIds(tree, found.id);
    const usage = await usageByNode(transaction);
    const total = emptyUsage();
    subtree.forEach((i) => Object.entries(usage.get(i) || {}).forEach(([k, v]) => { total[k] += v; }));
    if (Object.values(total).some((v) => v > 0)) {
      throw new ApiError(409, 'This category, or one below it, is in use. Retire it instead.', 'CATEGORY_IN_USE', { usage: total });
    }
    // Deepest first, so no row is deleted while a child still points at it.
    const order = [...subtree].sort((a, b) => cat.depthOf(tree, b) - cat.depthOf(tree, a));
    for (const cid of order) {
      // eslint-disable-next-line no-await-in-loop
      await TicketCategory.destroy({ where: { id: cid }, transaction });
    }
    return { ...found, removed: subtree.length };
  });
  await writeAudit(req, 'ticketCategory.delete', 'TicketCategory', id, { name: node.name, removed });
  res.status(204).end();
});

// PUT /ticket-categories/settings { categoryRequired: boolean }
const updateSettings = asyncHandler(async (req, res) => {
  const value = (req.body || {}).categoryRequired;
  if (typeof value !== 'boolean') throw bad('categoryRequired must be true or false');
  await SystemSettings.upsert({ key: REQUIRED_KEY, value: String(value), updatedById: req.user.id });
  await writeAudit(req, 'ticketCategory.settings', 'TicketCategory', null, { categoryRequired: value });
  res.json({ categoryRequired: value });
});

module.exports = {
  list, create, update, reorder, remove, updateSettings, categoryRequired,
};
