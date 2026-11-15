const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { openCompanyTab } = require('./companyTabs');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Setup › What applies here (CS part 4): bundles on or off for the company,
// and the rules, recurring tickets and custom fields that reach it.

const PHONE = { viewport: { width: 375, height: 812 } };
let smoke; let w; let acme; let bundle;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await models.Playbook.destroy({ where: {} });
  w = await makeWorld();
  acme = await makeCompany(w.admin, { name: 'Acme Manufacturing' });
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Steps', usage: 'ticket', definition: { sections: [{ key: 's', title: 'Steps', items: [{ key: 'a', kind: 'step', body: 'Do it' }] }] },
  }), 201).form;
  bundle = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({ name: 'New account', blocks: [{ formId: form.id, applies: 'once' }] }), 201).playbook;
});
afterAll(async () => {
  await models.Playbook.destroy({ where: {} });
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('turns a bundle off for this company, and starts a recurring ticket for it', async () => {
  const page = await smoke.pageAs('admin', undefined, PHONE);
  await page.goto(`/companies/${acme.id}`);
  await openCompanyTab(page, 'Setup', 'What applies here');
  const sw = page.getByRole('switch', { name: 'Offer New account' });
  await sw.waitFor();
  expect(await sw.getAttribute('aria-checked')).toBe('true');
  await sw.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Offer New account"]')?.getAttribute('aria-checked') === 'false');
  expect((await models.Playbook.findByPk(bundle.id)).exceptCompanyIds).toEqual([acme.id]);
  await page.getByRole('region', { name: 'Workflow rules' }).waitFor();
  await page.getByRole('region', { name: 'Custom fields' }).waitFor();
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  await page.getByRole('link', { name: 'New for Acme Manufacturing' }).click();
  await page.waitForURL(new RegExp(`/settings/recurring-tickets/new\\?companyId=${acme.id}`));
  await page.context().close();
});
