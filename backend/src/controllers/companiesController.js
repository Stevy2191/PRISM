// Companies (client companies, sub-project 2): the organization itself (the
// one internal company), clients and vendors. Every read and write is fenced
// by the caller's company access — see permissionService.canAccessCompany.
const { Op, fn, col } = require('sequelize');
const {
  Company, CompanyDomain, Site, User, Department, Contact, Ticket, Project, Asset, License, Contract,
  ProjectMaterial, UserCompanyAccess, RoleCompanyAccess, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parsePagination, paginated } = require('../utils/pagination');
const {
  canAccessCompany, companyScopeWhere, parseRecordId, invalidateAllPermissions,
} = require('../services/permissionService');
const { FREE_MAIL_DOMAINS } = require('../services/companyService');
const { andWhere, isEmpty } = require('../services/recordScope');
const { getTicketStatusBuckets } = require('../services/statusBehavior');
const { mergeCounts, mergeCompanies } = require('../services/companyMerge');

const NAME_MAX = 150;
const WEBSITE_RE = /^https?:\/\/[^\s<>"]+$/i;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const companyInclude = [
  { model: CompanyDomain, as: 'domains', attributes: ['id', 'domain'] },
  { model: User, as: 'accountManager', attributes: ['id', 'displayName'] },
];

function normalizeName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new ApiError(400, 'Company name is required', 'VALIDATION_ERROR');
  if (name.length > NAME_MAX) throw new ApiError(400, `Company name must be ${NAME_MAX} characters or fewer`, 'VALIDATION_ERROR');
  return name;
}

// Active names are unique ignoring case; an inactive company's name is free
// to reuse (a client who left and came back as a new record).
async function assertNameFree(name, excludeId) {
  const clash = await Company.findOne({
    where: {
      status: 'active',
      [Op.and]: [sequelize.where(fn('LOWER', col('name')), name.toLowerCase())],
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
  });
  if (clash) throw new ApiError(409, 'A company with this name already exists', 'COMPANY_NAME_TAKEN');
}

async function resolveAccountManager(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const user = await User.findByPk(parseRecordId(raw) || 0, { attributes: ['id', 'isActive'] });
  if (!user || !user.isActive) throw new ApiError(400, 'Unknown account manager', 'VALIDATION_ERROR');
  return user.id;
}

function normalizeWebsite(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const site = String(raw).trim();
  if (!WEBSITE_RE.test(site) || site.length > 255) throw new ApiError(400, 'Website must be an http(s) address', 'VALIDATION_ERROR');
  return site;
}

// Builds the writable fields from a request body. isInternal and id are
// never taken from a body.
async function readFields(body, existing) {
  const out = {};
  if (body.name !== undefined || !existing) out.name = normalizeName(body.name);
  if (body.isClient !== undefined) out.isClient = !!body.isClient;
  if (body.isVendor !== undefined) out.isVendor = !!body.isVendor;
  if (body.phone !== undefined) out.phone = body.phone ? String(body.phone).trim().slice(0, 50) : null;
  if (body.website !== undefined) out.website = normalizeWebsite(body.website);
  if (body.notes !== undefined) out.notes = body.notes || null;
  if (body.accountManagerId !== undefined) out.accountManagerId = await resolveAccountManager(body.accountManagerId);
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) throw new ApiError(400, 'Status must be active or inactive', 'VALIDATION_ERROR');
    if (existing && existing.isInternal && body.status === 'inactive') {
      throw new ApiError(400, 'The internal company cannot be deactivated', 'VALIDATION_ERROR');
    }
    out.status = body.status;
  }
  return out;
}

// Loads :id and refuses a company the caller can't reach. Shared with the
// sites controller.
async function loadAccessibleCompany(req) {
  const company = await Company.findByPk(parseRecordId(req.params.id) || 0);
  if (!company) throw new ApiError(404, 'Company not found', 'NOT_FOUND');
  if (!(await canAccessCompany(req.user, company.id))) {
    throw new ApiError(403, 'You do not have access to this company', 'FORBIDDEN');
  }
  return company;
}

// GET /companies?kind=client|vendor&status=&search=
const list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const and = [await companyScopeWhere(req.user, 'id')];
  if (req.query.kind === 'client') and.push({ [Op.or]: [{ isClient: true }, { isInternal: true }] });
  if (req.query.kind === 'vendor') and.push({ isVendor: true });
  if (req.query.status === 'active' || req.query.status === 'inactive') and.push({ status: req.query.status });
  if (req.query.search && String(req.query.search).trim()) {
    and.push({ name: { [Op.like]: `%${String(req.query.search).trim()}%` } });
  }
  const { rows, count } = await Company.findAndCountAll({
    where: { [Op.and]: and },
    order: [['isInternal', 'DESC'], ['name', 'ASC']],
    limit,
    offset,
  });
  // Per-row counts for the list (two grouped queries, not one per row).
  const ids = rows.map((c) => c.id);
  const buckets = await getTicketStatusBuckets();
  const countBy = async (Model, extra = {}) => {
    if (!ids.length) return new Map();
    const counted = await Model.findAll({
      where: { companyId: ids, ...extra },
      attributes: ['companyId', [fn('COUNT', col('id')), 'n']],
      group: ['companyId'],
      raw: true,
    });
    return new Map(counted.map((r) => [r.companyId, Number(r.n)]));
  };
  const [contacts, openTickets] = await Promise.all([
    countBy(Contact), countBy(Ticket, { status: { [Op.in]: buckets.open } }),
  ]);
  const withCounts = rows.map((c) => ({
    ...c.toJSON(), contactCount: contacts.get(c.id) || 0, openTicketCount: openTickets.get(c.id) || 0,
  }));
  res.json(paginated('companies', { rows: withCounts, count }, { page, limit }));
});

// GET /companies/summary — any staff user: the frontend needs it before
// anything else to decide whether to show company UI. `count` covers only
// the companies the user can reach; multiCompany ("a client exists") stays
// global, since it switches UI on for everyone and reveals only that. Vendor
// companies (including those made from vendor text) never switch it on.
const summary = asyncHandler(async (req, res) => {
  const [count, clients] = await Promise.all([
    Company.count({ where: await companyScopeWhere(req.user, 'id') }),
    Company.count({ where: { isClient: true } }),
  ]);
  res.json({ count, multiCompany: clients > 0 });
});

// GET /companies/vendors?search= — the vendor picker: shared vendor-only
// companies, plus vendor companies the user can reach (see isSharedVendor).
const vendors = asyncHandler(async (req, res) => {
  const scope = await companyScopeWhere(req.user, 'id');
  const and = [{ isVendor: true, status: 'active' }];
  if (!isEmpty(scope)) and.push({ [Op.or]: [{ isClient: false, isInternal: false }, scope] });
  const term = String(req.query.search || '').trim();
  if (term) and.push({ name: { [Op.like]: `%${term}%` } });
  const rows = await Company.findAll({
    where: andWhere(...and), attributes: ['id', 'name'], order: [['name', 'ASC']], limit: 25,
  });
  res.json({ vendors: rows });
});

// GET /companies/:id
const get = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  res.json({ company: await Company.findByPk(company.id, { include: companyInclude }) });
});

// POST /companies
const create = asyncHandler(async (req, res) => {
  const fields = await readFields(req.body || {}, null);
  await assertNameFree(fields.name);
  const company = await Company.create({ ...fields, isInternal: false });
  await writeAudit(req, 'company.create', 'Company', company.id, { name: company.name, isClient: company.isClient, isVendor: company.isVendor });
  res.status(201).json({ company: await Company.findByPk(company.id, { include: companyInclude }) });
});

// PATCH /companies/:id
const update = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const changes = await readFields(req.body || {}, company);
  // A company that owns contacts, tickets or other records must stay a
  // client: those records may only sit in a client (or the internal)
  // company, and clearing the flag could also switch company UI off.
  if (changes.isClient === false && company.isClient) {
    const byCompany = { where: { companyId: company.id } };
    const counts = await Promise.all(
      [Contact, Ticket, Project, Department, Site, Asset, License, Contract].map((M) => M.count(byCompany))
    );
    if (counts.some((n) => n > 0)) {
      throw new ApiError(409, 'This company still has client records. Merge it or move them before it stops being a client.', 'COMPANY_IN_USE');
    }
  }
  const becomesActive = (changes.status || company.status) === 'active';
  if (becomesActive && (changes.name !== undefined || changes.status === 'active')) {
    await assertNameFree(changes.name || company.name, company.id);
  }
  await company.update(changes);
  await writeAudit(req, 'company.update', 'Company', company.id, changes);
  res.json({ company: await Company.findByPk(company.id, { include: companyInclude }) });
});

// DELETE /companies/:id — only a company nothing points at.
const remove = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  if (company.isInternal) throw new ApiError(400, 'The internal company cannot be deleted', 'VALIDATION_ERROR');
  const byCompany = { where: { companyId: company.id } };
  const byVendor = { where: { vendorCompanyId: company.id } };
  const counts = await Promise.all([
    Department.count(byCompany), Contact.count(byCompany), Ticket.count(byCompany), Project.count(byCompany),
    Asset.count(byCompany), License.count(byCompany), Contract.count(byCompany), Site.count(byCompany),
    Asset.count(byVendor), License.count(byVendor), Contract.count(byVendor), ProjectMaterial.count(byVendor),
  ]);
  if (counts.some((n) => n > 0)) {
    throw new ApiError(409, 'This company has records. Deactivate or merge it instead.', 'COMPANY_IN_USE');
  }
  await sequelize.transaction(async (t) => {
    await CompanyDomain.destroy({ ...byCompany, transaction: t });
    await UserCompanyAccess.destroy({ ...byCompany, transaction: t });
    await RoleCompanyAccess.destroy({ ...byCompany, transaction: t });
    await company.destroy({ transaction: t });
  });
  invalidateAllPermissions();
  await writeAudit(req, 'company.delete', 'Company', company.id, { name: company.name });
  res.json({ ok: true });
});

// POST /companies/:id/merge { intoCompanyId } — merge :id (B) into A.
// ?preview=true returns the per-table counts and changes nothing.
const merge = asyncHandler(async (req, res) => {
  const from = await loadAccessibleCompany(req);
  if (from.isInternal) throw new ApiError(400, 'The internal company cannot be merged into another', 'VALIDATION_ERROR');
  const into = await Company.findByPk(parseRecordId((req.body || {}).intoCompanyId) || 0);
  // Missing and out-of-reach targets look the same.
  if (!into || !(await canAccessCompany(req.user, into.id))) throw new ApiError(400, 'Unknown company', 'VALIDATION_ERROR');
  if (into.id === from.id) throw new ApiError(400, 'A company cannot be merged into itself', 'VALIDATION_ERROR');
  if (into.status !== 'active') throw new ApiError(400, 'Merge into an active company', 'VALIDATION_ERROR');

  if (req.query.preview === 'true') {
    res.json({ preview: true, counts: await mergeCounts(from.id) });
    return;
  }
  const counts = await sequelize.transaction(async (transaction) => {
    const moved = await mergeCounts(from.id, transaction);
    await mergeCompanies(from, into, transaction);
    return moved;
  });
  invalidateAllPermissions();
  await writeAudit(req, 'company.merge', 'Company', into.id, { fromCompanyId: from.id, fromName: from.name, counts });
  res.json({ company: await Company.findByPk(into.id, { include: companyInclude }), counts });
});

// POST /companies/:id/domains { domain }
const addDomain = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const domain = String((req.body || {}).domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!DOMAIN_RE.test(domain)) throw new ApiError(400, 'Invalid domain', 'VALIDATION_ERROR');
  if (FREE_MAIL_DOMAINS.has(domain)) throw new ApiError(400, "Free email domains can't identify a company", 'VALIDATION_ERROR');
  if (await CompanyDomain.findOne({ where: { domain } })) {
    throw new ApiError(409, 'This domain already belongs to a company', 'DOMAIN_TAKEN');
  }
  const row = await CompanyDomain.create({ companyId: company.id, domain });
  await writeAudit(req, 'company.domain_add', 'Company', company.id, { domain });
  res.status(201).json({ domain: row });
});

// DELETE /companies/:id/domains/:domainId
const removeDomain = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const row = await CompanyDomain.findOne({ where: { id: parseRecordId(req.params.domainId) || 0, companyId: company.id } });
  if (!row) throw new ApiError(404, 'Domain not found', 'NOT_FOUND');
  await row.destroy();
  await writeAudit(req, 'company.domain_remove', 'Company', company.id, { domain: row.domain });
  res.json({ ok: true });
});

module.exports = {
  list, summary, vendors, get, create, update, remove, merge, addDomain, removeDomain, loadAccessibleCompany,
};
