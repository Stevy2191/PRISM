const bcrypt = require('bcryptjs');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  makeWorld, makeContact, makeCompany, makeTicket, makeTech, setCompanyAccess, expectOk,
} = require('./fixtures');

// Sub-project 7a, task 5: staff set portal admins and contact watchers, and
// see a contact's portal fields.

const API = '/api/v1';
const PASSWORD = 'Harbour-Lights-2026';

let w; let alpha; let beta; let billing; let reception; let betaDept;
let pat; let dana; let rita; let otto;

const grantPortal = (u) => w.admin.agent.post(`${API}/users/${u.user.id}/overrides`).send({ permissionKey: 'portal.manage', granted: true });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  beta = await makeCompany(w.admin, { name: 'Beta' });
  billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  reception = expectOk(await a.post(`${API}/departments`).send({ name: 'Reception', companyId: alpha.id }), 201).department;
  betaDept = expectOk(await a.post(`${API}/departments`).send({ name: 'Ops', companyId: beta.id }), 201).department;
  pat = await makeContact(w.admin, { firstName: 'Pat', companyId: alpha.id, departmentId: billing.id });
  dana = await makeContact(w.admin, { firstName: 'Dana', companyId: alpha.id, departmentId: billing.id });
  rita = await makeContact(w.admin, { firstName: 'Rita', companyId: alpha.id, departmentId: reception.id });
  otto = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id, departmentId: betaDept.id });
});
// Settings outlive resetData: leave the portal switched off for later suites.
afterAll(async () => {
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await closeDb();
});

describe('portal admins', () => {
  it('need portal.manage and the company fence; members only', async () => {
    const tech = await makeTech('tess', w.deptA.id);
    expect((await tech.agent.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [dana.id] })).status).toBe(403);
    expect((await tech.agent.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [dana.id] })).status).toBe(403);
    expectOk(await grantPortal(tech), 201);
    await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [beta.id] });
    expect((await tech.agent.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [dana.id] })).status).toBe(403);
    expect((await tech.agent.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [dana.id] })).status).toBe(403);
    expectOk(await tech.agent.put(`${API}/departments/${betaDept.id}/portal-admins`).send({ contactIds: [otto.id] }));

    const a = w.admin.agent;
    // A department admin must belong to the department; a company admin to the company.
    expect((await a.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [rita.id] })).status).toBe(400);
    expect((await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [otto.id] })).status).toBe(400);
    expect((await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: ['12abc'] })).status).toBe(400);
    expect((await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: 'x' })).status).toBe(400);

    const dept = expectOk(await a.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [dana.id] }));
    expect(dept.contacts.map((c) => c.id)).toEqual([dana.id]);
    const co = expectOk(await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [rita.id, rita.id] }));
    expect(co.contacts.map((c) => c.id)).toEqual([rita.id]);
    expect(expectOk(await a.get(`${API}/companies/${alpha.id}/portal-admins`)).contacts.map((c) => c.id)).toEqual([rita.id]);
    expect(expectOk(await a.get(`${API}/departments/${billing.id}/portal-admins`)).contacts.map((c) => c.id)).toEqual([dana.id]);
    // Replace, not add.
    expectOk(await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [] }));
    expect(await models.CompanyPortalAdmin.count()).toBe(0);
    expect(await models.AuditLog.count({ where: { action: 'portal.admins_changed' } })).toBeGreaterThan(0);
  });

  it('follow the person: a department change drops the old department role, a company move drops them all', async () => {
    const a = w.admin.agent;
    expectOk(await a.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [dana.id] }));
    expectOk(await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [dana.id] }));
    expectOk(await a.patch(`${API}/contacts/${dana.id}`).send({ departmentId: reception.id }));
    expect(await models.DepartmentPortalAdmin.count({ where: { contactId: dana.id } })).toBe(0);
    expect(await models.CompanyPortalAdmin.count({ where: { contactId: dana.id } })).toBe(1);

    expectOk(await a.put(`${API}/departments/${reception.id}/portal-admins`).send({ contactIds: [dana.id] }));
    expectOk(await a.patch(`${API}/contacts/${dana.id}/department`).send({ departmentId: billing.id }));
    expect(await models.DepartmentPortalAdmin.count({ where: { contactId: dana.id } })).toBe(0);

    expectOk(await a.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [dana.id] }));
    expectOk(await a.patch(`${API}/contacts/${dana.id}`).send({ companyId: beta.id }));
    expect(await models.DepartmentPortalAdmin.count({ where: { contactId: dana.id } })).toBe(0);
    expect(await models.CompanyPortalAdmin.count({ where: { contactId: dana.id } })).toBe(0);
  });
});

describe('contact watchers', () => {
  it('can be added and removed by a portal.manage holder; same company only; they then see the ticket', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Pat laptop', contactId: pat.id });
    const tech = await makeTech('tess', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'tickets.manage_watchers', granted: true }), 201);
    expect((await tech.agent.post(`${API}/tickets/${t.id}/watchers`).send({ contactId: rita.id })).status).toBe(403);

    const a = w.admin.agent;
    expect((await a.post(`${API}/tickets/${t.id}/watchers`).send({ contactId: otto.id })).status).toBe(400);
    expect((await a.post(`${API}/tickets/${t.id}/watchers`).send({ contactId: '12abc' })).status).toBe(400);
    expect((await a.post(`${API}/tickets/${t.id}/watchers`).send({ contactId: rita.id, userId: w.admin.user.id })).status).toBe(400);
    const added = expectOk(await a.post(`${API}/tickets/${t.id}/watchers`).send({ contactId: rita.id }), 201);
    expect(added.watcher).toMatchObject({ kind: 'contact', contact: { id: rita.id, portalAccess: false } });
    expectOk(await a.post(`${API}/tickets/${t.id}/watchers`).send({ userId: w.admin.user.id }), 201);
    const { watchers } = expectOk(await a.get(`${API}/tickets/${t.id}/watchers`));
    expect(watchers.map((x) => x.kind).sort()).toEqual(['contact', 'user']);
    expect(watchers.find((x) => x.kind === 'user').user.id).toBe(w.admin.user.id);

    // Rita sees it in her portal.
    const hash = await bcrypt.hash(PASSWORD, 4);
    await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: rita.id } });
    const portal = request.agent(getApp());
    expectOk(await portal.post(`${API}/portal/auth/login`).send({ email: rita.email, password: PASSWORD }));
    expectOk(await portal.get(`${API}/portal/tickets/${t.id}`));

    // Staff updates notify user watchers only; the contact row is skipped.
    expectOk(await a.post(`${API}/tickets/${t.id}/comments`).send({ body: 'Update', type: 'comment_public' }), 201);

    expect((await tech.agent.delete(`${API}/tickets/${t.id}/watchers/contacts/${rita.id}`)).status).toBe(403);
    expectOk(await a.delete(`${API}/tickets/${t.id}/watchers/contacts/${rita.id}`));
    expect((await portal.get(`${API}/portal/tickets/${t.id}`)).status).toBe(404);
  });

  it('merging tickets keeps every contact watcher', async () => {
    const t1 = await makeTicket(w.admin.agent, { title: 'one', contactId: pat.id });
    const t2 = await makeTicket(w.admin.agent, { title: 'two', contactId: pat.id });
    await models.TicketWatcher.create({ ticketId: t1.id, contactId: rita.id });
    await models.TicketWatcher.create({ ticketId: t1.id, contactId: dana.id });
    await models.TicketWatcher.create({ ticketId: t2.id, contactId: dana.id });
    expectOk(await w.admin.agent.post(`${API}/tickets/${t2.id}/merge`).send({ sourceIds: [t1.id] }));
    const rows = await models.TicketWatcher.findAll({ where: { ticketId: t2.id } });
    expect(rows.map((r) => r.contactId).sort()).toEqual([rita.id, dana.id].sort());
  });
});

describe('contact payload', () => {
  it('carries the portal fields', async () => {
    const a = w.admin.agent;
    expectOk(await a.put(`${API}/departments/${billing.id}/portal-admins`).send({ contactIds: [dana.id] }));
    expectOk(await a.put(`${API}/companies/${alpha.id}/portal-admins`).send({ contactIds: [dana.id] }));
    await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: 'x'.repeat(60) }, { where: { id: dana.id } });
    const { contact } = expectOk(await a.get(`${API}/contacts/${dana.id}`));
    expect(contact).toMatchObject({
      portalAccess: true, signInMethod: 'password', portalLastSignInAt: null,
      adminOf: { company: true, departments: [{ id: billing.id, name: 'Billing' }] },
    });
    expect(JSON.stringify(contact)).not.toContain('passwordHash');
    // Edits answer with the same fields, so the page keeps them.
    const patched = expectOk(await a.patch(`${API}/contacts/${dana.id}`).send({ jobTitle: 'Office manager' })).contact;
    expect(patched).toMatchObject({ signInMethod: 'password', adminOf: { company: true } });
    expect(JSON.stringify(patched)).not.toContain('passwordHash');
    const plain = expectOk(await a.get(`${API}/contacts/${pat.id}`)).contact;
    expect(plain).toMatchObject({ portalAccess: false, signInMethod: null, adminOf: { company: false, departments: [] } });
  });
});
