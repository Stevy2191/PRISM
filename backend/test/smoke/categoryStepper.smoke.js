const bcrypt = require('bcryptjs');
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 9, task 6: the step-by-step category picker on the portal
// (Other / I'm not sure at every step, then Which app?), and Which app? on
// staff tickets. Only the ticket company's tree and apps are offered.

const PASSWORD = 'Harbour-Lights-2026';
let smoke;
let w;
let alpha;
let beta;
let pat; // alpha's contact, signed in to the portal
let bob; // beta's contact
let apps;
let crashes;
let dentrix;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  beta = await makeCompany(w.admin, { name: 'Beta Law' });
  await models.Company.update({ portalEnabled: true }, { where: { id: alpha.id } });
  alpha = await models.Company.findByPk(alpha.id);
  pat = await makeContact(w.admin, { firstName: 'Pat', lastName: 'Plain', companyId: alpha.id });
  bob = await makeContact(w.admin, { firstName: 'Bob', lastName: 'Ray', companyId: beta.id });
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: await bcrypt.hash(PASSWORD, 4) }, { where: { id: pat.id } });
  const cat = async (body) => expectOk(await a.post(`${API}/ticket-categories`).send(body), 201).category;
  apps = await cat({ name: 'Software', companyId: alpha.id, pickKind: 'software', requireChild: true });
  crashes = await cat({ name: 'Crashes', parentId: apps.id, companyId: alpha.id });
  await cat({ name: 'Printing', companyId: alpha.id });
  await cat({ name: 'Court filings', companyId: beta.id });
  dentrix = expectOk(await a.post(`${API}/companies/${alpha.id}/catalog`).send({ kind: 'software', name: 'Dentrix' }), 201).item;
  expectOk(await a.post(`${API}/companies/${beta.id}/catalog`).send({ kind: 'software', name: 'Clio' }), 201);
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

async function portalPage() {
  const context = await smoke.browser.newContext({ baseURL: smoke.base });
  const res = await context.request.post(`/api/v1/portal/c/${alpha.portalSlug}/auth/login`, { data: { email: pat.email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`portal login failed: ${res.status()}`);
  return context.newPage();
}

it('portal: a choice is required; step by step down to the app reaches the ticket', async () => {
  const page = await portalPage();
  await page.goto(`/portal/${alpha.portalSlug}/tickets/new`);
  await page.getByLabel(/^Title/).fill('Dentrix crashes');
  await page.getByLabel(/^Description/).fill('Every time I open a chart.');
  const first = page.getByLabel("What's it about?");
  // Only Alpha's own tree.
  expect(await first.locator('option').allTextContents()).toEqual(['Choose…', 'Printing', 'Software', "Other / I'm not sure"]);
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.getByText("Choose what it's about, or Other / I'm not sure.").waitFor();

  await first.selectOption({ label: 'Software' });
  await page.getByLabel('More specifically').selectOption({ label: 'Crashes' });
  const which = page.locator('#nt-cat-app');
  expect(await which.locator('option').allTextContents()).toEqual(['Choose the app…', 'Dentrix', 'Not listed']);
  await which.selectOption({ label: 'Dentrix' });
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.waitForURL(/\/tickets\/\d+$/);
  const t = await models.Ticket.findOne({ where: { title: 'Dentrix crashes' } });
  expect(t).toMatchObject({ categoryId: crashes.id, categoryUnsure: false, catalogItemId: dentrix.id });
});

it('portal: not sure part way down, and Not listed, reach the ticket', async () => {
  const page = await portalPage();
  await page.goto(`/portal/${alpha.portalSlug}/tickets/new`);
  await page.getByLabel(/^Title/).fill('Some app is slow');
  await page.getByLabel(/^Description/).fill('Not sure which.');
  await page.getByLabel("What's it about?").selectOption({ label: 'Software' });
  await page.getByLabel('More specifically').selectOption({ label: "Other / I'm not sure" });
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.waitForURL(/\/tickets\/\d+$/);
  expect(await models.Ticket.findOne({ where: { title: 'Some app is slow' } })).toMatchObject({ categoryId: apps.id, categoryUnsure: true, catalogItemId: null });

  await page.goto(`/portal/${alpha.portalSlug}/tickets/new`);
  await page.getByLabel(/^Title/).fill('Our scheduler crashes');
  await page.getByLabel(/^Description/).fill('The new one.');
  await page.getByLabel("What's it about?").selectOption({ label: 'Software' });
  await page.getByLabel('More specifically').selectOption({ label: 'Crashes' });
  await page.locator('#nt-cat-app').selectOption({ label: 'Not listed' });
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.waitForURL(/\/tickets\/\d+$/);
  expect(await models.Ticket.findOne({ where: { title: 'Our scheduler crashes' } })).toMatchObject({ catalogItemNotListed: true });
});

it('staff: Which app? appears for a category that asks, from the ticket company\'s list, and saves', async () => {
  const page = await smoke.pageAs('admin');
  const t = expectOk(await w.admin.agent.post(`${API}/tickets`).send({ title: 'Chart crash', contactId: pat.id, categoryId: crashes.id }), 201).ticket;
  await page.goto(`/tickets/${t.id}`);
  const picker = page.getByTestId('sidebar-app').locator('select');
  await picker.waitFor();
  expect(await picker.locator('option').allTextContents()).toEqual(['Which app?', 'Dentrix', 'Not listed']);
  await picker.selectOption({ label: 'Dentrix' });
  await page.waitForFunction(async (id) => {
    const r = await fetch(`/api/v1/tickets/${id}`);
    return (await r.json()).ticket.catalogItemId != null;
  }, t.id);
  expect((await models.Ticket.findByPk(t.id)).catalogItemId).toBe(dentrix.id);

  // A ticket of another company whose category doesn't ask: no app step.
  const other = expectOk(await w.admin.agent.post(`${API}/tickets`).send({ title: 'Filing', contactId: bob.id }), 201).ticket;
  await page.goto(`/tickets/${other.id}`);
  await page.getByTestId('sidebar-category').waitFor();
  expect(await page.getByTestId('sidebar-app').count()).toBe(0);
});
