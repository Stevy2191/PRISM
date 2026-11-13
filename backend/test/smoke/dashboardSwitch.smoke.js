const { resetData, closeDb, createUser, ROLE } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// "Whose dashboard": picking another person swaps the system-wide dashboard
// for that person's. The page used to go blank: for a moment it drew the
// system-wide panels (activity feed, team workload) with a personal
// dashboard's data, which has neither.

let smoke;
let w;
let other;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  other = await createUser({ username: 'second_admin', roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: w.deptA.id });
  await makeTicket(w.admin.agent, { title: 'Assigned to the second admin', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: other.user.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it("switches to another administrator's dashboard and back without breaking", async () => {
  const page = await smoke.pageAs('admin');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/dashboard');
  const whose = page.getByLabel('Whose dashboard');
  await page.getByText('Activity Feed').first().waitFor();

  await whose.selectOption({ label: 'Test second_admin' });
  await page.getByText("Viewing Test second_admin's dashboard").waitFor();
  await page.getByRole('link', { name: /Assigned to the second admin/ }).first().waitFor();

  await whose.selectOption({ label: 'Test admin' });
  await page.getByText("Viewing Test admin's dashboard").waitFor();

  await whose.selectOption({ index: 0 }); // All users (system wide)
  await page.getByText('Activity Feed').first().waitFor();
  expect(errors).toEqual([]);
});
