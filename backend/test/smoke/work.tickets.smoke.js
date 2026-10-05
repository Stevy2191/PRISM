const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3a guard: every tab of the ticket page renders its seeded content,
// and the quick actions still work. Characterization tests — they pass
// before the split and must pass after it.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();

let smoke;
let w;
let ticket;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  const tina = await makeTech('tina', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: w.contact.id, assigneeId: tina.user.id, description: 'It will not print',
  });
  const other = await makeTicket(w.admin.agent, { title: 'Toner order', contactId: w.contact.id });
  const a = w.admin.agent;
  expectOk(await a.post(`${API}/tickets/${ticket.id}/comments`).send({ body: 'Seeded note text', type: 'comment_private' }), 201);
  expectOk(await a.post(`${API}/tickets/${ticket.id}/time`).send({ minutes: 45, note: 'Seeded time note' }), 201);
  expectOk(await a.post(`${API}/tickets/${ticket.id}/tasks`).send({ description: 'Seeded checklist item' }), 201);
  expectOk(await a.post(`${API}/tickets/${ticket.id}/relations`).send({ relatedTicketId: other.id, relationType: 'related' }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('the header, sidebar and conversation render', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, 'Printer offline').waitFor();
  await shown(page, 'Seeded note text').waitFor();
  await shown(page, 'Test tina').waitFor();
});

it('every tab opens and shows its content', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, 'Printer offline').waitFor();
  await tab(page, /^Time Entries/);
  await shown(page, 'Seeded time note').waitFor();
  await tab(page, /^Tasks/);
  await shown(page, 'Seeded checklist item').waitFor();
  await tab(page, /^Relationships/);
  await shown(page, 'Toner order').waitFor();
  await tab(page, /^Resolution/);
  await page.getByPlaceholder('Describe what resolved this issue...').filter({ visible: true }).waitFor();
  await tab(page, /^Attachments/);
  await tab(page, /^Activity/);
  await shown(page, 'opened this ticket').waitFor();
});

it('a task can be added from the Tasks tab', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  const input = page.getByPlaceholder('Add a task and press Enter…').filter({ visible: true });
  await input.fill('Added from the guard');
  await input.press('Enter');
  await shown(page, 'Added from the guard').waitFor();
});
