const crypto = require('crypto');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeManager, makeTech, makeTicket, makeProject, makeTask,
} = require('./fixtures');

// S12–S17: report and CSAT scope holes, and project records accepting a task
// from another project. All predate plan 3a (found during its review).

const { CsatSurvey } = models;

let w;
let tina;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

const get = async (agent, path) => expectOk(await agent.get(`${API}${path}`));
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};

describe('S14: the time & billing report keeps the reader\'s scope under ?assigneeId', () => {
  beforeEach(async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, assigneeId: tina.user.id });
    expectOk(await tina.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 90 }), 201);
  });

  it('an own-scope reader asking for someone else\'s time gets nothing', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const { summary } = await get(staff.agent, `/reports/time-billing?assigneeId=${tina.user.id}`);
    expect(summary).toEqual(expect.objectContaining({ entryCount: 0, totalHours: 0 }));
  });

  it('an own-scope reader filtering on themselves still sees their own time', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const t = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id });
    expectOk(await staff.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 30 }), 201);
    const { summary } = await get(staff.agent, `/reports/time-billing?assigneeId=${staff.user.id}`);
    expect(summary).toEqual(expect.objectContaining({ entryCount: 1, totalHours: 0.5 }));
  });

  it('an all-scope reader can still filter by assignee', async () => {
    const { summary } = await get(w.admin.agent, `/reports/time-billing?assigneeId=${tina.user.id}`);
    expect(summary).toEqual(expect.objectContaining({ entryCount: 1, totalHours: 1.5 }));
  });
});

describe('S12 and S15: CSAT figures follow the reader\'s report scope', () => {
  let ticket;
  beforeEach(async () => {
    ticket = await makeTicket(w.admin.agent, {
      title: 'Rated', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tina.user.id,
    });
    const now = new Date();
    await CsatSurvey.create({
      ticketId: ticket.id, contactId: w.contact.id, assignedToUserId: tina.user.id, surveyToken: crypto.randomUUID(),
      status: 'responded', dueToSendAt: now, sentAt: now, respondedAt: now, rating: 5, comment: 'great',
    });
  });

  it('S12: the customer-happiness report shows everything to an all-scope reader', async () => {
    const body = await get(w.admin.agent, '/reports/customer-happiness');
    expect([body.summary.responseCount, body.summary.sentCount]).toEqual([1, 1]);
    expect(body.tableData.rows).toHaveLength(1);
  });

  it('S12: an own-scope reader sees only surveys on their own tickets', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const body = await get(staff.agent, '/reports/customer-happiness');
    expect([body.summary.responseCount, body.summary.sentCount]).toEqual([0, 0]);
    expect(body.tableData.rows).toEqual([]);
    expect(body.chartData.scoreByTech).toEqual([]);
  });

  it('S12: a department-scope reader sees only their department, whatever ?departmentId says', async () => {
    const mgr = await makeManager('mgrb', w.deptB.id);
    for (const q of ['', `?departmentId=${w.deptA.id}`]) {
      // eslint-disable-next-line no-await-in-loop
      const body = await get(mgr.agent, `/reports/customer-happiness${q}`);
      expect([body.summary.responseCount, body.summary.sentCount]).toEqual([0, 0]);
      expect(body.chartData.scoreByTech.map((t) => t.name)).not.toContain('Test tina');
    }
    const own = await get((await makeManager('mgra', w.deptA.id)).agent, '/reports/customer-happiness');
    expect(own.summary.responseCount).toBe(1);
  });

  it('S12: the CSV export is scoped the same way', async () => {
    const mgr = await makeManager('mgrb', w.deptB.id);
    const res = await mgr.agent.get(`${API}/reports/customer-happiness/export`);
    expect(res.status).toBe(200);
    expect(res.text.split('\r\n').filter(Boolean)).toHaveLength(1); // header only
  });

  it('S15: a department-scope reader can\'t read another department\'s technician', async () => {
    const mgr = await makeManager('mgrb', w.deptB.id);
    const message = "You don't have permission to view other technicians' performance stats";
    expectErr(await mgr.agent.get(`${API}/csat/stats?userId=${tina.user.id}`), 403, 'FORBIDDEN', message);
    expectErr(await mgr.agent.get(`${API}/csat/responses?userId=${tina.user.id}`), 403, 'FORBIDDEN', message);
  });

  it('S15: a department-scope reader\'s team and response lists stay in their department', async () => {
    const mgr = await makeManager('mgrb', w.deptB.id);
    const { team } = await get(mgr.agent, '/csat/stats');
    expect(team.map((t) => t.userId)).not.toContain(tina.user.id);
    expect((await get(mgr.agent, '/csat/responses')).responses).toEqual([]);
    const mgrA = await makeManager('mgra', w.deptA.id);
    expect((await get(mgrA.agent, `/csat/stats?userId=${tina.user.id}`)).responseCount).toBe(1);
    expect((await get(mgrA.agent, '/csat/responses')).responses).toHaveLength(1);
  });
});

describe('S13: project records only take a task from their own project', () => {
  let p1;
  let p2;
  let foreignTask;
  const NOT_HERE = ['400', 'VALIDATION_ERROR', 'Task does not belong to this project'];
  const expectNotHere = (res) => expectErr(res, Number(NOT_HERE[0]), NOT_HERE[1], NOT_HERE[2]);
  beforeEach(async () => {
    p1 = await makeProject(w.admin.agent, { name: 'One', ownerDepartmentId: w.deptA.id });
    p2 = await makeProject(w.admin.agent, { name: 'Two', ownerDepartmentId: w.deptA.id });
    foreignTask = await makeTask(w.admin.agent, p1.id, { title: 'Secret task' });
  });
  const url = (path) => `${API}/projects/${p2.id}/${path}`;

  it('expenses: create and update refuse a foreign task; an own task works', async () => {
    const a = w.admin.agent;
    expectNotHere(await a.post(url('expenses')).send({ description: 'x', amount: 1, taskId: foreignTask.id }));
    const exp = expectOk(await a.post(url('expenses')).send({ description: 'x', amount: 1 }), 201).expense;
    expectNotHere(await a.patch(url(`expenses/${exp.id}`)).send({ taskId: foreignTask.id }));
    const own = await makeTask(a, p2.id, { title: 'Own' });
    expect(expectOk(await a.patch(url(`expenses/${exp.id}`)).send({ taskId: own.id })).expense.taskId).toBe(own.id);
    expect(expectOk(await a.patch(url(`expenses/${exp.id}`)).send({ taskId: null })).expense.taskId).toBeNull();
  });

  it('materials: create and update refuse a foreign task', async () => {
    const a = w.admin.agent;
    expectNotHere(await a.post(url('materials')).send({ itemName: 'x', taskId: foreignTask.id }));
    const m = expectOk(await a.post(url('materials')).send({ itemName: 'x' }), 201).material;
    expectNotHere(await a.patch(url(`materials/${m.id}`)).send({ taskId: foreignTask.id }));
  });

  it('time entries: update refuses a foreign task', async () => {
    const a = w.admin.agent;
    const e = expectOk(await a.post(url('time-entries')).send({
      startTime: '2026-03-10T13:00:00Z', endTime: '2026-03-10T14:00:00Z', entryDate: '2026-03-10',
    }), 201).entry;
    expectNotHere(await a.patch(url(`time-entries/${e.id}`)).send({ taskId: foreignTask.id }));
  });

  it('files: upload refuses a foreign task', async () => {
    const res = await w.admin.agent.post(url('files')).field('taskId', String(foreignTask.id)).attach('file', Buffer.from('hello'), 'notes.txt');
    expectNotHere(res);
    expect(expectOk(await w.admin.agent.get(url('files'))).files).toEqual([]);
  });
});

describe('S16 and S17: the custom report builder keeps the reader\'s scope', () => {
  const MARK = 'S16MARK';
  beforeEach(async () => {
    const a = w.admin.agent;
    const t = await makeTicket(a, { title: `${MARK} ticket`, contactId: w.contact.id, assigneeId: tina.user.id });
    expectOk(await tina.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 30, note: `${MARK} time` }), 201);
    const p = await makeProject(a, { name: `${MARK} project`, ownerDepartmentId: w.deptA.id, assignedToUserId: tina.user.id });
    expectOk(await a.post(`${API}/projects/${p.id}/expenses`).send({ description: `${MARK} expense`, amount: 5 }), 201);
    expectOk(await a.post(`${API}/projects/${p.id}/materials`).send({ itemName: `${MARK} material` }), 201);
  });
  const run = async (agent, dataSource, filters = {}) => JSON.stringify(
    expectOk(await agent.post(`${API}/reports/custom`).send({ dataSource, filters }))
  );

  it.each(['tickets', 'projects', 'time_entries'])('S16: %s — ?assigneeId can\'t widen an own-scope reader', async (source) => {
    const staff = await makeStaff('staff', w.deptA.id);
    expect(await run(staff.agent, source, { assigneeId: tina.user.id })).not.toContain(MARK);
    expect(await run(w.admin.agent, source, { assigneeId: tina.user.id })).toContain(MARK);
  });

  it('S17: an own-scope reader sees expenses and materials only on projects they lead', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expect(await run(staff.agent, 'expenses_materials')).not.toContain(MARK);
    const admin = await run(w.admin.agent, 'expenses_materials');
    expect(admin).toContain(`${MARK} expense`);
    expect(admin).toContain(`${MARK} material`);
    expect(await run(tina.agent, 'expenses_materials')).toContain(`${MARK} expense`);
  });
});
