const {
  resetData, closeDb, models,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const run = require('../../src/services/money/billingRun');
const { invoiceJson } = require('../../src/services/money/invoices');
const { invalidateAllPermissions } = require('../../src/services/permissionService');

// Phase 3, step 3, task 3: the billing run on the 1st. Each customer gets
// one draft: the coming month's agreement fees (prorated in the first
// month, catching up people added since) plus last month's extras after
// the billing rules — trip charges, minimums and steps, covered time at
// $0, prepaid hours drawn down, materials and rebilled expenses.

let w;
let alpha;
let beta;
let servers;
let onSite;
let remote;
let alphaTicket;
let betaTicket;
const a = () => w.admin.agent;

const people = async (companyId, n, supportTier, from = 0) => {
  for (let i = from; i < from + n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await models.Contact.create({
      companyId, firstName: `${supportTier}${i}`, lastName: 'P', displayName: `${supportTier}${i} P`, email: `${supportTier}${i}.${companyId}@x.test`, supportTier,
    });
  }
};
const log = (ticket, entryDate, minutes, workType, extra = {}) => models.TimeEntry.create({
  ticketId: ticket.id, userId: w.admin.user.id, entryDate, durationSeconds: minutes * 60, workTypeId: workType.id, billable: true, ...extra,
});
const alphaAgreement = (extra = {}) => a().post(`${API}/money/agreements`).send({
  companyId: alpha.id,
  name: 'Managed services',
  startsOn: '2026-12-15',
  lines: [
    { kind: 'per_user', tier: 'full', description: 'Full user', unitPrice: '95' },
    { kind: 'per_user', tier: 'light', description: 'Light user', unitPrice: '35' },
    { kind: 'per_device', assetCategoryId: servers.id, description: 'Server', unitPrice: '150' },
    { kind: 'license', countSource: 'manual', manualCount: '14', description: 'Microsoft 365 Business Standard', unitPrice: '12.50' },
  ],
  ...extra,
}).expect(201);
const draft = async (companyId, opts) => invoiceJson(await run.draftForCompany(companyId, opts));
const amounts = (inv) => inv.lines.map((l) => [l.kind, l.amount]);
const statusOf = async (entry) => (await models.TimeEntry.findByPk(entry.id)).billingStatus;

beforeEach(async () => {
  await resetData();
  invalidateAllPermissions();
  w = await makeWorld();
  for (const [key, value] of [
    ['money.customerBilling', 'true'], ['money.hourlyRate', '100'], ['money.afterHoursRate', '150'], ['money.tripCharge', '45'],
    ['company.timezone', 'America/Chicago'],
  ]) await models.SystemSettings.upsert({ key, value }); // eslint-disable-line no-await-in-loop
  // Work types are kept between tests, and migration round trips reset
  // their on-site flag: set it every time.
  [onSite] = await models.WorkType.findOrCreate({ where: { name: 'Run: on site' } });
  [remote] = await models.WorkType.findOrCreate({ where: { name: 'Run: remote' } });
  await onSite.update({ onSite: true });
  await remote.update({ onSite: false });
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  beta = await makeCompany(w.admin, { name: 'Beta Law' });
  await people(alpha.id, 11, 'full'); // and Ana, below: 12 full users
  await people(alpha.id, 4, 'light');
  servers = await models.AssetCategory.findOne({ where: { name: 'Servers' } }) || await models.AssetCategory.create({ name: 'Servers' });
  for (const tag of ['SRV-1', 'SRV-2']) await models.Asset.create({ assetTag: tag, name: tag, categoryId: servers.id, companyId: alpha.id }); // eslint-disable-line no-await-in-loop
  const ana = await makeContact(w.admin, { firstName: 'Ana', lastName: 'A', companyId: alpha.id });
  const ben = await makeContact(w.admin, { firstName: 'Ben', lastName: 'B', companyId: beta.id });
  alphaTicket = await makeTicket(a(), { title: 'Printer', contactId: ana.id });
  betaTicket = await makeTicket(a(), { title: 'New laptop', contactId: ben.id });
});
afterAll(closeDb);

it('an agreement starting mid-month bills the rest of the month, prorated by days, line by line', async () => {
  await alphaAgreement();
  const inv = await draft(alpha.id, { runDate: '2026-12-15' });
  expect(inv.periodKey).toBe('2026-12');
  // 17 of December's 31 days.
  expect(amounts(inv)).toEqual([['agreement', '625.16'], ['agreement', '76.77'], ['agreement', '164.52'], ['license', '95.97']]);
  expect(inv.subtotal).toBe('962.42');
  expect(inv.lines[0]).toMatchObject({ serviceFrom: '2026-12-15', serviceTo: '2026-12-31' });
});

it('on the 1st: the month\'s fees, people added since, and last month\'s on-site call (trip charged, labor covered)', async () => {
  await alphaAgreement();
  await draft(alpha.id, { runDate: '2026-12-15' });
  await people(alpha.id, 1, 'full', 100); // a 13th full user in December
  const visit = await log(alphaTicket, '2026-12-20', 40, onSite);
  const inv = await draft(alpha.id, { runDate: '2027-01-01' });
  expect(inv.periodKey).toBe('2027-01');
  expect(amounts(inv)).toEqual([
    ['agreement', '1235.00'], ['agreement', '140.00'], ['agreement', '300.00'], ['license', '175.00'],
    ['agreement', '95.00'], // catch-up: one more full user, December
    ['trip', '45.00'], ['covered', '0.00'],
  ]);
  expect(inv.lines[4]).toMatchObject({ serviceFrom: '2026-12-01', serviceTo: '2026-12-31' });
  expect(await statusOf(visit)).toBe('covered');
});

it('an event-basis customer: minimum and steps, remote steps, after hours, materials', async () => {
  const site = await log(betaTicket, '2026-12-10', 40, onSite);
  await log(betaTicket, '2026-12-11', 20, remote);
  await log(betaTicket, '2026-12-12', 50, remote, { afterHours: true });
  const cable = await models.ProjectMaterial.create({
    ticketId: betaTicket.id, itemName: 'Cat6 cable', quantity: '300', unitPrice: '0.1800', addedBy: w.admin.user.id,
  });
  const inv = await draft(beta.id, { runDate: '2027-01-01' });
  expect(amounts(inv)).toEqual([
    ['trip', '45.00'], ['labor', '100.00'], ['labor', '50.00'], ['after_hours', '150.00'], ['material', '54.00'],
  ]);
  expect(inv.subtotal).toBe('399.00');
  expect(await statusOf(site)).toBe('billed');
  expect((await models.ProjectMaterial.findByPk(cable.id)).billingStatus).toBe('billed');
  // January's work waits for February.
  const later = await log(betaTicket, '2027-01-02', 30, remote);
  expect(await statusOf(later)).toBe('unbilled');
});

it('prepaid hours: worked time draws the block down; past it, overage', async () => {
  await a().post(`${API}/money/agreements`).send({
    companyId: beta.id,
    name: 'Ten hours a month',
    startsOn: '2026-12-01',
    lines: [{ kind: 'prepaid_hours', description: 'Prepaid support block', unitPrice: '900', hours: '10', overageRate: '110' }],
  }).expect(201);
  await log(betaTicket, '2026-12-02', 240, remote);
  await log(betaTicket, '2026-12-03', 240, remote);
  await log(betaTicket, '2026-12-04', 210, remote);
  const inv = await draft(beta.id, { runDate: '2027-01-01' });
  // December's block was never billed: it comes with January's.
  expect(amounts(inv)).toEqual([
    ['prepaid_hours', '900.00'], ['prepaid_hours', '900.00'], ['covered', '0.00'], ['covered', '0.00'], ['overage', '165.00'],
  ]);
});

it('runs once per month: again, or twice at once, it changes nothing', async () => {
  await alphaAgreement();
  await log(betaTicket, '2026-12-10', 40, onSite);
  const first = expectOk(await a().post(`${API}/money/billing-run`).send({ runDate: '2027-01-01' }));
  expect(first.drafted.map((d) => d.companyId).sort()).toEqual([alpha.id, beta.id].sort());
  const again = expectOk(await a().post(`${API}/money/billing-run`).send({ runDate: '2027-01-01' }));
  expect(again.drafted).toEqual([]);
  expect(again.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(['already drafted']));
  expect(await models.Invoice.count()).toBe(2);

  await log(alphaTicket, '2027-01-05', 40, onSite);
  await Promise.all([run.billingRun({ runDate: '2027-02-01' }), run.billingRun({ runDate: '2027-02-01' })]);
  expect(await models.Invoice.count({ where: { periodKey: '2027-02' } })).toBe(1);
  expect(await models.InvoiceLine.count({ where: { kind: 'trip' } })).toBe(2);
});

it('a customer billed per job: the ticket is invoiced when it closes, and its work stays off the run', async () => {
  await a().put(`${API}/companies/${beta.id}/billing`).send({ invoiceTiming: 'on_close' }).expect(200);
  await log(betaTicket, '2026-12-11', 20, remote);
  const closed = await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } });
  expectOk(await a().patch(`${API}/tickets/${betaTicket.id}`).send({ status: closed.name }));
  const onClose = await models.Invoice.findOne({ where: { ticketId: betaTicket.id }, include: ['lines'] });
  expect(amounts(invoiceJson(onClose))).toEqual([['labor', '50.00']]);
  const res = await run.billingRun({ runDate: '2027-01-01' });
  expect(res.drafted.find((d) => d.companyId === beta.id)).toBeUndefined();
});

it('a cancelled agreement\'s last invoice carries only its unbilled last days and extras, no new month', async () => {
  await alphaAgreement();
  const agreement = await models.Agreement.findOne({ where: { companyId: alpha.id } });
  await a().post(`${API}/money/agreements/${agreement.id}/cancel`).send({ cancelledOn: '2026-12-31' }).expect(200);
  await log(alphaTicket, '2026-12-20', 40, onSite);
  const inv = await draft(alpha.id, { runDate: '2027-01-01' });
  // Never billed: Dec 15–31 (17 of 31 days), then December's call. No January.
  expect(amounts(inv)).toEqual([
    ['agreement', '625.16'], ['agreement', '76.77'], ['agreement', '164.52'], ['license', '95.97'], ['trip', '45.00'], ['covered', '0.00'],
  ]);
});

it('the preview shows what each customer would get and writes nothing', async () => {
  await alphaAgreement();
  const visit = await log(betaTicket, '2026-12-10', 40, onSite);
  const preview = expectOk(await a().get(`${API}/money/billing-run/preview?runDate=2027-01-01`));
  expect(preview.drafts.map((d) => [d.companyId, d.total]).sort()).toEqual([[alpha.id, '2717.42'], [beta.id, '145.00']].sort());
  expect(await models.Invoice.count()).toBe(0);
  expect(await statusOf(visit)).toBe('unbilled');
  expect((await models.AgreementLine.findOne()).lastBilledQuantity).toBeNull();
});

it('the scheduler runs on the 1st in the organization\'s time zone, once', async () => {
  await alphaAgreement();
  // Jan 1 08:00 in Chicago.
  expect((await run.maybeRunBilling({ now: new Date('2027-01-01T14:00:00Z') })).ran).toBe(true);
  expect((await run.maybeRunBilling({ now: new Date('2027-01-01T15:00:00Z') })).ran).toBe(false);
  // Dec 1 03:00 UTC is still Nov 30 in Chicago.
  expect((await run.maybeRunBilling({ now: new Date('2026-12-01T03:00:00Z') })).ran).toBe(false);
  expect(await models.Invoice.count()).toBe(1);
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await run.maybeRunBilling({ now: new Date('2027-02-01T14:00:00Z') })).ran).toBe(false);
});

it('sends the drafts itself when auto-send is on', async () => {
  await alphaAgreement();
  await models.SystemSettings.upsert({ key: 'money.autoSend', value: 'true' });
  await run.maybeRunBilling({ now: new Date('2027-01-01T14:00:00Z') });
  expect((await models.Invoice.findOne()).status).toBe('sent');
});

it('fences the run: technicians, the switch', async () => {
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.post(`${API}/money/billing-run`).send({})).status).toBe(403);
  expect((await tech.agent.get(`${API}/money/billing-run/preview`)).status).toBe(403);
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await a().post(`${API}/money/billing-run`).send({})).status).toBe(404);
});
