const { resetData, closeDb, models } = require('../integration/helpers');
const { makeAdmin, makeContact, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 5a (service desk email): the template editor, the signature editor
// and the ticket's CC panel.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('email templates: edit, preview, reset', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/email-templates');
  await page.getByRole('button', { name: /Request received/ }).click();
  const subject = page.getByLabel('Subject');
  await subject.fill('Thanks, {{contact.firstName}} [Ticket #{{ticket.number}}]');
  await page.getByText('Thanks, Ann [Ticket #00042]').waitFor();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  expect((await models.EmailTemplate.findOne({ where: { key: 'contact_auto_reply' } })).subject)
    .toBe('Thanks, {{contact.firstName}} [Ticket #{{ticket.number}}]');
  await page.getByRole('navigation', { name: 'Email templates' }).getByText('Edited').waitFor();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await page.getByText('Back to the default').waitFor();
  expect(await models.EmailTemplate.count()).toBe(0);
  expect(await subject.inputValue()).toBe('Your request has been received [Ticket #{{ticket.number}}]');
});

it('preferences: signature saves', async () => {
  const admin = await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/preferences');
  const form = page.getByRole('form', { name: 'Email signature' });
  await form.locator('.ProseMirror').click();
  await page.keyboard.type('Tina from IT');
  await form.getByRole('button', { name: 'Save signature' }).click();
  await form.getByText('Signature saved').waitFor();
  expect((await models.User.findByPk(admin.user.id)).emailSignature).toContain('Tina from IT');
});

it('ticket: add and remove a CC; reply shows Cc/Bcc toggle', async () => {
  const admin = await makeAdmin();
  const contact = await makeContact(admin);
  const t = await makeTicket(admin.agent, { title: 'Printer offline', contactId: contact.id });
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${t.id}`);
  const panel = page.getByTestId('cc-panel').first();
  await panel.getByLabel('Add CC email').fill('boss@acme.com');
  await panel.getByLabel('Add CC email').press('Enter');
  await panel.getByText('boss@acme.com').waitFor();
  expect(await models.TicketCc.count({ where: { ticketId: t.id } })).toBe(1);
  await panel.getByRole('button', { name: 'Remove boss@acme.com' }).click();
  await panel.getByText("No one is CC'd.").waitFor();

  await page.getByRole('button', { name: 'Cc/Bcc' }).click();
  await page.getByLabel('Cc', { exact: true }).waitFor();
  await page.getByLabel('Bcc', { exact: true }).waitFor();
});
