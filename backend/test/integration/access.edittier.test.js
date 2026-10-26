const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeTicket, makeProject, makeTask,
} = require('./fixtures');

// The edit tier (Q26, Q28): changing a ticket's or project's own data needs
// *.edit_* against the record; collaborating (comments, attachments, files,
// watchers, your own time) needs only view access (user decision 2026-10-06).

let w;
let staff;
let tech;
let mgr;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  staff = await makeStaff('staff', w.deptA.id); // tickets view_department + edit_own; projects view_department
  tech = await makeTech('tech', w.deptA.id); // System Technician: view_all + edit_all (plan 3b-2)
  mgr = await makeManager('mgr', w.deptA.id); // view/edit department
});
afterAll(closeDb);

const editRefused = (thing) => ({ error: true, message: `You do not have permission to edit this ${thing}`, code: 'FORBIDDEN' });

describe('tickets', () => {
  let mine;
  let theirs;
  beforeEach(async () => {
    mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: staff.user.id });
    theirs = await makeTicket(w.admin.agent, { title: 'Theirs', contactId: w.contact.id, departmentId: w.deptA.id });
  });
  const url = (t, path = '') => `${API}/tickets/${t.id}${path}`;

  it('edit_own: edits tickets assigned to them, not the department\'s others', async () => {
    expect((await staff.agent.patch(url(mine)).send({ priority: 'low' })).status).toBe(200);
    expect((await staff.agent.patch(url(theirs)).send({ priority: 'low' })).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.post(url(theirs, '/tasks')).send({ title: 'x' })).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.patch(url(theirs, '/custom-field-values')).send({ values: {} })).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.post(url(theirs, '/relations')).send({ relatedTicketId: mine.id })).body).toEqual(editRefused('ticket'));
  });

  it('collaborating needs only view access: comments, watchers and your own time', async () => {
    expectOk(await staff.agent.post(url(theirs, '/comments')).send({ body: 'helped' }), 201);
    expectOk(await staff.agent.post(url(theirs, '/watchers')).send({ userId: staff.user.id }), 201);
    expectOk(await staff.agent.post(url(theirs, '/time')).send({ durationMinutes: 15 }), 201);
  });

  it('System Technician and Department Manager keep today\'s reach', async () => {
    const elsewhere = await makeTicket(w.admin.agent, { title: 'B', contactId: w.contact.id, departmentId: w.deptB.id });
    expect((await tech.agent.patch(url(elsewhere)).send({ priority: 'low' })).status).toBe(200);
    expect((await mgr.agent.patch(url(theirs)).send({ priority: 'low' })).status).toBe(200);
    expect((await mgr.agent.patch(url(elsewhere)).send({ priority: 'low' })).status).toBe(403);
  });

  it('a department-less user never matches a department-less ticket', async () => {
    const loose = await makeStaff('loose', null);
    await models.User.update({ departmentId: null }, { where: { id: loose.user.id } });
    const orphan = await makeTicket(w.admin.agent, { title: 'No dept', contactId: w.contact.id });
    await models.Ticket.update({ departmentId: null }, { where: { id: orphan.id } });
    expect((await loose.agent.patch(url(orphan)).send({ priority: 'low' })).status).toBe(403);
  });

  it('Q28: delete needs the edit tier as well as tickets.delete', async () => {
    expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/overrides`).send({ permissionKey: 'tickets.delete', granted: true }), 201);
    expect((await staff.agent.delete(url(theirs))).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.delete(url(mine))).status).toBe(200);
  });
});

describe('projects', () => {
  let ours;
  beforeEach(async () => {
    ours = await makeProject(w.admin.agent, { name: 'Ours', ownerDepartmentId: w.deptA.id });
  });
  const url = (p, path = '') => `${API}/projects/${p.id}${path}`;

  it('view without edit: staff can\'t edit the project or its tasks, but log their own time', async () => {
    expect((await staff.agent.patch(url(ours)).send({ name: 'x' })).status).toBe(403);
    expect((await staff.agent.post(url(ours, '/tasks')).send({ title: 'x' })).status).toBe(403);
    expectOk(await staff.agent.post(url(ours, '/time-entries')).send({ durationMinutes: 15 }), 201);
  });

  it('the lead and members edit whatever their role; a helper only views and logs time (2026-10-26)', async () => {
    const task = await makeTask(w.admin.agent, ours.id);
    expect((await staff.agent.post(url(ours, '/files')).attach('file', Buffer.from('hi'), 'a.txt')).status).toBe(403);

    expectOk(await w.admin.agent.post(url(ours, `/tasks/${task.id}/helpers`)).send({ userId: staff.user.id }), 201);
    expect((await staff.agent.patch(url(ours)).send({ name: 'x' })).status).toBe(403);
    expect((await staff.agent.post(url(ours, '/files')).attach('file', Buffer.from('hi'), 'a.txt')).status).toBe(403);

    expectOk(await w.admin.agent.post(url(ours, '/members')).send({ userId: staff.user.id }), 201);
    expectOk(await staff.agent.patch(url(ours)).send({ name: 'Ours 2' }));
    expectOk(await staff.agent.patch(url(ours, `/tasks/${task.id}`)).send({ title: 'y' }));
    expectOk(await staff.agent.post(url(ours, '/files')).attach('file', Buffer.from('hi'), 'a.txt'), 201);

    const led = await makeProject(w.admin.agent, { name: 'Led', ownerDepartmentId: w.deptA.id, assignedToUserId: staff.user.id });
    expectOk(await staff.agent.patch(url(led)).send({ name: 'Led 2' }));
  });

  it('edit_department covers the department\'s projects; edit_all (System Technician) covers all', async () => {
    const elsewhere = await makeProject(w.admin.agent, { name: 'B', ownerDepartmentId: w.deptB.id });
    expectOk(await mgr.agent.patch(url(ours)).send({ name: 'Ours 2' }));
    expect((await mgr.agent.patch(url(elsewhere)).send({ name: 'x' })).status).toBe(403);
    expectOk(await tech.agent.patch(url(elsewhere)).send({ name: 'B 2' }));
    const task = await makeTask(tech.agent, elsewhere.id);
    expectOk(await tech.agent.patch(url(elsewhere, `/tasks/${task.id}`)).send({ title: 'y' }));
  });

  it('Q28: delete needs the edit tier as well as projects.delete', async () => {
    expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'projects.delete', granted: true }), 201);
    const elsewhere = await makeProject(w.admin.agent, { name: 'B', ownerDepartmentId: w.deptB.id });
    expect((await mgr.agent.delete(url(elsewhere))).status).toBe(403);
    expectOk(await mgr.agent.delete(url(ours)));
  });
});

it('the timer runs on anything the user can see (time.log + view)', async () => {
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  expect((await staff.agent.post(`${API}/timer/start`).send({ type: 'project', id: p.id })).status).toBe(201);
});
