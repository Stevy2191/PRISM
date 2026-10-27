// Mail is recorded, not sent.
jest.mock('../../src/services/emailSender', () => ({
  ...jest.requireActual('../../src/services/emailSender'),
  sendMail: jest.fn(async () => ({})),
}));

const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeCompany, makeContact, makeTech, waitFor,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { sendMail } = require('../../src/services/emailSender');

// Sub-project 7a: the staff screens for portal access, admins, contact
// watchers, article audiences and the portal switch.

const DESKTOP = { viewport: { width: 1280, height: 900 } };
const PHONE = { viewport: { width: 375, height: 812 } };
const TITLE = 'Portal staff smoke: billing scans';

let smoke;
let w; let alpha; let billing; let maria; let tom; let ticket;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await models.KbArticle.destroy({ where: { title: TITLE } });
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
  await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Riverside Family Clinic' });
  billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  maria = await makeContact(w.admin, { firstName: 'Maria', lastName: 'Chen', companyId: alpha.id, departmentId: billing.id });
  tom = await makeContact(w.admin, { firstName: 'Tom', lastName: 'Baker', companyId: alpha.id, departmentId: billing.id });
  ticket = await makeTicket(a, { title: 'Scanner offline', contactId: maria.id });
  await makeTech('tess', w.deptA.id);
});
afterAll(async () => {
  await models.KbArticle.destroy({ where: { title: TITLE } });
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('turning portal access on and sending an invite from the contact page', async () => {
  sendMail.mockClear();
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/contacts/${maria.id}`);
  const block = page.getByRole('region', { name: 'Support portal' });
  await block.getByText('Not set up yet').waitFor();
  await block.getByRole('button', { name: 'Send portal invite' }).click();
  await block.getByRole('status').filter({ hasText: 'Invite sent' }).waitFor();
  await waitFor(() => sendMail.mock.calls.length > 0, 5000);
  expect(await block.getByRole('switch', { name: /Portal access for/ }).getAttribute('aria-checked')).toBe('true');
  await block.getByRole('switch', { name: /Portal access for/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label^="Portal access for"]')?.getAttribute('aria-checked') === 'false');
  expect((await models.Contact.findByPk(maria.id)).portalAccess).toBe(false);
  await page.context().close();
});

it('a staff user without portal.manage sees the block read-only and no invite button', async () => {
  const page = await smoke.pageAs('tess', undefined, DESKTOP);
  await page.goto(`/contacts/${tom.id}`);
  const block = page.getByRole('region', { name: 'Support portal' });
  await block.getByText('Portal access').first().waitFor();
  expect(await block.getByRole('switch').isDisabled()).toBe(true);
  expect(await block.getByRole('button', { name: /portal invite/ }).count()).toBe(0);
  await page.context().close();
});

it('marking a department admin and a company admin', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/companies/${alpha.id}`);
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('heading', { name: 'Company admins' }).waitFor();
  await page.getByLabel('Add a company admin').fill('Tom');
  await page.getByRole('option', { name: /Tom Baker/ }).click();
  await page.getByRole('button', { name: 'Remove Tom Baker as company admin' }).waitFor();
  await page.getByRole('button', { name: 'Add admin' }).click();
  await page.getByLabel('Add a Billing admin').fill('Maria');
  await page.getByRole('option', { name: /Maria Chen/ }).click();
  await page.getByRole('button', { name: 'Remove Maria Chen as Billing admin' }).waitFor();
  expect(await models.CompanyPortalAdmin.count({ where: { companyId: alpha.id, contactId: tom.id } })).toBe(1);
  expect(await models.DepartmentPortalAdmin.count({ where: { departmentId: billing.id, contactId: maria.id } })).toBe(1);
  await page.context().close();
});

it('adding a contact watcher from the ticket page', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByLabel('Add a watcher').first().fill('Tom');
  await page.getByRole('option', { name: /Tom Baker/ }).click();
  await page.getByText('Contact', { exact: true }).first().waitFor();
  const row = await models.TicketWatcher.findOne({ where: { ticketId: ticket.id, contactId: tom.id } });
  expect(row).toBeTruthy();
  await page.getByRole('button', { name: 'Remove Tom Baker' }).first().click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Remove Tom Baker"]'));
  expect(await models.TicketWatcher.count({ where: { ticketId: ticket.id, contactId: tom.id } })).toBe(0);
  await page.context().close();
});

it('choosing "Chosen departments" on an article and saving', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto('/knowledge/new');
  await page.getByPlaceholder(/title/i).first().fill(TITLE);
  await page.getByLabel('Audience').selectOption('portal');
  await page.getByLabel(/Chosen departments/).check();
  await page.getByLabel('Add a department').selectOption({ label: 'Riverside Family Clinic › Billing' });
  await page.getByRole('button', { name: 'Remove Riverside Family Clinic › Billing' }).waitFor();
  await page.getByRole('button', { name: /Create article/ }).click();
  await page.waitForURL(/\/knowledge\/\d+\/edit/);
  const art = await models.KbArticle.findOne({ where: { title: TITLE } });
  expect([art.visibility, art.portalScope]).toEqual(['portal', 'departments']);
  expect((await models.KbArticleAudience.findAll({ where: { articleId: art.id } })).map((r) => r.departmentId)).toEqual([billing.id]);
  await page.reload();
  await page.getByRole('button', { name: 'Remove Riverside Family Clinic › Billing' }).waitFor();
  await page.context().close();
});

it('Settings → Client portal switch persists', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto('/settings/client-portal');
  const sw = page.getByRole('switch', { name: 'Portal on' });
  await sw.waitFor();
  expect(await sw.getAttribute('aria-checked')).toBe('false');
  await sw.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Portal on"]')?.getAttribute('aria-checked') === 'true');
  await page.reload();
  await page.getByRole('switch', { name: 'Portal on' }).waitFor();
  expect(await page.getByRole('switch', { name: 'Portal on' }).getAttribute('aria-checked')).toBe('true');
  expect(await page.getByLabel('Portal address').inputValue()).toMatch(/\/portal$/);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  await page.context().close();
});
