const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeManager, makeTicket, makeProject, setCompanyAccess,
} = require('./fixtures');

// Departments belong to a company, and tickets, contacts and projects keep
// their departments inside their own company (plan 2a task 7).

const { Company, Contact } = models;

let w;
let acme;
let acmeHR;
let ann;
let internalId;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await Company.create({ name: 'Acme', isClient: true });
  acmeHR = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'HR', companyId: acme.id }), 201).department;
  ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id, departmentId: acmeHR.id });
});
afterAll(closeDb);

const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const grant = async (user, permissionKey) => expectOk(
  await a().post(`${API}/users/${user.user.id}/overrides`).send({ permissionKey, granted: true }), 201
);

it('a client can have a department named like one of yours', async () => {
  const res = expectOk(await a().post(`${API}/departments`).send({ name: 'Service Desk', companyId: acme.id }), 201).department;
  expect(res).toEqual(expect.objectContaining({ companyId: acme.id, shortCode: null }));
});

it('names are unique within a company', async () => {
  expectErr(await a().post(`${API}/departments`).send({ name: 'hr', companyId: acme.id }), 409, 'DEPARTMENT_NAME_TAKEN', 'This company already has a department with that name');
});

it('internal departments still need a short code; client ones don\'t', async () => {
  expectErr(await a().post(`${API}/departments`).send({ name: 'Ops' }), 400, 'VALIDATION_ERROR', 'Short code is required (used to prefix this department\'s project IDs)');
});

it('client departments need companies.manage; internal ones keep people.manage_departments', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  await grant(staff, 'people.manage_departments');
  expectErr(await staff.agent.post(`${API}/departments`).send({ name: 'Legal', companyId: acme.id }), 403, 'FORBIDDEN', 'Managing a client company\'s departments needs companies.manage');
  expect((await staff.agent.post(`${API}/departments`).send({ name: 'Ops', shortCode: 'OPS' })).status).toBe(201);
});

it('the department list is fenced and filterable', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internalId] });
  const fencedIds = expectOk(await tech.agent.get(`${API}/departments`)).departments.map((d) => d.id);
  expect(fencedIds).not.toContain(acmeHR.id);
  const { departments } = expectOk(await a().get(`${API}/departments?companyId=${acme.id}`));
  expect(departments.map((d) => [d.name, d.company])).toEqual([['HR', { id: acme.id, name: 'Acme' }]]);
});

it('a ticket\'s department must belong to its contact\'s company', async () => {
  expectErr(await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, departmentId: w.deptA.id }), 400, 'VALIDATION_ERROR', 'Department not found');
  const t = await makeTicket(a(), { title: 'Acme one', contactId: ann.id });
  expectErr(await a().patch(`${API}/tickets/${t.id}`).send({ departmentId: w.deptA.id }), 400, 'VALIDATION_ERROR', 'Department not found');
});

it('changing a ticket\'s contact drops a foreign department', async () => {
  const t = await makeTicket(a(), { title: 'Home', contactId: w.contact.id, departmentId: w.deptA.id });
  const { ticket } = expectOk(await a().patch(`${API}/tickets/${t.id}`).send({ contactId: ann.id }));
  expect([ticket.companyId, ticket.departmentId]).toEqual([acme.id, acmeHR.id]);
});

it('a contact\'s department must belong to the contact\'s company', async () => {
  expectErr(await a().patch(`${API}/contacts/${ann.id}`).send({ departmentId: w.deptA.id }), 400, 'VALIDATION_ERROR', 'Department not found');
});

it('S8\'s assign-department keeps to the contact\'s company', async () => {
  expectErr(await a().patch(`${API}/contacts/${ann.id}/department`).send({ departmentId: w.deptA.id }), 400, 'VALIDATION_ERROR', 'Department does not exist');
});

it('a project\'s "owned by" must be one of your departments', async () => {
  expectErr(await a().post(`${API}/projects`).send({ name: 'P', ownerDepartmentId: acmeHR.id }), 400, 'VALIDATION_ERROR', 'Owned-by department does not exist');
});

it('a project\'s "for" department must be in the project\'s company', async () => {
  expectErr(await a().post(`${API}/projects`).send({ name: 'P', ownerDepartmentId: w.deptA.id, forDepartmentId: acmeHR.id }), 400, 'VALIDATION_ERROR', 'For-department does not exist');
});

it('a fenced user can\'t read or edit another company\'s department', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internalId] });
  const forbidden = { error: true, message: 'You do not have access to this department', code: 'FORBIDDEN' };
  const read = await tech.agent.get(`${API}/departments/${acmeHR.id}`);
  expect([read.status, read.body]).toEqual([403, forbidden]);
  const mgr = await makeManager('mgr', w.deptA.id);
  await grant(mgr, 'people.manage_departments');
  await setCompanyAccess(w.admin, mgr.user.id, { allCompanies: false, companyIds: [internalId] });
  const write = await mgr.agent.patch(`${API}/departments/${acmeHR.id}`).send({ name: 'People' });
  expect([write.status, write.body]).toEqual([403, forbidden]);
});
