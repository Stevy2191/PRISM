const fs = require('fs');
const path = require('path');
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// PB2: Settings › Checklists. New checklist, paste to build, the editor (Turn
// into, indenting, Only for, Try it), the bundle sentence, and the old
// addresses redirecting.

let smoke;
let w;
let page;
let jamf;
let mac;

const CHECK_IN = fs.readFileSync(path.join(__dirname, '../fixtures/playbooks/apple-check-in.txt'), 'utf8');

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await models.AssetCategory.destroy({ where: { name: ['Mac', 'iPhone', 'iPad'] } });
  await models.Mdm.destroy({ where: { name: ['Jamf Pro', 'ManageEngine'] } });
  jamf = await models.Mdm.create({ name: 'Jamf Pro' });
  await models.Mdm.create({ name: 'ManageEngine' });
  mac = await models.AssetCategory.create({ name: 'Mac' });
  await models.AssetCategory.create({ name: 'iPhone' });
  await models.AssetCategory.create({ name: 'iPad' });
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

const allItems = (def) => def.sections.flatMap((s) => s.items);
async function storedForm(name) {
  return models.Form.findOne({ where: { name }, include: ['currentVersion'] });
}

it('New checklist: a device check-in from the pasted Apple document', async () => {
  await page.goto('/settings/checklists');
  await page.getByRole('button', { name: 'New checklist' }).click();
  await page.getByLabel('Name').fill('Apple device check-in');
  await page.getByRole('button', { name: /^A device/ }).click();
  await page.getByRole('button', { name: /^Check the device in/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Your document').fill(CHECK_IN);
  await page.getByRole('status').getByText('10 sections, 41 steps').waitFor();
  await page.getByRole('button', { name: 'Create checklist' }).click();
  await page.waitForURL(/\/settings\/checklists\/\d+$/);
  await page.getByRole('button', { name: 'Only for Jamf Pro · Mac' }).waitFor();

  const form = await storedForm('Apple device check-in');
  expect(form.usage).toBe('device');
  const items = allItems(form.currentVersion.definition);
  expect(items[items.length - 1]).toMatchObject({ kind: 'action', action: 'check_in' });
  expect(items.filter((i) => i.showWhen).length).toBe(7);
  expect(items.find((i) => /Wipe Computer/.test(i.body || '')).showWhen).toEqual([
    { on: 'device', field: 'mdm', op: 'in', value: [jamf.id] },
    { on: 'device', field: 'categoryId', op: 'in', value: [mac.id] },
  ]);
});

it('Printer setup: typed line by line, a yes/no question with a line under it', async () => {
  await page.goto('/settings/checklists');
  await page.getByRole('button', { name: 'New checklist' }).click();
  await page.getByLabel('Name').fill('Printer setup');
  await page.getByRole('button', { name: /^A blank checklist/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  const first = page.getByRole('textbox', { name: 'Step: empty' });
  await first.click();
  await page.keyboard.type('Unbox the printer and connect it to the network');
  for (const line of ['Install the driver on the computer', 'Print a test page', 'Is it a color printer?']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  // Turn the last line into a yes/no question.
  await page.getByRole('button', { name: /^Turn into/ }).click();
  await page.getByRole('menuitem', { name: 'Yes/no question' }).click();
  // Enter under a question starts its "If yes" group.
  await page.getByRole('textbox', { name: /^Ask: Is it a color printer/ }).press('Enter');
  await page.keyboard.type('Run the color calibration');
  await page.getByText('If yes:').waitFor();
  await page.getByRole('button', { name: 'Create checklist' }).click();
  await page.waitForURL(/\/settings\/checklists\/\d+$/);

  const form = await storedForm('Printer setup');
  expect(form.usage).toBe('ticket');
  const items = allItems(form.currentVersion.definition);
  expect(items.map((i) => i.kind)).toEqual(['step', 'step', 'step', 'field', 'step']);
  expect(items[3]).toMatchObject({ fieldType: 'yesno', label: 'Is it a color printer?' });
  expect(items[4].showWhen).toEqual([{ on: 'answer', field: items[3].key, op: 'is', value: true }]);
});

it('Only for: Jamf Pro and Mac on one line, with the sentence; Try it greys the rest', async () => {
  const form = await storedForm('Apple device check-in');
  await page.goto(`/settings/checklists/${form.id}`);
  const line = page.getByRole('textbox', { name: /^Step: Wait for the device to restart/ });
  await line.click();
  await page.getByRole('toolbar', { name: 'Line options' }).getByRole('button', { name: 'Only for…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Only for' });
  await dialog.getByLabel('Jamf Pro').check();
  await dialog.getByLabel('Mac', { exact: true }).check();
  await dialog.getByText('Shows for Macs on Jamf Pro. Hidden for every other device.').waitFor();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  const saved = allItems((await storedForm('Apple device check-in')).currentVersion.definition)
    .find((i) => /Wait for the device to restart/.test(i.body || ''));
  expect(saved.showWhen).toEqual([
    { on: 'device', field: 'mdm', op: 'in', value: [jamf.id] },
    { on: 'device', field: 'categoryId', op: 'in', value: [mac.id] },
  ]);
  expect((await storedForm('Apple device check-in')).currentVersion.version).toBe(2);

  await page.getByLabel('Device type').selectOption({ label: 'iPhone' });
  await page.getByLabel('MDM', { exact: true }).selectOption({ label: 'ManageEngine' });
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('status').filter({ hasText: 'hidden by Only for' }).waitFor();
});

it('A bundle, written as a sentence, that suggests itself on a category', async () => {
  const category = await models.TicketCategory.create({ name: 'Termination smoke' });
  const company = await makeCompany(w.admin, { name: 'County' });
  const jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes' });
  await models.Asset.create({ assetTag: 'CK-S1', name: 'MacBook', categoryId: mac.id, companyId: company.id, assignedToContactId: jordan.id });
  const checkIn = await storedForm('Apple device check-in');
  const account = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Account termination', usage: 'ticket', definition: { sections: [{ key: 's', title: 'S', items: [{ key: 'a', kind: 'step', body: 'Disable', required: true }] }] },
  }), 201).form;

  await page.goto('/settings/checklists');
  await page.getByRole('link', { name: 'New bundle' }).click();
  await page.getByLabel('Bundle name').fill('Termination');
  await page.getByRole('button', { name: 'Add a checklist' }).click();
  await page.getByLabel('Checklist 1', { exact: true }).selectOption(String(account.id));
  await page.getByRole('button', { name: 'Add another checklist' }).click();
  await page.getByLabel('Checklist 2', { exact: true }).selectOption(String(checkIn.id));
  await page.getByRole('button', { name: 'other ▾' }).click();
  await page.getByRole('dialog', { name: 'Which device types' }).getByLabel('Mac', { exact: true }).check();
  await page.getByRole('dialog', { name: 'Which device types' }).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'a category ▾' }).click();
  await page.getByRole('dialog', { name: 'Suggest on tickets in' }).getByLabel('Termination smoke').check();
  await page.getByRole('dialog', { name: 'Suggest on tickets in' }).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/settings\/checklists\/bundles\/\d+$/);

  const bundle = await models.Playbook.findOne({ where: { name: 'Termination' } });
  expect(bundle.needsPerson).toBe(true);
  expect(bundle.blocks).toEqual([
    { formId: account.id, applies: 'once', limits: {} },
    { formId: checkIn.id, applies: 'person_devices', limits: { categoryIds: [mac.id] } },
  ]);
  expect(bundle.suggestCategoryIds).toEqual([category.id]);

  await page.getByLabel('Try on contact').fill('Jordan');
  await page.getByRole('button', { name: 'Jordan Reyes' }).click();
  await page.getByTestId('try-result').getByText('Apple device check-in').waitFor();
});

it('old Settings addresses redirect, keeping ids', async () => {
  const form = await storedForm('Printer setup');
  await page.goto(`/settings/forms/${form.id}`);
  await page.waitForURL(new RegExp(`/settings/checklists/${form.id}$`));
  await page.goto('/settings/playbooks');
  await page.waitForURL(/\/settings\/checklists$/);
  await page.getByRole('heading', { name: 'Checklists' }).waitFor();
});
