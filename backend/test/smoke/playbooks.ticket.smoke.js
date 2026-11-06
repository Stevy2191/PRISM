const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Playbooks (PB, task 11): the ticket screens. A rule suggests the
// termination playbook; it's applied for the person guessed from the
// subject; a device form is filled in (a branch by MDM, a secure value, the
// check-in); devices are added; closing asks first.

let smoke;
let w;
let page;
let company;
let jordan;
let mdmA;
let laptop;
let category;
let termination;

const checkInDef = () => ({
  sections: [
    {
      key: 'start',
      title: 'Before you start',
      items: [
        { key: 'have', kind: 'step', body: '<p>You have the device and its charger.</p>', required: true },
        { key: 'cond', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['Good', 'Damaged'], required: true },
      ],
    },
    {
      key: 'wipe',
      title: 'Wipe the device',
      items: [
        { key: 'wipe_a', kind: 'step', body: '<p>Wipe it in MDM A.</p>', required: true, showWhen: [{ on: 'device', field: 'mdmId', op: 'is', value: mdmA.id }] },
        { key: 'wipe_other', kind: 'step', body: '<p>Wipe it on the device.</p>', required: true, showWhen: [{ on: 'device', field: 'isManaged', op: 'is', value: false }] },
        { key: 'code', kind: 'secure', label: 'Bypass code' },
        { key: 'act', kind: 'action', action: 'check_in' },
      ],
    },
  ],
});

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes' });
  mdmA = await models.Mdm.create({ name: 'MDM A' });
  category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  laptop = await models.Asset.create({
    assetTag: 'SM-LT1', name: 'MacBook Pro', categoryId: category.id, companyId: company.id, assignedToContactId: jordan.id, isManaged: true, mdmId: mdmA.id,
  });
  const account = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Account termination', usage: 'ticket', definition: { sections: [{ key: 's', title: 'Account', items: [{ key: 'disable', kind: 'step', body: '<p>Disable the account.</p>', required: true }] }] },
  }), 201).form;
  const checkIn = expectOk(await w.admin.agent.post(`${API}/forms`).send({ name: 'Device check-in', usage: 'device', definition: checkInDef() }), 201).form;
  const playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Account termination', needsPerson: true, blocks: [{ formId: account.id, applies: 'once' }, { formId: checkIn.id, applies: 'person_devices' }],
  }), 201).playbook;
  termination = expectOk(await w.admin.agent.post(`${API}/ticket-categories`).send({ name: 'Termination' }), 201).category;
  expectOk(await w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Termination requests', triggerEvent: 'ticket_created', conditions: [{ field: 'category', operator: 'is', value: String(termination.id) }],
    actions: [{ actionType: 'suggest_playbook', actionValue: { playbookId: playbook.id } }],
  }), 201);
  page = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

let ticket;

it('the rule suggests the playbook; Apply guesses the person and lists their device', async () => {
  ticket = await makeTicket(w.admin.agent, { title: 'Termination: Jordan Reyes, last day Nov 14', contactId: jordan.id, categoryId: termination.id });
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByText('Suggested:').waitFor();
  await page.getByRole('button', { name: 'Apply…' }).click();
  await page.getByRole('dialog', { name: 'Apply a playbook' }).waitFor();
  await page.getByText('Jordan Reyes', { exact: true }).first().waitFor();
  await page.getByText('MacBook Pro').waitFor();
  await page.getByTestId('apply-playbook').click();
  await page.getByTestId('playbook-panel').waitFor();
  await page.getByRole('link', { name: 'Device check-in: MacBook Pro' }).waitFor();
  expect(await page.getByText('Suggested:').count()).toBe(0);
});

it('closing is refused while forms are open, and says what is left', async () => {
  const closed = (await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } })).name;
  // Straight through the API the page uses: the dialog lists the forms.
  const res = await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: closed });
  expect(res.status).toBe(409);
  await page.goto(`/tickets/${ticket.id}`);
  // The sidebar's Status. This ticket has no resolution and no time, so both
  // of those warnings come first; then the forms check.
  await page.locator('select').filter({ has: page.locator(`option[value="${closed}"]`) }).first().selectOption(closed);
  await page.getByRole('button', { name: 'Close without resolution' }).click();
  await page.getByRole('dialog', { name: 'No time has been logged on this ticket.' }).getByRole('button', { name: 'Close anyway' }).click();
  const dialog = page.getByRole('dialog', { name: "This ticket can't be closed yet" });
  await dialog.waitFor();
  await dialog.getByText('Device check-in: MacBook Pro').waitFor();
  await page.getByRole('button', { name: 'Keep it open' }).click();
  expect((await models.Ticket.findByPk(ticket.id)).status).not.toBe(closed);
});

it('the device form: the MDM branch shows, a secure value is set and revealed, then check-in', async () => {
  const view = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks`));
  const tf = view.applied[0].forms.find((f) => f.asset);
  await page.goto(`/tickets/${ticket.id}/forms/${tf.id}`);
  await page.getByRole('heading', { name: 'Device check-in: MacBook Pro' }).waitFor();
  await page.getByText('Wipe it in MDM A.').waitFor();
  expect(await page.getByText('Wipe it on the device.').count()).toBe(0);
  await page.getByText(/1 step hidden/).waitFor();

  await page.getByRole('checkbox', { name: /You have the device/ }).check();
  await page.getByLabel('Condition').selectOption('Good');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByLabel('Bypass code').fill('BYPASS-SMOKE-1');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByTestId('secure-code').getByText('BYPASS-SMOKE-1').waitFor();

  expect(await page.getByTestId('form-action').isDisabled()).toBe(true);
  await page.getByRole('checkbox', { name: /Wipe it in MDM A/ }).check();
  await page.waitForFunction(() => !document.querySelector('[data-testid="form-action"]').disabled);
  await page.getByTestId('form-action').click();
  await page.getByText('Finished', { exact: true }).waitFor();
  const asset = await models.Asset.findByPk(laptop.id);
  expect(asset.status).toBe('ready_to_issue');
  expect(asset.assignedToContactId).toBeNull();
});

it('Add device: creates one with a line, and the ticket lists it', async () => {
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByTestId('add-device').click();
  await page.getByRole('tab', { name: 'Create a new device' }).click();
  await page.getByTestId('device-type').selectOption(String(category.id));
  await page.getByTestId('device-name').fill('Spare phone');
  await page.getByRole('group', { name: 'Cellular' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByLabel('IMEI').fill('353918114826114');
  await page.getByTestId('create-device').click();
  await page.getByRole('link', { name: 'Spare phone' }).first().waitFor();
  const phone = await models.Asset.findOne({ where: { name: 'Spare phone' } });
  expect(phone).toMatchObject({ companyId: company.id, hasCellular: true, imei: '353918114826114' });
});

it('fits a phone screen without sideways scrolling', async () => {
  const view = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/playbooks`));
  const phonePage = await smoke.pageAs('admin', undefined, { viewport: { width: 390, height: 844 } });
  await phonePage.goto(`/tickets/${ticket.id}/forms/${view.applied[0].forms[0].id}`);
  await phonePage.getByRole('heading', { name: 'Account termination' }).waitFor();
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
