const path = require('path');
const { parse: parseCsv } = require('csv-parse/sync');
const { Op } = require('sequelize');
const { Contact, Department, Company } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { logContactActivity } = require('../services/contactActivity');
const { normalizePhoneLenient } = require('../utils/phone');
const { toCsv } = require('../utils/csv');
const { getInternalCompanyId } = require('../services/companyService');
const { companyScopeWhere } = require('../services/permissionService');
const { andWhere } = require('../services/recordScope');

const IMPORT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'mobile', 'department', 'jobTitle', 'company'];

// GET /contacts/import/sample — a template CSV with the expected headers.
const sample = asyncHandler(async (req, res) => {
  const csv = toCsv(IMPORT_FIELDS, [
    // A blank company means the organization itself (the internal company).
    ['Jane', 'Doe', 'jane.doe@example.com', '555-0100', '555-0101', 'IT Support', 'Systems Analyst', ''],
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="prism-contacts-import-sample.csv"');
  res.send(csv);
});

// POST /contacts/import/parse — multipart CSV upload, returns headers + all
// parsed rows so the frontend can drive the rest of the wizard client-side
// (no server-side session/staging needed — later steps re-send the rows).
const parseUpload = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'A CSV file is required', 'VALIDATION_ERROR');
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.csv') throw new ApiError(400, 'Only .csv files are supported', 'VALIDATION_ERROR');

  let records;
  try {
    records = parseCsv(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    throw new ApiError(400, `Could not parse CSV: ${err.message}`, 'PARSE_ERROR');
  }
  if (!records.length) throw new ApiError(400, 'CSV file has no data rows', 'VALIDATION_ERROR');

  res.json({ headers: Object.keys(records[0]), rows: records });
});

function mapRow(row, mapping) {
  const record = {};
  Object.entries(mapping).forEach(([header, field]) => {
    if (!field || field === 'skip') return;
    const raw = row[header];
    record[field] = raw === undefined || raw === null ? '' : String(raw).trim();
  });
  return record;
}

// Contacts can go in any active client company the importer can reach, or
// the internal company (blank Company cell). Department names match within
// the row's company only.
async function buildLookups(user) {
  const internalId = await getInternalCompanyId();
  const [contacts, companies] = await Promise.all([
    Contact.findAll({ attributes: ['id', 'email'], where: { email: { [Op.ne]: null } }, raw: true }),
    Company.findAll({
      where: andWhere(
        { status: 'active', [Op.or]: [{ isClient: true }, { isInternal: true }] },
        await companyScopeWhere(user, 'id')
      ),
      attributes: ['id', 'name'],
      raw: true,
    }),
  ]);
  const companyIds = companies.map((c) => c.id);
  const departments = companyIds.length
    ? await Department.findAll({ where: { companyId: companyIds }, attributes: ['id', 'name', 'companyId'], raw: true })
    : [];
  return {
    emailToId: new Map(contacts.map((c) => [c.email.toLowerCase(), c.id])),
    companyByName: new Map(companies.map((c) => [c.name.toLowerCase(), c.id])),
    defaultCompanyId: companyIds.includes(internalId) ? internalId : null,
    deptByKey: new Map(departments.map((d) => [`${d.companyId}:${d.name.toLowerCase()}`, d.id])),
  };
}
const deptKey = (companyId, name) => `${companyId}:${name.toLowerCase()}`;

// Shared by /validate and the actual /import commit — classifies each row as
// 'create' | 'skip' (duplicate email) | 'error' (missing required fields),
// with a `department` value that doesn't match anything surfaced as a
// non-blocking warning either way.
function validateRows(rows, mapping, lookups) {
  const seenEmails = new Set();
  return rows.map((row, rowIndex) => {
    const record = mapRow(row, mapping);
    const issues = [];
    let action = 'create';

    if (!record.firstName && !record.email) {
      issues.push({ type: 'error', message: 'Missing both first name and email' });
      action = 'error';
    } else {
      const emailLower = record.email ? record.email.toLowerCase() : null;
      if (emailLower) {
        if (lookups.emailToId.has(emailLower)) {
          issues.push({ type: 'warning', message: 'A contact with this email already exists' });
          action = 'skip';
        } else if (seenEmails.has(emailLower)) {
          issues.push({ type: 'warning', message: 'Duplicate email within this file' });
          action = 'skip';
        }
        seenEmails.add(emailLower);
      }
      // The company is checked last and wins over a duplicate-email skip: a
      // row that can't be placed is an error to fix, not a row to skip.
      const companyName = (record.company || '').trim();
      record.companyId = companyName
        ? lookups.companyByName.get(companyName.toLowerCase()) || null
        : lookups.defaultCompanyId;
      if (!record.companyId) {
        issues.push({ type: 'error', message: companyName ? `"${companyName}" does not match any company` : 'Choose a company for this contact' });
        action = 'error';
      }
      if (record.department && record.companyId && !lookups.deptByKey.has(deptKey(record.companyId, record.department))) {
        issues.push({ type: 'warning', message: `"${record.department}" does not match any existing department` });
      }
    }

    return { rowIndex, record, issues, action };
  });
}

function requireMapping(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new ApiError(400, 'mapping is required', 'VALIDATION_ERROR');
  }
  const mappedFields = new Set(Object.values(mapping));
  if (!mappedFields.has('firstName') && !mappedFields.has('email')) {
    throw new ApiError(400, 'At least First name or Email must be mapped', 'VALIDATION_ERROR');
  }
}

// POST /contacts/import/validate { rows, mapping } — dry run, writes nothing.
const validate = asyncHandler(async (req, res) => {
  const { rows, mapping } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) throw new ApiError(400, 'rows is required', 'VALIDATION_ERROR');
  requireMapping(mapping);

  const lookups = await buildLookups(req.user);
  const validated = validateRows(rows, mapping, lookups);

  res.json({
    rows: validated,
    summary: {
      willCreate: validated.filter((r) => r.action === 'create').length,
      willSkip: validated.filter((r) => r.action === 'skip').length,
      errors: validated.filter((r) => r.action === 'error').length,
      // Mutually exclusive from willSkip/errors — "will be created, but with
      // a caveat" (e.g. an unmatched department), not a duplicate-email or
      // missing-required-field row (those are already their own counts).
      warnings: validated.filter((r) => r.action === 'create' && r.issues.length > 0).length,
    },
  });
});

// POST /contacts/import { rows, mapping } — the actual commit.
const commit = asyncHandler(async (req, res) => {
  const { rows, mapping } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) throw new ApiError(400, 'rows is required', 'VALIDATION_ERROR');
  requireMapping(mapping);

  const lookups = await buildLookups(req.user);
  const validated = validateRows(rows, mapping, lookups);

  let created = 0;
  let skipped = 0;
  const errors = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const r of validated) {
    if (r.action === 'error') {
      errors.push({ rowIndex: r.rowIndex, reason: r.issues.map((i) => i.message).join('; ') });
      continue; // eslint-disable-line no-continue
    }
    if (r.action === 'skip') {
      skipped += 1;
      continue; // eslint-disable-line no-continue
    }
    const rec = r.record;
    const deptId = rec.department ? lookups.deptByKey.get(deptKey(rec.companyId, rec.department)) || null : null;
    try {
      // eslint-disable-next-line no-await-in-loop
      const contact = await Contact.create({
        firstName: rec.firstName || '',
        lastName: rec.lastName || '',
        displayName: `${rec.firstName || ''} ${rec.lastName || ''}`.trim() || rec.email,
        email: rec.email || null,
        phone: normalizePhoneLenient(rec.phone),
        mobile: normalizePhoneLenient(rec.mobile),
        companyId: rec.companyId,
        departmentId: deptId,
        jobTitle: rec.jobTitle || null,
        assignedTo: req.user.id,
        createdBy: req.user.id,
      });
      // eslint-disable-next-line no-await-in-loop
      await logContactActivity(contact.id, req.user.id, 'csv_imported', { displayName: contact.displayName });
      created += 1;
      // Keeps later rows in this same batch catching duplicates against
      // contacts this loop just created, not only pre-existing ones.
      if (rec.email) lookups.emailToId.set(rec.email.toLowerCase(), contact.id);
    } catch (err) {
      errors.push({ rowIndex: r.rowIndex, reason: err.message || 'Unknown error' });
    }
  }

  await writeAudit(req, 'contact.import', 'Contact', null, { created, skipped, failed: errors.length });

  res.json({ created, skipped, failed: errors.length, errors });
});

module.exports = { sample, parseUpload, validate, commit };
