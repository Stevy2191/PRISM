// The billing run (Phase 3, step 3): POST /money/billing-run drafts every
// customer's invoice for the month; GET /money/billing-run/preview shows
// what it would draft and writes nothing. money.billing.manage.
const { ApiError, asyncHandler } = require('../../middleware/error');
const { getUserCompanyIds } = require('../../services/permissionService');
const { writeAudit } = require('../../middleware/audit');
const { billingRun } = require('../../services/money/billingRun');

// The run covers every customer, so it needs reach over all of them.
async function assertAllCompanies(user) {
  if ((await getUserCompanyIds(user)) !== null) {
    throw new ApiError(403, 'The billing run covers every customer; it needs access to all companies', 'FORBIDDEN');
  }
}

const run = asyncHandler(async (req, res) => {
  await assertAllCompanies(req.user);
  const result = await billingRun({ runDate: (req.body || {}).runDate || null, userId: req.user.id });
  await writeAudit(req, 'money.billing.run', 'Invoice', null, { runDate: result.runDate, drafted: result.drafted.length });
  res.json(result);
});

const preview = asyncHandler(async (req, res) => {
  await assertAllCompanies(req.user);
  const result = await billingRun({ runDate: req.query.runDate || null, userId: req.user.id, preview: true });
  res.json({ runDate: result.runDate, drafts: result.drafted, skipped: result.skipped });
});

module.exports = { run, preview };
