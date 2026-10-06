const { resetData, closeDb, ROLE, createUserAndLogin, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeUser, makeContractor, makeTicket, makeProject, makeTeam,
  makeCompany, setCompanyAccess, makeContact,
} = require('./fixtures');

// Who may log, edit and delete time, and for whom (spec: Permissions; Q4,
// Q6, Q21). The same rules on both sides of the one ledger.

let w;
let tech;
let mgr;
let ctr;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  mgr = await makeManager('mgr', w.deptA.id);
  ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
});
afterAll(closeDb);

const KINDS = {
  ticket: {
    make: async (fields = {}) => makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, ...fields }),
    url: (p) => `${API}/tickets/${p.id}/time`,
  },
  project: {
    make: async (fields = {}) => makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id, ...fields }),
    url: (p) => `${API}/projects/${p.id}/time-entries`,
  },
};
const forbidden = (message) => ({ error: true, message, code: 'FORBIDDEN' });
const invalidTarget = { error: true, message: 'Invalid user to log time for', code: 'VALIDATION_ERROR' };

describe.each(Object.keys(KINDS))('on a %s', (kind) => {
  const { make, url } = KINDS[kind];
  let parent;
  beforeEach(async () => {
    parent = await make();
  });
  const log = (u, body) => u.agent.post(url(parent)).send({ durationMinutes: 30, ...body });
  const entryUrl = (e) => `${url(parent)}/${e.id}`;

  it('time.log is required to log, edit or delete', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    const res = await log(ro);
    expect(res.status).toBe(403);
    const e = expectOk(await log(tech), 201).entry;
    expect((await ro.agent.patch(entryUrl(e)).send({ note: 'x' })).status).toBe(403);
    expect((await ro.agent.delete(entryUrl(e))).status).toBe(403);
  });

  it('a technician logs their own time but not someone else\'s', async () => {
    const own = expectOk(await log(tech, { userId: String(tech.user.id) }), 201).entry;
    expect([own.userId, own.loggedById]).toEqual([tech.user.id, tech.user.id]);
    const res = await log(tech, { userId: ctr.user.id });
    expect(res.body).toEqual(forbidden('You can only log time for yourself or people you manage'));
  });

  it('Q6: time.manage_others lets a manager log, edit and delete for others', async () => {
    const e = expectOk(await log(mgr, { userId: ctr.user.id }), 201).entry;
    expect([e.userId, e.loggedById, e.laborCost]).toEqual([ctr.user.id, mgr.user.id, 30]);
    const theirs = expectOk(await log(tech), 201).entry;
    expect(expectOk(await mgr.agent.patch(entryUrl(theirs)).send({ note: 'checked' })).entry.note).toBe('checked');
    expectOk(await mgr.agent.delete(entryUrl(theirs)));
  });

  it('Q6: the permission decides, not the legacy admin role', async () => {
    const granular = await createUserAndLogin({ username: 'granular', roleName: ROLE.ADMIN, legacyRole: 'technician' });
    expect((await log(granular, { userId: tech.user.id })).status).toBe(201);
  });

  it('Q21: a team lead manages time for their own team only', async () => {
    const lead = await makeTech('lead', w.deptA.id);
    await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }, { userId: tech.user.id, isLead: false }]);
    expect((await log(lead, { userId: tech.user.id })).status).toBe(201);
    expect((await log(lead, { userId: ctr.user.id })).body).toEqual(forbidden('You can only log time for yourself or people you manage'));
  });

  it('Q4: the logger and the person it is for may both edit and delete it', async () => {
    const lead = await makeTech('lead', w.deptA.id);
    await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }, { userId: tech.user.id, isLead: false }]);
    const a = expectOk(await log(lead, { userId: tech.user.id }), 201).entry;
    const b = expectOk(await log(lead, { userId: tech.user.id }), 201).entry;
    expectOk(await tech.agent.patch(entryUrl(a)).send({ note: 'mine' }));
    expectOk(await tech.agent.delete(entryUrl(a)));
    expectOk(await lead.agent.delete(entryUrl(b)));
  });

  it('someone else can\'t change it', async () => {
    const e = expectOk(await log(tech), 201).entry;
    expect((await ctr.agent.patch(entryUrl(e)).send({ note: 'x' })).body).toEqual(forbidden('You can only edit your own time entries'));
    expect((await ctr.agent.delete(entryUrl(e))).body).toEqual(forbidden('You can only remove your own time entries'));
  });

  it('the person must exist, be active and be able to log time', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    const gone = await makeTech('gone', w.deptA.id);
    await models.User.update({ isActive: false }, { where: { id: gone.user.id } });
    for (const userId of [ro.user.id, gone.user.id, 99999, '12abc', 1.5]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await log(mgr, { userId })).body).toEqual(invalidTarget);
    }
  });

  it('the person must be able to open the parent\'s company', async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    const ann = await makeContact(w.admin, { firstName: 'Ann', companyId: acme.id });
    const acmeParent = kind === 'ticket'
      ? await makeTicket(w.admin.agent, { title: 'Acme', contactId: ann.id })
      : await makeProject(w.admin.agent, { name: 'Acme job', companyId: acme.id, ownerDepartmentId: w.deptA.id });
    const internalId = (await models.Company.findOne({ where: { isInternal: true } })).id;
    await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internalId] });
    const res = await w.admin.agent.post(url(acmeParent)).send({ durationMinutes: 30, userId: tech.user.id });
    expect(res.body).toEqual(invalidTarget);
  });

  it('moving an entry to someone else follows the same rules, and recosts it', async () => {
    const e = expectOk(await log(tech), 201).entry;
    expect((await tech.agent.patch(entryUrl(e)).send({ userId: ctr.user.id })).body)
      .toEqual(forbidden('You can only log time for yourself or people you manage'));
    const moved = expectOk(await w.admin.agent.patch(entryUrl(e)).send({ userId: ctr.user.id })).entry;
    expect([moved.userId, moved.laborCost]).toEqual([ctr.user.id, 30]);
  });
});

it('the session flag reflects the permission or a team lead role', async () => {
  const lead = await makeTech('lead', w.deptA.id);
  await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }]);
  const flag = async (u) => expectOk(await u.agent.get(`${API}/auth/me`)).user.canLogTimeForOthers;
  expect([await flag(mgr), await flag(lead), await flag(tech)]).toEqual([true, true, false]);
});

// Final review I2: until plan 3b-2 checks the edit tier, each side keeps the
// gate it had before time.log existed — ticket time needs a ticket edit
// permission, project time needs projects.log_time — so time.log alone
// doesn't open a domain a role never could log in.
describe('interim domain gates', () => {
  const deny = async (u, permissionKey) => expectOk(
    await w.admin.agent.post(`${API}/users/${u.user.id}/overrides`).send({ permissionKey, granted: false }), 201
  );
  let ticket;
  let project;
  beforeEach(async () => {
    ticket = await KINDS.ticket.make();
    project = await KINDS.project.make();
  });
  const logOn = (u, kind, parent) => u.agent.post(KINDS[kind].url(parent)).send({ durationMinutes: 5 });

  it('ticket time also needs a ticket edit permission', async () => {
    for (const key of ['tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all']) await deny(tech, key); // eslint-disable-line no-await-in-loop
    expect((await logOn(tech, 'ticket', ticket)).status).toBe(403);
    expect((await logOn(tech, 'project', project)).status).toBe(201);
    expect((await tech.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: ticket.id })).status).toBe(403);
  });

  it('project time also needs projects.log_time', async () => {
    await deny(tech, 'projects.log_time');
    expect((await logOn(tech, 'project', project)).status).toBe(403);
    expect((await logOn(tech, 'ticket', ticket)).status).toBe(201);
    expect((await tech.agent.post(`${API}/timer/start`).send({ type: 'project', id: project.id })).status).toBe(403);
  });
});
