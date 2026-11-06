const { resetData, closeDb } = require('../integration/helpers');
const { API, expectOk, makeWorld } = require('../integration/fixtures');
const models = require('../../src/models');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Checking out equipment: the form is printed to sign there and then (or
// emailed), and the signed copy is uploaded back to the checkout.

let smoke;
let w;
let asset;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  const category = await models.AssetCategory.findOne();
  asset = expectOk(await w.admin.agent.post(`${API}/assets`).send({
    categoryId: category.id, name: 'Front desk laptop', assetTag: 'LT-0042', assignedToContactId: w.contact.id,
  }), 201).asset;
});

it('check out, print the form, then upload the signed copy', async () => {
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.opened = [];
    window.open = (url) => { window.opened.push(url); return null; };
  });
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole('button', { name: 'Check out' }).click();
  await page.locator('form').getByRole('button', { name: 'Check out' }).click();

  await page.getByRole('heading', { name: 'Checkout form ready' }).waitFor();
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await page.getByText('The form opened in a new tab').waitFor();
  const [url] = await page.evaluate(() => window.opened);
  const checkout = await models.AssetCheckout.findOne({ where: { assetId: asset.id } });
  expect(url).toBe(`/api/v1/assets/${asset.id}/attachments/${checkout.formAttachmentId}/download?inline=1`);
  // The link really opens the PDF inline.
  const pdf = await page.request.get(url);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(pdf.headers()['content-disposition']).toMatch(/^inline/);

  // Email is the other choice, with the print-sign-return message.
  await page.getByRole('button', { name: 'Email…' }).click();
  await page.getByRole('heading', { name: 'Email checkout form' }).waitFor();
  expect(await page.getByLabel('Message').inputValue()).toMatch(/print it, sign it/);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Checkout History' }).click();
  await page.getByText(/Checkout form printed .*, waiting for the signed copy/).waitFor();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload signed copy' }).click(),
  ]);
  await chooser.setFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%signed\n%%EOF\n') });
  await page.getByText(/Checkout form: signed copy received/).waitFor();
  expect(await page.getByRole('link', { name: 'Signed copy' }).getAttribute('href')).toMatch(/\/attachments\/\d+\/download$/);
  expect(await page.getByRole('button', { name: 'Upload signed copy' }).count()).toBe(0);
});

it('a checkout without a form can get one later', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole('button', { name: 'Check out' }).click();
  await page.getByLabel('Generate checkout form').uncheck();
  await page.locator('form').getByRole('button', { name: 'Check out' }).click();
  await page.getByRole('button', { name: 'Checkout History' }).click();
  await page.getByRole('button', { name: 'Create form' }).click();
  await page.getByRole('button', { name: 'Print form' }).waitFor();
  await page.getByText('Checkout form not printed or emailed yet').waitFor();
});

it('assigning someone in Edit asset fills in their department', async () => {
  const unassigned = expectOk(await w.admin.agent.post(`${API}/assets`).send({
    categoryId: (await models.AssetCategory.findOne()).id, name: 'Spare laptop', assetTag: 'LT-0099',
  }), 201).asset;
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 1280, height: 900 } });
  await page.goto(`/assets/${unassigned.id}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Contact', exact: true }).click();
  await page.getByPlaceholder('Search contacts…').fill('Casey');
  await page.getByRole('button', { name: /Casey Contact/ }).first().click();
  const dept = page.locator('select').filter({ has: page.locator('option', { hasText: 'None' }) }).filter({ has: page.locator(`option[value="${w.deptA.id}"]`) });
  await page.waitForFunction((id) => [...document.querySelectorAll('select')].some((el) => el.value === id), String(w.deptA.id));
  expect(await dept.inputValue()).toBe(String(w.deptA.id));
});
