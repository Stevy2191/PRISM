// Mail is recorded, not sent; the real "is SMTP set up?" check stays.
jest.mock('../../src/services/emailSender', () => ({
  ...jest.requireActual('../../src/services/emailSender'),
  sendMail: jest.fn(async () => ({})),
}));

const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeStaff, makeTech, makeProject, makeTask, makeCompany, setCompanyAccess, taskStatusId, waitFor,
} = require('./fixtures');

// Finish-to-start dependencies, shift dependents and unblocked notifications
// (sub-project 6, task 4).

let w;
let proj;
let DONE;
let TODO;
beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  proj = await makeProject(w.admin.agent, { name: 'Riverside Clinic network refresh', ownerDepartmentId: w.deptA.id });
  DONE = await taskStatusId(w.admin.agent, 'project', 'Completed');
  TODO = await taskStatusId(w.admin.agent, 'project', 'Active');
});
afterAll(closeDb);

const mk = (fields = {}, p = proj) => makeTask(w.admin.agent, p.id, fields);
const link = (predecessorId, successorId, agent = w.admin.agent, p = proj) => agent.post(`${API}/projects/${p.id}/dependencies`).send({ predecessorId, successorId });
const patch = (t, body, agent = w.admin.agent, p = proj) => agent.patch(`${API}/projects/${p.id}/tasks/${t.id}`).send(body);
const finish = async (t, agent = w.admin.agent) => expectOk(await patch(t, { statusId: DONE }, agent)).task;
const getTask = async (t) => {
  const { tasks } = expectOk(await w.admin.agent.get(`${API}/projects/${proj.id}/tasks`));
  return tasks.find((x) => x.id === t.id);
};
const unblockedFor = (userId) => models.Notification.count({ where: { userId, type: 'task_unblocked' } });
const audits = (action) => models.AuditLog.findAll({ where: { action } });

describe('creating and removing links', () => {
  it('create link; duplicate → 409 DEPENDENCY_EXISTS', async () => {
    const a = await mk({ title: 'A' });
    const b = await mk({ title: 'B' });
    const res = await link(a.id, b.id);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), predecessorId: a.id, successorId: b.id });
    const dup = await link(a.id, b.id);
    expect([dup.status, dup.body.code]).toEqual([409, 'DEPENDENCY_EXISTS']);
    expect((await audits('taskDependency.create')).length).toBe(1);
    const list = expectOk(await w.admin.agent.get(`${API}/projects/${proj.id}/dependencies`));
    expect(list.dependencies).toEqual([{ id: res.body.id, predecessorId: a.id, successorId: b.id }]);
  });

  it('self link and loop → 400 DEPENDENCY_CYCLE', async () => {
    const a = await mk({ title: 'A' });
    const b = await mk({ title: 'B' });
    const c = await mk({ title: 'C' });
    const self = await link(a.id, a.id);
    expect([self.status, self.body.code]).toEqual([400, 'DEPENDENCY_CYCLE']);
    expectOk(await link(a.id, b.id), 201);
    expectOk(await link(b.id, c.id), 201);
    const loop = await link(c.id, a.id);
    expect([loop.status, loop.body.code]).toEqual([400, 'DEPENDENCY_CYCLE']);
    const back = await link(b.id, a.id);
    expect([back.status, back.body.code]).toEqual([400, 'DEPENDENCY_CYCLE']);
  });

  it('subtask or other-project task → 400 DEPENDENCY_SCOPE', async () => {
    const a = await mk({ title: 'A' });
    const sub = expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'S', parentTaskId: a.id }), 201).task;
    const b = await mk({ title: 'B' });
    for (const [p, s] of [[a.id, sub.id], [sub.id, b.id], [b.id, 999999]]) {
      const res = await link(p, s);
      expect([res.status, res.body.code]).toEqual([400, 'DEPENDENCY_SCOPE']);
    }
    expect((await link('abc', b.id)).status).toBe(400);
  });

  it('dependency to a task in another editable project → 400 DEPENDENCY_SCOPE', async () => {
    const other = await makeProject(w.admin.agent, { name: 'Other', ownerDepartmentId: w.deptA.id });
    const a = await mk({ title: 'A' });
    const x = await mk({ title: 'X' }, other);
    const res = await link(a.id, x.id);
    expect([res.status, res.body.code]).toEqual([400, 'DEPENDENCY_SCOPE']);
    expect(await models.TaskDependency.count()).toBe(0);
  });

  it('needs the edit tier; viewing is enough to list', async () => {
    const a = await mk({ title: 'A' });
    const b = await mk({ title: 'B' });
    const viewer = await makeStaff('viewer', w.deptA.id);
    await models.ProjectMember.create({ projectId: proj.id, userId: viewer.user.id, role: 'member' });
    const res = await link(a.id, b.id, viewer.agent);
    expect(res.status).toBe(403);
    expect((await viewer.agent.get(`${API}/projects/${proj.id}/dependencies`)).status).toBe(200);
    const outsider = await makeStaff('outsider', w.deptB.id);
    expect((await link(a.id, b.id, outsider.agent)).status).toBe(403);
  });

  it('DELETE predecessor → successor waitingOn is empty', async () => {
    const a = await mk({ title: 'A' });
    const b = await mk({ title: 'B' });
    const { id } = (await link(a.id, b.id)).body;
    expect((await getTask(b)).waitingOn).toHaveLength(1);
    expectOk(await w.admin.agent.delete(`${API}/projects/${proj.id}/dependencies/${id}`));
    expect((await getTask(b)).waitingOn).toEqual([]);
    expect((await getTask(a)).holdingUp).toEqual([]);
    expect((await audits('taskDependency.delete')).length).toBe(1);
  });

  it('a dependency id of another project → 404 before anything else', async () => {
    const other = await makeProject(w.admin.agent, { name: 'Other', ownerDepartmentId: w.deptA.id });
    const x = await mk({ title: 'X' }, other);
    const y = await mk({ title: 'Y' }, other);
    const { id } = (await link(x.id, y.id, w.admin.agent, other)).body;
    expect((await w.admin.agent.delete(`${API}/projects/${proj.id}/dependencies/${id}`)).status).toBe(404);
    expect((await w.admin.agent.delete(`${API}/projects/${proj.id}/dependencies/abc`)).status).toBe(404);
    expect(await models.TaskDependency.count()).toBe(1);
  });

  it('deleting a task removes its links', async () => {
    const a = await mk({ title: 'A' });
    const b = await mk({ title: 'B' });
    await link(a.id, b.id);
    expectOk(await w.admin.agent.delete(`${API}/projects/${proj.id}/tasks/${a.id}`));
    expect(await models.TaskDependency.count()).toBe(0);
  });
});

describe('waiting', () => {
  it('waitingOn lists only unfinished predecessors; holdingUp the other way', async () => {
    const a = await mk({ title: 'A', dueDate: '2026-03-10' });
    const b = await mk({ title: 'B' });
    const c = await mk({ title: 'C' });
    await link(a.id, c.id);
    await link(b.id, c.id);
    await finish(a);
    const got = await getTask(c);
    expect(got.waitingOn).toEqual([{ id: b.id, code: b.code, title: 'B', dueDate: null }]);
    expect((await getTask(b)).holdingUp).toEqual([{ id: c.id, code: c.code, title: 'C' }]);
    expect((await getTask(a)).holdingUp).toEqual([{ id: c.id, code: c.code, title: 'C' }]);
    // never blocks: a waiting task can still be started and closed
    expect((await patch(c, { statusId: DONE })).status).toBe(200);
  });
});

describe('shift offer and shift dependents', () => {
  let a; let b; let c; let d;
  beforeEach(async () => {
    a = await mk({ title: 'A', startDate: '2026-03-02', dueDate: '2026-03-06' });
    b = await mk({ title: 'B', startDate: '2026-03-09', dueDate: '2026-03-13' });
    c = await mk({ title: 'C', startDate: '2026-03-16', dueDate: '2026-03-20' });
    d = await mk({ title: 'D', startDate: '2026-03-23', dueDate: '2026-03-27' });
    await link(a.id, b.id);
    await link(b.id, c.id);
    await link(c.id, d.id);
  });

  it('moving dueDate 2 days later returns shiftOffer with downstream tasks', async () => {
    const res = expectOk(await patch(a, { dueDate: '2026-03-08' }));
    expect(res.shiftOffer).toEqual({
      days: 2,
      tasks: [b, c, d].map((t) => ({ id: t.id, code: t.code, title: t.title })),
    });
    expect(res.task.shiftOffer).toBeUndefined();
  });

  it('shiftOffer lists only downstream tasks that have dates (the ones shift-dependents will move)', async () => {
    const e = await mk({ title: 'E undated' });
    await link(d.id, e.id);
    const res = expectOk(await patch(a, { dueDate: '2026-03-08' }));
    expect(res.shiftOffer.tasks.map((t) => t.id)).toEqual([b.id, c.id, d.id]);
    // an undated task alone downstream: nothing to offer
    const lone = await mk({ title: 'Lone', startDate: '2026-04-01', dueDate: '2026-04-02' });
    const loose = await mk({ title: 'Loose' });
    await link(lone.id, loose.id);
    expect((await patch(lone, { dueDate: '2026-04-04' })).body.shiftOffer).toBeUndefined();
  });

  it('moving earlier returns no shiftOffer', async () => {
    const res = expectOk(await patch(a, { dueDate: '2026-03-04' }));
    expect(res.shiftOffer).toBeUndefined();
    expect(expectOk(await patch(d, { dueDate: '2026-03-30' })).shiftOffer).toBeUndefined(); // nothing downstream
  });

  it('shift-dependents moves the chain by 2 and skips done tasks', async () => {
    await finish(c);
    const res = expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/tasks/${a.id}/shift-dependents`).send({ days: 2 }));
    expect(res.moved).toEqual([
      { id: b.id, startDate: '2026-03-11', dueDate: '2026-03-15' },
      { id: d.id, startDate: '2026-03-25', dueDate: '2026-03-29' },
    ]);
    expect((await getTask(c)).dueDate).toBe('2026-03-20');
    expect((await getTask(b)).dueDate).toBe('2026-03-15');
    expect((await audits('task.shiftDependents')).length).toBe(1);
  });

  it('validates days, the task and the edit tier', async () => {
    const url = (t, p = proj) => `${API}/projects/${p.id}/tasks/${t.id}/shift-dependents`;
    for (const days of [0, 366, 1.5, 'x', undefined, -1]) {
      expect((await w.admin.agent.post(url(a)).send({ days })).status).toBe(400);
    }
    const other = await makeProject(w.admin.agent, { name: 'Other', ownerDepartmentId: w.deptA.id });
    expect((await w.admin.agent.post(url(a, other)).send({ days: 1 })).status).toBe(404);
    const viewer = await makeStaff('viewer', w.deptA.id);
    await models.ProjectMember.create({ projectId: proj.id, userId: viewer.user.id, role: 'member' });
    expect((await viewer.agent.post(url(a)).send({ days: 1 })).status).toBe(403);
    expect((await getTask(b)).dueDate).toBe('2026-03-13');
  });
});

describe('unblocked notifications', () => {
  let a; let b; let c;
  let lead; let helper;
  beforeEach(async () => {
    lead = await makeTech('lead', w.deptA.id);
    helper = await makeTech('helper', w.deptA.id);
    a = await mk({ title: 'A' });
    b = await mk({ title: 'B' });
    c = await mk({ title: 'C', assigneeId: lead.user.id });
    expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/tasks/${c.id}/helpers`).send({ userId: helper.user.id }), 201);
    await link(a.id, c.id);
    await link(b.id, c.id);
    await models.Notification.destroy({ where: {} });
  });

  it('finishing the last predecessor notifies the successor assignee and its helpers once each', async () => {
    await finish(a);
    await finish(b);
    expect(await unblockedFor(lead.user.id)).toBe(1);
    expect(await unblockedFor(helper.user.id)).toBe(1);
    const [n] = await models.Notification.findAll({ where: { userId: lead.user.id, type: 'task_unblocked' } });
    expect(n.projectId).toBe(proj.id);
    expect(n.message).toContain(c.code);
    expect(await unblockedFor(w.admin.user.id)).toBe(0); // not the actor
  });

  it('finishing one of two predecessors notifies nobody', async () => {
    await finish(a);
    expect(await models.Notification.count({ where: { type: 'task_unblocked' } })).toBe(0);
  });

  it('does not notify when the actor is the assignee', async () => {
    await finish(a);
    await finish(b, lead.agent);
    expect(await unblockedFor(lead.user.id)).toBe(0);
    expect(await unblockedFor(helper.user.id)).toBe(1);
  });

  it('assignee who lost project access is not notified', async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    await setCompanyAccess(w.admin, helper.user.id, { allCompanies: false, companyIds: [acme.id] });
    await finish(a);
    await finish(b);
    expect(await unblockedFor(helper.user.id)).toBe(0);
    expect(await unblockedFor(lead.user.id)).toBe(1);
  });

  it('a successor that is already finished is not notified', async () => {
    await finish(c);
    await finish(a);
    await finish(b);
    expect(await models.Notification.count({ where: { type: 'task_unblocked' } })).toBe(0);
  });

  it('emails only those who turned task_unblocked email on', async () => {
    await models.User.update({ email: 'lead@acme.com' }, { where: { id: lead.user.id } });
    await models.User.update({ email: 'helper@acme.com', notificationEmailPrefs: { task_unblocked: true } }, { where: { id: helper.user.id } });
    await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
    await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
    await finish(a);
    await finish(b);
    await waitFor(() => sendMail.mock.calls.length >= 1);
    await new Promise((r) => { setTimeout(r, 250); });
    const mails = sendMail.mock.calls.map(([m]) => m);
    expect(mails.map((m) => m.to)).toEqual([['helper@acme.com']]);
    expect(mails[0].html).toContain(c.code);
    expect(mails[0].html).toContain('Riverside Clinic network refresh');
  });
});

describe('task_added email', () => {
  it('addHelper emails the helper by default', async () => {
    const helper = await makeTech('helper', w.deptA.id);
    await models.User.update({ email: 'helper@acme.com' }, { where: { id: helper.user.id } });
    await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
    await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
    const t = await mk({ title: 'Cabling' });
    expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/tasks/${t.id}/helpers`).send({ userId: helper.user.id }), 201);
    await waitFor(() => sendMail.mock.calls.length === 1);
    const [[mail]] = sendMail.mock.calls;
    expect(mail.to).toEqual(['helper@acme.com']);
    expect(mail.subject).toContain('Riverside Clinic network refresh');
    expect(mail.html).toContain(`added you to ${t.code}`);
  });
});
