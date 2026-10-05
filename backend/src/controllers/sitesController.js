// A company's sites (physical locations). Reached only through their own
// company, which the caller must be able to reach.
const { Op, fn, col } = require('sequelize');
const { Site, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const { loadAccessibleCompany } = require('./companiesController');

// field -> [max length, label]
const TEXT_FIELDS = {
  line1: [200, 'Address line 1'],
  line2: [200, 'Address line 2'],
  city: [100, 'City'],
  region: [100, 'Region'],
  postalCode: [20, 'Postal code'],
  country: [100, 'Country'],
  phone: [50, 'Phone'],
};

function readFields(body, isCreate) {
  const out = {};
  if (body.name !== undefined || isCreate) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ApiError(400, 'Site name is required', 'VALIDATION_ERROR');
    if (name.length > 150) throw new ApiError(400, 'Site name is too long', 'VALIDATION_ERROR');
    out.name = name;
  }
  for (const [field, [max, label]] of Object.entries(TEXT_FIELDS)) {
    if (body[field] !== undefined) {
      const value = body[field] === null ? '' : String(body[field]).trim();
      if (value.length > max) throw new ApiError(400, `${label} is too long`, 'VALIDATION_ERROR');
      out[field] = value || null;
    }
  }
  if (body.notes !== undefined) out.notes = body.notes || null;
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) throw new ApiError(400, 'Status must be active or inactive', 'VALIDATION_ERROR');
    out.status = body.status;
  }
  return out;
}

async function assertNameFree(companyId, name, excludeId) {
  const clash = await Site.findOne({
    where: {
      companyId,
      [Op.and]: [sequelize.where(fn('LOWER', col('name')), name.toLowerCase())],
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
  });
  if (clash) throw new ApiError(409, 'This company already has a site with that name', 'SITE_NAME_TAKEN');
}

// GET /companies/:id/sites
const list = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  res.json({ sites: await Site.findAll({ where: { companyId: company.id }, order: [['name', 'ASC']] }) });
});

// POST /companies/:id/sites
const create = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const fields = readFields(req.body || {}, true);
  await assertNameFree(company.id, fields.name);
  const site = await Site.create({ ...fields, companyId: company.id });
  await writeAudit(req, 'site.create', 'Site', site.id, { companyId: company.id, name: site.name });
  res.status(201).json({ site });
});

// PATCH /companies/:id/sites/:siteId
const update = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const site = await Site.findOne({ where: { id: parseRecordId(req.params.siteId) || 0, companyId: company.id } });
  if (!site) throw new ApiError(404, 'Site not found', 'NOT_FOUND');
  const changes = readFields(req.body || {}, false);
  if (changes.name) await assertNameFree(company.id, changes.name, site.id);
  await site.update(changes);
  await writeAudit(req, 'site.update', 'Site', site.id, changes);
  res.json({ site });
});

module.exports = { list, create, update };
