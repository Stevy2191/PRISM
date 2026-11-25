const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeTech, setCompanyAccess,
} = require('./fixtures');
const { taxForLines, customerBilling, isExemptOn } = require('../../src/services/money/tax');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const migration = require('../../migrations/20260101000105-tax-and-company-billing');

// Phase 3, step 1, task 4: tax rates, tax categories with a taxable share,
// and each customer's billing settings.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
let w;
let alpha;
let rate;
const a = () => w.admin.agent;
const cat = async (name) => models.TaxCategory.findOne({ where: { name } });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  rate = expectOk(await a().post(`${API}/money/tax-rates`).send({ name: 'Riverside 8.25%', ratePercent: '8.25', isDefault: true }), 201).taxRate;
});
afterAll(closeDb);

it('seeds the tax categories with their taxable shares', async () => {
  const cats = expectOk(await a().get(`${API}/money/tax-categories`)).taxCategories;
  const byName = Object.fromEntries(cats.map((c) => [c.name, c.taxablePercent]));
  expect(byName).toMatchObject({
    'Parts and equipment': '100.0000', 'Managed services': '80.0000', 'Remote support': '80.0000', 'On-site labor': '100.0000', Cabling: '100.0000', Licenses: '100.0000', Fees: '0.0000',
  });
});

it('works out tax per line at the taxable share', async () => {
  const billing = await customerBilling(alpha.id);
  expect(billing).toMatchObject({ chargeTax: true, taxExempt: false, taxRatePercent: '8.2500', termsDays: 30, invoiceTiming: 'monthly' });
  const managed = await cat('Managed services');
  const parts = await cat('Parts and equipment');
  const fees = await cat('Fees');
  const out = taxForLines([
    { amount: '100.00', taxCategoryId: managed.id },
    { amount: '100.00', taxCategoryId: parts.id },
    { amount: '45.00', taxCategoryId: fees.id },
    { amount: '10.00', taxCategoryId: null },
  ], billing, { categories: [managed, parts, fees] });
  expect(out.lines.map((l) => l.tax)).toEqual(['6.60', '8.25', '0.00', '0.00']);
  expect(out.lines.map((l) => l.taxable)).toEqual(['80.00', '100.00', '0.00', '0.00']);
  expect(out.taxTotal).toBe('14.85');
});

it('an exempt customer pays none, until the certificate expires; tax can be left off', async () => {
  const parts = await cat('Parts and equipment');
  const lines = [{ amount: '100.00', taxCategoryId: parts.id }];
  expectOk(await a().put(`${API}/companies/${alpha.id}/billing`).send({ taxExempt: true, exemptExpiresOn: '2030-01-01' }));
  let billing = await customerBilling(alpha.id);
  expect(isExemptOn(billing, '2026-12-01')).toBe(true);
  expect(taxForLines(lines, billing, { categories: [parts], onDate: '2026-12-01' }).taxTotal).toBe('0.00');
  expect(taxForLines(lines, billing, { categories: [parts], onDate: '2030-01-02' }).taxTotal).toBe('8.25');
  expectOk(await a().put(`${API}/companies/${alpha.id}/billing`).send({ taxExempt: false, chargeTax: false }));
  billing = await customerBilling(alpha.id);
  expect(taxForLines(lines, billing, { categories: [parts] }).taxTotal).toBe('0.00');
});

it("a customer's own rate, terms, timing and rate overrides", async () => {
  const other = expectOk(await a().post(`${API}/money/tax-rates`).send({ name: 'Out of town 6.25%', ratePercent: '6.25' }), 201).taxRate;
  const saved = expectOk(await a().put(`${API}/companies/${alpha.id}/billing`).send({
    taxRateId: other.id, termsDays: 15, invoiceTiming: 'on_close', hourlyRate: '90', tripCharge: '35.50',
  })).billing;
  expect(saved).toMatchObject({
    taxRatePercent: '6.2500', termsDays: 15, invoiceTiming: 'on_close', hourlyRate: '90.00', tripCharge: '35.50',
  });
  for (const body of [{ termsDays: -1 }, { invoiceTiming: 'weekly' }, { hourlyRate: '-5' }, { taxRateId: 999999 }, { exemptExpiresOn: 'soon' }]) {
    // eslint-disable-next-line no-await-in-loop
    expect((await a().put(`${API}/companies/${alpha.id}/billing`).send(body)).status).toBe(400);
  }
  // Back to the defaults.
  const cleared = expectOk(await a().put(`${API}/companies/${alpha.id}/billing`).send({ taxRateId: null, termsDays: null, hourlyRate: null })).billing;
  expect(cleared).toMatchObject({ taxRatePercent: '8.2500', termsDays: 30, hourlyRate: '0.00' });
});

it('one default rate at a time; rates and categories are validated', async () => {
  const second = expectOk(await a().post(`${API}/money/tax-rates`).send({ name: 'Second', ratePercent: '7', isDefault: true }), 201).taxRate;
  const rates = expectOk(await a().get(`${API}/money/tax-rates`)).taxRates;
  expect(rates.filter((r) => r.isDefault).map((r) => r.id)).toEqual([second.id]);
  expect((await a().post(`${API}/money/tax-rates`).send({ name: 'Bad', ratePercent: '101' })).status).toBe(400);
  expect((await a().post(`${API}/money/tax-categories`).send({ name: 'Odd', taxablePercent: '120' })).status).toBe(400);
  const made = expectOk(await a().post(`${API}/money/tax-categories`).send({ name: 'Data processing', taxablePercent: '80' }), 201).taxCategory;
  expect(expectOk(await a().patch(`${API}/money/tax-categories/${made.id}`).send({ taxablePercent: '100' })).taxCategory.taxablePercent).toBe('100.0000');
  expect((await a().post(`${API}/money/tax-categories`).send({ name: 'data PROCESSING', taxablePercent: '1' })).status).toBe(409);
  expect(rate.isDefault).toBe(true);
});

it('fences billing settings: permission and company reach', async () => {
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/companies/${alpha.id}/billing`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/money/tax-rates`)).status).toBe(403);
  // A billing clerk who reaches only Beta can't reach Alpha's, and no file
  // is written for an upload to Alpha.
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  const clerk = await makeTech('cleo', w.deptA.id);
  await models.UserPermissionOverride.bulkCreate(['money.billing.view', 'money.billing.manage'].map((permissionKey) => ({ userId: clerk.user.id, permissionKey, granted: true })));
  invalidateAllPermissions();
  await setCompanyAccess(w.admin, clerk.user.id, { allCompanies: false, companyIds: [beta.id] });
  expect((await clerk.agent.get(`${API}/companies/${beta.id}/billing`)).status).toBe(200);
  expect([403, 404]).toContain((await clerk.agent.get(`${API}/companies/${alpha.id}/billing`)).status);
  expect([403, 404]).toContain((await clerk.agent.post(`${API}/companies/${alpha.id}/billing/certificate`).attach('file', PDF, 'cert.pdf')).status);
  const fs = require('fs');
  const path = require('path');
  const { UPLOAD_ROOT } = require('../../src/middleware/upload');
  expect(fs.existsSync(path.join(UPLOAD_ROOT, 'companies', String(alpha.id)))).toBe(false);
});

it('keeps the exemption certificate (PDF, PNG, JPG only)', async () => {
  const up = expectOk(await a().post(`${API}/companies/${alpha.id}/billing/certificate`).attach('file', PDF, 'Texas exemption.pdf'), 201).billing;
  expect(up.exemptCertificateName).toBe('Texas exemption.pdf');
  const got = await a().get(`${API}/companies/${alpha.id}/billing/certificate`);
  expect(got.status).toBe(200);
  expect(got.headers['content-disposition']).toMatch(/attachment/);
  expect((await a().post(`${API}/companies/${alpha.id}/billing/certificate`).attach('file', Buffer.from('MZ'), 'virus.exe')).status).toBe(400);
  expect((await a().post(`${API}/companies/${alpha.id}/billing/certificate`).attach('file', Buffer.from('hello'), 'notes.docx')).status).toBe(400);
});

it('merging keeps the surviving company\'s billing settings', async () => {
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  expectOk(await a().put(`${API}/companies/${alpha.id}/billing`).send({ termsDays: 10 }));
  expectOk(await a().put(`${API}/companies/${beta.id}/billing`).send({ termsDays: 20 }));
  expectOk(await a().post(`${API}/companies/${beta.id}/merge`).send({ intoCompanyId: alpha.id }));
  expect((await customerBilling(alpha.id)).termsDays).toBe(10);
  expect(await models.CompanyBilling.count({ where: { companyId: beta.id } })).toBe(0);
});

it('migration 105 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('CompanyBilling');
  expect(names).not.toContain('TaxCategories');
  await migration.up(qi, Sequelize);
  expect(await models.TaxCategory.count()).toBe(7);
});
