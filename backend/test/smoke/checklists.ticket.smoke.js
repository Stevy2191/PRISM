const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// PB2: Add checklist on a ticket. A ticket checklist in one click; a device
// checklist asks who and which devices; a bundle its category suggested;
// all of it at phone width too.

let smoke;
let w;
let page;
let company;
let jordan;
let category;
let printer;
let checkIn;

const step = (key, body, extra = {}) => ({ key, kind: 'step', body: `<p>${body}</p>`, required: true, ...extra });

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes', email: 'jreyes@county.example' });
  await models.AssetCategory.destroy({ where: { name: 'CK Laptop' } });
  await models.Mdm.destroy({ where: { name: 'Jamf CK' } });
  const laptops = await models.AssetCategory.create({ name: 'CK Laptop' });
  const jamf = await models.Mdm.create({ name: 'Jamf CK' });
  await models.Asset.create({ assetTag: 'CK-T1', name: 'MacBook Pro', categoryId: laptops.id, companyId: company.id, assignedToContactId: jordan.id, isManaged: true, mdmId: jamf.id });
  await models.Asset.create({ assetTag: 'CK-T2', name: 'Spare laptop', categoryId: laptops.id, companyId: company.id });
  printer = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Printer setup', usage: 'ticket', definition: { sections: [{ key: 's', title: 'Steps', items: [step('a', 'Install the driver'), step('b', 'Print a test page')] }] },
  }), 201).form;
  checkIn = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Device check-in',
    usage: 'device',
    definition: {
      sections: [{
        key: 's',
        title: 'Wipe',
        items: [
          step('jamf', 'Remove from Jamf', { showWhen: [{ on: 'device', field: 'mdm', op: 'in', value: [jamf.id] }] }),
          step('wipe', 'Wipe it'),
          { key: 'in', kind: 'action', action: 'check_in', statuses: ['ready_to_issue'] },
        ],
      }],
    },
  }), 201).form;
  category = expectOk(await w.admin.agent.post(`${API}/ticket-categories`).send({ name: 'Offboarding CK' }), 201).category;
  expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Offboarding', needsPerson: true, blocks: [{ formId: printer.id, applies: 'once' }, { formId: checkIn.id, applies: 'person_devices' }], suggestCategoryIds: [category.id],
  }), 201);
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

const newTicket = (extra = {}) => makeTicket(w.admin.agent, { title: 'Termination: Jordan Reyes', contactId: jordan.id, ...extra });

it('a ticket checklist is added in one click', async () => {
  const ticket = await newTicket();
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'Add checklist' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a checklist' });
  await dialog.getByText('For the ticket').waitFor();
  await dialog.getByTestId(`add-checklist-${printer.id}`).click();
  await page.getByRole('region', { name: 'Checklists' }).getByRole('link', { name: 'Printer setup' }).waitFor();
  expect(await models.TicketForm.count({ where: { ticketId: ticket.id } })).toBe(1);
});

it('a device checklist asks who and which devices, and adds them', async () => {
  const ticket = await newTicket();
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'Add checklist' }).first().click();
  await page.getByRole('dialog', { name: 'Add a checklist' }).getByTestId(`add-checklist-${checkIn.id}`).click();
  const who = page.getByRole('dialog', { name: 'Who is it for?' });
  await who.getByText('Jordan Reyes', { exact: true }).waitFor();
  await who.getByText('Gets Device check-in, the Jamf CK steps · 2 steps').waitFor();
  await who.getByRole('button', { name: '+ Another device' }).click();
  await who.getByLabel('Search devices').fill('Spare');
  await who.getByRole('button', { name: /Spare laptop/ }).click();
  await who.getByRole('button', { name: 'Add 2 checklists' }).click();
  const panel = page.getByRole('region', { name: 'Checklists' });
  await panel.getByRole('link', { name: 'Device check-in: MacBook Pro' }).waitFor();
  await panel.getByRole('link', { name: 'Device check-in: Spare laptop' }).waitFor();
  const forms = await models.TicketForm.findAll({ where: { ticketId: ticket.id } });
  expect(forms.map((f) => f.contactId)).toEqual([jordan.id, jordan.id]);
  expect(await models.AssetTicket.count({ where: { ticketId: ticket.id } })).toBe(2);
});

it("the bundle its category suggests is added from the banner, and the count matches", async () => {
  const ticket = await newTicket({ categoryId: category.id });
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByText('Suggested:').waitFor();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const who = page.getByRole('dialog', { name: 'Who is it for?' });
  await who.getByText('MacBook Pro').waitFor();
  await who.getByRole('button', { name: 'Add 2 checklists' }).click();
  await page.getByRole('region', { name: 'Bundle Offboarding' }).waitFor();
  expect(await models.TicketForm.count({ where: { ticketId: ticket.id } })).toBe(2);
  expect(await page.getByText('Suggested:').count()).toBe(0);
});

it('fits a phone screen', async () => {
  const phone = await smoke.pageAs('admin', undefined, { viewport: { width: 390, height: 844 } });
  const ticket = await newTicket();
  await phone.goto(`/tickets/${ticket.id}`);
  await phone.getByRole('button', { name: 'More actions' }).click();
  await phone.getByRole('menuitem', { name: 'Add checklist' }).click();
  await phone.getByRole('dialog', { name: 'Add a checklist' }).getByTestId(`add-checklist-${checkIn.id}`).click();
  await phone.getByRole('dialog', { name: 'Who is it for?' }).getByText('MacBook Pro').waitFor();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await phone.context().close();
});
