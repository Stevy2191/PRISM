const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeCompany } = require('../integration/fixtures');
const { startMockMicrosoft } = require('../integration/mockMicrosoft');
const {
  TENANT, GROUP, uid, person,
} = require('../integration/m365Fixtures');
const { encryptToken } = require('../../src/utils/tokenCrypto');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 7b, task 7: the company's Microsoft 365 tab, the Microsoft app
// in Settings, the contact block, and Sign in with Microsoft in the portal,
// against a fake Microsoft.

const DESKTOP = { viewport: { width: 1280, height: 900 } };
let smoke;
let ms;
let w;
let company;
let billing;

const member = (n, department) => ({
  id: uid(n), displayName: `Person ${n}`, givenName: 'Person', surname: String(n), mail: `person${n}@tenant.test`, accountEnabled: true, department,
});

beforeAll(async () => {
  smoke = await startSmoke();
  ms = await startMockMicrosoft();
  process.env.MS_LOGIN_BASE = ms.loginBase;
  process.env.MS_GRAPH_BASE = ms.graphBase;
  // Microsoft sends the browser back to PUBLIC_APP_URL: this server.
  process.env.PUBLIC_APP_URL = smoke.base;
  await resetData();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  company = await makeCompany(w.admin, { name: 'Tenant Co' });
  billing = await models.Department.create({ companyId: company.id, name: 'Billing' });
  ms.tenants = {
    [TENANT]: {
      users: { [uid(1)]: member(1, 'Billing Dept'), [uid(2)]: member(2, 'Billing Dept'), [uid(9)]: member(9, null) },
      groups: {
        [GROUP]: { name: 'Portal users', members: [uid(1), uid(2)] },
        'a0000000-0000-0000-0000-000000000005': { name: 'Service accounts', members: [uid(9)] },
      },
    },
  };
});

afterAll(async () => {
  delete process.env.MS_LOGIN_BASE;
  delete process.env.MS_GRAPH_BASE;
  delete process.env.PUBLIC_APP_URL;
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await models.SystemSettings.destroy({ where: { key: ['portal.msClientId', 'portal.msClientSecret'] } });
  await ms.close();
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('Settings saves the Microsoft app, never shows the secret, and tests it', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/settings/client-portal');
  const app = page.getByRole('region', { name: 'Microsoft 365 app' });
  await app.getByLabel('Application (client) ID').fill(ms.clientId);
  await app.getByLabel('Client secret').fill(ms.clientSecret);
  await app.getByRole('button', { name: 'Save' }).click();
  await app.getByText('Stored encrypted.').waitFor();
  expect(await app.getByLabel('Redirect address').inputValue()).toBe(`${smoke.base}/api/v1/portal/auth/microsoft/callback`);
  await page.reload();
  await page.getByRole('region', { name: 'Microsoft 365 app' }).getByText('Stored encrypted.').waitFor();
  expect(await page.content()).not.toContain(ms.clientSecret);
  // No tenant linked yet: nothing to test against.
  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByText('Nothing to test against').waitFor();
});

it('staff link a tenant, pick a sync group, Sync now, and map a detected department', async () => {
  // A contact of the company the sync links by email.
  await models.Contact.create({ firstName: 'Per', displayName: 'Per One', email: 'person1@tenant.test', companyId: company.id });
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/companies/${company.id}`);
  await page.getByRole('button', { name: 'Microsoft 365' }).click();
  await page.getByLabel('Tenant ID').fill(TENANT);
  await page.getByRole('region', { name: 'Microsoft 365 tenant' }).getByRole('button', { name: 'Save' }).click();
  await page.getByText('Waiting for approval').waitFor();

  const groups = page.getByRole('region', { name: 'Sync groups' });
  await groups.getByLabel('Find a group').fill('portal');
  await groups.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('list', { name: 'Groups found' }).getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save groups' }).click();
  await page.getByRole('list', { name: 'Chosen sync groups' }).getByText('Portal users').waitFor();

  await page.getByRole('button', { name: 'Sync now' }).click();
  const summary = page.getByLabel('Last sync');
  await summary.getByText('contacts updated').waitFor();
  expect(await summary.textContent()).toMatch(/1\s*new detected departments/);

  const detected = page.getByRole('region', { name: 'Detected departments' });
  await detected.getByRole('cell', { name: 'Billing Dept' }).waitFor();
  await detected.getByText('Looks like').waitFor();
  await detected.getByRole('button', { name: 'Map', exact: true }).click();
  await detected.getByText('Nothing to sort out.').waitFor();
  const linked = await models.Contact.findOne({ where: { email: 'person1@tenant.test' } });
  expect(linked).toMatchObject({ msObjectId: uid(1), departmentId: billing.id });

  // The contact's support-portal block: Microsoft, and no invite.
  await page.goto(`/contacts/${linked.id}`);
  const block = page.getByRole('region', { name: 'Support portal' });
  await block.getByText('Password sign-in is off for this contact.').waitFor();
  expect(await block.getByRole('button', { name: /portal invite/ }).count()).toBe(0);
});

it('Sign in with Microsoft signs a sync-group member in, and shows a non-member why not', async () => {
  const context = await smoke.browser.newContext({ baseURL: smoke.base, ...DESKTOP });
  const page = await context.newPage();
  ms.nextSignIn = person(2);
  await page.goto('/portal/sign-in');
  await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
  await page.waitForURL(/\/portal\/tickets/);
  const me = await context.request.get('/api/v1/portal/me');
  expect((await me.json()).contact).toMatchObject({ email: 'person2@tenant.test', signInMethod: 'microsoft' });

  const other = await (await smoke.browser.newContext({ baseURL: smoke.base, ...DESKTOP })).newPage();
  ms.nextSignIn = person(9);
  await other.goto('/portal/sign-in');
  await other.getByRole('link', { name: 'Sign in with Microsoft' }).click();
  await other.waitForURL(/refused=not_in_groups/);
  await other.getByRole('region', { name: 'Microsoft account not allowed' }).getByText("Your account isn't set up for this portal").waitFor();
});
