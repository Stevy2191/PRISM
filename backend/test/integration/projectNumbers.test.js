const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeProject, makeTask,
} = require('./fixtures');
const migration = require('../../migrations/20260101000098-project-numbers');

// Projects numbered per company (CN part 3): WC-HR-P0007 for a department,
// WC-P0006 for the whole company, one counter per company; customer contacts
// and the portal switch.

let w;
let wc;
let acme;
let hr;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  wc = await makeCompany(w.admin, { name: 'Washington County' });
  acme = await makeCompany(w.admin, { name: 'Acme', code: 'ACME' });
  hr = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'Human Resources', companyId: wc.id }), 201).department;
});
afterAll(closeDb);

const project = (fields) => makeProject(w.admin.agent, { name: 'Rollout', ownerDepartmentId: w.deptA.id, ...fields });

it('one counter per company, with the department it is for; tasks follow', async () => {
  const a = await project({ companyId: wc.id, forDepartmentId: null });
  const b = await project({ companyId: wc.id, forDepartmentId: hr.id });
  const c = await project({ companyId: acme.id, forDepartmentId: null });
  expect([a.projectCode, b.projectCode, c.projectCode]).toEqual(['WC-P0001', 'WC-HR-P0002', 'ACME-P0001']);
  expect(hr.shortCode).toBe('HR');
  const task = await makeTask(w.admin.agent, b.id, { title: 'Forms' });
  expect(task.code).toBe('WC-HR-P0002-T01');
  // Your own projects: for the department doing them unless told otherwise.
  const own = await project({});
  expect(own.projectCode).toBe('LITS-SD-P0001');
  expect(expectOk(await w.admin.agent.get(`${API}/projects/next-number`).query({ companyId: wc.id, forDepartmentId: hr.id })).code).toBe('WC-HR-P0003');
});

it('customer projects show in the portal by default; contacts are the company\'s own', async () => {
  const pat = await makeContact(w.admin, { companyId: wc.id, email: 'pat@wc.test' });
  const lee = await makeContact(w.admin, { companyId: acme.id, email: 'lee@acme.test' });
  const p = await project({ companyId: wc.id, contactIds: [pat.id] });
  expect(p.showInPortal).toBe(true);
  expect((await project({})).showInPortal).toBe(false);
  expect(expectOk(await w.admin.agent.get(`${API}/projects/${p.id}/contacts`)).contacts.map((c) => c.id)).toEqual([pat.id]);
  const wrong = await w.admin.agent.put(`${API}/projects/${p.id}/contacts`).send({ contactIds: [lee.id] });
  expect(wrong.status).toBe(400);
  expect(expectOk(await w.admin.agent.put(`${API}/projects/${p.id}/contacts`).send({ contactIds: [] })).contacts).toEqual([]);
  const hidden = expectOk(await w.admin.agent.patch(`${API}/projects/${p.id}`).send({ showInPortal: false }));
  expect((hidden.project || hidden).showInPortal).toBe(false);
  expect((await w.admin.agent.post(`${API}/projects`).send({ name: 'Own', ownerDepartmentId: w.deptA.id, contactIds: [pat.id] })).status).toBe(400);
});

it('a new company code, a move or a merge renumbers; old codes still find the project', async () => {
  const p = await project({ companyId: wc.id, forDepartmentId: hr.id });
  await makeTask(w.admin.agent, p.id, { title: 'Forms' });
  expectOk(await w.admin.agent.patch(`${API}/companies/${wc.id}`).send({ code: 'WCO' }));
  let fresh = await models.Project.findByPk(p.id);
  expect(fresh.projectCode).toBe('WCO-HR-P0001');
  expect((await models.Task.findOne({ where: { projectId: p.id } })).code).toBe('WCO-HR-P0001-T01');
  const found = expectOk(await w.admin.agent.get(`${API}/search`).query({ q: 'WC-HR-P0001' }));
  expect(found.projects.map((x) => x.id)).toContain(p.id);

  // Moved to Acme (for the whole company): Acme's next number.
  expectOk(await w.admin.agent.patch(`${API}/projects/${p.id}`).send({ companyId: acme.id, forDepartmentId: null }));
  fresh = await models.Project.findByPk(p.id);
  expect(fresh.projectCode).toBe('ACME-P0001');
  expect(fresh.previousCodes).toEqual(expect.arrayContaining(['WC-HR-P0001', 'WCO-HR-P0001']));
  expect((await models.Task.findOne({ where: { projectId: p.id } })).code).toBe('ACME-P0001-T01');

  // Acme merged into Washington County: the next WCO number; Acme's HR
  // department code clashes, so it becomes HR2.
  expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'HR', companyId: acme.id }), 201);
  expectOk(await w.admin.agent.post(`${API}/companies/${acme.id}/merge`).send({ intoCompanyId: wc.id }));
  fresh = await models.Project.findByPk(p.id);
  expect(fresh.projectCode).toBe('WCO-P0002');
  const codes = (await models.Department.findAll({ where: { companyId: wc.id } })).map((d) => d.shortCode).sort();
  expect(codes).toEqual(['HR', 'HR2']);
});

it('migration 098 numbers projects per company, fixes "for", moves task codes, and rolls back', async () => {
  const qi = sequelize.getQueryInterface();
  const a = await project({ companyId: wc.id, forDepartmentId: hr.id });
  const b = await project({});
  await makeTask(w.admin.agent, a.id, { title: 'Forms' });
  await migration.down(qi, Sequelize);
  try {
    expect((await qi.describeTable('Projects')).companySeq).toBeUndefined();
    // As before CN: codes per department of yours, a customer project "for"
    // the department doing it.
    await sequelize.query("UPDATE Projects SET projectCode = 'SD-P00007', forDepartmentId = ? WHERE id = ?", { replacements: [w.deptA.id, a.id] });
    await sequelize.query("UPDATE Projects SET projectCode = 'SD-P00008' WHERE id = ?", { replacements: [b.id] });
    await sequelize.query("UPDATE Tasks SET code = 'SD-P00007-T01' WHERE projectId = ?", { replacements: [a.id] });
  } finally {
    await migration.up(qi, Sequelize);
  }
  const rows = await sequelize.query('SELECT id, projectCode, forDepartmentId, previousCodes, showInPortal FROM Projects ORDER BY id', { type: Sequelize.QueryTypes.SELECT });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  expect(byId[a.id]).toEqual(expect.objectContaining({ projectCode: 'WC-P0001', forDepartmentId: null }));
  expect(byId[b.id].projectCode).toBe('LITS-SD-P0001');
  expect(Boolean(byId[a.id].showInPortal)).toBe(true);
  expect(Boolean(byId[b.id].showInPortal)).toBe(false);
  const prev = byId[a.id].previousCodes;
  expect(typeof prev === 'string' ? JSON.parse(prev) : prev).toEqual(['SD-P00007']);
  expect((await models.Task.findOne({ where: { projectId: a.id } })).code).toBe('WC-P0001-T01');
  await migration.up(qi, Sequelize); // twice is harmless
  expect((await models.Project.findByPk(a.id)).projectCode).toBe('WC-P0001');
});
