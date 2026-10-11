const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: Settings edits the ticket-task and project-task status lists and
// the work types, and the role editor shows the time permissions.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

let smoke;
let w;
let seededStatuses;
let seededTypes;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  seededStatuses = await models.TaskStatus.findAll({ raw: true });
  seededTypes = await models.WorkType.findAll({ raw: true });
});
afterAll(async () => {
  // Seeded lists are not reset between files: put them back.
  await models.Task.destroy({ where: {} });
  await models.TimeEntry.destroy({ where: {} });
  await models.TaskStatus.destroy({ where: {} });
  await models.TaskStatus.bulkCreate(seededStatuses);
  await models.WorkType.destroy({ where: {} });
  await models.WorkType.bulkCreate(seededTypes);
  await smoke.stop();
  await closeDb();
});

it('adds a ticket-task status, and refuses to delete one in use', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/statuses');
  await button(page, 'Ticket tasks').click();
  // Names are in input boxes; wait on the row's labelled delete button.
  await page.getByRole('button', { name: 'Delete In progress' }).waitFor();
  const added = page.waitForResponse((r) => r.url().endsWith('/task-statuses') && r.request().method() === 'POST');
  await button(page, '+ Add status').click();
  expect((await (await added).json()).status).toEqual(expect.objectContaining({ scope: 'ticket' }));
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'uses To do' }), 201);
  await page.reload();
  await button(page, 'Ticket tasks').click();
  await page.getByRole('button', { name: 'Delete To do' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).last().click();
  await shown(page, /used by 1 task/).waitFor();
  expect((await models.TaskStatus.findAll({ where: { scope: 'ticket' } })).map((s) => s.name)).toContain('To do');
});

it('adds, deactivates and deletes work types', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/work-types');
  await page.getByLabel('Remote support name').waitFor();
  await page.getByPlaceholder('New work type').fill('Training');
  await button(page, 'Add').click();
  await page.getByLabel('Training name').waitFor();
  const deactivated = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/work-types/'));
  await page.getByLabel('Training active').click(); // controlled: flips once the PATCH returns
  await deactivated;
  expect((await models.WorkType.findOne({ where: { name: 'Training' } })).isActive).toBe(false);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete Training' }).click();
  await page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/work-types/'));
  expect(await models.WorkType.count({ where: { name: 'Training' } })).toBe(0);
});

it('the role editor lists every permission category, the time permissions among them', async () => {
  const page = await smoke.pageAs('admin');
  const { roles } = expectOk(await w.admin.agent.get(`${API}/roles`));
  const tech = roles.find((r) => r.name === 'System Technician');
  await page.goto(`/admin/roles/${tech.id}`);
  await shown(page, /^Time —/).click();
  await shown(page, "Manage others' time").waitFor();
  for (const category of [/^Assets —/, /^Companies —/, /^Knowledge base —/]) {
    await shown(page, category).waitFor(); // eslint-disable-line no-await-in-loop
  }
});
