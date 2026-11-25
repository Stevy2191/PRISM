// A customer's billing settings (Phase 3, step 1): /companies/:id/billing.
// Reading needs money.billing.view, changing money.billing.manage; the
// company must be in the caller's reach (checked before any upload lands).
const fs = require('fs');
const path = require('path');
const { CompanyBilling, TaxRate } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { parseRecordId } = require('../../services/permissionService');
const { loadAccessibleCompany } = require('../companiesController');
const { customerBilling } = require('../../services/money/tax');

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const CERT_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

// Route guard: the company exists and is in reach; sets req.billingCompany.
async function loadBillingCompany(req, res, next) {
  try {
    req.billingCompany = await loadAccessibleCompany(req);
    next();
  } catch (err) {
    next(err);
  }
}

function amountOrNull(raw, label) {
  if (raw === null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw bad(`${label} must be an amount like 100 or 99.50`);
  return s;
}

// GET /companies/:id/billing
const get = asyncHandler(async (req, res) => {
  res.json({ billing: await customerBilling(req.billingCompany.id) });
});

// PUT /companies/:id/billing { chargeTax?, taxExempt?, exemptExpiresOn?, taxRateId?, termsDays?, invoiceTiming?, hourlyRate?, afterHoursRate?, tripCharge? }
const update = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fields = {};
  for (const key of ['chargeTax', 'taxExempt']) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') throw bad(`${key} must be true or false`);
      fields[key] = body[key];
    }
  }
  if (body.exemptExpiresOn !== undefined) {
    if (body.exemptExpiresOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.exemptExpiresOn))) throw bad('The expiry must be a date like 2027-06-30');
    fields.exemptExpiresOn = body.exemptExpiresOn;
  }
  if (body.taxRateId !== undefined) {
    if (body.taxRateId === null) fields.taxRateId = null;
    else {
      const rate = await TaxRate.findByPk(parseRecordId(body.taxRateId) || 0);
      if (!rate) throw bad('Tax rate not found');
      fields.taxRateId = rate.id;
    }
  }
  if (body.termsDays !== undefined) {
    if (body.termsDays !== null && (!Number.isInteger(body.termsDays) || body.termsDays < 0 || body.termsDays > 365)) throw bad('Payment terms must be 0 to 365 days');
    fields.termsDays = body.termsDays;
  }
  if (body.invoiceTiming !== undefined) {
    if (!['monthly', 'on_close'].includes(body.invoiceTiming)) throw bad('Invoicing must be monthly or when a ticket closes');
    fields.invoiceTiming = body.invoiceTiming;
  }
  if (body.hourlyRate !== undefined) fields.hourlyRate = amountOrNull(body.hourlyRate, 'The hourly rate');
  if (body.afterHoursRate !== undefined) fields.afterHoursRate = amountOrNull(body.afterHoursRate, 'The after-hours rate');
  if (body.tripCharge !== undefined) fields.tripCharge = amountOrNull(body.tripCharge, 'The trip charge');
  const [row] = await CompanyBilling.findOrCreate({ where: { companyId: req.billingCompany.id } });
  await row.update(fields);
  await writeAudit(req, 'money.companyBilling', 'Company', req.billingCompany.id, fields);
  res.json({ billing: await customerBilling(req.billingCompany.id) });
});

// POST /companies/:id/billing/certificate (multipart "file") — after the
// usual checks (signature, size, virus scan).
const uploadCertificate = asyncHandler(async (req, res) => {
  if (!req.file) throw bad('Choose a file');
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!CERT_TYPES.has(ext)) {
    fs.promises.unlink(req.file.path).catch(() => {});
    throw new ApiError(400, 'The certificate must be a PDF, PNG or JPG', 'INVALID_FILE_TYPE');
  }
  const [row] = await CompanyBilling.findOrCreate({ where: { companyId: req.billingCompany.id } });
  const old = row.exemptCertificateFile;
  await row.update({ exemptCertificateFile: req.file.filename, exemptCertificateName: req.file.originalname.slice(0, 255) });
  if (old && old !== req.file.filename) {
    fs.promises.unlink(path.join(UPLOAD_ROOT, 'companies', String(req.billingCompany.id), path.basename(old))).catch(() => {});
  }
  await writeAudit(req, 'money.exemptCertificate', 'Company', req.billingCompany.id, { name: row.exemptCertificateName });
  res.status(201).json({ billing: await customerBilling(req.billingCompany.id) });
});

// GET /companies/:id/billing/certificate — always a download.
const downloadCertificate = asyncHandler(async (req, res) => {
  const row = await CompanyBilling.findByPk(req.billingCompany.id);
  if (!row || !row.exemptCertificateFile) throw new ApiError(404, 'No certificate on file', 'NOT_FOUND');
  const file = path.join(UPLOAD_ROOT, 'companies', String(req.billingCompany.id), path.basename(row.exemptCertificateFile));
  if (!fs.existsSync(file)) throw new ApiError(404, 'The certificate file is missing', 'FILE_MISSING');
  res.download(file, row.exemptCertificateName || 'certificate');
});

module.exports = {
  loadBillingCompany, get, update, uploadCertificate, downloadCertificate,
};
