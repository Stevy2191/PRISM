const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeTicket, makeProject, makeContact, setSettings,
} = require('./fixtures');

// Plan 3b-2's final review and security review: the findings fixed in its
// one fix pass.

let w;
let staff;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  staff = await makeStaff('staff', w.deptA.id); // tickets view_department + edit_own
});
afterAll(closeDb);

const grant = async (u, permissionKey, granted = true) => expectOk(
  await w.admin.agent.post(`${API}/users/${u.user.id}/overrides`).send({ permissionKey, granted }), 201
);
const forbiddenEdit = (thing) => ({ error: true, message: `You do not have permission to edit this ${thing}`, code: 'FORBIDDEN' });

describe('statuses are matched exactly (I2)', () => {
  it('a status in another letter case is stored by its real name, and closing still needs time', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, status: 'open' });
    expect(t.status).toBe('Open');
    await setSettings(w.admin, { 'timeTracking.requireBeforeClose': 'true' });
    for (const status of ['closed', 'CLOSED']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.post(`${API}/tickets`).send({ title: 'C', contactId: w.contact.id, status })).body.code)
        .toBe('TIME_REQUIRED_BEFORE_CLOSE');
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status })).body.code).toBe('TIME_REQUIRED_BEFORE_CLOSE');
    }
    const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id, status: 'active' });
    expect(p.status).toBe('Active');
  });
});

it('I3: a new ticket can\'t link the same ticket twice through parent, child and related', async () => {
  const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
  for (const links of [
    { parentTicketId: other.id, childTicketIds: [other.id] },
    { parentTicketId: other.id, relatedTicketIds: [other.id] },
    { childTicketIds: [other.id], relatedTicketIds: [String(other.id)] },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.admin.agent.post(`${API}/tickets`).send({ title: 'New', contactId: w.contact.id, ...links });
    expect(res.body).toEqual({ error: true, message: 'A ticket can be linked only once', code: 'VALIDATION_ERROR' });
  }
  expect(await models.TicketRelation.count()).toBe(0);
});

it('M1: staff-entered CSAT needs the edit tier', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Closed' }));
  expect((await staff.agent.post(`${API}/tickets/${t.id}/csat`).send({ rating: 'unhappy' })).body).toEqual(forbiddenEdit('ticket'));
});

it('M2: the activity feed doesn\'t name a linked ticket the viewer can\'t open', async () => {
  const mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id });
  const secret = await makeTicket(w.admin.agent, { title: 'Terminate J. Doe', contactId: w.contact.id, departmentId: w.deptB.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${mine.id}/relations`).send({ relatedTicketId: secret.id }), 201);
  // A row written before this fix, with the title in it.
  await models.TicketActivity.create({ ticketId: mine.id, userId: w.admin.user.id, action: 'relation_added', toValue: 'related: Terminate J. Doe' });
  const linkRows = async (u) => expectOk(await u.agent.get(`${API}/tickets/${mine.id}/activity`)).activity
    .filter((a) => a.action === 'relation_added').map((a) => a.toValue);
  const pad = String(secret.id).padStart(5, '0');
  expect(await linkRows(staff)).toEqual(['related: a linked ticket', `related: #${pad} (restricted)`]);
  expect(await linkRows(w.admin)).toEqual(['related: a linked ticket', `related: #${pad} Terminate J. Doe`]);
});

describe('assets show linked tickets only to those who can open them (L3)', () => {
  let asset;
  let secret;
  beforeEach(async () => {
    const category = await models.AssetCategory.create({ name: 'Fixpass laptops' });
    asset = expectOk(await w.admin.agent.post(`${API}/assets`).send({ name: 'Laptop', categoryId: category.id }), 201).asset;
    secret = await makeTicket(w.admin.agent, { title: 'Payroll breach', contactId: w.contact.id, departmentId: w.deptB.id });
    expectOk(await w.admin.agent.post(`${API}/assets/${asset.id}/tickets`).send({ ticketId: secret.id }), 201);
    await grant(staff, 'assets.view');
    await grant(staff, 'assets.link_tickets');
  });
  afterEach(() => models.AssetCategory.destroy({ where: { name: 'Fixpass laptops' } }));

  it('the list, the activity and unlinking', async () => {
    const [row] = expectOk(await staff.agent.get(`${API}/assets/${asset.id}/tickets`)).tickets;
    expect(row).toEqual(expect.objectContaining({ id: secret.id, restricted: true }));
    expect(row).not.toHaveProperty('title');
    expect(expectOk(await w.admin.agent.get(`${API}/assets/${asset.id}/tickets`)).tickets[0].title).toBe('Payroll breach');
    const titles = async (u) => expectOk(await u.agent.get(`${API}/assets/${asset.id}/activity`)).activity
      .filter((a) => a.action === 'ticket_linked').map((a) => a.detail.ticketTitle ?? null);
    expect(await titles(staff)).toEqual([null]);
    expect(await titles(w.admin)).toEqual(['Payroll breach']);
    expect((await staff.agent.delete(`${API}/assets/${asset.id}/tickets/${secret.id}`)).status).toBe(404);
    expect(await models.AssetTicket.count({ where: { assetId: asset.id } })).toBe(1);
  });
});

describe('project members (I5, L1, L2)', () => {
  let p;
  let tech;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id });
  });
  const membersOf = async () => expectOk(await w.admin.agent.get(`${API}/projects/${p.id}/members`)).members
    .map((m) => [m.userId, m.role]).sort((a, b) => a[0] - b[0]);

  it('a member must be an active user who can work for the project\'s company', async () => {
    const gone = await makeTech('gone', w.deptA.id);
    await models.User.update({ isActive: false }, { where: { id: gone.user.id } });
    for (const userId of [gone.user.id, 99999, '12abc']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.post(`${API}/projects/${p.id}/members`).send({ userId })).body)
        .toEqual({ error: true, message: 'Member can\'t work for this company', code: 'VALIDATION_ERROR' });
    }
  });

  it('adding someone as lead makes them the project\'s lead', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/members`).send({ userId: mgr.user.id, role: 'lead' }), 201);
    expect(expectOk(await w.admin.agent.get(`${API}/projects/${p.id}`)).project.assignedToUserId).toBe(mgr.user.id);
    expect(await membersOf()).toEqual([[tech.user.id, 'member'], [mgr.user.id, 'lead']].sort((a, b) => a[0] - b[0]));
  });

  it('changing the lead needs projects.manage_members; re-sending the current lead does not', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    await grant(tech, 'projects.manage_members', false);
    expect((await tech.agent.patch(`${API}/projects/${p.id}`).send({ assignedToUserId: mgr.user.id })).body)
      .toEqual({ error: true, message: 'Changing the lead needs permission to manage members', code: 'FORBIDDEN' });
    expectOk(await tech.agent.patch(`${API}/projects/${p.id}`).send({ name: 'Renamed', assignedToUserId: tech.user.id }));
  });

  it('naming someone else as lead or member at create needs projects.manage_members', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    await grant(tech, 'projects.manage_members', false);
    const res = await tech.agent.post(`${API}/projects`).send({ name: 'Q', ownerDepartmentId: w.deptA.id, assignedToUserId: mgr.user.id });
    expect(res.body).toEqual({ error: true, message: 'Naming the lead or members needs permission to manage members', code: 'FORBIDDEN' });
    expectOk(await tech.agent.post(`${API}/projects`).send({ name: 'Mine', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id }), 201);
  });

  it('a lead who has since left doesn\'t block other edits (minor 2)', async () => {
    await models.User.update({ isActive: false }, { where: { id: tech.user.id } });
    expectOk(await w.admin.agent.patch(`${API}/projects/${p.id}`).send({ name: 'Renamed', assignedToUserId: tech.user.id, status: 'Active' }));
  });
});

it('L4: a ticket shows a project the viewer can\'t open as restricted', async () => {
  const hidden = await makeProject(w.admin.agent, { name: 'Secret merger', ownerDepartmentId: w.deptB.id });
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, projectId: hidden.id });
  expect(expectOk(await staff.agent.get(`${API}/tickets/${t.id}`)).ticket.project).toEqual({ id: hidden.id, restricted: true });
  const listed = expectOk(await staff.agent.get(`${API}/tickets`)).tickets.find((x) => x.id === t.id);
  expect(listed.project).toEqual({ id: hidden.id, restricted: true });
  expect(expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`)).ticket.project).toEqual({ id: hidden.id, name: 'Secret merger' });
});

it('a contact\'s tickets list only the tickets the viewer can open', async () => {
  const c = await makeContact(w.admin, { firstName: 'Cara', departmentId: w.deptA.id });
  const seen = await makeTicket(w.admin.agent, { title: 'Seen', contactId: c.id, departmentId: w.deptA.id });
  const hidden = await makeTicket(w.admin.agent, { title: 'Hidden', contactId: c.id, departmentId: w.deptB.id });
  const ids = (rows) => rows.map((r) => r.id);
  expect(ids(expectOk(await staff.agent.get(`${API}/contacts/${c.id}/tickets`)).tickets)).toEqual([seen.id]);
  const detail = expectOk(await staff.agent.get(`${API}/contacts/${c.id}`));
  expect(ids(detail.recentTickets)).toEqual([seen.id]);
  expect(ids(expectOk(await w.admin.agent.get(`${API}/contacts/${c.id}/tickets`)).tickets).sort()).toEqual([seen.id, hidden.id].sort());
});
