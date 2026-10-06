const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeTicket, makeProject, makeContact,
} = require('./fixtures');

// Security fix (found in plan 3b-2): a department-tier user with no
// department is in no department. Comparing NULL to NULL made them match
// every record without a department, in single-record checks (null === null)
// and in lists (Sequelize renders { departmentId: null } as IS NULL).

let w;
let loose;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  loose = await makeStaff('loose', w.deptA.id); // tickets/projects view_department, people view_own_department
  await models.User.update({ departmentId: null }, { where: { id: loose.user.id } });
});
afterAll(closeDb);

const ids = (rows) => rows.map((r) => r.id);

it('a department-less ticket is not visible to a department-less department-tier user', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'No dept', contactId: w.contact.id });
  await models.Ticket.update({ departmentId: null }, { where: { id: t.id } });
  expect((await loose.agent.get(`${API}/tickets/${t.id}`)).status).toBe(403);
  expect(ids(expectOk(await loose.agent.get(`${API}/tickets`)).tickets)).not.toContain(t.id);
  // Assigned to them, it is theirs.
  await models.Ticket.update({ assigneeId: loose.user.id }, { where: { id: t.id } });
  expect((await loose.agent.get(`${API}/tickets/${t.id}`)).status).toBe(200);
});

it('a department-less project is not visible to a department-less department-tier user', async () => {
  const p = await makeProject(w.admin.agent, { name: 'No dept', ownerDepartmentId: w.deptA.id });
  await models.Project.update({ ownerDepartmentId: null, forDepartmentId: null }, { where: { id: p.id } });
  expect((await loose.agent.get(`${API}/projects/${p.id}`)).status).toBe(403);
  expect(ids(expectOk(await loose.agent.get(`${API}/projects`)).projects)).not.toContain(p.id);
});

it('department-less contacts and users are not listed for a department-less user', async () => {
  const c = await makeContact(w.admin, { firstName: 'Nobody' });
  await models.Contact.update({ departmentId: null }, { where: { id: c.id } });
  expect(ids(expectOk(await loose.agent.get(`${API}/contacts`)).contacts)).not.toContain(c.id);
  const other = await makeStaff('other', w.deptA.id);
  await models.User.update({ departmentId: null }, { where: { id: other.user.id } });
  expect(ids(expectOk(await loose.agent.get(`${API}/users?scope=department`)).users)).not.toContain(other.user.id);
});
