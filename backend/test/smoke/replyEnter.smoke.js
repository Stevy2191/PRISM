const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The ticket's reply box: Enter sends, Shift+Enter is a new line.

let smoke;
let ticket;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  const w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('Shift+Enter adds a line; Enter sends the reply with both lines', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  const box = page.getByPlaceholder(/^Reply to /).filter({ visible: true });
  await box.click();
  await page.keyboard.type('Line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line two');
  expect(await box.inputValue()).toBe('Line one\nLine two');
  const sent = page.waitForResponse((r) => r.url().endsWith(`/tickets/${ticket.id}/comments`) && r.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await sent).status()).toBe(201);
  expect(await box.inputValue()).toBe('');
  const c = await models.Comment.findOne({ where: { ticketId: ticket.id, type: 'reply' } });
  expect(c.body).toBe('Line one\nLine two');
  // Enter on an empty box sends nothing.
  await page.keyboard.press('Enter');
  expect(await models.Comment.count({ where: { ticketId: ticket.id, type: 'reply' } })).toBe(1);
});
