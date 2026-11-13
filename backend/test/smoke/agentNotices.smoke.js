const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeCompany } = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { openCompanyTab } = require('./companyTabs');

// Agent notices: a tech posts one on the company's page and takes it down.

let smoke;
let w;
let company;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('post a notice for the company, see it listed, take it down', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${company.id}`);
  await openCompanyTab(page, 'Assets', 'Agent notices');
  const list = page.getByTestId('agent-notices');
  await list.getByText('No notices are showing.').waitFor();
  await page.getByLabel('Headline').fill('Email is slow this morning');
  await page.getByLabel('Message (optional)').fill('We are on it.');
  await page.getByRole('button', { name: 'Post notice' }).click();
  await list.getByText('Email is slow this morning').waitFor();
  const row = await models.AgentNotice.findOne({ where: { companyId: company.id } });
  expect(row).toMatchObject({ headline: 'Email is slow this morning', message: 'We are on it.', removedAt: null });
  expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now());
  await list.getByRole('button', { name: 'Take down' }).click();
  await list.getByText('No notices are showing.').waitFor();
  expect((await models.AgentNotice.findByPk(row.id)).removedAt).not.toBeNull();
});
