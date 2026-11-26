const { resetData, closeDb, models } = require('../integration/helpers');
const {
  makeWorld, makeTicket, makeTech, makeManager,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Phase 3, step 3, task 8: Tess submits her week; Mia, her manager,
// approves it.

let smoke;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  const w = await makeWorld();
  const tess = await makeTech('tess', w.deptA.id);
  await makeManager('mia', w.deptA.id);
  const ticket = await makeTicket(w.admin.agent, { title: 'Printer jam', contactId: w.contact.id });
  const workType = await models.WorkType.findOne({ where: { isActive: true } });
  await models.TimeEntry.create({
    ticketId: ticket.id, userId: tess.user.id, loggedById: tess.user.id, entryDate: new Date().toISOString().slice(0, 10), durationSeconds: 5400, workTypeId: workType.id, note: 'Cleared the jam',
  });
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('Tess submits her week and Mia approves it', async () => {
  const tess = await smoke.pageAs('tess');
  await tess.goto('/timesheets');
  await tess.getByTestId('timesheet').getByText('Cleared the jam — 1.5 h').waitFor();
  expect(await tess.getByTestId('timesheet-total').textContent()).toBe('1.5 h');
  await tess.getByRole('button', { name: 'Submit this week' }).click();
  await tess.getByText('Submitted', { exact: true }).waitFor();
  expect(await tess.getByRole('button', { name: 'Submit this week' }).count()).toBe(0);

  const mia = await smoke.pageAs('mia');
  await mia.goto('/timesheets');
  await mia.getByRole('tab', { name: 'To approve' }).click();
  const approvals = mia.getByTestId('timesheet-approvals');
  await approvals.getByText('Test tess').waitFor();
  await approvals.getByRole('button', { name: 'Approve' }).click();
  await approvals.getByText('Nothing waiting.').waitFor();
});
