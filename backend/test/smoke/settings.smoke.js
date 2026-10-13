const { resetData, closeDb, models, ROLE } = require('../integration/helpers');
const { API, expectOk, makeWorld, makeUser } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The Settings redesign (spec 2026-10-12): one menu, one page layout, the
// regrouped pages.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const setting = async (key) => (await models.SystemSettings.findOne({ where: { key } }))?.value;

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

describe('Company profile', () => {
  it('holds what Company and Branding did, and saves a value from each panel', async () => {
    // Settings outlive resetData: start from known values.
    for (const [key, value] of [['company.name', 'Acme Corp'], ['company.timezone', 'UTC'], ['branding.appName', 'PRISM'], ['branding.tagline', '']]) {
      await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
    }
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    await page.getByLabel('Organization name').fill('Northwind IT');
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('App name').fill('Northwind Desk');
    await page.getByLabel('Login page tagline').fill('Help, fast');
    await shown(page, 'Unsaved changes').waitFor();
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith('/settings'));
    await page.getByRole('button', { name: 'Save' }).click();
    await saved;
    await shown(page, 'Saved').waitFor();
    expect([await setting('company.name'), await setting('company.timezone'), await setting('branding.appName'), await setting('branding.tagline')])
      .toEqual(['Northwind IT', 'America/Chicago', 'Northwind Desk', 'Help, fast']);
  });

  it('a branding-only user may change the logo but sees the text read-only', async () => {
    const brand = await makeUser('brand', ROLE.DEPARTMENT_STAFF, w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${brand.user.id}/overrides`).send({ permissionKey: 'settings.manage_branding', granted: true }), 201);
    const page = await smoke.pageAs('brand');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    expect(await page.getByLabel('Organization name').isDisabled()).toBe(true);
    await shown(page, /Changing these needs the System settings permission/).waitFor();
    expect(await page.getByRole('button', { name: 'Save' }).count()).toBe(0);
    await page.getByText('Upload').first().waitFor();
  });

  it('the old Branding address opens Company profile', async () => {
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/branding');
    await page.waitForURL('**/settings/company');
  });
});

describe('System info', () => {
  it('has the upload limit, and the old General Settings address lands on Settings', async () => {
    // Settings outlive resetData: start from a known value.
    await models.SystemSettings.upsert({ key: 'system.maxAttachmentSizeMB', value: '25' });
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/system');
    await page.getByRole('heading', { level: 1, name: 'System info' }).waitFor();
    await page.getByLabel('Max attachment size (MB)').fill('30');
    await page.getByRole('button', { name: 'Save' }).click();
    await shown(page, 'Saved').waitFor();
    expect(await setting('system.maxAttachmentSizeMB')).toBe('30');
    await page.goto('/admin/settings');
    await page.waitForURL(/\/settings$/);
  });
});
