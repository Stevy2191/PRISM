// Timesheets (Phase 3, step 3): /timesheets. Everyone who logs time sees and
// submits their own weeks; approvers (money.timesheets.approve) see the
// weeks of the people they decide for, and approve or send them back.
const { asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const timesheets = require('../services/time/timesheets');

const mine = asyncHandler(async (req, res) => {
  res.json({ timesheet: await timesheets.weekOf(req.user.id, req.query.week || null) });
});

const submit = asyncHandler(async (req, res) => {
  const sheet = await timesheets.submit(req.user, (req.body || {}).week || null);
  await writeAudit(req, 'timesheet.submit', 'Timesheet', sheet.id, { weekStart: sheet.weekStart, totalSeconds: sheet.totalSeconds });
  res.json({ timesheet: sheet });
});

const pending = asyncHandler(async (req, res) => {
  res.json({ timesheets: await timesheets.pending(req.user, { status: req.query.status || 'submitted' }) });
});

const decide = (approve) => asyncHandler(async (req, res) => {
  const sheet = await timesheets.decide(req.user, req.params.id, { approve, note: (req.body || {}).note });
  await writeAudit(req, approve ? 'timesheet.approve' : 'timesheet.reject', 'Timesheet', sheet.id, { userId: sheet.userId, weekStart: sheet.weekStart });
  res.json({ timesheet: sheet });
});

module.exports = {
  mine, submit, pending, approve: decide(true), reject: decide(false),
};
