const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeProject, makeTask, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Findings from plan 2a's final and security reviews (R1–R8 in the ledger).

const {
  Company, Contact, Ticket, TicketRelation, ProjectTask, Asset, Notification, Role, RoleCompanyAccess, UserCompanyAccess,
} = models;

let w;
let acme;
let globex;
let internalId;
let hr;
let ann;
let acmeTicket;
let homeTicket;
let category;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
// A tech who reaches only the given companies.
const fencedTech = async (name, companyIds) => {
  const t = await makeTech(name, w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds });
  return t;
};
const grant = async (user, permissionKey) => expectOk(
  await a().post(`${API}/users/${user.id}/overrides`).send({ permissionKey, granted: true }), 201
);

beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex' });
  hr = expectOk(await a().post(`${API}/departments`).send({ name: 'HR', companyId: acme.id }), 201).department;
  ann = expectOk(await a().post(`${API}/contacts`).send({ firstName: 'Ann', companyId: acme.id, departmentId: hr.id }), 201).contact;
  acmeTicket = await makeTicket(a(), { title: 'Acme ticket', contactId: ann.id, departmentId: hr.id });
  homeTicket = await makeTicket(a(), { title: 'Home ticket', contactId: w.contact.id });
  category = await models.AssetCategory.create({ name: 'Laptops' });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

describe('R1: the default company is a company like any other', () => {
  it('a user who can\'t reach the internal company can\'t create records in it by leaving companyId out', async () => {
    const t = await fencedTech('acmeonly', [acme.id]);
    await grant(t.user, 'people.view_all');
    expectErr(await t.agent.post(`${API}/contacts`).send({ firstName: 'x' }), 400, 'VALIDATION_ERROR', 'Unknown company');
    expectOk(await t.agent.post(`${API}/contacts`).send({ firstName: 'y', companyId: acme.id }), 201);
  });

  it('a null or empty companyId on update leaves the company alone', async () => {
    for (const blank of [null, '']) {
      // eslint-disable-next-line no-await-in-loop
      const contact = expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: blank })).contact;
      expect(contact.companyId).toBe(acme.id);
    }
    const project = await makeProject(a(), { name: 'P', companyId: acme.id, ownerDepartmentId: w.deptA.id });
    expect(expectOk(await a().patch(`${API}/projects/${project.id}`).send({ companyId: null })).project.companyId).toBe(acme.id);
    const asset = expectOk(await a().post(`${API}/assets`).send({ name: 'L', assetTag: 'L-1', categoryId: category.id, companyId: acme.id }), 201).asset;
    expect(expectOk(await a().patch(`${API}/assets/${asset.id}`).send({ companyId: '' })).asset.companyId).toBe(acme.id);
  });
});

describe('R2: a contact\'s move takes its tickets\' departments along', () => {
  it('moved tickets lose the old company\'s department', async () => {
    expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId }));
    expect((await Ticket.findByPk(acmeTicket.id)).departmentId).toBeNull();
  });

  it('moved tickets take the contact\'s new department', async () => {
    expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId, departmentId: w.deptA.id }));
    expect((await Ticket.findByPk(acmeTicket.id)).departmentId).toBe(w.deptA.id);
  });
});

describe('R3: links stay inside one company', () => {
  it('a ticket can only be related to a ticket in its own company', async () => {
    expectErr(
      await a().post(`${API}/tickets/${acmeTicket.id}/relations`).send({ relatedTicketId: homeTicket.id }),
      400, 'VALIDATION_ERROR', 'Related ticket not found'
    );
    expectErr(
      await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, relatedTicketIds: [homeTicket.id] }),
      400, 'VALIDATION_ERROR', 'Linked ticket not found'
    );
  });

  it('a relation made before a move is hidden', async () => {
    await TicketRelation.create({ ticketId: acmeTicket.id, relatedTicketId: homeTicket.id, relationType: 'related' });
    expect(expectOk(await a().get(`${API}/tickets/${acmeTicket.id}/relations`)).relations).toEqual([]);
  });

  it('a ticket\'s project must be in the ticket\'s company, and one from elsewhere is hidden', async () => {
    const homeProject = await makeProject(a(), { name: 'Home project', ownerDepartmentId: w.deptA.id });
    expectErr(await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, projectId: homeProject.id }), 400, 'VALIDATION_ERROR', 'Project not found');
    expectErr(await a().patch(`${API}/tickets/${acmeTicket.id}`).send({ projectId: homeProject.id }), 400, 'VALIDATION_ERROR', 'Project not found');
    await Ticket.update({ projectId: homeProject.id }, { where: { id: acmeTicket.id }, hooks: false });
    expect(expectOk(await a().get(`${API}/tickets/${acmeTicket.id}`)).ticket.project).toBeNull();
    const stats = expectOk(await a().get(`${API}/projects/${homeProject.id}/stats`)).stats;
    expect(stats.openTicketsCount).toBe(0);
  });

  it('a project task can only link a ticket in the project\'s company, and one from elsewhere is hidden', async () => {
    const acmeProject = await makeProject(a(), { name: 'Acme project', companyId: acme.id, ownerDepartmentId: w.deptA.id });
    expectErr(
      await a().post(`${API}/projects/${acmeProject.id}/tasks`).send({ title: 't', linkedTicketId: homeTicket.id }),
      400, 'VALIDATION_ERROR', 'Linked ticket not found'
    );
    const task = await makeTask(a(), acmeProject.id, { linkedTicketId: acmeTicket.id });
    expectErr(
      await a().patch(`${API}/projects/${acmeProject.id}/tasks/${task.id}`).send({ linkedTicketId: homeTicket.id }),
      400, 'VALIDATION_ERROR', 'Linked ticket not found'
    );
    await ProjectTask.update({ linkedTicketId: homeTicket.id }, { where: { id: task.id } });
    const { tasks } = expectOk(await a().get(`${API}/projects/${acmeProject.id}/tasks`));
    expect(tasks.find((x) => x.id === task.id).linkedTicket).toBeNull();
  });

  it('an asset\'s contact who moves away is unassigned, and a stale one is hidden and doesn\'t block saving', async () => {
    const asset = expectOk(await a().post(`${API}/assets`).send({
      name: 'L', assetTag: 'L-2', categoryId: category.id, companyId: acme.id, assignedToContactId: ann.id,
    }), 201).asset;
    expectOk(await a().patch(`${API}/contacts/${ann.id}`).send({ companyId: internalId }));
    expect((await Asset.findByPk(asset.id)).assignedToContactId).toBeNull();

    // A stale assignment from before this fix.
    await Asset.update({ assignedToContactId: ann.id }, { where: { id: asset.id } });
    expect(expectOk(await a().get(`${API}/assets/${asset.id}`)).asset.assignedToContact).toBeNull();
    expectOk(await a().patch(`${API}/assets/${asset.id}`).send({ assignedToContactId: ann.id, notes: 'still saves' }));
  });
});

describe('R4: deletes are fenced', () => {
  it('a fenced user with delete permission can\'t delete another company\'s ticket or project', async () => {
    const t = await fencedTech('deleter', [internalId]);
    await grant(t.user, 'tickets.delete');
    await grant(t.user, 'projects.delete');
    const acmeProject = await makeProject(a(), { name: 'Acme project', companyId: acme.id, ownerDepartmentId: w.deptA.id });
    expectErr(await t.agent.delete(`${API}/tickets/${acmeTicket.id}`), 403, 'FORBIDDEN', 'You do not have access to this ticket');
    expectErr(await t.agent.delete(`${API}/projects/${acmeProject.id}`), 403, 'FORBIDDEN', 'You do not have access to this project');
    expect(await Ticket.findByPk(acmeTicket.id)).not.toBeNull();
  });
});

describe('R5: import and AD sync stay in the internal company', () => {
  it('CSV import matches department names in the internal company only', async () => {
    const rows = [{ First: 'Imp', Email: 'imp@example.com', Dept: 'HR' }];
    const mapping = { First: 'firstName', Email: 'email', Dept: 'department' };
    const check = expectOk(await a().post(`${API}/contacts/import/validate`).send({ rows, mapping }));
    expect(check.summary.warnings).toBe(1); // "HR" is Acme's, so it doesn't match
    expectOk(await a().post(`${API}/contacts/import`).send({ rows, mapping }));
    const imported = await Contact.findOne({ where: { email: 'imp@example.com' } });
    expect([imported.companyId, imported.departmentId]).toEqual([internalId, null]);
  });

  it('an AD group can only map to an internal department', async () => {
    expectErr(
      await a().post(`${API}/ad-sync/group-mappings`).send({ adGroupName: 'HR', departmentId: hr.id }),
      404, 'NOT_FOUND', 'Department not found'
    );
  });

  it('AD sync leaves a client\'s contact with the same email alone', async () => {
    const { processEnabledUser } = require('../../src/services/adContactSync'); // eslint-disable-line global-require
    await Contact.update({ email: 'ann@acme.test' }, { where: { id: ann.id } });
    const entry = { attributes: [{ type: 'givenName', values: ['Annie'] }, { type: 'mail', values: ['ann@acme.test'] }] };
    const counters = { usersProcessed: 0, contactsCreated: 0, contactsUpdated: 0, contactsDeactivated: 0 };
    await processEnabledUser(entry, new Map(), counters, { firstNameAttr: 'givenName', emailAttr: 'mail' });
    const after = await Contact.findByPk(ann.id);
    expect([after.firstName, after.companyId, after.departmentId, after.adSynced]).toEqual(['Ann', acme.id, hr.id, false]);
    expect(counters.contactsUpdated + counters.contactsCreated).toBe(0);
  });
});

describe('R6: saving company access keeps what the granter can\'t see', () => {
  it('a fenced granter\'s save keeps the companies they can\'t reach, and can\'t flip all-companies', async () => {
    const granter = await fencedTech('granter', [acme.id]);
    await grant(granter.user, 'companies.manage_access');
    const victim = await fencedTech('victim', [acme.id, globex.id]);

    const seen = expectOk(await granter.agent.get(`${API}/users/${victim.user.id}/company-access`)).access;
    expect(seen.companies.map((c) => c.name)).toEqual(['Acme']);

    expectOk(await granter.agent.put(`${API}/users/${victim.user.id}/company-access`).send({ allCompanies: false, companyIds: [] }));
    const rows = await UserCompanyAccess.findAll({ where: { userId: victim.user.id } });
    expect(rows.map((r) => r.companyId)).toEqual([globex.id]);

    const allUser = await makeTech('everyone', w.deptA.id);
    expectErr(
      await granter.agent.put(`${API}/users/${allUser.user.id}/company-access`).send({ allCompanies: false, companyIds: [acme.id] }),
      403, 'FORBIDDEN', 'Only a user who reaches every company can change "all companies"'
    );
  });

  it('a fenced granter\'s role save keeps the companies they can\'t reach', async () => {
    const granter = await fencedTech('granter2', [acme.id]);
    await grant(granter.user, 'companies.manage_access');
    const role = await Role.findOne({ where: { name: 'Department Staff' } });
    await RoleCompanyAccess.bulkCreate([{ roleId: role.id, companyId: acme.id }, { roleId: role.id, companyId: globex.id }]);
    const res = expectOk(await granter.agent.put(`${API}/roles/${role.id}/company-access`).send({ companyIds: [] }));
    expect(res.access.companies.map((c) => c.name)).toEqual([]);
    const rows = await RoleCompanyAccess.findAll({ where: { roleId: role.id } });
    expect(rows.map((r) => r.companyId)).toEqual([globex.id]);
  });
});

describe('R7: notifications only reach people who can open the ticket', () => {
  it('an assignee or watcher who can\'t reach the ticket\'s company gets nothing', async () => {
    const outsider = await fencedTech('outsider', [internalId]);
    expectOk(await a().patch(`${API}/tickets/${acmeTicket.id}`).send({ assigneeId: outsider.user.id }));
    expectOk(await a().post(`${API}/tickets/${acmeTicket.id}/watchers`).send({ userId: outsider.user.id }), 201);
    expectOk(await a().post(`${API}/tickets/${acmeTicket.id}/comments`).send({ body: 'secret detail', type: 'reply' }), 201);
    await Ticket.update({ dueDate: '2020-01-01' }, { where: { id: acmeTicket.id }, hooks: false });
    expectOk(await outsider.agent.get(`${API}/notifications`));
    expect(await Notification.count({ where: { userId: outsider.user.id } })).toBe(0);
  });
});

describe('R8: role assignment can\'t widen company reach', () => {
  it('a fenced role manager can\'t hand out a role that reaches other companies, or System Administrator, or a role to themselves', async () => {
    const mgr = await fencedTech('rolemgr', [acme.id]);
    await grant(mgr.user, 'people.manage_roles');
    const target = await fencedTech('target', [acme.id]);
    const staff = await Role.findOne({ where: { name: 'Department Staff' } });
    await RoleCompanyAccess.create({ roleId: staff.id, companyId: globex.id });
    expectErr(
      await mgr.agent.post(`${API}/users/${target.user.id}/roles`).send({ roleId: staff.id, departmentId: w.deptA.id }),
      403, 'FORBIDDEN', 'You can only grant companies you can reach'
    );
    const sysAdmin = await Role.findOne({ where: { name: 'System Administrator' } });
    expectErr(
      await mgr.agent.post(`${API}/users/${target.user.id}/roles`).send({ roleId: sysAdmin.id }),
      403, 'FORBIDDEN', 'Only a System Administrator can grant the System Administrator role'
    );
    const manager = await Role.findOne({ where: { name: 'Department Manager' } });
    expectErr(
      await mgr.agent.post(`${API}/users/${mgr.user.id}/roles`).send({ roleId: manager.id, departmentId: w.deptA.id }),
      403, 'FORBIDDEN', 'You cannot change your own roles'
    );
  });
});
