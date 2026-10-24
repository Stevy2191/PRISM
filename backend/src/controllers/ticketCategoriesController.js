// Settings -> Ticket categories (5c): the global category tree. Any staff
// user may read it (no client data); writes need tickets.categories.manage.
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
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

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

// Siblings' names are unique, ignoring case and outer spaces. The UNIQUE
// index can't see NULL parents (roots), so this check is the real guard.
function assertUniqueName(tree, parentId, name, selfId = null) {
  const clash = cat.childrenOf(tree, parentId).some((n) => n.id !== selfId && sameName(n.name, name));
  if (clash) throw bad('A category with that name already exists here', 'DUPLICATE_NAME', 409);
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

// JSON columns can come back as strings from MariaDB.
function idList(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : [];
}

// Uses of each category id, counted per node (not including descendants).
async function usageByNode() {
  const [tickets, recurring, conditions, fields] = await Promise.all([
    Ticket.findAll({ attributes: ['categoryId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where: { categoryId: { [Op.ne]: null } }, group: ['categoryId'], raw: true }),
    RecurringTicket.findAll({ attributes: ['categoryId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where: { categoryId: { [Op.ne]: null } }, group: ['categoryId'], raw: true }),
    WorkflowCondition.findAll({ attributes: ['value'], where: { field: 'category' }, raw: true }),
    CustomField.findAll({ attributes: ['categoryIds'], raw: true }),
  ]);
  const usage = new Map();
  const bump = (id, key, by = 1) => {
    if (!usage.has(id)) usage.set(id, { tickets: 0, fields: 0, rules: 0, recurring: 0 });
    usage.get(id)[key] += by;
  };
  tickets.forEach((r) => bump(r.categoryId, 'tickets', Number(r.n)));
  recurring.forEach((r) => bump(r.categoryId, 'recurring', Number(r.n)));
  conditions.forEach((c) => { const id = parseRecordId(String(c.value ?? '').trim()); if (id) bump(id, 'rules'); });
  fields.forEach((f) => idList(f.categoryIds).forEach((id) => bump(id, 'fields')));
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
  const tree = await cat.loadTree();
  const name = cleanName(body.name);
  const parentId = cleanParent(tree, body.parentId);
  const requireChild = cleanBool(body.requireChild, 'Require a sub-category') ?? false;
  assertDepth(tree, parentId);
  assertUniqueName(tree, parentId, name);
  const row = await TicketCategory.create({
    name, parentId, requireChild, sortOrder: nextSortOrder(tree, parentId),
  });
  await writeAudit(req, 'ticketCategory.create', 'TicketCategory', row.id, { name, parentId });
  res.status(201).json({ category: await fresh(row.id) });
});

async function loadNode(rawId) {
  const id = parseRecordId(rawId);
  const tree = await cat.loadTree();
  if (!id || !tree.has(id)) throw bad('Category not found', 'NOT_FOUND', 404);
  return { id, tree, node: tree.get(id) };
}

// PATCH /ticket-categories/:id { name?, requireChild?, active?, parentId? }
const update = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { id, tree, node } = await loadNode(req.params.id);
  const changes = {};
  const audits = [];

  const requireChild = cleanBool(body.requireChild, 'Require a sub-category');
  const active = cleanBool(body.active, 'Active');
  const moving = Object.hasOwn(body, 'parentId');
  const parentId = moving ? cleanParent(tree, body.parentId) : node.parentId;
  if (moving && parentId !== node.parentId) {
    if (cat.wouldCycle(tree, id, parentId)) throw bad("A category can't be moved under itself or one of its sub-categories");
    assertDepth(tree, parentId, cat.subtreeHeight(tree, id));
    changes.parentId = parentId;
    changes.sortOrder = nextSortOrder(tree, parentId);
    audits.push(['ticketCategory.move', { from: node.parentId, to: parentId }]);
  }
  const name = body.name !== undefined ? cleanName(body.name) : node.name;
  if (body.name !== undefined || changes.parentId !== undefined) assertUniqueName(tree, parentId, name, id);
  if (body.name !== undefined && name !== node.name) changes.name = name;
  if (requireChild !== undefined && requireChild !== node.requireChild) changes.requireChild = requireChild;
  if (changes.name !== undefined || changes.requireChild !== undefined) {
    audits.push(['ticketCategory.update', { name: changes.name, requireChild: changes.requireChild }]);
  }
  if (active !== undefined && active !== node.active) {
    changes.active = active;
    audits.push([active ? 'ticketCategory.restore' : 'ticketCategory.retire', null]);
  }

  if (Object.keys(changes).length) await TicketCategory.update(changes, { where: { id } });
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
  const tree = await cat.loadTree();
  const parentId = cleanParent(tree, body.parentId);
  const ids = Array.isArray(body.orderedIds) ? body.orderedIds.map(parseRecordId) : null;
  const kids = cat.childrenOf(tree, parentId).map((n) => n.id);
  const ok = ids && ids.every(Boolean) && new Set(ids).size === ids.length
    && ids.length === kids.length && ids.every((i) => kids.includes(i));
  if (!ok) throw bad('orderedIds must list every sub-category of that parent exactly once');
  await sequelize.transaction(async (t) => {
    for (const [i, cid] of ids.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await TicketCategory.update({ sortOrder: i }, { where: { id: cid }, transaction: t });
    }
  });
  await writeAudit(req, 'ticketCategory.reorder', 'TicketCategory', parentId, { parentId, orderedIds: ids });
  res.json({ ok: true });
});

// DELETE /ticket-categories/:id — only when nothing uses it or anything
// below it; removes the whole (unused) subtree.
const remove = asyncHandler(async (req, res) => {
  const { id, tree, node } = await loadNode(req.params.id);
  const ids = cat.descendantIds(tree, id);
  const usage = await usageByNode();
  const total = emptyUsage();
  ids.forEach((i) => Object.entries(usage.get(i) || {}).forEach(([k, v]) => { total[k] += v; }));
  if (Object.values(total).some((v) => v > 0)) {
    throw new ApiError(409, 'This category, or one below it, is in use. Retire it instead.', 'CATEGORY_IN_USE', { usage: total });
  }
  // Deepest first, so no row is deleted while a child still points at it.
  const order = [...ids].sort((a, b) => cat.depthOf(tree, b) - cat.depthOf(tree, a));
  await sequelize.transaction(async (t) => {
    for (const cid of order) {
      // eslint-disable-next-line no-await-in-loop
      await TicketCategory.destroy({ where: { id: cid }, transaction: t });
    }
  });
  await writeAudit(req, 'ticketCategory.delete', 'TicketCategory', id, { name: node.name, removed: ids.length });
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
