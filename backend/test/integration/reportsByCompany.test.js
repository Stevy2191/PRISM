const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeProject,
} = require('./fixtures');

// CN part 5: reports show every company side by side and the total across
// them; Company is a custom-report group-by.

let w;
let wc;
let acme;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  wc = await makeCompany(w.admin, { name: 'Washington County' });
  acme = await makeCompany(w.admin, { name: 'Acme', code: 'ACME' });
  const pat = await makeContact(w.admin, { companyId: wc.id, email: 'pat@wc.test' });
  const lee = await makeContact(w.admin, { companyId: acme.id, email: 'lee@acme.test' });
  const a = w.admin.agent;
  await makeTicket(a, { title: 'One', contactId: pat.id });
  await makeTicket(a, { title: 'Two', contactId: pat.id });
  const closed = await makeTicket(a, { title: 'Three', contactId: lee.id });
  const closedName = (await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } })).name;
  expectOk(await a.patch(`${API}/tickets/${closed.id}`).send({ status: closedName }));
  await makeProject(a, { name: 'County rollout', ownerDepartmentId: w.deptA.id, companyId: wc.id, dueDate: '2020-01-01' });
  await makeProject(a, { name: 'Acme move', ownerDepartmentId: w.deptA.id, companyId: acme.id });
});
afterAll(closeDb);

it('the ticket report has a By company table and the All companies total', async () => {
  const { byCompany } = expectOk(await w.admin.agent.get(`${API}/reports/ticket-volume`).query({ preset: 'all' }));
  const byName = Object.fromEntries(byCompany.rows.map((r) => [r.name, r]));
  expect(byName['Washington County']).toEqual(expect.objectContaining({ opened: 2, closed: 0, openNow: 2, code: wc.code }));
  expect(byName.Acme).toEqual(expect.objectContaining({ opened: 1, closed: 1, openNow: 0 }));
  expect(byCompany.total).toEqual(expect.objectContaining({ name: 'All companies', opened: 3, closed: 1, openNow: 2 }));
});

it('the project report has a By company table and the total', async () => {
  const { byCompany } = expectOk(await w.admin.agent.get(`${API}/reports/projects`).query({ preset: 'all' }));
  const byName = Object.fromEntries(byCompany.rows.map((r) => [r.name, r]));
  expect(byName['Washington County']).toEqual(expect.objectContaining({ active: 1, overdue: 1 }));
  expect(byName.Acme).toEqual(expect.objectContaining({ active: 1, overdue: 0 }));
  expect(byCompany.total).toEqual(expect.objectContaining({ name: 'All companies', active: 2, overdue: 1 }));
});

it('custom reports group by company', async () => {
  const meta = expectOk(await w.admin.agent.get(`${API}/reports/custom/metadata`));
  for (const key of ['tickets', 'projects', 'time_entries']) {
    expect(meta.dataSources.find((d) => d.key === key).groupBy).toContain('company');
  }
  const { chartData } = expectOk(await w.admin.agent.post(`${API}/reports/custom`).send({ dataSource: 'tickets', fields: ['title'], groupBy: 'company' }));
  expect(Object.fromEntries(chartData.map((g) => [g.name, g.count]))).toEqual({ 'Washington County': 2, Acme: 1 });
});
