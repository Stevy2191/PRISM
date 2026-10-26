const {
  resetData, closeDb, models, sequelize, createUserAndLogin, ROLE,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeProject, makeTask, makeCompany, makeContact, setCompanyAccess,
  makeTeam, setSettings, freezeClock, unfreezeClock,
} = require('./fixtures');

// Workload (sub-project 6, task 12): capacity, the planned date on a ticket
// and the read-only people x days screen, built from the viewer's own scope.

const {
  SlaPolicy, TicketSla, Ticket, TicketActivity, AuditLog, TaskAssignee,
} = models;
const MON = '2026-11-02';
const NOV = (d) => `2026-11-${String(d).padStart(2, '0')}`;

let w;
let tina;
let carl;
const get = (agent, qs = '') => agent.get(`${API}/workload?from=${MON}&today=${MON}${qs}`);
const load = async (agent, qs = '') => expectOk(await get(agent, qs));
const row = (res, user) => res.people.find((p) => p.id === user.user.id);
const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, ...fields,
});

beforeEach(async () => {
  await resetData();
  await sequelize.query('DELETE FROM Holidays');
  await sequelize.query('DELETE FROM HolidayLists');
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  carl = await makeTech('carl', w.deptA.id);
});
afterAll(closeDb);

describe('access', () => {
  it('without workload.view → 403', async () => {
    const { agent } = await createUserAndLogin({ username: 'dstaff', roleName: ROLE.DEPARTMENT_STAFF, departmentId: w.deptA.id });
    expect((await get(agent)).status).toBe(403);
    expect((await get(w.admin.agent)).status).toBe(200);
  });

  it('validates days, kinds, from and teamId', async () => {
    const bad = async (qs) => expect((await w.admin.agent.get(`${API}/workload?${qs}`)).status).toBe(400);
    await bad(`from=${MON}&days=7`);
    await bad(`from=${MON}&kinds=everything`);
    await bad('from=2026-2-3');
    await bad('from=2026-02-30');
    await bad(`from=${MON}&teamId=abc`);
    await bad(`from=${MON}&teamId=1e1`);
    expect((await w.admin.agent.get(`${API}/workload?from=${MON}&days=10&kinds=tickets`)).status).toBe(200);
  });
});

describe('the grid', () => {
  it('columns are the next 5 or 10 weekdays and carry today', async () => {
    const five = await load(w.admin.agent);
    expect(five.days.map((d) => d.date)).toEqual([NOV(2), NOV(3), NOV(4), NOV(5), NOV(6)]);
    const ten = await load(w.admin.agent, '&days=10');
    expect(ten.days).toHaveLength(10);
    expect(ten.days[5].date).toBe(NOV(9));
  });

  it('a ticket with a due date fills that day, with no date sits under none, the default size is 60', async () => {
    await newTicket({ assigneeId: tina.user.id, dueDate: NOV(4) });
    await newTicket({ title: 'Undated', assigneeId: tina.user.id });
    const res = await load(w.admin.agent);
    const cells = row(res, tina).cells;
    expect(cells[NOV(4)]).toEqual(expect.objectContaining({ minutes: 60, capacity: 480, count: 1, overdue: false }));
    expect(cells.none.minutes).toBe(60);
    expect(cells[NOV(2)].minutes).toBe(0);
    expect(res.items[tina.user.id].map((i) => i.title).sort()).toEqual(['Printer', 'Undated']);
  });

  it('a planned date wins over the due date, an unassigned ticket lands in the lane', async () => {
    const t = await newTicket({ assigneeId: tina.user.id, dueDate: NOV(6) });
    await Ticket.update({ plannedDate: NOV(3) }, { where: { id: t.id } });
    await newTicket({ title: 'Nobody' });
    const res = await load(w.admin.agent);
    expect(row(res, tina).cells[NOV(3)].minutes).toBe(60);
    expect(row(res, tina).cells[NOV(6)].minutes).toBe(0);
    expect(res.unassigned.map((i) => i.title)).toEqual(['Nobody']);
    expect(res.items[tina.user.id][0]).toEqual(expect.objectContaining({ kind: 'ticket', plannedDate: NOV(3), canEdit: true }));
  });

  it('past due counts on today and is marked overdue', async () => {
    await newTicket({ assigneeId: tina.user.id, dueDate: '2026-10-20' });
    const res = await load(w.admin.agent);
    expect(row(res, tina).cells[MON]).toEqual(expect.objectContaining({ minutes: 60, count: 1, overdue: true }));
    expect(res.items[tina.user.id][0].overdue).toBe(true);
  });

  it('a ticket counts its open tasks\' remaining estimates', async () => {
    const t = await newTicket({ assigneeId: tina.user.id, dueDate: NOV(5) });
    const tk = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'Swap', estimateMinutes: 90 }), 201).task;
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 30, taskId: tk.id }), 201);
    const res = await load(w.admin.agent);
    expect(row(res, tina).cells[NOV(5)].minutes).toBe(60);
  });

  it('kinds narrows to tickets or tasks', async () => {
    await newTicket({ assigneeId: tina.user.id, dueDate: NOV(4) });
    const p = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
    await makeTask(w.admin.agent, p.id, { assigneeId: tina.user.id, estimateMinutes: 120, startDate: NOV(4), dueDate: NOV(4) });
    const both = await load(w.admin.agent);
    expect(row(both, tina).cells[NOV(4)].minutes).toBe(180);
    expect(row(await load(w.admin.agent, '&kinds=tickets'), tina).cells[NOV(4)].minutes).toBe(60);
    expect(row(await load(w.admin.agent, '&kinds=tasks'), tina).cells[NOV(4)].minutes).toBe(120);
  });

  it('teamId limits the people', async () => {
    const team = await makeTeam(w.admin, 'Desk', [{ userId: tina.user.id }]);
    const res = await load(w.admin.agent, `&teamId=${team.id}`);
    expect(res.people.map((p) => p.id)).toEqual([tina.user.id]);
    expect((await load(w.admin.agent)).people.map((p) => p.id)).toEqual(expect.arrayContaining([tina.user.id, carl.user.id]));
  });
});

describe('helpers', () => {
  it('task with a helper appears in both people\'s rows with half the remaining estimate', async () => {
    const p = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
    const t = await makeTask(w.admin.agent, p.id, {
      title: 'Rack', assigneeId: tina.user.id, estimateMinutes: 300, startDate: NOV(3), dueDate: NOV(3),
    });
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/tasks/${t.id}/helpers`).send({ userId: carl.user.id }), 201);
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/time-entries`).send({ taskId: t.id, durationMinutes: 60 }), 201);
    const res = await load(w.admin.agent);
    // 300 estimate - 60 logged by someone = 240; two people = 120 each
    expect(row(res, tina).cells[NOV(3)].minutes).toBe(120);
    expect(row(res, carl).cells[NOV(3)].minutes).toBe(120);
    expect(res.items[carl.user.id][0]).toEqual(expect.objectContaining({ kind: 'task', id: t.id, projectId: p.id, minutes: 120 }));
  });

  it('a person who cannot reach the project does not get the task in their row', async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    const p = await makeProject(w.admin.agent, { name: 'Acme job', companyId: acme.id, ownerDepartmentId: w.deptA.id });
    const t = await makeTask(w.admin.agent, p.id, { title: 'Rack', assigneeId: carl.user.id, estimateMinutes: 240, startDate: NOV(3), dueDate: NOV(3) });
    await setCompanyAccess(w.admin, tina.user.id, { allCompanies: false, companyIds: [] });
    await TaskAssignee.create({ taskId: t.id, userId: tina.user.id });
    const res = await load(w.admin.agent);
    expect(res.items[tina.user.id] || []).toEqual([]);
    expect(row(res, tina).cells[NOV(3)].minutes).toBe(0);
    expect(row(res, carl).cells[NOV(3)].minutes).toBe(240);
  });
});

describe('scope', () => {
  it('restricted viewer: other-company ticket assigned to a shown tech → absent from items and from cell minutes', async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    const dell = await makeCompany(w.admin, { name: 'Dell' });
    const acmeContact = await makeContact(w.admin, { companyId: acme.id });
    const dellContact = await makeContact(w.admin, { companyId: dell.id });
    const mine = await newTicket({ title: 'Acme job', contactId: acmeContact.id, departmentId: undefined, assigneeId: tina.user.id, dueDate: NOV(4) });
    await newTicket({ title: 'Dell job', contactId: dellContact.id, departmentId: undefined, assigneeId: tina.user.id, dueDate: NOV(4) });
    const pDell = await makeProject(w.admin.agent, { name: 'Dell project', companyId: dell.id, ownerDepartmentId: w.deptA.id });
    await makeTask(w.admin.agent, pDell.id, { title: 'Dell task', assigneeId: tina.user.id, estimateMinutes: 90, startDate: NOV(4), dueDate: NOV(4) });
    const viewer = await makeTech('viewer', w.deptA.id);
    await setCompanyAccess(w.admin, viewer.user.id, { allCompanies: false, companyIds: [acme.id] });

    const res = await load(viewer.agent);
    expect(row(res, tina).cells[NOV(4)].minutes).toBe(60);
    expect(res.items[tina.user.id].map((i) => i.title)).toEqual([mine.title]);
    expect(JSON.stringify(res)).not.toContain('Dell');
    // the admin still sees everything
    const all = await load(w.admin.agent);
    expect(row(all, tina).cells[NOV(4)].minutes).toBe(60 + 60 + 90);
  });

  it('canEdit follows the viewer\'s real edit access', async () => {
    await newTicket({ assigneeId: tina.user.id, dueDate: NOV(4) });
    const p = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
    await makeTask(w.admin.agent, p.id, { assigneeId: tina.user.id, estimateMinutes: 60, dueDate: NOV(4) });
    const { agent, user } = await createUserAndLogin({ username: 'reader', roleName: ROLE.READ_ONLY, departmentId: w.deptA.id });
    expectOk(await w.admin.agent.post(`${API}/users/${user.id}/overrides`).send({ permissionKey: 'workload.view', granted: true }), 201);
    const res = await load(agent);
    const items = res.items[tina.user.id];
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.canEdit)).toEqual([false, false]);
    const admin = await load(w.admin.agent);
    expect(admin.items[tina.user.id].map((i) => i.canEdit)).toEqual([true, true]);
  });
});

describe('today and holidays', () => {
  it('GET /workload?from=2026-11-02&today=2026-11-02 at 2026-11-03T03:30Z → today column is Nov 2', async () => {
    await newTicket({ assigneeId: tina.user.id, dueDate: '2026-10-30' });
    freezeClock('2026-11-03T03:30:00Z');
    try {
      // Sign in under the frozen clock: a session made earlier looks expired to it.
      const { agent } = await createUserAndLogin({ username: 'late', roleName: ROLE.ADMIN, legacyRole: 'admin' });
      const res = await load(agent);
      expect(res.today).toBe(MON);
      expect(row(res, tina).cells[MON]).toEqual(expect.objectContaining({ minutes: 60, overdue: true }));
      // junk or missing today falls back to the server's local date
      const noToday = expectOk(await agent.get(`${API}/workload?from=${MON}&today=nonsense`));
      const d = new Date();
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(noToday.today).toBe(local);
    } finally {
      unfreezeClock();
    }
  });

  it('global and own-department holidays count, other departments\' do not', async () => {
    const mk = async (name, departmentId, date) => {
      const list = expectOk(await w.admin.agent.post(`${API}/holiday-lists`).send({ name, departmentId }), 201).holidayList;
      expectOk(await w.admin.agent.post(`${API}/holiday-lists/${list.id}/holidays`).send({ name, date }), 201);
    };
    await mk('Company day', null, NOV(3));
    await mk('Desk day', w.deptA.id, NOV(4));
    await mk('Facilities day', w.deptB.id, NOV(5));
    const res = await load(w.admin.agent);
    const cells = row(res, tina).cells;
    expect(cells[NOV(3)].capacity).toBe(0);
    expect(cells[NOV(4)].capacity).toBe(0);
    expect(cells[NOV(5)].capacity).toBe(480);
    expect(cells[NOV(2)].capacity).toBe(480);
    expect(res.days.find((d) => d.date === NOV(3)).holiday).toBeTruthy();
    expect(res.days.find((d) => d.date === NOV(5)).holiday).toBeFalsy();
  });

  it('personal work hours and the default setting set capacity', async () => {
    expectOk(await w.admin.agent.patch(`${API}/users/${tina.user.id}/work-hours`).send({ workHours: { 1: 240, 2: 0 } }));
    let res = await load(w.admin.agent);
    expect(row(res, tina).cells[NOV(2)].capacity).toBe(240);
    expect(row(res, tina).cells[NOV(3)].capacity).toBe(0);
    expect(row(res, carl).cells[NOV(3)].capacity).toBe(480);
    await setSettings(w.admin, { 'workload.defaultWorkHours': { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 0, 7: 0 }, 'workload.defaultTicketMinutes': '30' });
    res = await load(w.admin.agent);
    expect(row(res, carl).cells[NOV(3)].capacity).toBe(100);
  });
});

describe('ticket planned date', () => {
  it('PATCH ticket plannedDate audited and logged, SLA dueDate unchanged', async () => {
    const std = await SlaPolicy.findOne({ where: { isDefault: true } });
    expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send({
      targets: [{ ticketType: 'incident', priority: 'high', resolutionMinutes: 2880 }],
    }));
    const t = await newTicket({ type: 'incident', priority: 'high', assigneeId: tina.user.id });
    const before = await Ticket.findByPk(t.id);
    const slaBefore = await TicketSla.findOne({ where: { ticketId: t.id } });
    expect(before.dueDate).toBeTruthy();
    const res = expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ plannedDate: NOV(5) }));
    expect(res.ticket.plannedDate).toBe(NOV(5));
    const after = await Ticket.findByPk(t.id);
    expect(after.plannedDate).toBe(NOV(5));
    expect(after.dueDate).toBe(before.dueDate);
    expect(new Date((await TicketSla.findOne({ where: { ticketId: t.id } })).resolutionDueAt).getTime())
      .toBe(new Date(slaBefore.resolutionDueAt).getTime());
    expect(await AuditLog.count({ where: { action: 'ticket.plannedDate', entityId: t.id } })).toBe(1);
    const act = await TicketActivity.findAll({ where: { ticketId: t.id, action: 'plannedDate' } });
    expect(act).toHaveLength(1);
    expect(act[0].toValue).toBe(NOV(5));
    // clearing it
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ plannedDate: null }));
    expect((await Ticket.findByPk(t.id)).plannedDate).toBeNull();
    // same value again writes nothing new
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ plannedDate: null }));
    expect(await AuditLog.count({ where: { action: 'ticket.plannedDate', entityId: t.id } })).toBe(2);
  });

  it('rejects junk dates', async () => {
    const t = await newTicket();
    for (const bad of ['2026-02-30', 'tomorrow', 20261105, '2026-11-5']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ plannedDate: bad })).status).toBe(400);
    }
  });

  it('plannedDate on a ticket without edit access → 403', async () => {
    const t = await newTicket({ assigneeId: tina.user.id });
    const { agent } = await createUserAndLogin({ username: 'reader', roleName: ROLE.READ_ONLY, departmentId: w.deptA.id });
    expect((await agent.patch(`${API}/tickets/${t.id}`).send({ plannedDate: NOV(5) })).status).toBe(403);
    expect((await Ticket.findByPk(t.id)).plannedDate).toBeNull();
  });
});

describe('work hours and settings', () => {
  const patchHours = (agent, id, workHours) => agent.patch(`${API}/users/${id}/work-hours`).send({ workHours });

  it('work-hours PATCH validates 0–1440 and needs settings.manage_business_hours', async () => {
    expect((await patchHours(tina.agent, carl.user.id, { 1: 60 })).status).toBe(403);
    const ok = expectOk(await patchHours(w.admin.agent, carl.user.id, { 1: 0, 2: 1440, 7: 90 }));
    expect(ok.user.workHours).toEqual({ 1: 0, 2: 1440, 7: 90 });
    expect(await AuditLog.count({ where: { action: 'user.workHours', entityId: carl.user.id } })).toBe(1);
    for (const bad of [{ 8: 60 }, { 0: 60 }, { 1: 1441 }, { 1: -1 }, { 1: 1.5 }, { 1: '60' }, { monday: 60 }, [60], 'x', 5, { 1: null }]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await patchHours(w.admin.agent, carl.user.id, bad)).status).toBe(400);
    }
    expect((await patchHours(w.admin.agent, 'abc', { 1: 60 })).status).toBe(404);
    expect((await patchHours(w.admin.agent, 987654, { 1: 60 })).status).toBe(404);
    expectOk(await patchHours(w.admin.agent, carl.user.id, null)); // reset
    expect((await models.User.findByPk(carl.user.id)).workHours).toBeNull();
    expect((await w.admin.agent.patch(`${API}/users/${carl.user.id}/work-hours`).send({})).status).toBe(400);
  });

  it('defaultTicketMinutes outside 15–1440 → 400', async () => {
    const patch = (value) => w.admin.agent.patch(`${API}/settings`).send({ 'workload.defaultTicketMinutes': value });
    for (const bad of ['14', '1441', '0', 'abc', '30.5']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await patch(bad)).status).toBe(400);
    }
    expectOk(await patch('15'));
    expectOk(await patch('1440'));
    expect(await AuditLog.count({ where: { action: 'settings.workload' } })).toBe(2);
  });

  it('defaultWorkHours is validated and audited', async () => {
    const patch = (value) => w.admin.agent.patch(`${API}/settings`).send({ 'workload.defaultWorkHours': value });
    expect((await patch({ 1: 2000 })).status).toBe(400);
    expect((await patch('not json')).status).toBe(400);
    expect((await patch({ 9: 10 })).status).toBe(400);
    const ok = expectOk(await patch({ 1: 420, 2: 420, 3: 420, 4: 420, 5: 420, 6: 0, 7: 0 }));
    expect(JSON.parse(ok.settings['workload.defaultWorkHours'])[1]).toBe(420);
    expect(await AuditLog.count({ where: { action: 'settings.workload' } })).toBe(1);
  });
});
