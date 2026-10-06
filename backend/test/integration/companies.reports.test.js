const crypto = require('crypto');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeProject, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Reports, the custom report builder and CSAT stats are fenced by company
// (plan 2a task 10). Everything under Acme carries the ACME-SECRET marker; a
// reporter fenced to the internal company must never see it, while the
// admin's identical request does (the control).

const { Company, Contact, CsatSurvey } = models;
const MARK = 'ACME-SECRET';
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

let w;
let acme;
let tina;
let fenced;
let acmeTicket;
let acmeProject;
beforeAll(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  const a = w.admin.agent;
  const internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: `${MARK} Corp` });
  const ann = await Contact.create({ firstName: 'Ann', displayName: `${MARK} Ann`, email: 'ann@acme.test', companyId: acme.id });
  tina = await makeTech('tina', w.deptA.id);

  acmeTicket = await makeTicket(a, { title: `${MARK} ticket`, contactId: ann.id, assigneeId: tina.user.id, dueDate: day(-3) });
  expectOk(await a.post(`${API}/tickets/${acmeTicket.id}/time`).send({ durationMinutes: 30, note: `${MARK} work` }), 201);
  expectOk(await a.patch(`${API}/tickets/${acmeTicket.id}`).send({ status: 'Closed' }));
  expectOk(await a.post(`${API}/tickets/${acmeTicket.id}/csat`).send({ rating: 'happy' }), 201);
  const now = new Date();
  await CsatSurvey.create({
    ticketId: acmeTicket.id, contactId: ann.id, assignedToUserId: tina.user.id, surveyToken: crypto.randomUUID(),
    status: 'responded', dueToSendAt: now, sentAt: now, respondedAt: now, rating: 5, comment: `${MARK} thanks`,
  });
  await CsatSurvey.create({
    ticketId: acmeTicket.id, contactId: ann.id, assignedToUserId: tina.user.id, surveyToken: crypto.randomUUID(),
    status: 'pending', dueToSendAt: now, sentAt: now,
  });

  acmeProject = await makeProject(a, { name: `${MARK} project`, companyId: acme.id, ownerDepartmentId: w.deptA.id, assignedToUserId: tina.user.id });
  expectOk(await a.post(`${API}/projects/${acmeProject.id}/time-entries`).send({
    startTime: `${day(0)}T10:00:00Z`, endTime: `${day(0)}T11:00:00Z`, entryDate: day(0), userId: tina.user.id,
    description: `${MARK} build`,
  }), 201);
  expectOk(await a.post(`${API}/projects/${acmeProject.id}/expenses`).send({ description: `${MARK} cables`, amount: 100 }), 201);
  expectOk(await a.post(`${API}/projects/${acmeProject.id}/materials`).send({ itemName: `${MARK} switch`, quantity: 1, unitCost: 10 }), 201);

  const category = await models.AssetCategory.create({ name: 'Laptops' });
  const asset = expectOk(await a.post(`${API}/assets`).send({
    name: `${MARK} laptop`, assetTag: `${MARK}-1`, categoryId: category.id, companyId: acme.id,
    warrantyExpiryDate: day(-10), replacementPlanDate: day(30), purchasePrice: 900,
  }), 201).asset;
  expectOk(await a.post(`${API}/assets/${asset.id}/tickets`).send({ ticketId: acmeTicket.id }), 201);
  expectOk(await a.post(`${API}/licenses`).send({ name: `${MARK} licence`, companyId: acme.id, expiryDate: day(30), renewalDate: day(30), annualCost: 500 }), 201);
  expectOk(await a.post(`${API}/contracts`).send({ name: `${MARK} contract`, vendor: 'Dell', companyId: acme.id, renewalDate: day(30), annualCost: 700 }), 201);

  fenced = await makeTech('fenced', w.deptA.id);
  for (const permissionKey of ['reports.view_all', 'reports.export']) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(await a.post(`${API}/users/${fenced.user.id}/overrides`).send({ permissionKey, granted: true }), 201);
  }
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

const body = async (agent, path) => {
  const res = await agent.get(`${API}${path}`);
  expect(res.status).toBe(200);
  return res.headers['content-type'].startsWith('text/csv') ? res.text : JSON.stringify(res.body);
};

// Reports that list records by name: the marker must not appear.
const JSON_REPORTS = [
  '/reports/ticket-volume', '/reports/sla-compliance', '/reports/time-billing', '/reports/projects',
  '/reports/contacts', '/reports/customer-happiness', '/reports/assets/replacement', '/reports/assets/warranty',
  '/reports/assets/inventory', '/reports/assets/ticket-history', '/reports/licenses/inventory',
  '/reports/contracts/summary', '/reports/licenses-contracts/upcoming-renewals', '/csat/responses',
];
const EXPORTS = [
  '/reports/ticket-volume/export', '/reports/sla-compliance/export', '/reports/time-billing/export',
  '/reports/projects/export', '/reports/customer-happiness/export', '/reports/assets/replacement/export',
  '/reports/assets/warranty/export', '/reports/assets/inventory/export', '/reports/assets/ticket-history/export',
  '/reports/licenses/inventory/export', '/reports/contracts/summary/export',
  '/reports/licenses-contracts/upcoming-renewals/export', '/reports/tickets/export',
];
// Reports that only aggregate: the Acme rows' contribution must be missing.
const json = (text) => JSON.parse(text);
const lines = (text) => text.split('\r\n').filter(Boolean);
const AGGREGATES = [
  ['/reports/ticket-trends', (t) => json(t).summary.totalCreated, 1, 0],
  ['/reports/csat', (t) => json(t).overall.total, 1, 0],
  ['/reports/licenses/spend', (t) => json(t).summary.licenseCount, 1, 0],
  ['/reports/contracts/spend', (t) => json(t).summary.contractCount, 1, 0],
  ['/csat/stats', (t) => json(t).team.find((r) => r.name === 'Test tina').responseCount, 1, 0],
  ['/reports/ticket-trends/export', (t) => lines(t).length, 2, 1],
  ['/reports/licenses/spend/export', (t) => lines(t).length, 2, 1],
  ['/reports/contracts/spend/export', (t) => lines(t).length, 2, 1],
  // The admin's 30 minutes, Tina's closed ticket and her hour of project time are Acme's.
  ['/reports/team-performance/export', (t) => lines(t).filter((l) => /^Test (admin|tina),/.test(l)).sort(),
    ['Test admin,—,0,0,0,,0.5,', 'Test tina,Service Desk,1,1,0,0,1,'],
    ['Test admin,—,0,0,0,,0,', 'Test tina,Service Desk,0,0,0,,0,']],
  // Ann is the only contact with no department.
  ['/reports/contacts/export', (t) => lines(t).some((l) => l.startsWith('No department,')), true, false],
];

it.each(JSON_REPORTS)('%s leaves out other companies', async (path) => {
  expect(await body(w.admin.agent, path)).toContain(MARK);
  expect(await body(fenced.agent, path)).not.toContain(MARK);
});

it.each(EXPORTS)('%s leaves out other companies', async (path) => {
  expect(await body(w.admin.agent, path)).toContain(MARK);
  expect(await body(fenced.agent, path)).not.toContain(MARK);
});

it.each(AGGREGATES)('%s leaves out other companies\' numbers', async (path, pick, adminValue, fencedValue) => {
  expect(pick(await body(w.admin.agent, path))).toEqual(adminValue);
  expect(pick(await body(fenced.agent, path))).toEqual(fencedValue);
});

it.each(['tickets', 'projects', 'time_entries', 'expenses_materials', 'contacts'])(
  'the custom %s report leaves out other companies',
  async (dataSource) => {
    const run = async (agent) => JSON.stringify(expectOk(await agent.post(`${API}/reports/custom`).send({ dataSource })));
    expect(await run(w.admin.agent)).toContain(MARK);
    expect(await run(fenced.agent)).not.toContain(MARK);
  }
);

it('time-billing totals leave out other companies\' hours', async () => {
  const hours = async (agent) => expectOk(await agent.get(`${API}/reports/time-billing`)).summary.totalHours;
  expect(await hours(w.admin.agent)).toBe(1.5);
  expect(await hours(fenced.agent)).toBe(0);
});

it('team-performance counts no other company\'s tickets', async () => {
  const closed = async (agent) => expectOk(await agent.get(`${API}/reports/team-performance`)).summary.totalClosed;
  expect(await closed(w.admin.agent)).toBe(1);
  expect(await closed(fenced.agent)).toBe(0);
});

it('the dashboard\'s team happiness leaves out other companies\' ratings', async () => {
  const tinaRow = async (agent) => {
    const dash = expectOk(await agent.get(`${API}/dashboard`));
    return (dash.teamHappiness || []).find((r) => r.userId === tina.user.id);
  };
  expect((await tinaRow(w.admin.agent)).responseCount).toBe(1);
  const mine = await tinaRow(fenced.agent);
  expect(mine ? mine.responseCount : 0).toBe(0);
});
