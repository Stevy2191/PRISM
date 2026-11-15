const bcrypt = require('bcryptjs');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeProject, makeTask, portalAgent,
} = require('./fixtures');

// CN part 4: a company's projects in its portal. Status, progress, phases and
// milestones only; company admins see all, department admins theirs and the
// company-wide ones, named contacts the ones they're on.

const P = `${API}/portal`;
const PASSWORD = 'Harbour-Lights-2026';
let hash;
let w; let alpha; let beta; let billing; let reception;
let boss; let dana; let pat; let otto;
let whole; let forBilling; let forReception; let hidden; let betas;

async function portalAs(contact) {
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: contact.id } });
  const agent = await portalAgent(contact.companyId);
  expectOk(await agent.post(`${P}/auth/login`).send({ email: contact.email, password: PASSWORD }));
  return agent;
}

beforeAll(async () => { hash = await bcrypt.hash(PASSWORD, 4); });
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  beta = await makeCompany(w.admin, { name: 'Beta' });
  billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  reception = expectOk(await a.post(`${API}/departments`).send({ name: 'Reception', companyId: alpha.id }), 201).department;
  boss = await makeContact(w.admin, { firstName: 'Bo', companyId: alpha.id });
  dana = await makeContact(w.admin, { firstName: 'Dana', companyId: alpha.id, departmentId: billing.id });
  pat = await makeContact(w.admin, { firstName: 'Pat', companyId: alpha.id, departmentId: reception.id });
  otto = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id });
  await models.CompanyPortalAdmin.create({ companyId: alpha.id, contactId: boss.id });
  await models.DepartmentPortalAdmin.create({ departmentId: billing.id, contactId: dana.id });
  const make = (fields) => makeProject(a, { ownerDepartmentId: w.deptA.id, companyId: alpha.id, ...fields });
  whole = await make({ name: 'Windows 11 for everyone', forDepartmentId: null });
  forBilling = await make({ name: 'New invoicing', forDepartmentId: billing.id, contactIds: [pat.id] });
  forReception = await make({ name: 'Front desk kiosk', forDepartmentId: reception.id });
  hidden = await make({ name: 'Secret', forDepartmentId: null, showInPortal: false });
  betas = await makeProject(a, { name: 'Beta move', ownerDepartmentId: w.deptA.id, companyId: beta.id });
});
afterAll(closeDb);

const names = async (agent) => expectOk(await agent.get(`${P}/projects`)).projects.map((x) => x.name).sort();

it('who sees which project', async () => {
  expect(await names(await portalAs(boss))).toEqual(['Front desk kiosk', 'New invoicing', 'Windows 11 for everyone']);
  expect(await names(await portalAs(dana))).toEqual(['New invoicing', 'Windows 11 for everyone']);
  expect(await names(await portalAs(pat))).toEqual(['New invoicing']);
  expect(await names(await portalAs(otto))).toEqual([]);
  const danaAgent = await portalAs(dana);
  expect((await danaAgent.get(`${P}/projects/${forReception.id}`)).status).toBe(404);
  expect((await danaAgent.get(`${P}/projects/${hidden.id}`)).status).toBe(404);
  expect((await danaAgent.get(`${P}/projects/${betas.id}`)).status).toBe(404);
});

it('a project shows status, progress, phases and milestones, and nothing else', async () => {
  const a = w.admin.agent;
  const phase = expectOk(await a.post(`${API}/projects/${forBilling.id}/phases`).send({ name: 'Build' }), 201).phase;
  const t1 = await makeTask(a, forBilling.id, { title: 'Screens', phaseId: phase.id, startDate: '2026-11-18', dueDate: '2026-12-20' });
  await makeTask(a, forBilling.id, { title: 'Reports', phaseId: phase.id });
  await makeTask(a, forBilling.id, { title: 'Live', isMilestone: true, startDate: '2027-01-30' });
  await models.Task.update({ completedAt: new Date() }, { where: { id: t1.id } });
  const { project } = expectOk(await (await portalAs(pat)).get(`${P}/projects/${forBilling.id}`));
  expect(project).toEqual(expect.objectContaining({
    projectCode: forBilling.projectCode, name: 'New invoicing', forDepartment: { id: billing.id, name: 'Billing' },
    progress: { done: 1, total: 2, percent: 50 },
  }));
  expect(project.steps.map((s) => [s.kind, s.name, s.state])).toEqual([['phase', 'Build', 'active'], ['milestone', 'Live', 'todo']]);
  // Nothing about tasks, people, time, money or notes.
  const keys = Object.keys(project).sort();
  expect(keys).toEqual(['completedAt', 'dueDate', 'forDepartment', 'id', 'name', 'progress', 'projectCode', 'startDate', 'status', 'statusBehavior', 'steps']);
  expect(JSON.stringify(project)).not.toMatch(/Screens|Reports|assignee|lead|budget/i);
});
