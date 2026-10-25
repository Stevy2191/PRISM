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

  it('a requireChild parent alone can\'t be submitted: the sub-category level is required', async () => {
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: true }));
    await openForm();
    await level(page, 1).selectOption(String(hw.id));
    const before = await models.Ticket.count();
    await submit();
    expect(await level(page, 2).evaluate((el) => el.validity.valueMissing)).toBe(true);
    expect(page.url()).toMatch(/\/tickets\/new/);
    expect(await models.Ticket.count()).toBe(before);
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

  it('sidebar: a requireChild parent opens the next level instead of saving; the leaf saves', async () => {
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: true }));
    const t = await makeTicket(w.admin.agent, { title: 'Sidebar pick', contactId: w.contact.id, departmentId: w.deptA.id });
    await page.goto(`/tickets/${t.id}`);
    const box = page.getByTestId('sidebar-category').filter({ visible: true }).first();
    const patches = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().endsWith(`/tickets/${t.id}`)) patches.push(r.postData()); });
    await box.getByLabel('Category level 1').selectOption(String(hw.id));
    await box.getByLabel('Category level 2').selectOption(String(laptop.id));
    await page.waitForResponse((r) => r.url().endsWith(`/tickets/${t.id}`) && r.request().method() === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0])).toEqual({ categoryId: laptop.id });
    expect((await models.Ticket.findByPk(t.id)).categoryId).toBe(laptop.id);
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: false }));
  });

  it('sidebar: "change" on a retired category opens the picker without clearing it', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Retired change', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: sw.id });
    expectOk(await w.admin.agent.patch(`${CAT}/${sw.id}`).send({ active: false }));
    await page.goto(`/tickets/${t.id}`);
    const box = page.getByTestId('sidebar-category').filter({ visible: true }).first();
    await box.getByRole('button', { name: 'change' }).click();
    await box.getByLabel('Category level 1').waitFor();
    expect((await models.Ticket.findByPk(t.id)).categoryId).toBe(sw.id);
    await box.getByRole('button', { name: 'Cancel' }).click();
    await box.getByText('(retired)').waitFor();
    expectOk(await w.admin.agent.patch(`${CAT}/${sw.id}`).send({ active: true }));
  });

  it('a saved list filter on a retired category shows it and can be cleared', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Filtered retired', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: sw.id });
    expect(t.category.id).toBe(sw.id);
    // Saved filters outlive resetData: a unique name per run.
    const viewName = `Software view ${Date.now()}`;
    expectOk(await w.admin.agent.post(`${API}/saved-filters`).send({ name: viewName, filterJson: { category: sw.id } }), 201);
    expectOk(await w.admin.agent.patch(`${CAT}/${sw.id}`).send({ active: false }));
    await page.goto('/tickets');
    await page.getByTitle('Saved filters').click();
    await page.getByRole('button', { name: viewName }).click();
    const inline = page.getByTestId('filter-category-inline-box').filter({ visible: true }).first();
    await inline.getByText('(retired)').waitFor();
    await inline.getByRole('button', { name: 'change' }).click();
    expect(await page.locator('#filter-category-inline').filter({ visible: true }).first().inputValue()).toBe('');
    expectOk(await w.admin.agent.patch(`${CAT}/${sw.id}`).send({ active: true }));
  });

  it('a slow custom-field answer for an earlier category doesn\'t replace the current one', async () => {
    const field = await models.CustomField.findOne({ where: { label: 'Serial number' } });
    expect(field).toBeTruthy();
    await openForm();
    // Hold back the answer for Hardware until after Software's has arrived.
    await page.route(`**/custom-fields?*categoryId=${hw.id}*`, async (route) => {
      await new Promise((r) => { setTimeout(r, 1500); });
      await route.continue();
    });
    const slow = page.waitForResponse((r) => r.url().includes(`categoryId=${hw.id}`));
    await level(page, 1).selectOption(String(hw.id));
    await level(page, 1).selectOption(String(sw.id));
    await slow;
    await page.waitForTimeout(300);
    expect(await page.getByText('Serial number').filter({ visible: true }).count()).toBe(0);
    await page.unroute(`**/custom-fields?*categoryId=${hw.id}*`);
  });

  it('after a parent that needs a sub-category, the next level says so and is required', async () => {
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: true }));
    await openForm();
    await level(page, 1).selectOption(String(hw.id));
    const second = level(page, 2);
    expect(await second.locator('option').first().textContent()).toBe('Choose a sub-category…');
    expect(await second.getAttribute('required')).not.toBeNull();
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: false }));
  });

  it('the recurring editor warns about the category it has now, in the right words', async () => {
    const rule = expectOk(await w.admin.agent.post(`${API}/recurring-tickets`).send({
      title: 'Weekly cat', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: hw.id,
      frequency: 'weekly', interval: 1, weekdays: [1], timeOfDay: '09:00', timezone: 'America/Chicago', startDate: '2026-01-01',
    }), 201).rule;
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: true }));
    await page.goto(`/settings/recurring-tickets/${rule.id}`);
    const warn = page.getByTestId('rt-category-warning');
    await warn.waitFor();
    expect(await warn.textContent()).toMatch(/needs a sub-category/);
    await level(page, 2).selectOption(String(laptop.id));
    await warn.waitFor({ state: 'hidden' });
    expectOk(await w.admin.agent.patch(`${CAT}/${hw.id}`).send({ requireChild: false }));
    await models.RecurringTicket.destroy({ where: { id: rule.id } });
  });

  it('bulk edit can remove the category', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Bulk clear me', contactId: w.contact.id, departmentId: w.deptA.id, categoryId: sw.id });
    await page.goto('/tickets');
    await page.locator('tr', { hasText: 'Bulk clear me' }).filter({ visible: true }).locator('input[type=checkbox]').check();
    await page.locator('select').filter({ hasText: 'Choose action…' }).filter({ visible: true }).first().selectOption('category');
    await page.getByLabel('Remove the category').check();
    await page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).first().click();
    await page.getByTestId('bulk-result').waitFor();
    expect((await models.Ticket.findByPk(t.id)).categoryId).toBeNull();
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
