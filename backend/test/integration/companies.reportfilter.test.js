const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 7: ?companyId= narrows reports to one company.

const { Company, Contact } = models;

let w;
let acme;
let globex;
let internalId;
const a = () => w.admin.agent;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex' });
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const gus = await Contact.create({ firstName: 'Gus', displayName: 'Gus', companyId: globex.id });
  await makeTicket(a(), { title: 'ACME-ONE', contactId: ann.id });
  await makeTicket(a(), { title: 'GLOBEX-ONE', contactId: gus.id });
});
afterAll(closeDb);

const titles = (body) => body.tableData.rows.map((r) => r.title).sort();

it('a report narrows to one company', async () => {
  expect(titles(expectOk(await a().get(`${API}/reports/ticket-volume`)))).toEqual(['ACME-ONE', 'GLOBEX-ONE']);
  expect(titles(expectOk(await a().get(`${API}/reports/ticket-volume?companyId=${acme.id}`)))).toEqual(['ACME-ONE']);
  expect(titles(expectOk(await a().get(`${API}/reports/ticket-volume?companyId=abc`)))).toEqual([]);
});

it('a CSV export narrows the same way', async () => {
  const res = await a().get(`${API}/reports/tickets/export?companyId=${globex.id}`);
  expect(res.text).toContain('GLOBEX-ONE');
  expect(res.text).not.toContain('ACME-ONE');
});

it('a custom report narrows by filters.companyId', async () => {
  const body = expectOk(await a().post(`${API}/reports/custom`).send({ dataSource: 'tickets', filters: { companyId: acme.id } }));
  const text = JSON.stringify(body);
  expect(text).toContain('ACME-ONE');
  expect(text).not.toContain('GLOBEX-ONE');
});

it('a company outside the viewer\'s reach narrows to nothing, never widens', async () => {
  const t = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [internalId, acme.id] });
  expectOk(await a().post(`${API}/users/${t.user.id}/overrides`).send({ permissionKey: 'reports.view_all', granted: true }), 201);
  expect(titles(expectOk(await t.agent.get(`${API}/reports/ticket-volume?companyId=${globex.id}`)))).toEqual([]);
  expect(titles(expectOk(await t.agent.get(`${API}/reports/ticket-volume`)))).toEqual(['ACME-ONE']);
});
