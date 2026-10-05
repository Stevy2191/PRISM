const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeCompany, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 2b task 12 (Review Focus 4).

// Waits until fn() returns `want` (the UI saves asynchronously).
const poll = async (fn, want, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn() === want) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 100); });
  }
  expect(await fn()).toBe(want);
};

let smoke;
let admin;
let acme;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => {
  await resetData();
  admin = await makeAdmin();
  acme = await makeCompany(admin, { name: 'Acme' });
});

it('moving a contact asks first and takes its tickets', async () => {
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  const bob = await models.Contact.create({ firstName: 'Bob', displayName: 'Bob Home', companyId: internal.id });
  const t = await makeTicket(admin.agent, { title: 'Bob ticket', contactId: bob.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/contacts/${bob.id}`);
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await page.locator('#contact-company').selectOption(String(acme.id));
  await poll(async () => (await models.Ticket.findByPk(t.id)).companyId, acme.id);
  expect(asked).toMatch(/tickets move too/);
});

it('a new contact can be created for a company, and the list shows and filters by it', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/contacts');
  await page.getByRole('button', { name: /New contact/ }).click();
  await page.locator('#company-picker').selectOption(String(acme.id));
  // The modal's form: first and last name are its first two text inputs.
  const form = page.locator('form').last();
  await form.locator('input').nth(0).fill('Cara');
  await form.locator('input').nth(1).fill('Client');
  await form.getByRole('button', { name: 'Save' }).click();
  await poll(async () => (await models.Contact.findOne({ where: { firstName: 'Cara' } }))?.companyId, acme.id);
  await page.goto('/contacts');
  await page.getByText('· Acme').first().waitFor();
  await page.getByLabel('Company').selectOption(String(acme.id));
  await page.getByRole('link', { name: 'Cara Client' }).first().waitFor();
});
