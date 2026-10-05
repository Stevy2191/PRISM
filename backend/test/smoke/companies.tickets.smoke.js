const { resetData, closeDb, models } = require('../integration/helpers');
const {
  makeAdmin, makeCompany, makeTech, makeDept, setCompanyAccess,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 13.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a new ticket for a client contact shows the company and offers only that company\'s departments and people', async () => {
  const admin = await makeAdmin();
  const home = await makeDept(admin, 'Service Desk', 'SD');
  const acme = await makeCompany(admin, { name: 'Acme' });
  await models.Department.create({ name: 'Acme HR', companyId: acme.id });
  await models.Contact.create({ firstName: 'Ann', displayName: 'Ann Acme', companyId: acme.id });
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const outsider = await makeTech('outsider', home.id);
  await setCompanyAccess(admin, outsider.user.id, { allCompanies: false, companyIds: [internal.id] });

  const page = await smoke.pageAs('admin');
  await page.goto('/tickets/new');
  await page.getByPlaceholder('Search contacts by name or email…').fill('Ann');
  await page.getByRole('button', { name: /Ann Acme/ }).click();
  await page.getByText('Company: Acme').waitFor();
  const deptOptions = await page.locator('select').filter({ hasText: 'Acme HR' }).first().locator('option').allTextContents();
  expect(deptOptions).not.toContain('Service Desk');
  const assigneeOptions = await page.locator('select').filter({ hasText: 'Unassigned' }).first().locator('option').allTextContents();
  expect(assigneeOptions).not.toContain('Test outsider');
});

// Regression guard (written after the change, ledgered): the ticket page
// labels the contact with the ticket's company.
it('the ticket page shows the contact\'s company', async () => {
  const { makeTicket } = require('../integration/fixtures'); // eslint-disable-line global-require
  const admin = await makeAdmin();
  const acme = await makeCompany(admin, { name: 'Acme' });
  const ann = await models.Contact.create({ firstName: 'Ann', displayName: 'Ann Acme', companyId: acme.id });
  const t = await makeTicket(admin.agent, { title: 'Acme printer', contactId: ann.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${t.id}`);
  await page.getByText('· Acme').first().waitFor();
});
