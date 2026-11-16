const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The conversation reads newest first: the latest message at the top, the
// oldest and the description below; the reply bar is pinned under it all and
// opens the composer when clicked. A tray ticket's
// health snapshot is in the sidebar's Computer card, not the thread.

let smoke;
let ticket;
const DESKTOP = { viewport: { width: 1440, height: 900 } };
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  const w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, {
    title: 'Mac mini is slow', description: 'It takes minutes to open Outlook.', contactId: w.contact.id, departmentId: w.deptA.id,
  });
  await models.Ticket.update({ source: 'agent' }, { where: { id: ticket.id }, hooks: false });
  const at = (min) => new Date(Date.now() - min * 60000);
  await models.Comment.create({
    ticketId: ticket.id, authorId: w.admin.user.id, type: 'comment_private', createdAt: at(30),
    body: 'Health snapshot from Front desk Mac mini\nOS: macOS 27.2.1 (build 26B131)\nMemory in use: 7.1 GB of 8.0 GB (89%)\nFree on Macintosh HD: 20 GB of 256 GB\nBattery: not present\nIP addresses: 10.0.0.12',
  });
  await models.Comment.create({ ticketId: ticket.id, authorId: w.admin.user.id, type: 'reply', body: 'First answer', createdAt: at(20) });
  await models.Comment.create({ ticketId: ticket.id, authorId: w.admin.user.id, type: 'reply', body: 'Latest answer', createdAt: at(5) });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('newest message first, description last, reply bar under them; the snapshot is the Computer card', async () => {
  const page = await smoke.pageAs('admin', undefined, DESKTOP);
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByText('Latest answer').waitFor();
  const order = await page.evaluate(() => {
    const text = document.body.innerText;
    return ['Latest answer', 'First answer', 'It takes minutes to open Outlook.', 'Reply to '].map((s) => text.indexOf(s));
  });
  expect(order.every((n) => n >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Not in the thread; in the Computer card instead.
  expect(await page.getByText('Health snapshot from').count()).toBe(0);
  const card = page.getByRole('region', { name: 'Computer' });
  await card.getByText('Front desk Mac mini').waitFor();
  await card.getByText('macOS 27.2.1 (build 26B131)').waitFor();
  expect(await card.getByText('Battery').count()).toBe(0);
  await card.getByRole('button', { name: /Show all/ }).click();
  await card.getByText('not present').waitFor();
  // The bar opens the full composer, which can be put away again.
  await page.getByRole('button', { name: /^Reply/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Send Reply' }).waitFor();
  await page.getByRole('button', { name: 'Collapse reply' }).click();
  await page.getByRole('button', { name: 'Send Reply' }).waitFor({ state: 'detached' });
});
