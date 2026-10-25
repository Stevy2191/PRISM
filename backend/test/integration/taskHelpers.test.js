const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeTech, makeTicket, makeProject, makeTask, makeSubtask,
  makeCompany, setCompanyAccess,
} = require('./fixtures');

// Helpers on project tasks, person-hours and the "mine" filter (sub-project 6, task 3b).

let w;
let proj;
let task;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  proj = await makeProject(w.admin.agent, { name: 'Riverside Clinic network refresh', ownerDepartmentId: w.deptA.id });
  task = await makeTask(w.admin.agent, proj.id, { title: 'Cabling' });
});
afterAll(closeDb);

const helpersUrl = (t = task, p = proj) => `${API}/projects/${p.id}/tasks/${t.id}/helpers`;
const addHelper = (agent, userId, t = task, p = proj) => agent.post(helpersUrl(t, p)).send({ userId });
const removeHelper = (agent, userId, t = task, p = proj) => agent.delete(`${helpersUrl(t, p)}/${userId}`);
const getTask = async (t = task) => {
  const { tasks } = expectOk(await w.admin.agent.get(`${API}/projects/${proj.id}/tasks`));
  return tasks.find((x) => x.id === t.id);
};
const audits = async (action) => models.AuditLog.findAll({ where: { action }, order: [['id', 'ASC']] });

describe('adding and removing helpers', () => {
  it('edit-access user adds a helper; audited task.helperAdd; helper notified task_added', async () => {
    const helper = await makeStaff('helper', w.deptA.id);
    const res = expectOk(await addHelper(w.admin.agent, helper.user.id), 201);
    expect(res.task.helpers).toEqual([expect.objectContaining({ id: helper.user.id })]);
    expect((await audits('task.helperAdd')).length).toBe(1);
    const [n] = await models.Notification.findAll({ where: { userId: helper.user.id, type: 'task_added' } });
    expect(n.message).toBe(`${w.admin.user.displayName || w.admin.user.username} added you to ${task.code} on Riverside Clinic network refresh`);
    expect(n.projectId).toBe(proj.id);
  });

  it('adding yourself does not notify you', async () => {
    expectOk(await addHelper(w.admin.agent, w.admin.user.id), 201);
    expect(await models.Notification.count({ where: { type: 'task_added' } })).toBe(0);
  });

  it('main assignee without edit access can add a helper', async () => {
    const lead = await makeStaff('lead', w.deptA.id);
    const helper = await makeStaff('helper', w.deptA.id);
    expectOk(await w.admin.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ assigneeId: lead.user.id }));
    expectOk(await addHelper(lead.agent, helper.user.id), 201);
    expect((await getTask()).helpers.map((h) => h.id)).toEqual([helper.user.id]);
  });

  it('other non-edit member → 403', async () => {
    const other = await makeStaff('other', w.deptA.id);
    const helper = await makeStaff('helper', w.deptA.id);
    expect((await addHelper(other.agent, helper.user.id)).status).toBe(403);
    expect((await getTask()).helpers).toEqual([]);
  });

  it('helper can remove themselves but not others', async () => {
    const h1 = await makeStaff('h1', w.deptA.id);
    const h2 = await makeStaff('h2', w.deptA.id);
    expectOk(await addHelper(w.admin.agent, h1.user.id), 201);
    expectOk(await addHelper(w.admin.agent, h2.user.id), 201);
    expect((await removeHelper(h1.agent, h2.user.id)).status).toBe(403);
    expectOk(await removeHelper(h1.agent, h1.user.id));
    expect((await getTask()).helpers.map((h) => h.id)).toEqual([h2.user.id]);
    expect((await audits('task.helperRemove')).length).toBe(1);
    expect((await removeHelper(w.admin.agent, h1.user.id)).status).toBe(404);
  });

  it('helper not yet a member becomes a member (projectMember.autoAdd) and can GET the project and log time', async () => {
    const outsider = await makeStaff('outsider', w.deptB.id);
    expect((await outsider.agent.get(`${API}/projects/${proj.id}`)).status).toBe(403);
    expectOk(await addHelper(w.admin.agent, outsider.user.id), 201);
    const member = await models.ProjectMember.findOne({ where: { projectId: proj.id, userId: outsider.user.id } });
    expect(member.role).toBe('member');
    expect((await audits('projectMember.autoAdd')).length).toBe(1);
    expect((await outsider.agent.get(`${API}/projects/${proj.id}`)).status).toBe(200);
    expectOk(await outsider.agent.post(`${API}/projects/${proj.id}/time-entries`).send({ entryDate: '2026-03-03', durationMinutes: 30, taskId: task.id }), 201);
  });

  it('an existing member is not re-added or audited as autoAdd', async () => {
    const m = await makeTech('m', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/members`).send({ userId: m.user.id }), 201);
    expectOk(await addHelper(w.admin.agent, m.user.id), 201);
    expect((await audits('projectMember.autoAdd')).length).toBe(0);
  });

  it("user who can't work the company → 400, no member row", async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    const fenced = await makeTech('fenced', w.deptA.id);
    await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [acme.id] });
    const res = await addHelper(w.admin.agent, fenced.user.id);
    expect(res.status).toBe(400);
    expect(await models.ProjectMember.count({ where: { projectId: proj.id, userId: fenced.user.id } })).toBe(0);
    expect(await models.TaskAssignee.count()).toBe(0);
  });

  it('adding the main assignee → 409 ALREADY_ON_TASK; duplicate helper → 409 ALREADY_ON_TASK', async () => {
    const lead = await makeStaff('lead', w.deptA.id);
    const helper = await makeStaff('helper', w.deptA.id);
    expectOk(await w.admin.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ assigneeId: lead.user.id }));
    let res = await addHelper(w.admin.agent, lead.user.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ON_TASK');
    expectOk(await addHelper(w.admin.agent, helper.user.id), 201);
    res = await addHelper(w.admin.agent, helper.user.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_ON_TASK');
  });

  it('making a helper the main assignee removes them from helpers', async () => {
    const helper = await makeStaff('helper', w.deptA.id);
    expectOk(await addHelper(w.admin.agent, helper.user.id), 201);
    const res = expectOk(await w.admin.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ assigneeId: helper.user.id }));
    expect(res.task.assigneeId).toBe(helper.user.id);
    expect(res.task.helpers).toEqual([]);
    expect(await models.TaskAssignee.count()).toBe(0);
  });

  it('works on subtasks too, and the task id must belong to the project (404)', async () => {
    const helper = await makeStaff('helper', w.deptA.id);
    const sub = await makeSubtask(w.admin.agent, proj.id, task.id);
    const url = `${API}/projects/${proj.id}/tasks/${task.id}/subtasks/${sub.id}/helpers`;
    expectOk(await w.admin.agent.post(url).send({ userId: helper.user.id }), 201);
    expectOk(await w.admin.agent.delete(`${url}/${helper.user.id}`));
    const other = await makeProject(w.admin.agent, { name: 'Other', ownerDepartmentId: w.deptA.id });
    expect((await addHelper(w.admin.agent, helper.user.id, task, other)).status).toBe(404);
    expect((await w.admin.agent.post(`${API}/projects/${proj.id}/tasks/abc/helpers`).send({ userId: helper.user.id })).status).toBe(404);
  });

  it('ticket task helper → 400 PROJECT_TASK_ONLY', async () => {
    const helper = await makeStaff('helper', w.deptA.id);
    const ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
    const tt = expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'x' }), 201).task;
    const { ticketParent, findTask } = require('../../src/services/tasks');
    const { addHelper: add } = require('../../src/services/projects/helpers');
    const parent = ticketParent(await models.Ticket.findByPk(ticket.id));
    const req = { user: w.admin.user };
    await expect(add(req, parent, await findTask(parent, tt.id), helper.user.id))
      .rejects.toMatchObject({ status: 400, code: 'PROJECT_TASK_ONLY' });
  });
});

describe('person-hours and mine', () => {
  it('task with 1 h from each of two people: loggedMinutes 120, loggedBy 2, phase and budget used 120', async () => {
    const helper = await makeTech('helper', w.deptA.id);
    const phase = expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/phases`).send({ name: 'Build' }), 201).phase;
    expectOk(await w.admin.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ phaseId: phase.id }));
    expectOk(await addHelper(w.admin.agent, helper.user.id), 201);
    const body = { entryDate: '2026-03-03', durationMinutes: 60, taskId: task.id };
    expectOk(await w.admin.agent.post(`${API}/projects/${proj.id}/time-entries`).send(body), 201);
    expectOk(await helper.agent.post(`${API}/projects/${proj.id}/time-entries`).send(body), 201);
    const t = await getTask();
    expect(t.loggedSeconds).toBe(7200);
    expect(t.loggedBy).toBe(2);
    const { phases } = expectOk(await w.admin.agent.get(`${API}/projects/${proj.id}/phases`));
    expect(phases[0].loggedMinutes).toBe(120);
    const { project } = expectOk(await w.admin.agent.get(`${API}/projects/${proj.id}`));
    expect(project.stats.totalTimeSeconds).toBe(7200);
  });

  it('mine filter includes tasks I help on', async () => {
    const me = await makeTech('me', w.deptA.id);
    const assigned = await makeTask(w.admin.agent, proj.id, { title: 'Mine', assigneeId: me.user.id });
    await makeTask(w.admin.agent, proj.id, { title: 'Not mine' });
    expectOk(await addHelper(w.admin.agent, me.user.id), 201);
    const { tasks } = expectOk(await me.agent.get(`${API}/projects/${proj.id}/tasks?mine=${me.user.id}`));
    expect(tasks.map((t) => t.id).sort()).toEqual([task.id, assigned.id].sort());
    expect((await me.agent.get(`${API}/projects/${proj.id}/tasks?mine=abc`)).status).toBe(400);
  });

  it('helper who can no longer work the company → no task_added notification, time still counted', async () => {
    const helper = await makeTech('helper', w.deptA.id);
    expectOk(await addHelper(w.admin.agent, helper.user.id), 201);
    const body = { entryDate: '2026-03-03', durationMinutes: 60, taskId: task.id };
    expectOk(await helper.agent.post(`${API}/projects/${proj.id}/time-entries`).send(body), 201);
    await models.Notification.destroy({ where: {} });
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    await setCompanyAccess(w.admin, helper.user.id, { allCompanies: false, companyIds: [acme.id] });
    // Added to another task of the same project by a second add attempt: refused, nothing sent.
    const t2 = await makeTask(w.admin.agent, proj.id, { title: 'Two' });
    expect((await addHelper(w.admin.agent, helper.user.id, t2)).status).toBe(400);
    // The notification helper itself refuses someone who can't reach the project.
    const { createNotification } = require('../../src/services/notifications');
    expect(await createNotification({ userId: helper.user.id, type: 'task_added', message: 'x', projectId: proj.id })).toBeNull();
    expect(await models.Notification.count({ where: { userId: helper.user.id, type: 'task_added' } })).toBe(0);
    expect((await getTask()).loggedBy).toBe(1);
    expect((await getTask()).loggedSeconds).toBe(3600);
  });
});
