// A company's own SLA (CS part 2): GET/PUT /companies/:id/sla, its holidays,
// and "reset to the starting values"; and the starting values themselves
// (GET/PUT /sla/starting-values, and their holidays). Reading needs the
// company; changing needs "System settings" (as SLAs always have).
const { asyncHandler, ApiError } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission } = require('../services/permissionService');
const sla = require('../services/sla/companySla');
const { loadAccessibleCompany } = require('./companiesController');

async function assertCanChange(req) {
  if (!(await hasPermission(req.user.id, 'settings.manage_system'))) {
    throw new ApiError(403, 'Changing an SLA needs the System settings permission', 'FORBIDDEN');
  }
}

async function companyRow(req) {
  const company = await loadAccessibleCompany(req);
  return { company, row: await sla.ensureCompanySla(company) };
}

const get = asyncHandler(async (req, res) => {
  const { row } = await companyRow(req);
  res.json({ sla: await sla.presentSla(row), canChange: await hasPermission(req.user.id, 'settings.manage_system') });
});

const save = asyncHandler(async (req, res) => {
  await assertCanChange(req);
  const { company, row } = await companyRow(req);
  await sla.saveSla(row, req.body || {});
  await writeAudit(req, 'company.sla', 'Company', company.id, { fields: Object.keys(req.body || {}) });
  res.json({ sla: await sla.presentSla(row) });
});

const addHoliday = asyncHandler(async (req, res) => {
  await assertCanChange(req);
  const { company, row } = await companyRow(req);
  const day = await sla.addHoliday(row, req.body || {});
  await writeAudit(req, 'company.holiday.add', 'Company', company.id, { name: day.name, date: day.date });
  res.status(201).json({ sla: await sla.presentSla(row) });
});

const removeHoliday = asyncHandler(async (req, res) => {
  await assertCanChange(req);
  const { company, row } = await companyRow(req);
  await sla.removeHoliday(row, req.params.holidayId);
  await writeAudit(req, 'company.holiday.remove', 'Company', company.id, { holidayId: Number(req.params.holidayId) });
  res.json({ sla: await sla.presentSla(row) });
});

const reset = asyncHandler(async (req, res) => {
  await assertCanChange(req);
  const { company, row } = await companyRow(req);
  await sla.resetToStartingValues(row);
  await writeAudit(req, 'company.sla.reset', 'Company', company.id, {});
  res.json({ sla: await sla.presentSla(row) });
});

// ---- Starting values: Settings › Hours & SLAs ------------------------------

const getStart = asyncHandler(async (req, res) => {
  res.json({ sla: await sla.presentSla(await sla.startingValues()) });
});

const saveStart = asyncHandler(async (req, res) => {
  const row = await sla.startingValues();
  await sla.saveSla(row, req.body || {});
  await writeAudit(req, 'sla.startingValues', 'SlaPolicy', row.id, { fields: Object.keys(req.body || {}) });
  res.json({ sla: await sla.presentSla(row) });
});

const addStartHoliday = asyncHandler(async (req, res) => {
  const row = await sla.startingValues();
  await sla.addHoliday(row, req.body || {});
  res.status(201).json({ sla: await sla.presentSla(row) });
});

const removeStartHoliday = asyncHandler(async (req, res) => {
  const row = await sla.startingValues();
  await sla.removeHoliday(row, req.params.holidayId);
  res.json({ sla: await sla.presentSla(row) });
});

module.exports = {
  get, save, addHoliday, removeHoliday, reset, getStart, saveStart, addStartHoliday, removeStartHoliday,
};
