const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeManager, makeTicket, makeProject, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Choosing and changing a record's company: contacts and projects (plan 2a
// task 8). Tickets follow their contact (model hook, task 3).

const { Company, Contact, AuditLog } = models;

let w;
let acme;
let dell;
let old;
let internalId;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme', isClient: true });
  dell = await makeCompany(w.admin, { name: 'Dell', isClient: false, isVendor: true });
  old = await makeCompany(w.admin, { name: 'Old', isClient: true });
  expectOk(await w.admin.agent.patch(`${API}/companies/${old.id}`).send({ status: 'inactive' }));
  tech = await makeTech('tech', w.deptA.id);
});
afterAll(closeDb);

const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const acmeDept = async (name = 'HR') => expectOk(await a().post(`${API}/departments`).send({ name, companyId: acme.id }), 201).department;
const acmeSite = async (name = 'HQ') => expectOk(await a().post(`${API}/companies/${acme.id}/sites`).send({ name }), 201).site;

describe('contacts', () => {
  it('a contact defaults to the internal company', async () => {
    const c = expectOk(await tech.agent.post(`${API}/contacts`).send({ firstName: 'Pat' }), 201).contact;
    expect(c.companyId).toBe(internalId);
    expect(c.company).toEqual({ id: internalId, name: expect.any(String) });
  });

  it('a contact can be created at a client', async () => {
    const c = expectOk(await tech.agent.post(`${API}/contacts`).send({ firstName: 'Ann', companyId: acme.id }), 201).contact;
    expect(c.companyId).toBe(acme.id);
  });

  it('a contact\'s company must be an active client (or internal) the user can reach', async () => {
    const fenced = await makeTech('fenced', w.deptA.id);
    await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
    const attempts = [
      [tech, dell.id], [tech, old.id], [tech, 99999], [tech, '1e1'], [fenced, acme.id],
    ];
    for (const [user, companyId] of attempts) {
      // eslint-disable-next-line no-await-in-loop
      expectErr(await user.agent.post(`${API}/contacts`).send({ firstName: 'X', companyId }), 400, 'VALIDATION_ERROR', 'Unknown company');
    }
  });

  it('a contact\'s site must be in its company', async () => {
    const hq = await acmeSite();
    const ok = expectOk(await a().post(`${API}/contacts`).send({ firstName: 'Ann', companyId: acme.id, siteId: hq.id }), 201).contact;
    expect(ok.site).toEqual({ id: hq.id, name: 'HQ' });
    expectErr(await a().post(`${API}/contacts`).send({ firstName: 'Bo', siteId: hq.id }), 400, 'VALIDATION_ERROR', 'Site not found');
  });

  it('moving a contact needs people.edit_users', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    // Staff created this contact, so they can reach it (canAccessContact).
    const mine = expectOk(await staff.agent.post(`${API}/contacts`).send({ firstName: 'Ann', companyId: acme.id }), 201).contact;
    expectErr(await staff.agent.patch(`${API}/contacts/${mine.id}`).send({ companyId: internalId }), 403, 'FORBIDDEN', 'Moving a contact to another company needs people.edit_users');
  });

  it('moving a contact needs access to both companies', async () => {
    const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const mgr = await makeManager('mgr', w.deptA.id);
    expectOk(await a().post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
    await setCompanyAccess(w.admin, mgr.user.id, { allCompanies: false, companyIds: [internalId] });
    expectErr(await mgr.agent.patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId }), 403, 'FORBIDDEN', 'You do not have access to this contact');
  });

  describe('moving a contact', () => {
    let ann;
    let hr;
    let hq;
    let tickets;
    beforeEach(async () => {
      hr = await acmeDept();
      hq = await acmeSite();
      ann = expectOk(await a().post(`${API}/contacts`).send({ firstName: 'Ann', companyId: acme.id, departmentId: hr.id, siteId: hq.id }), 201).contact;
      tickets = [
        await makeTicket(a(), { title: 'Open one', contactId: ann.id }),
        await makeTicket(a(), { title: 'Closed one', contactId: ann.id, status: 'Closed' }),
      ];
    });

    it('is audited', async () => {
      expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId }));
      // No endpoint reads AuditLogs.
      const row = await AuditLog.findOne({ where: { action: 'contact.move' }, raw: true });
      expect(row.meta).toEqual({ fromCompanyId: acme.id, toCompanyId: internalId, ticketsMoved: 2 });
    });

    it('moves every ticket, open and closed', async () => {
      expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId }));
      for (const t of tickets) {
        // eslint-disable-next-line no-await-in-loop
        expect(expectOk(await a().get(`${API}/tickets/${t.id}`)).ticket.companyId).toBe(internalId);
      }
    });

    it('drops its department and site from the old company', async () => {
      const { contact } = expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId }));
      expect([contact.departmentId, contact.siteId]).toEqual([null, null]);
    });

    it('refuses a department that isn\'t in the new company', async () => {
      expectErr(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId, departmentId: hr.id }), 400, 'VALIDATION_ERROR', 'Department not found');
    });
  });
});

describe('projects', () => {
  it('a project can belong to a client', async () => {
    const hr = await acmeDept();
    const p = await makeProject(a(), { name: 'Acme rollout', ownerDepartmentId: w.deptA.id, companyId: acme.id, forDepartmentId: hr.id });
    expect(p).toEqual(expect.objectContaining({ companyId: acme.id, projectCode: 'SD-P00001', forDepartmentId: hr.id }));
    expect(p.company).toEqual({ id: acme.id, name: 'Acme' });
  });

  it('a project\'s company follows the same rules as a contact\'s', async () => {
    const fenced = await makeTech('fenced', w.deptA.id);
    await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
    for (const [user, companyId] of [[tech, dell.id], [tech, old.id], [fenced, acme.id]]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await user.agent.post(`${API}/projects`).send({ name: 'P', ownerDepartmentId: w.deptA.id, companyId });
      expectErr(res, 400, 'VALIDATION_ERROR', 'Unknown company');
    }
  });

  it('moving a project keeps its "for" department valid', async () => {
    const hr = await acmeDept();
    const p = await makeProject(a(), { name: 'Acme rollout', ownerDepartmentId: w.deptA.id, companyId: acme.id, forDepartmentId: hr.id });
    expectErr(await a().patch(`${API}/projects/${p.id}`).send({ companyId: internalId }), 400, 'VALIDATION_ERROR', 'For-department does not exist');
    const moved = expectOk(await a().patch(`${API}/projects/${p.id}`).send({ companyId: internalId, forDepartmentId: w.deptA.id })).project;
    expect([moved.companyId, moved.forDepartmentId]).toEqual([internalId, w.deptA.id]);
  });
});

describe('lists and labels', () => {
  it('lists filter by company', async () => {
    const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    await makeTicket(a(), { title: 'Acme ticket', contactId: ann.id });
    await makeTicket(a(), { title: 'Home ticket', contactId: w.contact.id });
    await makeProject(a(), { name: 'Acme project', ownerDepartmentId: w.deptA.id, companyId: acme.id });
    await makeProject(a(), { name: 'Home project', ownerDepartmentId: w.deptA.id });
    const q = `?companyId=${acme.id}`;
    expect(expectOk(await a().get(`${API}/tickets${q}`)).tickets.map((t) => t.title)).toEqual(['Acme ticket']);
    expect(expectOk(await a().get(`${API}/projects${q}`)).projects.map((p) => p.name)).toEqual(['Acme project']);
    expect(expectOk(await a().get(`${API}/contacts${q}`)).contacts.map((c) => c.displayName)).toEqual(['Ann']);
  });

  it('tickets show their company', async () => {
    const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
    const t = await makeTicket(a(), { title: 'Acme ticket', contactId: ann.id });
    expect(expectOk(await a().get(`${API}/tickets/${t.id}`)).ticket.company).toEqual({ id: acme.id, name: 'Acme' });
  });
});
