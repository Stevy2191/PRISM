const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeStaff,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Editing a ticket's title and description on the ticket page. The rebuilt
// page had lost both (and never showed the description at all).

let smoke;
let w;
let t;
let admin;
const fetchTicket = async (id) => expectOk(await w.admin.agent.get(`${API}/tickets/${id}`)).ticket;

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeStaff('viewer', w.deptA.id); // sees the department's tickets, can't edit them
  t = await makeTicket(w.admin.agent, {
    title: 'Printer offline', description: 'Jobs sit in the queue.\nOther PCs print fine.',
    contactId: w.contact.id, departmentId: w.deptA.id,
  });
  admin = await smoke.pageAs('admin');
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('the description shows at the top of the Conversation tab, line breaks kept', async () => {
  await admin.goto(`/tickets/${t.id}`);
  const card = admin.getByTestId('ticket-description');
  await card.waitFor();
  expect(await card.innerText()).toContain('Jobs sit in the queue.\nOther PCs print fine.');
});

it('the title edits in place: Enter saves, Escape cancels', async () => {
  await admin.goto(`/tickets/${t.id}`);
  await admin.getByRole('button', { name: 'Edit title' }).click();
  const input = admin.getByRole('textbox', { name: 'Ticket title' });
  await input.fill('Never saved');
  await input.press('Escape');
  await admin.getByRole('heading', { name: 'Printer offline' }).waitFor();

  await admin.getByRole('button', { name: 'Edit title' }).click();
  await input.fill('Front desk printer offline');
  await input.press('Enter');
  await admin.getByRole('heading', { name: 'Front desk printer offline' }).waitFor();
  expect((await fetchTicket(t.id)).title).toBe('Front desk printer offline');
});

it('a blank title is refused and the old one stays', async () => {
  await admin.goto(`/tickets/${t.id}`);
  await admin.getByRole('button', { name: 'Edit title' }).click();
  const input = admin.getByRole('textbox', { name: 'Ticket title' });
  await input.fill('   ');
  await input.press('Enter');
  await admin.getByText('Ticket title is required').waitFor();
  expect((await fetchTicket(t.id)).title).toBe('Front desk printer offline');
});

it('the description edits with Save, and Cancel throws the change away', async () => {
  await admin.goto(`/tickets/${t.id}`);
  await admin.getByRole('button', { name: 'Edit description' }).click();
  const box = admin.getByRole('textbox', { name: 'Description' });
  await box.fill('Thrown away');
  await admin.getByRole('button', { name: 'Cancel' }).click();
  await admin.getByTestId('ticket-description').getByText('Other PCs print fine.').waitFor();

  await admin.getByRole('button', { name: 'Edit description' }).click();
  await box.fill('Started after the Windows update.');
  await admin.getByRole('button', { name: 'Save description' }).click();
  await admin.getByTestId('ticket-description').getByText('Started after the Windows update.').waitFor();
  expect((await fetchTicket(t.id)).description).toBe('Started after the Windows update.');
});

it('the edits show in the Activity tab', async () => {
  await admin.goto(`/tickets/${t.id}`);
  await admin.getByRole('button', { name: 'Activity' }).click();
  await admin.getByText(/changed title from Printer offline to Front desk printer offline/).waitFor();
  await admin.getByText(/edited the description/).first().waitFor();
});

it('someone who can only view sees the text but no edit buttons', async () => {
  const viewer = await smoke.pageAs('viewer');
  await viewer.goto(`/tickets/${t.id}`);
  await viewer.getByTestId('ticket-description').getByText('Started after the Windows update.').waitFor();
  await viewer.getByRole('heading', { name: 'Front desk printer offline' }).waitFor();
  expect(await viewer.getByRole('button', { name: 'Edit title' }).count()).toBe(0);
  expect(await viewer.getByRole('button', { name: 'Edit description' }).count()).toBe(0);
});
