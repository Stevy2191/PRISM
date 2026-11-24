// A company's software list (9, task 3), reached only through its own
// company. Anyone who can reach the company reads it (the ticket forms'
// "which app?" step needs it); changing it needs the ticket categories
// permission, as the category tree it serves does.
const { Op, fn, col } = require('sequelize');
const {
  CompanyCatalogItem, AssetSoftware, Asset, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission, parseRecordId } = require('../services/permissionService');
const { loadAccessibleCompany } = require('./companiesController');

const KINDS = ['software'];
const MANAGE = 'tickets.categories.manage';
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

async function assertCanManage(req) {
  if (!(await hasPermission(req.user.id, MANAGE))) {
    throw new ApiError(403, 'You need the Manage ticket categories permission to change this list', 'FORBIDDEN');
  }
}

function cleanKind(raw) {
  const kind = raw === undefined || raw === null || raw === '' ? 'software' : raw;
  if (!KINDS.includes(kind)) throw bad(`Kind must be one of: ${KINDS.join(', ')}`);
  return kind;
}

function cleanText(raw, label, max, { required = false } = {}) {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (required && !value) throw bad(`${label} is required`);
  if (value.length > max) throw bad(`${label} is too long (at most ${max} characters)`);
  return value || null;
}

function readFields(body, isCreate) {
  const out = {};
  if (isCreate || body.name !== undefined) out.name = cleanText(body.name, 'Name', 255, { required: true });
  if (body.publisher !== undefined) out.publisher = cleanText(body.publisher, 'Publisher', 255);
  if (body.notes !== undefined) out.notes = cleanText(body.notes, 'Notes', 2000);
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw bad('Active must be true or false');
    out.active = body.active;
  }
  return out;
}

async function assertNameFree(companyId, kind, name, excludeId) {
  const clash = await CompanyCatalogItem.findOne({
    where: {
      companyId,
      kind,
      [Op.and]: [sequelize.where(fn('LOWER', col('name')), name.toLowerCase())],
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
  });
  if (clash) throw new ApiError(409, `This company already has ${name} on its list`, 'CATALOG_NAME_TAKEN');
}

async function loadItem(req, company) {
  const item = await CompanyCatalogItem.findOne({ where: { id: parseRecordId(req.params.itemId) || 0, companyId: company.id } });
  if (!item) throw new ApiError(404, 'Not on this company\'s list', 'NOT_FOUND');
  return item;
}

// GET /companies/:id/catalog?kind=software&active=true
const list = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const where = { companyId: company.id, kind: cleanKind(req.query.kind) };
  if (req.query.active === 'true') where.active = true;
  const items = await CompanyCatalogItem.findAll({ where, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  res.json({ items });
});

// POST /companies/:id/catalog { kind, name, publisher?, notes?, active? }
const create = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  await assertCanManage(req);
  const body = req.body || {};
  const kind = cleanKind(body.kind);
  const fields = readFields(body, true);
  await assertNameFree(company.id, kind, fields.name);
  const item = await CompanyCatalogItem.create({ ...fields, kind, companyId: company.id });
  await writeAudit(req, 'catalogItem.create', 'CompanyCatalogItem', item.id, { companyId: company.id, kind, name: item.name });
  res.status(201).json({ item });
});

// PATCH /companies/:id/catalog/:itemId
const update = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  await assertCanManage(req);
  const item = await loadItem(req, company);
  const changes = readFields(req.body || {}, false);
  if (changes.name) await assertNameFree(company.id, item.kind, changes.name, item.id);
  await item.update(changes);
  await writeAudit(req, 'catalogItem.update', 'CompanyCatalogItem', item.id, changes);
  res.json({ item });
});

// DELETE /companies/:id/catalog/:itemId: tickets that named it keep the
// ticket (the link is cleared); to keep the name on them, turn it off instead.
const remove = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  await assertCanManage(req);
  const item = await loadItem(req, company);
  await item.destroy();
  await writeAudit(req, 'catalogItem.delete', 'CompanyCatalogItem', item.id, { companyId: company.id, name: item.name });
  res.json({ ok: true });
});

// GET /companies/:id/catalog/found-software?search= — the programs the agent
// found on this company's computers, one row per name, with the versions
// seen and how many computers have it; what's on the list already is left
// out. It only reads; adding is a normal POST.
const foundSoftware = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  await assertCanManage(req);
  if (!(await hasPermission(req.user.id, 'assets.view'))) {
    throw new ApiError(403, 'You need the View assets permission to see this company\'s computers', 'FORBIDDEN');
  }
  const search = cleanText(req.query.search, 'Search', 100);
  const rows = await AssetSoftware.findAll({
    attributes: ['name', 'version', 'publisher', 'assetId'],
    where: search ? { name: { [Op.like]: `%${search.replace(/[\\%_]/g, '\\$&')}%` } } : {},
    include: [{ model: Asset, as: 'asset', attributes: [], where: { companyId: company.id }, required: true }],
    raw: true,
  });
  const listed = new Set((await CompanyCatalogItem.findAll({ where: { companyId: company.id, kind: 'software' }, attributes: ['name'] }))
    .map((i) => i.name.toLowerCase()));
  const byName = new Map();
  rows.forEach((r) => {
    const key = r.name.trim().toLowerCase();
    if (!key || listed.has(key)) return;
    if (!byName.has(key)) byName.set(key, { name: r.name.trim(), publisher: null, versions: new Set(), computers: new Set() });
    const g = byName.get(key);
    if (!g.publisher && r.publisher) g.publisher = r.publisher;
    if (r.version) g.versions.add(r.version);
    g.computers.add(r.assetId);
  });
  const software = [...byName.values()]
    .map((g) => ({
      name: g.name, publisher: g.publisher, versions: [...g.versions].sort(), computers: g.computers.size,
    }))
    .sort((x, y) => (y.computers - x.computers) || x.name.localeCompare(y.name))
    .slice(0, 500);
  res.json({ software });
});

module.exports = {
  list, create, update, remove, foundSoftware,
};
