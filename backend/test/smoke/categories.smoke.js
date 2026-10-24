const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Ticket categories (5c) in the browser: the Settings tree editor and the
// cascading picker on tickets.

const { TicketCategory } = models;
const shown = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first();

let smoke;
let w;
let page;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  page = await smoke.pageAs('admin');
  page.on('dialog', (d) => d.accept());
});
afterAll(async () => {
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

describe('tree editor', () => {
  it('admin adds Hardware › Laptop and it persists after reload', async () => {
    await page.goto('/settings/ticket-categories');
    await page.getByRole('button', { name: 'Add category' }).click();
    await page.getByLabel('New category name').fill('Hardware');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await shown(page, 'Hardware').waitFor();
    const hw = await TicketCategory.findOne({ where: { name: 'Hardware' } });
    await page.getByTestId(`category-${hw.id}`).getByRole('button', { name: 'add sub-category' }).first().click();
    await page.getByLabel('New sub-category name').fill('Laptop');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await shown(page, 'Laptop').waitFor();
    await page.reload();
    await shown(page, 'Laptop').waitFor();
    const laptop = await TicketCategory.findOne({ where: { name: 'Laptop' } });
    expect(laptop.parentId).toBe(hw.id);
  });

  it('delete of a used category shows the in-use message', async () => {
    const laptop = await TicketCategory.findOne({ where: { name: 'Laptop' } });
    const t = await makeTicket(w.admin.agent, { title: 'Used', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: laptop.id });
    expect(t.category.id).toBe(laptop.id);
    await page.goto('/settings/ticket-categories');
    const row = page.getByTestId(`category-${laptop.id}`);
    await row.getByRole('button', { name: 'delete' }).first().click();
    await page.getByRole('alert').filter({ hasText: 'in use' }).waitFor();
    expect(await page.getByRole('alert').textContent()).toMatch(/1 ticket/);
    expect(await TicketCategory.count({ where: { id: laptop.id } })).toBe(1);
    await models.Ticket.update({ categoryId: null }, { where: { id: t.id } });
  });

  it('the require-a-category switch saves', async () => {
    await page.goto('/settings/ticket-categories');
    await page.getByRole('switch', { name: 'Require a category on new tickets' }).click();
    await page.waitForResponse((r) => r.url().endsWith('/ticket-categories/settings'));
    const res = expectOk(await w.admin.agent.get(`${API}/ticket-categories`));
    expect(res.categoryRequired).toBe(true);
    expectOk(await w.admin.agent.put(`${API}/ticket-categories/settings`).send({ categoryRequired: false }));
  });
});
