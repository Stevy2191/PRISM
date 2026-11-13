const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Customize on the dashboard: panels move by dragging their handle or with
// the arrows, and the order is kept.

let smoke;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await makeWorld();
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

const order = (page) => page.getByTestId('dashboard-panel').evaluateAll((els) => els.map((e) => e.querySelector('[draggable]').textContent.replace('⠿', '').trim()));

it('drag a panel by its handle onto another, then move one with the arrows; Done keeps the order', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByTestId('dashboard-panel').first().waitFor();
  const before = await order(page);
  expect(before.length).toBeGreaterThan(2);

  // Drag the second panel's handle onto the first panel.
  const handle = page.getByTestId('dashboard-panel').nth(1).locator('[draggable]');
  await handle.dragTo(page.getByTestId('dashboard-panel').first());
  const dragged = await order(page);
  expect(dragged.slice(0, 2)).toEqual([before[1], before[0]]);

  // The arrows: move the first one later.
  await page.getByRole('button', { name: `Move ${dragged[0]} later` }).click();
  const moved = await order(page);
  expect(moved.slice(0, 2)).toEqual([dragged[1], dragged[0]]);
  expect(await page.getByRole('button', { name: `Move ${moved[0]} earlier` }).isDisabled()).toBe(true);

  const saved = page.waitForResponse((r) => r.url().endsWith('/dashboard/layout') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await saved).status()).toBe(200);
  const row = await models.DashboardLayout.findOne();
  expect(row).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Customize' }).click();
  expect((await order(page)).slice(0, 2)).toEqual(moved.slice(0, 2));
});
