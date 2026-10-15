jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const fs = require('fs');
const path = require('path');
const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const { UPLOAD_ROOT } = require('../../src/middleware/upload');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeOwnTier, makeTicket, makeContact, makeCompany, setSettings,
} = require('./fixtures');

// Service desk 5b task 6: merging tickets. Everything moves into the target
// in one transaction; sources close quietly with mergedIntoId set.

const {
  Ticket, Comment, Attachment, TimeEntry, Task, ActiveTimer, TicketWatcher, TicketCc, AssetTicket, TicketRelation, TicketActivity,
} = models;

let w;
let tina;
let bob;
let category;
beforeEach(async () => {
  await resetData();
  // TRUNCATE restarts ticket ids, so files from an earlier test would sit in
  // this test's ticket folders.
  await fs.promises.rm(UPLOAD_ROOT, { recursive: true, force: true });
  sendMail.mockReset();
  await models.AssetCategory.destroy({ where: { name: 'MergeCat' } });
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  bob = await makeContact(w.admin, { firstName: 'Bob', email: 'bob@example.com', departmentId: w.deptA.id });
  category = await models.AssetCategory.create({ name: 'MergeCat' });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'MergeCat' } });
  await closeDb();
});

const ticket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, ...fields,
});
const merge = (agent, targetId, sourceIds) => agent.post(`${API}/tickets/${targetId}/merge`).send({ sourceIds });
const asset = async (name) => expectOk(await w.admin.agent.post(`${API}/assets`).send({
  name, assetTag: name, categoryId: category.id, companyId: (await Ticket.findOne()).companyId,
}), 201).asset;
async function fileFor(ticketId, name) {
  const dir = path.join(UPLOAD_ROOT, String(ticketId));
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, name), `content of ${name}`);
  return Attachment.create({ filename: name, originalName: name, size: 10, ticketId, uploadedById: w.admin.user.id });
}
const exists = (ticketId, name) => fs.existsSync(path.join(UPLOAD_ROOT, String(ticketId), name));

describe('POST /tickets/:id/merge', () => {
  it('moves comments with timestamps, attachments and files, time, tasks with new codes, timers, watchers, CCs, assets, relations', async () => {
    const target = await ticket({ title: 'Target', watcherIds: [tina.user.id] });
    const a1 = await asset('M-1');
    const a2 = await asset('M-2');
    const other = await ticket({ title: 'Other' });
    const source = await ticket({
      title: 'Source', contactId: bob.id, watcherIds: [tina.user.id, w.admin.user.id], assetIds: [a1.id, a2.id], relatedTicketIds: [other.id],
    });
    expectOk(await w.admin.agent.post(`${API}/tickets/${target.id}/tasks`).send({ title: 'Target task' }), 201);
    const comment = expectOk(await w.admin.agent.post(`${API}/tickets/${source.id}/comments`).send({ body: 'Hello', type: 'comment_private' }), 201).comment;
    const oldStamp = new Date('2026-01-02T03:04:05Z');
    await Comment.update({ createdAt: oldStamp }, { where: { id: comment.id }, silent: true });
    await fileFor(source.id, 'a.txt');
    expectOk(await w.admin.agent.post(`${API}/tickets/${source.id}/time`).send({ durationMinutes: 30 }), 201);
    const task = expectOk(await w.admin.agent.post(`${API}/tickets/${source.id}/tasks`).send({ title: 'Source task' }), 201).task;
    expectOk(await w.admin.agent.post(`${API}/tickets/${source.id}/tasks`).send({ title: 'Sub', parentTaskId: task.id }), 201);
    await ActiveTimer.create({ userId: tina.user.id, entityType: 'ticket', entityId: source.id });
    await TicketCc.create({ ticketId: source.id, email: 'cc@example.com' });
    await TicketCc.create({ ticketId: target.id, email: 'cc@example.com' });
    await AssetTicket.create({ assetId: a1.id, ticketId: target.id, linkedBy: w.admin.user.id });

    const body = expectOk(await merge(w.admin.agent, target.id, [source.id]));
    expect(body.ticket.id).toBe(target.id);

    const moved = await Comment.findByPk(comment.id);
    expect(moved.ticketId).toBe(target.id);
    expect(moved.createdAt.toISOString()).toBe(oldStamp.toISOString());
    expect((await Attachment.findOne({ where: { filename: 'a.txt' } })).ticketId).toBe(target.id);
    expect(exists(target.id, 'a.txt')).toBe(true);
    expect(exists(source.id, 'a.txt')).toBe(false);
    expect(await TimeEntry.count({ where: { ticketId: target.id } })).toBe(1);
    const tasks = await Task.findAll({ where: { ticketId: target.id }, order: [['id', 'ASC']] });
    const tn = String(target.id).padStart(5, '0');
    expect(tasks.map((t) => [t.title, t.code])).toEqual([
      ['Target task', `#${tn}-T01`], ['Source task', `#${tn}-T02`], ['Sub', `#${tn}-T02-S01`],
    ]);
    expect((await ActiveTimer.findOne()).entityId).toBe(target.id);
    expect((await TicketWatcher.findAll({ where: { ticketId: target.id } })).map((x) => x.userId).sort())
      .toEqual([tina.user.id, w.admin.user.id].sort());
    expect(await TicketWatcher.count({ where: { ticketId: source.id } })).toBe(0);
    expect((await TicketCc.findAll({ where: { ticketId: target.id } })).map((c) => c.email).sort()).toEqual(['bob@example.com', 'cc@example.com']);
    expect((await AssetTicket.findAll({ where: { ticketId: target.id } })).map((x) => x.assetId).sort()).toEqual([a1.id, a2.id].sort());
    const rel = await TicketRelation.findAll();
    expect(rel.map((r) => [r.ticketId, r.relatedTicketId, r.relationType])).toEqual([[target.id, other.id, 'related']]);
  });

  it('drops relations among merged tickets and duplicate links', async () => {
    const other = await ticket({ title: 'Other' });
    const target = await ticket({ title: 'Target', relatedTicketIds: [other.id] });
    const s1 = await ticket({ title: 'S1', relatedTicketIds: [target.id, other.id] });
    const s2 = await ticket({ title: 'S2', parentTicketId: s1.id });
    expectOk(await merge(w.admin.agent, target.id, [s1.id, s2.id]));
    const rel = await TicketRelation.findAll();
    expect(rel.map((r) => [r.ticketId, r.relatedTicketId])).toEqual([[target.id, other.id]]);
  });

  it('refuses across companies, already-merged sources, a merged target, and the target as its own source', async () => {
    const acme = await makeCompany(w.admin);
    const acmeContact = await makeContact(w.admin, { companyId: acme.id });
    const target = await ticket();
    const foreign = await ticket({ contactId: acmeContact.id, departmentId: null });
    const s = await ticket();
    expect((await merge(w.admin.agent, target.id, [foreign.id])).status).toBe(400);
    expect((await merge(w.admin.agent, target.id, [target.id])).status).toBe(400);
    expect((await merge(w.admin.agent, target.id, [])).status).toBe(400);
    expectOk(await merge(w.admin.agent, target.id, [s.id]));
    const again = await merge(w.admin.agent, target.id, [s.id]);
    expect(again.status).toBe(400);
    const t2 = await ticket();
    expect((await merge(w.admin.agent, s.id, [t2.id])).status).toBe(400);
    expect(await Ticket.count({ where: { mergedIntoId: target.id } })).toBe(1);
  });

  it('one uneditable source refuses the whole merge and moves nothing', async () => {
    const sam = await makeStaff('sam', w.deptA.id); // view_department + edit_own
    const target = await ticket({ assigneeId: sam.user.id });
    const ok = await ticket({ assigneeId: sam.user.id });
    const notMine = await ticket({ assigneeId: w.admin.user.id });
    await fileFor(ok.id, 'keep.txt');
    expectOk(await w.admin.agent.post(`${API}/tickets/${ok.id}/comments`).send({ body: 'x', type: 'comment_private' }), 201);
    const res = await merge(sam.agent, target.id, [ok.id, notMine.id]);
    expect(res.status).toBe(403);
    expect(await Comment.count({ where: { ticketId: ok.id } })).toBe(1);
    expect((await Attachment.findOne({ where: { filename: 'keep.txt' } })).ticketId).toBe(ok.id);
    expect(exists(ok.id, 'keep.txt')).toBe(true);
    expect(exists(target.id, 'keep.txt')).toBe(false);
    expect((await Ticket.findByPk(ok.id)).mergedIntoId).toBeNull();

    // A source the user can't see at all looks like a missing one.
    const olly = await makeOwnTier(w.admin, 'olly', w.deptA.id);
    const ollyT = await ticket({ assigneeId: olly.user.id });
    const ollyS = await ticket({ assigneeId: olly.user.id });
    const hidden = await merge(olly.agent, ollyT.id, [ollyS.id, notMine.id]);
    const missing = await merge(olly.agent, ollyT.id, [ollyS.id, 999999]);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it('sources close quietly with mergedIntoId, notes and activity; no CSAT or resolved email', async () => {
    expectOk(await w.admin.agent.put(`${API}/settings/email-templates/contact_resolved`).send({
      subject: 'Resolved', bodyHtml: '<p>Done</p>', enabled: true,
    }));
    await setSettings(w.admin, { 'timeTracking.requireBeforeClose': 'true' });
    const rule = await models.WorkflowRule.create({ name: 'On close', triggerEvent: 'ticket_closed', isActive: true });
    await models.WorkflowAction.create({ ruleId: rule.id, actionType: 'set_priority', actionValue: { priority: 'critical' } });
    const target = await ticket({ title: 'Target' });
    const s1 = await ticket({ title: 'S1' });
    const s2 = await ticket({ title: 'S2' });
    sendMail.mockReset();
    expectOk(await merge(w.admin.agent, target.id, [s1.id, s2.id]));
    await new Promise((r) => { setTimeout(r, 200); });
    for (const s of [s1, s2]) {
      // eslint-disable-next-line no-await-in-loop
      const fresh = await Ticket.findByPk(s.id);
      expect([fresh.status, fresh.mergedIntoId, fresh.priority]).toEqual(['Closed', target.id, 'medium']);
      // eslint-disable-next-line no-await-in-loop
      const notes = await Comment.findAll({ where: { ticketId: s.id } });
      expect(notes.map((c) => [c.type, c.body])).toEqual([['comment_private', `Merged into #${String(target.id).padStart(5, '0')}`]]);
      // eslint-disable-next-line no-await-in-loop
      expect(await TicketActivity.count({ where: { ticketId: s.id, action: 'merged_into' } })).toBe(1);
    }
    const n = (id) => `#${String(id).padStart(5, '0')}`;
    expect(await Comment.count({ where: { ticketId: target.id, body: `Merged ${n(s1.id)}, ${n(s2.id)} into this ticket` } })).toBe(1);
    expect(await TicketActivity.count({ where: { ticketId: target.id, action: 'merged' } })).toBe(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(await models.CsatSurvey.count()).toBe(0);
  });

  it('source description becomes a private note on the target', async () => {
    const target = await ticket();
    const s = await ticket({ title: 'Mouse', description: 'Left button sticks' });
    expectOk(await merge(w.admin.agent, target.id, [s.id]));
    const notes = await Comment.findAll({ where: { ticketId: target.id, type: 'comment_private' }, order: [['id', 'ASC']] });
    const note = notes.find((c) => c.body.startsWith('From #'));
    expect(note.body).toBe(`From #${String(s.id).padStart(5, '0')}: Mouse\n\nLeft button sticks`);
    expect(note.createdAt.toISOString()).toBe(new Date(s.createdAt).toISOString());
  });

  it('target SLA unchanged; source clocks stop', async () => {
    const target = await ticket();
    const s = await ticket();
    const before = (await models.TicketSla.findOne({ where: { ticketId: target.id } })).toJSON();
    expectOk(await merge(w.admin.agent, target.id, [s.id]));
    const after = (await models.TicketSla.findOne({ where: { ticketId: target.id } })).toJSON();
    expect(after).toEqual(before);
    const src = await models.TicketSla.findOne({ where: { ticketId: s.id } });
    expect(src.assignRunningSince).toBeNull();
    expect(src.responseRunningSince).toBeNull();
  });

  it('detail shows mergedInto; hides the target title from viewers who cannot see it', async () => {
    const olly = await makeOwnTier(w.admin, 'olly', w.deptA.id);
    const target = await ticket({ title: 'Secret target' });
    const s = await ticket({ assigneeId: olly.user.id });
    expectOk(await merge(w.admin.agent, target.id, [s.id]));
    expect(expectOk(await w.admin.agent.get(`${API}/tickets/${s.id}`)).ticket.mergedInto)
      .toEqual({ id: target.id, title: 'Secret target' });
    expect(expectOk(await olly.agent.get(`${API}/tickets/${s.id}`)).ticket.mergedInto).toEqual({ id: target.id });
    expect(expectOk(await w.admin.agent.get(`${API}/tickets/${target.id}`)).ticket.mergedInto).toBeNull();
  });

  it('bulk merge is all-or-nothing with one result per id', async () => {
    const sam = await makeStaff('sam', w.deptA.id);
    const target = await ticket({ assigneeId: sam.user.id });
    const a = await ticket({ assigneeId: sam.user.id });
    const b = await ticket({ assigneeId: w.admin.user.id });
    const refused = expectOk(await sam.agent.post(`${API}/tickets/bulk`).send({ ids: [a.id, b.id], action: 'merge', value: target.id }));
    expect(refused.results.map((r) => r.ok)).toEqual([false, false]);
    expect(refused.results[0].error).toBe(refused.results[1].error);
    expect((await Ticket.findByPk(a.id)).mergedIntoId).toBeNull();
    const done = expectOk(await w.admin.agent.post(`${API}/tickets/bulk`).send({ ids: [a.id, b.id], action: 'merge', value: target.id }));
    expect(done.results).toEqual([{ id: a.id, ok: true }, { id: b.id, ok: true }]);
    expect(await Ticket.count({ where: { mergedIntoId: target.id } })).toBe(2);
  });
});
