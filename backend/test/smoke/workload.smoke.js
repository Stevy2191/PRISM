const { resetData, closeDb, models, ROLE } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket, makeProject, makeTask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Sub-project 6, task 13: the Workload screen, dispatch, Hours people work.
// The screen starts on this week's Monday (the coming one on a weekend), so
// every date here is worked out from the real clock, a week or so ahead of it.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (date, n) => { const [y, m, d] = date.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
function thisMonday() {
  const now = new Date();
  const dow = now.getDay() || 7; // 1 = Monday ... 7 = Sunday
  return dow > 5 ? plus(iso(now), 8 - dow) : plus(iso(now), 1 - dow);
}
const MON = thisMonday();
const THU = plus(MON, 10); // next week's Thursday, in the default two-week window

const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));
const cell = (page, person, date) => page.locator(`[data-cell][data-person="${person.user?.id ?? person.id}"][data-date="${date}"]`);
const lane = (page) => page.getByRole('complementary', { name: 'Not assigned yet' });

let smoke;
let w;
let sam; let priya; let samUser; let priyaUser;
let unassigned; let busy;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  sam = await makeTech('sam', w.deptA.id);
  priya = await makeTech('priya', w.deptA.id);
  samUser = await models.User.findByPk(sam.user.id);
  priyaUser = await models.User.findByPk(priya.user.id);
  unassigned = await makeTicket(w.admin.agent, { title: 'Set up new user', contactId: w.contact.id, departmentId: w.deptA.id });
  const project = await makeProject(w.admin.agent, { name: 'Network refresh', ownerDepartmentId: w.deptA.id });
  busy = await makeTask(w.admin.agent, project.id, {
    title: 'Rack the switches', assigneeId: priya.user.id, estimateMinutes: 600, startDate: THU, dueDate: THU,
  });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetRateLimits);

it('drag an unassigned ticket onto Sam Thu → assigned and planned, lane shrinks', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/workload');
  await page.getByRole('heading', { level: 1, name: 'Workload' }).waitFor();
  await page.getByText('Counts work you can see', { exact: false }).waitFor();
  const card = lane(page).locator(`[data-item-kind="ticket"][data-item-id="${unassigned.id}"]`);
  await card.waitFor();
  const before = Number(await lane(page).getByLabel(/items$/).first().innerText());
  const patched = waitFor(page, 'PATCH', `/tickets/${unassigned.id}`);
  await card.dragTo(cell(page, sam, THU));
  await patched;
  await lane(page).locator(`[data-item-id="${unassigned.id}"]`).waitFor({ state: 'detached' });
  expect(Number(await lane(page).getByLabel(/items$/).first().innerText())).toBe(before - 1);
  const t = await models.Ticket.findByPk(unassigned.id);
  expect([t.assigneeId, t.plannedDate]).toEqual([sam.user.id, THU]);
  await cell(page, sam, THU).getByText('1 item').waitFor();
});

it('drag between cells moves work to another person and day', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/workload');
  await cell(page, sam, THU).click();
  const row = page.getByRole('dialog').locator(`[data-item-kind="ticket"][data-item-id="${unassigned.id}"]`);
  await row.waitFor();
  const patched = waitFor(page, 'PATCH', `/tickets/${unassigned.id}`);
  // The popover lets pointer events through only once the drag has started, so
  // the target is not "clickable" up front: skip that check.
  await row.dragTo(cell(page, priya, plus(THU, 1)), { force: true });
  await patched;
  const t = await models.Ticket.findByPk(unassigned.id);
  expect([t.assigneeId, t.plannedDate]).toEqual([priya.user.id, plus(THU, 1)]);
});

it('a drop the server refuses shows the error inline', async () => {
  const fresh = await makeTicket(w.admin.agent, { title: 'Refused', contactId: w.contact.id, departmentId: w.deptA.id });
  const page = await smoke.pageAs('admin');
  await page.route(`**/tickets/${fresh.id}`, (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: true, message: 'You cannot change this ticket' }) })
    : route.continue()));
  await page.goto('/workload');
  await lane(page).locator(`[data-item-id="${fresh.id}"]`).dragTo(cell(page, sam, plus(THU, 1)));
  await page.getByRole('alert').filter({ hasText: 'You cannot change this ticket' }).first().waitFor();
  expect((await models.Ticket.findByPk(fresh.id)).assigneeId).toBeNull();
});

it('cell over capacity is red', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/workload');
  const c = cell(page, priya, THU);
  await c.waitFor();
  expect(await c.getAttribute('data-state')).toBe('over');
  await c.getByText('10 h').waitFor();
  expect(await cell(page, priya, plus(THU, -1)).getAttribute('data-state')).toBe('free');
});

it('clicking a cell lists its items', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/workload');
  await cell(page, priya, THU).click();
  const pop = page.getByRole('dialog');
  await pop.getByText('Rack the switches').waitFor();
  await pop.getByText(busy.code || 'Rack').first().waitFor();
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'detached' });
});

it('items without canEdit are not draggable', async () => {
  const viewer = await makeStaff('viewer', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${viewer.user.id}/overrides`).send({ permissionKey: 'workload.view', granted: true }), 201);
  expectOk(await w.admin.agent.post(`${API}/users/${viewer.user.id}/overrides`).send({ permissionKey: 'tickets.view_department', granted: true }), 201);
  const stuck = await makeTicket(w.admin.agent, { title: 'Look but do not touch', contactId: w.contact.id, departmentId: w.deptA.id });
  const page = await smoke.pageAs('viewer');
  await page.goto('/workload');
  const card = lane(page).locator(`[data-item-kind="ticket"][data-item-id="${stuck.id}"]`);
  await card.waitFor();
  expect(await card.getAttribute('data-draggable')).toBe('false');
  expect(await card.getAttribute('draggable')).toBe('false');
  await card.getByText("You can't change this one").waitFor();
});

it('nav shows Workload only with workload.view', async () => {
  const plain = await makeStaff('nolook', w.deptA.id);
  expect(plain.user.id).toBeTruthy();
  const without = await smoke.pageAs('nolook');
  await without.goto('/dashboard');
  await without.getByRole('navigation').first().waitFor();
  expect(await without.getByRole('link', { name: 'Workload', exact: true }).count()).toBe(0);
  const withIt = await smoke.pageAs('admin');
  await withIt.goto('/dashboard');
  await withIt.getByRole('link', { name: 'Workload', exact: true }).first().waitFor();
});

it('Hours people work saves a 6h override', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/work-hours');
  await page.getByRole('heading', { level: 1, name: 'Hours people work' }).waitFor();
  const row = page.locator(`[data-person-hours="${samUser.id}"]`);
  await row.getByRole('button', { name: /Change hours for|Set own hours/ }).click();
  await row.getByLabel('Monday').fill('6');
  const saved = waitFor(page, 'PATCH', `/users/${samUser.id}/work-hours`);
  await row.getByRole('button', { name: 'Save hours' }).click();
  await saved;
  await row.getByText(/Mon 6 h/).waitFor();
  const u = await models.User.findByPk(samUser.id);
  expect(u.workHours['1']).toBe(360);
  expect(u.workHours['2']).toBe(480);
  // The default week is a separate panel and saves on its own.
  await page.getByLabel('Friday', { exact: true }).first().fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  const setting = JSON.parse((await models.SystemSettings.findOne({ where: { key: 'workload.defaultWorkHours' } })).value);
  expect(setting['5']).toBe(240);
  await models.SystemSettings.update({ value: JSON.stringify({ 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0, 7: 0 }) }, { where: { key: 'workload.defaultWorkHours' } });
});

it('Holidays appears under Workload in Settings', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/holidays');
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await crumb.getByText(/Workload/).waitFor();
  await page.getByRole('heading', { level: 1, name: 'Holidays' }).waitFor();
  await page.getByText('Days off for the SLA clock and workload').first().waitFor();
  await page.goto('/settings');
  await page.getByText('Hours people work').first().waitFor();
});

it("drag a task within a helper's row moves its dates and keeps the main assignee", async () => {
  const day = plus(MON, 7); // next week's Monday and Tuesday, clear of the cells above
  const project = await makeProject(w.admin.agent, { name: 'Clinic cabling', ownerDepartmentId: w.deptA.id });
  const shared = await makeTask(w.admin.agent, project.id, {
    title: 'Pull cable', assigneeId: priya.user.id, estimateMinutes: 120, startDate: day, dueDate: day,
  });
  expectOk(await w.admin.agent.post(`${API}/projects/${project.id}/tasks/${shared.id}/helpers`).send({ userId: sam.user.id }), 201);
  const page = await smoke.pageAs('admin');
  await page.goto('/workload');
  await cell(page, sam, day).click();
  const row = page.getByRole('dialog').locator(`[data-item-kind="task"][data-item-id="${shared.id}"]`);
  await row.waitFor();
  const patched = waitFor(page, 'PATCH', `/tasks/${shared.id}`);
  await row.dragTo(cell(page, sam, plus(day, 1)), { force: true });
  const res = await patched;
  expect(res.request().postDataJSON()).not.toHaveProperty('assigneeId');
  const t = await models.Task.findByPk(shared.id);
  expect([t.assigneeId, t.startDate, t.dueDate]).toEqual([priya.user.id, plus(day, 1), plus(day, 1)]);
  expect(await models.TaskAssignee.count({ where: { taskId: shared.id, userId: sam.user.id } })).toBe(1);
});

// Follow-up from 6: dispatch without dragging, for touch and keyboard.
it('on a phone, Assign… hands a ticket to a person and a day', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'Tap to assign', contactId: w.contact.id, departmentId: w.deptA.id });
  const page = await smoke.pageAs('admin', undefined, { viewport: { width: 375, height: 812 } });
  await page.goto('/workload');
  await lane(page).getByRole('button', { name: 'Assign Tap to assign' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign Tap to assign' });
  await dialog.getByLabel('Person').selectOption({ label: samUser.displayName });
  await dialog.getByLabel('Day').selectOption(THU);
  const patched = waitFor(page, 'PATCH', `/tickets/${t.id}`);
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await patched;
  await dialog.waitFor({ state: 'detached' });
  const saved = await models.Ticket.findByPk(t.id);
  expect([saved.assigneeId, saved.plannedDate]).toEqual([sam.user.id, THU]);
});

it('Assign… works from the keyboard, keeps dates by default, and Esc cancels', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'Keyboard assign', contactId: w.contact.id, departmentId: w.deptA.id });
  const page = await smoke.pageAs('admin');
  await page.goto('/workload');
  const open = lane(page).getByRole('button', { name: 'Assign Keyboard assign' });
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Assign Keyboard assign' });
  await dialog.waitFor();
  expect(await page.evaluate(() => document.activeElement.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).toBe('Assign Keyboard assign');
  expect((await models.Ticket.findByPk(t.id)).assigneeId).toBeNull();

  await page.keyboard.press('Enter');
  await dialog.getByLabel('Person').selectOption({ label: priyaUser.displayName });
  expect(await dialog.getByLabel('Day').inputValue()).toBe('none');
  const patched = waitFor(page, 'PATCH', `/tickets/${t.id}`);
  await dialog.getByRole('button', { name: 'Assign', exact: true }).focus();
  await page.keyboard.press('Enter');
  await patched;
  const saved = await models.Ticket.findByPk(t.id);
  expect([saved.assigneeId, saved.plannedDate]).toEqual([priya.user.id, null]);
});
