const { resetData, closeDb, models } = require('../integration/helpers');
const { makeWorld, makeTicket } = require('../integration/fixtures');
const { startFakeClamd } = require('../helpers/fakeClamd');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

// Attachment scanning (5d): the System info card and a blocked ticket upload,
// against a fake clamd started in this process.

let smoke;
let w;
let page;
let fake;
let ticket;

const point = (port) => {
  process.env.CLAMAV_ENABLED = 'true';
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(port);
};

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, {
    title: 'Scan me', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium',
  });
  page = await smoke.pageAs('admin');
});
afterAll(async () => {
  if (fake) await fake.close();
  delete process.env.CLAMAV_ENABLED;
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

it('System info shows Connected with the version, and Test notices the scanner going away', async () => {
  fake = await startFakeClamd({ mode: 'ok' });
  point(fake.port);
  await page.goto('/settings/system');
  const card = page.getByRole('region', { name: 'Attachment scanning' });
  await card.getByText('Connected').waitFor();
  await card.getByText('ClamAV 1.5.4').waitFor();

  await fake.close();
  fake = null;
  await card.getByRole('button', { name: 'Test' }).click();
  await card.getByText('Unreachable').waitFor();
});

it('an infected ticket attachment shows the blocked message and adds nothing', async () => {
  fake = await startFakeClamd({ mode: 'found', signature: 'Eicar-Test-Signature' });
  point(fake.port);
  await page.goto(`/tickets/${ticket.id}`);
  const dialog = new Promise((resolve) => {
    page.once('dialog', (d) => { const m = d.message(); d.dismiss(); resolve(m); });
  });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'eicar.txt', mimeType: 'text/plain', buffer: Buffer.from('X5O!P%@AP'),
  });
  expect(await dialog).toBe('Upload blocked: a virus was detected (Eicar-Test-Signature)');
  expect(await models.Attachment.count({ where: { ticketId: ticket.id } })).toBe(0);
});
