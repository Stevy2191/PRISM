const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeContact } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// A person's phone extension: beside the phone on a contact's page and in
// Preferences; shown after the number in the contacts list.

let smoke; let w;
beforeAll(async () => { smoke = await startSmoke(); await resetData(); w = await makeWorld(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });

it("a contact's extension is typed beside the phone, and shown after it", async () => {
  const ann = await makeContact(w.admin, { firstName: 'Ann', lastName: 'Able', phone: '9792776200', departmentId: w.deptA.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/contacts/${ann.id}`);
  const ext = page.getByLabel('Extension');
  await ext.pressSequentially('12a345');
  expect(await ext.inputValue()).toBe('1234');
  const saved = page.waitForResponse((r) => r.url().endsWith(`/contacts/${ann.id}`) && r.request().method() === 'PATCH');
  await ext.blur();
  expect((await saved).status()).toBe(200);
  expect((await models.Contact.findByPk(ann.id)).phoneExt).toBe('1234');
  await page.goto('/contacts');
  await page.getByText('(979) 277-6200 ext. 1234').filter({ visible: true }).first().waitFor();
});

it('Preferences has an extension beside your phone', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/preferences');
  await page.getByLabel('Extension').fill('42');
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await page.waitForTimeout(800);
  expect((await models.User.findByPk(w.admin.user.id)).phoneExt).toBe('42');
});
