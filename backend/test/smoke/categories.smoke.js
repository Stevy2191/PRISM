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

describe('picker on tickets', () => {
  let hw;
  let laptop;
  let sw;
  const CAT = `${API}/ticket-categories`;
  const level = (p, n) => p.getByLabel(`Category level ${n}`).filter({ visible: true }).first();
  beforeAll(async () => {
    hw = await TicketCategory.findOne({ where: { name: 'Hardware' } });
    laptop = await TicketCategory.findOne({ where: { name: 'Laptop' } });
    sw = expectOk(await w.admin.agent.post(CAT).send({ name: 'Software' }), 201).category;
  });

  const openForm = async () => {
    await page.goto(`/tickets/new?contactId=${w.contact.id}`);
    await shown(page, 'Casey Contact').waitFor();
    await page.locator('xpath=//label[normalize-space(text())="Title"]/following::input[1]').fill('Picked ticket');
  };
  const submit = () => page.getByRole('button', { name: 'Create Ticket' }).filter({ visible: true }).click();

  it('picking Hardware then Laptop sends the leaf; changing level 1 clears level 2', async () => {
    await openForm();
    await level(page, 1).selectOption(String(hw.id));
    await level(page, 2).selectOption(String(laptop.id));
    await level(page, 1).selectOption(String(sw.id));
    expect(await page.getByLabel('Category level 2').count()).toBe(0);
    await level(page, 1).selectOption(String(hw.id));
    expect(await level(page, 2).inputValue()).toBe('');
    await level(page, 2).selectOption(String(laptop.id));
    await submit();
    await page.waitForURL(/\/tickets\/\d+$/);
    const id = Number(page.url().split('/').pop());
    expect((await models.Ticket.findByPk(id)).categoryId).toBe(laptop.id);
  });

  it('a requireChild parent alone shows the API message', async () => {
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: true }));
    await openForm();
    await level(page, 1).selectOption(String(hw.id));
    await submit();
    await shown(page, 'Choose a sub-category under Hardware').waitFor();
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: false }));
  });

  it('a field scoped to Hardware appears only after Hardware is picked', async () => {
    expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Serial number', fieldType: 'text', categoryIds: [hw.id] }), 201);
    await openForm();
    expect(await page.getByText('Serial number').filter({ visible: true }).count()).toBe(0);
    await level(page, 1).selectOption(String(hw.id));
    await page.getByText('Serial number').filter({ visible: true }).first().waitFor();
    await level(page, 1).selectOption(String(sw.id));
    await page.getByText('Serial number').filter({ visible: true }).first().waitFor({ state: 'hidden' });
  });

  it('the sidebar shows a retired category as "(retired)" and the ticket still saves a change', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Retired cat', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: laptop.id });
    expectOk(await w.admin.agent.patch(`${CAT}/${laptop.id}`).send({ active: false }));
    await page.goto(`/tickets/${t.id}`);
    const box = page.getByTestId('sidebar-category').filter({ visible: true }).first();
    await box.getByText('(retired)').waitFor();
    expect(await box.textContent()).toContain('Hardware › Laptop');
    // A sidebar change (priority) still saves, and the kept category stays.
    const saved = page.waitForResponse((r) => r.url().endsWith(`/tickets/${t.id}`) && r.request().method() === 'PATCH');
    await page.locator('#ticket-priority').filter({ visible: true }).first().selectOption('high');
    expect((await saved).status()).toBe(200);
    expect((await models.Ticket.findByPk(t.id)).priority).toBe('high');
    expect((await models.Ticket.findByPk(t.id)).categoryId).toBe(laptop.id);
  });

  it('a retired category is gone from the create-form picker', async () => {
    await openForm();
    await level(page, 1).selectOption(String(hw.id));
    const opts = await page.getByLabel('Category level 2').count();
    expect(opts).toBe(0); // Laptop (retired) was Hardware's only child
    expectOk(await w.admin.agent.patch(`${CAT}/${laptop.id}`).send({ active: true }));
  });

  it('the list filter by Hardware shows the Laptop ticket', async () => {
    await makeTicket(w.admin.agent, { title: 'Laptop filter ticket', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: laptop.id });
    await makeTicket(w.admin.agent, { title: 'Software filter ticket', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: sw.id });
    await page.goto('/tickets');
    await shown(page, 'Software filter ticket').waitFor();
    await page.locator('#filter-category-inline').filter({ visible: true }).first().selectOption(String(hw.id));
    await shown(page, 'Laptop filter ticket').waitFor();
    await page.getByText('Software filter ticket').filter({ visible: true }).first().waitFor({ state: 'hidden' });
  });
});
