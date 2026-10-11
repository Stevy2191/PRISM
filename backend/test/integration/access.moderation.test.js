const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeTicket, makeProject,
} = require('./fixtures');

// Moderating other people's content (editing or deleting their comments,
// removing their attachments and project files) is its own permission,
// tickets.moderate / projects.moderate, on top of edit_all or
// edit_department (user decision 2026-10-11: System Technician edits
// everything but doesn't moderate colleagues).

let w;
let tech;
let mgr;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id); // System Technician: edit_all, no moderate
  mgr = await makeManager('mgr', w.deptA.id); // Department Manager: edit_department + moderate
});
afterAll(closeDb);

it('System Technician can\'t edit or delete a colleague\'s comment or attachment; a Department Manager can', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  const url = `${API}/tickets/${t.id}`;
  const c = expectOk(await mgr.agent.post(`${url}/comments`).send({ body: 'mine' }), 201).comment;
  expect((await tech.agent.patch(`${url}/comments/${c.id}`).send({ body: 'changed' })).body.message).toBe('You can only edit your own comments');
  expect((await tech.agent.delete(`${url}/comments/${c.id}`)).body.message).toBe('You can only delete your own comments');
  const a = expectOk(await mgr.agent.post(`${url}/attachments`).attach('file', Buffer.from('hello'), 'notes.txt'), 201).attachment;
  expect((await tech.agent.delete(`${url}/attachments/${a.id}`)).body.message).toBe('You can only remove your own attachments');
  const own = expectOk(await tech.agent.post(`${url}/comments`).send({ body: 'tech wrote' }), 201).comment;
  expectOk(await mgr.agent.patch(`${url}/comments/${own.id}`).send({ body: 'moderated' }));
  expectOk(await mgr.agent.delete(`${url}/comments/${own.id}`));
  expectOk(await w.admin.agent.delete(`${url}/attachments/${a.id}`));
});

it('System Technician can\'t delete a colleague\'s project file; a Department Manager can', async () => {
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  const files = `${API}/projects/${p.id}/files`;
  const f = expectOk(await mgr.agent.post(files).attach('file', Buffer.from('hello'), 'notes.txt'), 201).file;
  expect((await tech.agent.delete(`${files}/${f.id}`)).body)
    .toEqual({ error: true, message: 'Only the uploader or a project moderator can delete this file', code: 'FORBIDDEN' });
  const g = expectOk(await tech.agent.post(files).attach('file', Buffer.from('hello'), 'tech.txt'), 201).file;
  expectOk(await mgr.agent.delete(`${files}/${g.id}`));
});

it('the moderate permission alone, without an edit tier that covers the record, is not enough', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'B', contactId: w.contact.id, departmentId: w.deptB.id });
  const other = await makeManager('mgrB', w.deptB.id);
  const c = expectOk(await other.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'b' }), 201).comment;
  expectOk(await w.admin.agent.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'tickets.moderate', granted: true }), 201);
  expectOk(await w.admin.agent.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'tickets.edit_all', granted: false }), 201);
  expect((await tech.agent.delete(`${API}/tickets/${t.id}/comments/${c.id}`)).status).toBe(403);
});
