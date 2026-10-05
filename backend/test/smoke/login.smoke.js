const { resetData, closeDb } = require('../integration/helpers');
const { makeAdmin } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The harness itself: a signed-in admin reaches the dashboard through the
// real API and the built frontend.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(resetData);

it('a signed-in admin lands on the dashboard', async () => {
  await makeAdmin();
  const page = await smoke.pageAs('admin');
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Tickets' }).first().waitFor();
  expect(page.url()).toContain('/dashboard');
});
