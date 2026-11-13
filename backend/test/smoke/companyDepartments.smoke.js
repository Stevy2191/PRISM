const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { openCompanyTab } = require('./companyTabs');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Companies, their departments and their contacts kept apart: Settings →
// Departments is the help desk's own; a client's are on its company page;
// the Contacts list shows each contact's company and filters departments by
// the chosen company.

let smoke;
let w;
let acme;
let bee;
const DESKTOP = { viewport: { width: 1440, height: 900 } };
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme' });
  bee = await makeCompany(w.admin, { name: 'Bee Co' });
  for (const c of [acme, bee]) {
    const hr = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'HR', companyId: c.id }), 201).department;
    await models.Contact.create({ firstName: `Pat ${c.name}`, lastName: 'Lee', displayName: `Pat ${c.name}`, email: `pat@${c.id}.test`, companyId: c.id, departmentId: hr.id });
  }
});

it('Settings → Departments lists only the help desk\'s own departments', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/admin/departments');
  await page.getByText(w.deptA.name, { exact: true }).waitFor();
  await page.getByText(/A client.s departments are on its page/).waitFor();
  expect(await page.getByText('HR', { exact: true }).count()).toBe(0);
  // A new one goes to the help desk's own company, with no company to pick.
  await page.getByRole('button', { name: '+ New department' }).click();
  expect(await page.getByLabel('Company').count()).toBe(0);
});

it('a client\'s departments are renamed and deleted on its company page', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/companies/${acme.id}`);
  await openCompanyTab(page, 'People', 'Departments');
  page.once('dialog', (d) => d.accept('People'));
  await page.getByRole('button', { name: 'Rename HR' }).click();
  await page.getByText('People', { exact: true }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete People' }).click();
  await page.getByText('No departments yet.').waitFor();
  // Bee Co's HR is untouched.
  expect(await models.Department.count({ where: { companyId: bee.id, name: 'HR' } })).toBe(1);
});

it('Contacts shows each contact\'s company, and the department filter follows the company', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/contacts');
  await page.getByRole('columnheader', { name: 'Company' }).waitFor();
  const row = page.getByRole('row').filter({ hasText: 'Pat Acme' });
  await row.getByRole('link', { name: 'Acme', exact: true }).waitFor();

  // All companies: departments grouped under each company.
  const dept = page.getByLabel('Department');
  expect(await dept.locator('optgroup').evaluateAll((gs) => gs.map((g) => g.label))).toEqual(expect.arrayContaining(['Acme', 'Bee Co']));
  // One company: only its departments.
  await page.getByLabel('Company').selectOption(String(acme.id));
  await page.waitForFunction(() => !document.querySelector('select[aria-label="Department"] optgroup'));
  const names = await dept.locator('option').allTextContents();
  expect(names).toEqual(['All departments', 'HR']);
  await page.getByRole('row').filter({ hasText: 'Pat Acme' }).first().waitFor();
  await page.getByRole('row').filter({ hasText: 'Pat Bee Co' }).waitFor({ state: 'detached' });
});
