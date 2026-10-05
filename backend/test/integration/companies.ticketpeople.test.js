const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 8: who may work a ticket, and server-side form defaults.

const { Company, Contact, Department, AssignmentRule } = models;

let w;
let acme;
let internalId;
let ann;
let hr;
let outsider;
let insider;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  hr = await Department.create({ name: 'HR', companyId: acme.id });
  ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id, departmentId: hr.id });
  outsider = await makeTech('outsider', w.deptA.id);
  await setCompanyAccess(w.admin, outsider.user.id, { allCompanies: false, companyIds: [internalId] });
  insider = await makeTech('insider', w.deptA.id);
});
afterAll(closeDb);

it('a ticket can\'t be assigned to someone who can\'t reach its company', async () => {
  expectErr(
    await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, assigneeId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Assignee can\'t see tickets for this company'
  );
  const t = await makeTicket(a(), { title: 'y', contactId: ann.id, assigneeId: insider.user.id });
  expectErr(
    await a().patch(`${API}/tickets/${t.id}`).send({ assigneeId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Assignee can\'t see tickets for this company'
  );
});

it('nor watched by them', async () => {
  expectErr(
    await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, watcherIds: [outsider.user.id] }),
    400, 'VALIDATION_ERROR', 'Watcher can\'t see tickets for this company'
  );
  const t = await makeTicket(a(), { title: 'y', contactId: ann.id });
  expectErr(
    await a().post(`${API}/tickets/${t.id}/watchers`).send({ userId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Watcher can\'t see tickets for this company'
  );
  expectOk(await a().post(`${API}/tickets/${t.id}/watchers`).send({ userId: insider.user.id }), 201);
});

it('an assignment rule pointing at such a person leaves the ticket unassigned', async () => {
  await AssignmentRule.create({ name: 'all to outsider', position: 0, isActive: true, assigneeId: outsider.user.id });
  const t = await makeTicket(a(), { title: 'z', contactId: ann.id });
  expect(t.assigneeId).toBeNull();
  const home = await makeTicket(a(), { title: 'home', contactId: w.contact.id });
  expect(home.assigneeId).toBe(outsider.user.id);
});

it('the assignee and watcher pickers narrow to one company', async () => {
  const ids = async (path) => expectOk(await a().get(`${API}${path}`)).users.map((u) => u.id);
  expect(await ids(`/users/assignable?companyId=${acme.id}`)).not.toContain(outsider.user.id);
  expect(await ids(`/users/assignable?companyId=${acme.id}`)).toContain(insider.user.id);
  expect(await ids(`/users/directory?companyId=${acme.id}`)).not.toContain(outsider.user.id);
  expect(await ids('/users/assignable')).toContain(outsider.user.id);
});

it('a company the caller can\'t reach is refused as a picker filter', async () => {
  expectErr(await outsider.agent.get(`${API}/users/assignable?companyId=${acme.id}`), 400, 'VALIDATION_ERROR', 'Unknown company');
});

it('a new ticket without a department takes its contact\'s', async () => {
  expect((await makeTicket(a(), { title: 'd', contactId: ann.id })).departmentId).toBe(hr.id);
  const other = await Department.create({ name: 'Ops', companyId: acme.id });
  expect((await makeTicket(a(), { title: 'e', contactId: ann.id, departmentId: other.id })).departmentId).toBe(other.id);
});

it('project creators fenced to a client can list the internal "owned by" departments', async () => {
  const t = await makeTech('acmeonly', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [acme.id] });
  const names = expectOk(await t.agent.get(`${API}/departments/owners`)).departments.map((d) => d.name);
  expect(names).toEqual(['Facilities', 'Service Desk']);
  const staff = await makeStaff('staff', w.deptA.id);
  expect((await staff.agent.get(`${API}/departments/owners`)).status).toBe(403);
});

// Beyond the plan (ledgered): a ticket's checklist task is work on the
// ticket too, so its assignee follows the same rule.
it('a ticket task can\'t be assigned to someone who can\'t reach the ticket\'s company', async () => {
  const t = await makeTicket(a(), { title: 'with task', contactId: ann.id });
  expectErr(
    await a().post(`${API}/tickets/${t.id}/tasks`).send({ description: 'step', assigneeId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Assignee can\'t see tickets for this company'
  );
  const task = expectOk(await a().post(`${API}/tickets/${t.id}/tasks`).send({ description: 'step' }), 201).task;
  expectErr(
    await a().patch(`${API}/tickets/${t.id}/tasks/${task.id}`).send({ assigneeId: outsider.user.id }),
    400, 'VALIDATION_ERROR', 'Assignee can\'t see tickets for this company'
  );
});
