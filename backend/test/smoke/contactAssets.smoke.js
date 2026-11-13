const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// A contact's Assets tab: what they have, assigning one that's already in
// the list, and checking it back in.

let smoke;
let w;
let amy;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const company = await makeCompany(w.admin, { name: 'Alpha Dental' });
  const elsewhere = await makeCompany(w.admin, { name: 'Beta Law' });
  amy = await makeContact(w.admin, { companyId: company.id, firstName: 'Amy', lastName: 'Ng' });
  const category = await models.AssetCategory.findOne();
  const add = (body) => w.admin.agent.post(`${API}/assets`).send({ categoryId: category.id, ...body });
  expectOk(await add({ name: 'Spare laptop', companyId: company.id, serialNumber: 'SN-SPARE-1' }), 201);
  expectOk(await add({ name: 'Other company laptop', companyId: elsewhere.id }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('assign an existing asset from the contact\'s page, then check it in', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/contacts/${amy.id}`);
  await page.getByRole('group', { name: 'Contact sections' }).getByRole('button', { name: /^Assets/ }).click();
  const table = page.getByTestId('contact-assets');
  await table.getByText('No assets.').waitFor();

  await page.getByRole('button', { name: 'Assign an existing asset' }).click();
  const list = page.getByTestId('assignable-assets');
  await list.getByText('Spare laptop').waitFor();
  // Only this contact's company's assets are offered.
  expect(await list.getByText('Other company laptop').count()).toBe(0);
  await page.getByLabel('Search assets').fill('SN-SPARE');
  await list.getByText('Spare laptop').waitFor();
  await list.getByRole('button', { name: 'Assign' }).click();

  await table.getByRole('link', { name: 'Spare laptop' }).waitFor();
  await table.getByText(/Checked out/).waitFor();
  await page.getByRole('group', { name: 'Contact sections' }).getByRole('button', { name: 'Assets (1)' }).waitFor();
  const asset = await models.Asset.findOne({ where: { name: 'Spare laptop' } });
  expect(asset.assignedToContactId).toBe(amy.id);
  expect(await models.AssetCheckout.count({ where: { assetId: asset.id, contactId: amy.id, checkedInAt: null } })).toBe(1);

  await table.getByRole('button', { name: 'Check in' }).click();
  await table.getByText('No assets.').waitFor();
  expect((await models.Asset.findByPk(asset.id)).assignedToContactId).toBeNull();
});

it('New asset opens the form already assigned to the contact', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/contacts/${amy.id}`);
  await page.getByRole('group', { name: 'Contact sections' }).getByRole('button', { name: /^Assets/ }).click();
  await page.getByRole('button', { name: 'New asset' }).click();
  await page.getByText('Amy Ng').filter({ visible: true }).nth(1).waitFor();
});
