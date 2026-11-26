const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeTech,
} = require('./fixtures');
const { startMockMicrosoft } = require('./mockMicrosoft');
const { TENANT } = require('./m365Fixtures');
const { encryptToken } = require('../../src/utils/tokenCrypto');
const { unit } = require('../../src/services/money/money');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { downFrom, upFrom } = require('./moneyMigrations');

// Phase 3, step 3, task 1: recurring agreements. Alpha Dental pays per user
// (Full and Light), per server, and for its Microsoft 365 licenses, the
// count read from its tenant each month.

const BUSINESS_STANDARD = 'f245ecc8-75af-4f8e-b61f-27d8114de5f3';
let ms;
let w;
let alpha;
let servers;
const a = () => w.admin.agent;

const people = async (companyId, n, supportTier) => {
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await models.Contact.create({
      companyId, firstName: `${supportTier}${i}`, lastName: 'P', displayName: `${supportTier}${i} P`, email: `${supportTier}${i}.${companyId}@alpha.test`, supportTier,
    });
  }
};
const agreementBody = (extra = {}) => ({
  companyId: alpha.id,
  name: 'Managed services',
  startsOn: '2026-12-15',
  lines: [
    { kind: 'per_user', tier: 'full', description: 'Full user', unitPrice: '95' },
    { kind: 'per_user', tier: 'light', description: 'Light user', unitPrice: '35' },
    { kind: 'per_device', assetCategoryId: servers.id, description: 'Server', unitPrice: '150' },
    {
      kind: 'license', skuId: BUSINESS_STANDARD, countSource: 'm365', manualCount: '10', description: 'Microsoft 365 Business Standard', unitPrice: '12.50',
    },
  ],
  ...extra,
});
const makeAgreement = async (extra) => expectOk(await a().post(`${API}/money/agreements`).send(agreementBody(extra)), 201).agreement;

beforeAll(async () => {
  ms = await startMockMicrosoft();
  process.env.MS_LOGIN_BASE = ms.loginBase;
  process.env.MS_GRAPH_BASE = ms.graphBase;
});
afterAll(async () => { await ms.close(); await closeDb(); });

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  require('../../src/services/microsoft365/graph').clearTokenCache(); // eslint-disable-line global-require
  await models.SystemSettings.upsert({ key: 'portal.msClientId', value: ms.clientId });
  await models.SystemSettings.upsert({ key: 'portal.msClientSecret', value: encryptToken(ms.clientSecret) });
  ms.failures = [];
  ms.tenants = { [TENANT]: { users: {}, groups: {}, skus: [{ skuId: BUSINESS_STANDARD, skuPartNumber: 'O365_BUSINESS_PREMIUM', consumedUnits: 14 }] } };

  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  await models.Company.update({ msTenantId: TENANT, msConsentAt: new Date() }, { where: { id: alpha.id } });
  await people(alpha.id, 12, 'full');
  await people(alpha.id, 4, 'light');
  servers = await models.AssetCategory.findOne({ where: { name: 'Servers' } }) || await models.AssetCategory.create({ name: 'Servers' });
  for (const tag of ['SRV-1', 'SRV-2']) {
    // eslint-disable-next-line no-await-in-loop
    await models.Asset.create({ assetTag: tag, name: tag, categoryId: servers.id, companyId: alpha.id });
  }
  await models.Asset.create({ assetTag: 'SRV-OLD', name: 'Old', categoryId: servers.id, companyId: alpha.id, status: 'retired' });
});

it('previews each line with this month\'s count: users by tier, servers, licenses from Microsoft 365', async () => {
  const agreement = await makeAgreement();
  expect(agreement).toMatchObject({ companyId: alpha.id, status: 'active', startsOn: '2026-12-15' });
  expect(agreement.lines).toHaveLength(4);
  const preview = expectOk(await a().get(`${API}/money/agreements/${agreement.id}/preview`));
  expect(preview.lines.map((l) => [unit(l.quantity), l.source, l.amount])).toEqual([
    ['12.0000', 'tiers', '1140.00'],
    ['4.0000', 'tiers', '140.00'],
    ['2.0000', 'assets', '300.00'],
    ['14.0000', 'm365', '175.00'],
  ]);
  expect(preview.total).toBe('1755.00');
});

it('falls back to the typed count when Microsoft 365 can\'t be read', async () => {
  const agreement = await makeAgreement();
  ms.failures.push({ match: /subscribedSkus/, status: 500 });
  const preview = expectOk(await a().get(`${API}/money/agreements/${agreement.id}/preview`));
  expect([unit(preview.lines[3].quantity), preview.lines[3].source]).toEqual(['10.0000', 'manual']);
});

it('one active agreement per company; checks every line', async () => {
  await makeAgreement();
  expect((await a().post(`${API}/money/agreements`).send(agreementBody())).status).toBe(409);
  const beta = await makeCompany(w.admin, { name: 'Beta Law' });
  const send = (lines) => a().post(`${API}/money/agreements`).send(agreementBody({ companyId: beta.id, lines }));
  expect((await send([{ kind: 'per_user', description: 'User', unitPrice: '95' }])).status).toBe(400);
  expect((await send([{ kind: 'flat', description: 'Fee', unitPrice: '-5' }])).status).toBe(400);
  expect((await send([{ kind: 'prepaid_hours', description: 'Block', unitPrice: '900' }])).status).toBe(400);
  expect((await send([{ kind: 'license', countSource: 'm365', description: 'No SKU', unitPrice: '5' }])).status).toBe(400);
  expect((await send([])).status).toBe(400);
  const prepaid = expectOk(await send([{
    kind: 'prepaid_hours', description: '10 hours a month', unitPrice: '900', hours: '10', rollover: true, overageRate: '110',
  }]), 201).agreement;
  expect(prepaid.lines[0]).toMatchObject({ kind: 'prepaid_hours', rollover: true, overageRate: '110.00' });
});

it('edits and cancels; a cancelled agreement makes room for a new one', async () => {
  const agreement = await makeAgreement();
  const edited = expectOk(await a().patch(`${API}/money/agreements/${agreement.id}`).send({
    name: 'Managed services 2027', lines: [{ kind: 'flat', description: 'Monitoring', unitPrice: '250' }],
  })).agreement;
  expect(edited.name).toBe('Managed services 2027');
  expect(edited.lines.map((l) => l.description)).toEqual(['Monitoring']);
  const cancelled = expectOk(await a().post(`${API}/money/agreements/${agreement.id}/cancel`).send({ cancelledOn: '2027-03-31' })).agreement;
  expect(cancelled).toMatchObject({ status: 'cancelled', cancelledOn: '2027-03-31' });
  expect((await a().post(`${API}/money/agreements/${agreement.id}/cancel`).send({ cancelledOn: '2027-03-31' })).status).toBe(409);
  await makeAgreement({ startsOn: '2027-04-01' });
  const listed = expectOk(await a().get(`${API}/money/agreements?companyId=${alpha.id}`)).agreements;
  expect(listed.map((x) => x.status).sort()).toEqual(['active', 'cancelled']);
});

it('fences agreements: technicians, other companies, the switch', async () => {
  const agreement = await makeAgreement();
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/agreements`)).status).toBe(403);
  expect((await tech.agent.get(`${API}/money/agreements/${agreement.id}`)).status).toBe(403);

  const clerk = await makeTech('cleo', w.deptA.id);
  for (const permissionKey of ['money.billing.view', 'money.billing.manage']) {
    // eslint-disable-next-line no-await-in-loop
    await models.UserPermissionOverride.create({ userId: clerk.user.id, permissionKey, granted: true });
  }
  invalidateAllPermissions();
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  await w.admin.agent.put(`${API}/users/${clerk.user.id}/company-access`).send({ allCompanies: false, companyIds: [other.id] });
  expect((await clerk.agent.get(`${API}/money/agreements/${agreement.id}`)).status).toBe(404);
  expect((await clerk.agent.get(`${API}/money/agreements/${agreement.id}/preview`)).status).toBe(404);
  expect((await clerk.agent.post(`${API}/money/agreements`).send(agreementBody({ startsOn: '2027-01-01' }))).status).toBe(404);
  expect(expectOk(await clerk.agent.get(`${API}/money/agreements`)).agreements).toEqual([]);

  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await a().get(`${API}/money/agreements`)).status).toBe(404);
  expect((await a().get(`${API}/money/agreements/${agreement.id}`)).status).toBe(404);
});

it('merging the company moves its agreement', async () => {
  const agreement = await makeAgreement();
  const kept = await makeCompany(w.admin, { name: 'Alpha Dental Group' });
  expectOk(await a().post(`${API}/companies/${alpha.id}/merge`).send({ intoCompanyId: kept.id }));
  expect((await models.Agreement.findByPk(agreement.id)).companyId).toBe(kept.id);
});

it('two active agreements can\'t be merged into one company; a company with one can\'t be deleted', async () => {
  await makeAgreement();
  const other = await makeCompany(w.admin, { name: 'Alpha Dental Group' });
  await a().post(`${API}/money/agreements`).send(agreementBody({ companyId: other.id })).expect(201);
  const res = await a().post(`${API}/companies/${alpha.id}/merge`).send({ intoCompanyId: other.id });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('AGREEMENT_EXISTS');
  expect(await models.Agreement.count({ where: { companyId: alpha.id } })).toBe(1);
  const lone = await makeCompany(w.admin, { name: 'Lone' });
  await a().post(`${API}/money/agreements`).send(agreementBody({ companyId: lone.id, lines: [{ kind: 'flat', description: 'Fee', unitPrice: '10' }] })).expect(201);
  expect((await a().delete(`${API}/companies/${lone.id}`)).status).toBe(409);
});

it('migration 115 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000115');
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  expect(names).not.toContain('Agreements');
  expect(names).not.toContain('AgreementLines');
  await upFrom('20260101000115');
  expect((await qi.describeTable('AgreementLines')).hoursBalanceMinutes).toBeDefined();
});
