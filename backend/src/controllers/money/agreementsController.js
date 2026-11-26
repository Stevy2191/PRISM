// Agreements (Phase 3, step 3): /money/agreements. Reading needs
// money.billing.view (or .manage), changing money.billing.manage; every
// agreement is reached only through a company in the caller's reach.
const { Agreement, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { parseRecordId, canAccessCompany, companyScopeWhere } = require('../../services/permissionService');
const agreements = require('../../services/money/agreements');

const notFound = () => new ApiError(404, 'Agreement not found', 'NOT_FOUND');

async function findAgreement(req) {
  const agreement = await agreements.load(parseRecordId(req.params.id) || 0);
  if (!agreement || !(await canAccessCompany(req.user, agreement.companyId))) throw notFound();
  return agreement;
}

// GET /money/agreements?companyId=&status=
const list = asyncHandler(async (req, res) => {
  const where = { ...(await companyScopeWhere(req.user, 'companyId')) };
  if (req.query.companyId) {
    const id = parseRecordId(req.query.companyId) || -1;
    if (!(await canAccessCompany(req.user, id))) return res.json({ agreements: [] });
    where.companyId = id;
  }
  if (['active', 'cancelled'].includes(req.query.status)) where.status = req.query.status;
  const rows = await Agreement.findAll({
    where,
    include: [{ association: 'lines' }, { model: Company, as: 'company', attributes: ['id', 'name'] }],
    order: [['status', 'ASC'], ['startsOn', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  return res.json({ agreements: rows.map((a) => ({ ...agreements.agreementJson(a), company: a.company ? { id: a.company.id, name: a.company.name } : null })) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ agreement: agreements.agreementJson(await findAgreement(req)) });
});

const preview = asyncHandler(async (req, res) => {
  res.json(await agreements.preview(await findAgreement(req)));
});

const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const company = await Company.findByPk(parseRecordId(body.companyId) || 0);
  if (!company || !(await canAccessCompany(req.user, company.id))) throw new ApiError(404, 'Company not found', 'NOT_FOUND');
  const agreement = await agreements.createAgreement(company, body, req.user);
  await writeAudit(req, 'money.agreement.create', 'Agreement', agreement.id, { companyId: company.id, lines: agreement.lines.length });
  res.status(201).json({ agreement: agreements.agreementJson(agreement) });
});

const update = asyncHandler(async (req, res) => {
  const agreement = await agreements.updateAgreement(await findAgreement(req), req.body || {});
  await writeAudit(req, 'money.agreement.update', 'Agreement', agreement.id, { fields: Object.keys(req.body || {}) });
  res.json({ agreement: agreements.agreementJson(agreement) });
});

const cancel = asyncHandler(async (req, res) => {
  const agreement = await agreements.cancelAgreement(await findAgreement(req), req.body || {});
  await writeAudit(req, 'money.agreement.cancel', 'Agreement', agreement.id, { cancelledOn: agreement.cancelledOn });
  res.json({ agreement: agreements.agreementJson(agreement) });
});

module.exports = {
  list, get, preview, create, update, cancel,
};
