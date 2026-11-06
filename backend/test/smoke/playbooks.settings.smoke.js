const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Playbooks (PB, task 12): Settings › Forms, Playbooks and MDMs, and the
// asset form's management and cellular fields.

let smoke;
let w;
let page;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('MDMs: add one, and retire it', async () => {
  await page.goto('/settings/mdms');
  await page.getByLabel('New MDM name').fill('MDM A');
  await page.getByLabel('New MDM console address').fill('https://a.example/devices/{id}');
  await page.getByRole('button', { name: 'Add MDM' }).click();
  await page.getByLabel('MDM A active').waitFor();
  await page.getByLabel('MDM A active').uncheck();
  await page.getByText('Retired').waitFor();
  expect((await models.Mdm.findOne({ where: { name: 'MDM A' } })).isActive).toBe(false);
  await models.Mdm.update({ isActive: true }, { where: { name: 'MDM A' } });
});

it('Form builder: a yes/no question, a step that shows only on yes; saved as version 1, then 2', async () => {
  await page.goto('/settings/forms/new');
  await page.getByTestId('form-name').fill('Leaving checklist');
  await page.getByTestId('form-usage').selectOption('ticket');
  await page.getByTestId('add-field').click();
  await page.getByTestId('item-label').fill('Is the person leaving?');
  await page.getByLabel('Type').selectOption('yesno');
  await page.getByTestId('add-step').click();
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.getByLabel('Condition is about').selectOption({ label: 'Is the person leaving?' });
  await page.getByLabel('Value').selectOption({ label: 'Yes' });
  await page.getByTestId('save-form').click();
  await page.waitForURL(/\/settings\/forms\/\d+$/);
  const form = await models.Form.findOne({ where: { name: 'Leaving checklist' }, include: ['currentVersion'] });
  const items = form.currentVersion.definition.sections[0].items;
  expect(items[1].showWhen).toEqual([{ on: 'answer', field: items[0].key, op: 'is', value: true }]);
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await page.getByRole('button', { name: 'Save as version 3' }).waitFor();
});

it('Playbook editor: a per-device form for managed devices; try it on someone', async () => {
  const company = await makeCompany(w.admin, { name: 'County' });
  const jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes' });
  const category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  await models.Asset.create({ assetTag: 'SM-P1', name: 'Laptop', categoryId: category.id, companyId: company.id, assignedToContactId: jordan.id, isManaged: true, mdmId: (await models.Mdm.findOne()).id });
  await models.Asset.create({ assetTag: 'SM-P2', name: 'Old tablet', categoryId: category.id, companyId: company.id, assignedToContactId: jordan.id });
  const dev = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Device check-in', usage: 'device', definition: { sections: [{ key: 's', title: 'S', items: [{ key: 'w', kind: 'step', body: 'Wipe', required: true }] }] },
  }), 201).form;

  await page.goto('/settings/playbooks/new');
  await page.getByTestId('playbook-name').fill('Termination');
  await page.getByTestId('needs-person').check();
  await page.getByTestId('add-block').click();
  await page.getByTestId('block-form-0').selectOption(String(dev.id));
  await page.getByTestId('block-applies-0').selectOption('person_devices');
  await page.getByLabel('Managed').selectOption('true');
  await page.getByTestId('save-playbook').click();
  await page.waitForURL(/\/settings\/playbooks\/\d+$/);
  const playbook = await models.Playbook.findOne({ where: { name: 'Termination' } });
  expect(playbook.blocks[0]).toMatchObject({ formId: dev.id, applies: 'person_devices', limits: { managed: true } });

  await page.getByLabel('Try on contact').fill('Jordan');
  await page.getByRole('button', { name: 'Jordan Reyes' }).click();
  const result = page.getByTestId('try-result');
  await result.getByText('Device check-in').waitFor();
  await result.getByText('Not covered · Old tablet').waitFor();
});

it('the asset form: managed by an MDM, and a phone line', async () => {
  const category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  const asset = await models.Asset.create({ assetTag: 'SM-A1', name: 'Field laptop', categoryId: category.id, companyId: (await models.Company.findOne({ where: { isInternal: true } })).id });
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.getByRole('group', { name: 'Managed' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByTestId('mdm-select').selectOption({ label: 'MDM A' });
  await page.getByRole('group', { name: 'Cellular' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByLabel('IMEI').fill('353918114826114');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('353918114826114').waitFor();
  const fresh = await models.Asset.findByPk(asset.id);
  expect(fresh).toMatchObject({ isManaged: true, hasCellular: true, imei: '353918114826114' });
});
