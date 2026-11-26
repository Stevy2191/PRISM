// The billing run (Phase 3, step 3): POST /money/billing-run drafts every
// customer's invoice for the month; GET /money/billing-run/preview shows
// what it would draft and writes nothing. money.billing.manage.
const { asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { billingRun } = require('../../services/money/billingRun');

const run = asyncHandler(async (req, res) => {
  const result = await billingRun({ runDate: (req.body || {}).runDate || null, userId: req.user.id });
  await writeAudit(req, 'money.billing.run', 'Invoice', null, { runDate: result.runDate, drafted: result.drafted.length });
  res.json(result);
});

const preview = asyncHandler(async (req, res) => {
  const result = await billingRun({ runDate: req.query.runDate || null, userId: req.user.id, preview: true });
  res.json({ runDate: result.runDate, drafts: result.drafted, skipped: result.skipped });
});

module.exports = { run, preview };
