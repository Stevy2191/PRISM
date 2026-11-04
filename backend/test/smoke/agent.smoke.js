const fs = require('fs');
const path = require('path');
const {
  resetData, closeDb, models, getApp,
} = require('../integration/helpers');
const { makeAdmin, makeCompany } = require('../integration/fixtures');
const { enrollDevice } = require('../integration/agentClient');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { startSmoke } = require('./harness');

// Sub-project 8a, task 12: the agent's staff screens, end to end.

let smoke;
beforeAll(async () => { smoke = await startSmoke(); });
afterAll(async () => { await smoke.stop(); await closeDb(); });
beforeEach(async () => { await resetData(); resetRateLimits(); });

const inventory = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/agent/windows11.json'), 'utf8'));

it('a key, a computer online, its Device and Software tabs, the Online filter and a tray ticket', async () => {
  const admin = await makeAdmin();
  const company = await makeCompany(admin, { name: 'Riverside' });
  await models.Contact.create({
    firstName: 'Maria', lastName: 'Chen', displayName: 'Maria Chen', email: 'maria.chen@riversideclinic.org', companyId: company.id,
  });
  const category = await models.AssetCategory.findOne();
  await models.Asset.create({ assetTag: 'PRN-1', name: 'Front desk printer', categoryId: category.id, companyId: company.id });

  // A key from the Devices tab; its install command carries the secret once.
  const page = await smoke.pageAs('admin');
  await page.goto(`/companies/${company.id}`);
  await page.getByRole('button', { name: 'Devices' }).click();
  await page.getByRole('button', { name: 'New enrolment key' }).click();
  await page.getByLabel('Name').fill('Clinic rollout');
  await page.getByRole('button', { name: 'Create key' }).click();
  const command = page.getByLabel('Command', { exact: true });
  await command.getByText(/ENROLL_KEY=pk_enr_[A-Za-z0-9_-]{20,}/).waitFor();
  const text = await command.textContent();
  expect(text).toContain('msiexec /i ');
  expect(text).toContain(`PRISM_URL=${smoke.base}`);
  await page.getByRole('cell', { name: /Clinic rollout/ }).waitFor();
  // The macOS tab (8b): the package, Open Anyway once, then the enrol
  // command with the same new key.
  await page.getByRole('tab', { name: 'macOS' }).click();
  await page.getByRole('list', { name: 'Installing on a Mac' }).getByText('Open Anyway').waitFor();
  const macCommand = await page.getByLabel('Command', { exact: true }).textContent();
  expect(macCommand).toBe(`sudo prism-agent enroll --url ${smoke.base} --key ${text.match(/ENROLL_KEY=(pk_enr_[A-Za-z0-9_-]+)/)[1]}`);
  await page.getByRole('tab', { name: 'Windows' }).click();

  // A computer enrols with that key and reports in.
  const secret = text.match(/ENROLL_KEY=(pk_enr_[A-Za-z0-9_-]+)/)[1];
  const device = await enrollDevice(getApp(), secret);
  await device.post('/api/v1/agent/v1/inventory', inventory()).expect(200);
  await page.reload();
  await page.getByRole('button', { name: 'Devices' }).click();
  const row = page.getByRole('row').filter({ hasText: 'RFC-FD-01' });
  await row.getByText('Online', { exact: true }).waitFor();
  await row.getByText('Maria Chen').waitFor();
  await row.getByText('Windows 11 Pro 24H2').waitFor();

  // Its Asset: the badges, the Device tab, the Software tab.
  await row.getByRole('link', { name: /Asset / }).click();
  await page.getByRole('heading', { name: 'RFC-FD-01' }).waitFor();
  await page.getByText('Agent-managed').waitFor();
  await page.getByRole('button', { name: 'Device', exact: true }).click();
  const hw = page.getByRole('region', { name: 'Hardware and OS' });
  await hw.getByText(/i5-13500 · 14 cores/).waitFor();
  await hw.getByText('7XK4Q93').waitFor();
  await hw.getByText('RIVERSIDE (Active Directory domain)').waitFor();
  await page.getByRole('region', { name: 'Network' }).getByText('B0:7B:25:3E:91:0C').waitFor();
  await page.getByRole('region', { name: 'Disks' }).getByText('476 GB total · 212 GB free').waitFor();
  await page.getByRole('button', { name: /^Software/ }).click();
  const sw = page.getByRole('region', { name: 'Installed software' });
  await sw.getByRole('cell', { name: 'Google Chrome' }).waitFor();
  await sw.getByLabel('Search software').fill('adobe');
  await sw.getByRole('cell', { name: 'Adobe Acrobat Reader (64-bit)' }).waitFor();
  await sw.getByRole('cell', { name: 'Google Chrome' }).waitFor({ state: 'detached' });

  // The Assets list: the Online column and the Online pill.
  await page.goto('/assets');
  const listRow = page.getByRole('row').filter({ hasText: 'RFC-FD-01' });
  await listRow.getByText('Online', { exact: true }).waitFor();
  await page.getByRole('row').filter({ hasText: 'Front desk printer' }).waitFor();
  await page.getByRole('group', { name: 'Agent' }).getByRole('button', { name: /^Online/ }).click();
  await page.getByRole('row').filter({ hasText: 'Front desk printer' }).waitFor({ state: 'detached' });
  await listRow.waitFor();

  // A ticket from the tray: the source, and the computer in the sidebar.
  const raised = await device.post('/api/v1/agent/v1/tray/tickets', {
    account: 'RIVERSIDE\\mchen', upn: 'maria.chen@riversideclinic.org', subject: 'Scanner missing', description: 'Since this morning', snapshot: { agentVersion: '0.5.0' },
  });
  expect(raised.status).toBe(201);
  await page.goto(`/tickets/${raised.body.ticketId}`);
  await page.getByText('PRISM tray').first().waitFor();
  const linked = page.getByRole('link', { name: /RFC-FD-01/ }).first();
  await linked.waitFor();
  await page.getByText('Online', { exact: true }).first().waitFor();
});

it('the install card shows the trust step only when PRISM serves a test certificate', async () => {
  const admin = await makeAdmin();
  const company = await makeCompany(admin, { name: 'Riverside' });
  const page = await smoke.pageAs('admin');

  // No test certificate (here the address falls through to the app page).
  await page.goto(`/companies/${company.id}`);
  await page.getByRole('button', { name: 'Devices' }).click();
  await page.getByRole('region', { name: 'Install command' }).waitFor();
  await page.waitForLoadState('networkidle');
  expect(await page.getByRole('region', { name: 'Test certificate' }).count()).toBe(0);
  // 127.0.0.1 over HTTP is fine for the agent: no HTTPS warning.
  expect(await page.getByText('The agent connects only over HTTPS').count()).toBe(0);

  // setup.sh's test certificate (nginx serves it; faked here).
  await page.route('**/prism-test-ca.crt', (route) => route.fulfill({
    status: 200, contentType: 'application/x-x509-ca-cert', body: '-----BEGIN CERTIFICATE-----\n',
  }));
  await page.reload();
  await page.getByRole('button', { name: 'Devices' }).click();
  const trust = page.getByRole('region', { name: 'Test certificate' });
  await trust.getByRole('link', { name: 'Download test certificate' }).waitFor();
  expect(await trust.getByRole('link', { name: 'Download test certificate' }).getAttribute('href')).toBe('/prism-test-ca.crt');
  expect(await trust.getByLabel('Trust command').textContent()).toBe('certutil -addstore -f Root prism-test-ca.crt');
  await page.getByRole('tab', { name: 'macOS' }).click();
  expect(await page.getByRole('region', { name: 'Test certificate' }).getByLabel('Trust command').textContent())
    .toContain('security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain');
});

it('Scan now on the Asset page and the Devices tab; the next inventory answers it', async () => {
  const admin = await makeAdmin();
  const company = await makeCompany(admin, { name: 'Riverside' });
  const key = await admin.agent.post(`/api/v1/companies/${company.id}/agent-keys`).send({ name: 'Scan test' });
  const device = await enrollDevice(getApp(), key.body.secret);
  await device.post('/api/v1/agent/v1/inventory', inventory()).expect(200);
  const d = await models.Device.findByPk(device.deviceId);

  const page = await smoke.pageAs('admin');
  await page.goto(`/assets/${d.assetId}`);
  await page.getByRole('button', { name: 'Scan now' }).click();
  await page.getByText(/^Scan requested just now$/).waitFor();
  expect((await models.Device.findByPk(d.id)).scanRequestedAt).not.toBeNull();

  // The Devices tab shows it pending too.
  await page.goto(`/companies/${company.id}`);
  await page.getByRole('button', { name: 'Devices' }).click();
  const row = page.getByRole('row').filter({ hasText: 'RFC-FD-01' });
  await row.getByText(/Scan requested/).waitFor();

  // The computer checks in (scan: true) and reports; the request clears.
  resetRateLimits();
  const beat = await device.post('/api/v1/agent/v1/heartbeat', { agentVersion: '0.5.0' }).expect(200);
  expect(beat.body.scan).toBe(true);
  await device.post('/api/v1/agent/v1/inventory', inventory()).expect(200);
  await page.reload();
  await page.getByRole('button', { name: 'Devices' }).click();
  await page.getByRole('row').filter({ hasText: 'RFC-FD-01' }).getByRole('button', { name: 'Scan now' }).waitFor();
});
