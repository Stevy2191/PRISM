jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const fs = require('fs');
const path = require('path');
const { resetData, closeDb, models } = require('./helpers');
const { UPLOAD_ROOT } = require('../../src/middleware/upload');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket, makeTeam,
} = require('./fixtures');

// Service desk 5b task 7: split one comment off into a new linked ticket.

const { Ticket, Comment, Attachment, TicketCc, TicketRelation } = models;

let w;
let tina;
beforeEach(async () => {
  await resetData();
  await fs.promises.rm(UPLOAD_ROOT, { recursive: true, force: true });
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

const split = (agent, ticketId, commentId) => agent.post(`${API}/tickets/${ticketId}/split`).send({ commentId });
const comment = async (ticketId, body) => expectOk(
  await w.admin.agent.post(`${API}/tickets/${ticketId}/comments`).send({ body, type: 'comment_private' }), 201
).comment;
async function fileFor(ticketId, name, commentId = null) {
  const dir = path.join(UPLOAD_ROOT, String(ticketId));
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, name), name);
  return Attachment.create({ filename: name, originalName: name, size: 1, ticketId, commentId, uploadedById: w.admin.user.id });
}

it('creates a linked ticket with the original contact, company, department, team, priority, type, source and CCs; unassigned with an SLA', async () => {
  const desk = await makeTeam(w.admin, 'Desk', []);
  const original = await makeTicket(w.admin.agent, {
    title: 'Laptop', contactId: w.contact.id, departmentId: w.deptA.id, teamId: desk.id,
    priority: 'high', type: 'incident', source: 'phone', assigneeId: tina.user.id,
  });
  await TicketCc.create({ ticketId: original.id, email: 'cc@example.com' });
  const c = await comment(original.id, 'Also my mouse is broken\nand more text');
  const created = expectOk(await split(w.admin.agent, original.id, c.id), 201).ticket;
  expect(created).toEqual(expect.objectContaining({
    title: `Split from #${String(original.id).padStart(5, '0')}: Also my mouse is broken`,
    contactId: w.contact.id, companyId: original.companyId, departmentId: w.deptA.id, teamId: desk.id,
    priority: 'high', type: 'incident', source: 'phone', assigneeId: null,
  }));
  expect(await models.TicketSla.count({ where: { ticketId: created.id } })).toBe(1);
  expect((await TicketCc.findAll({ where: { ticketId: created.id } })).map((x) => x.email)).toEqual(['cc@example.com']);
  const rel = await TicketRelation.findAll();
  expect(rel.map((r) => [r.ticketId, r.relatedTicketId, r.relationType])).toEqual([[created.id, original.id, 'related']]);
  const acts = await models.TicketActivity.findAll({ where: { action: ['split_to', 'split_from'] } });
  expect(acts.map((a) => [a.ticketId, a.action]).sort()).toEqual([[original.id, 'split_to'], [created.id, 'split_from']].sort());
});

it('moves the comment and only its own attachments (with files)', async () => {
  const original = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  const c = await comment(original.id, 'Split me');
  const stamp = new Date('2026-02-03T04:05:06Z');
  await Comment.update({ createdAt: stamp }, { where: { id: c.id }, silent: true });
  const keep = await comment(original.id, 'Stay');
  await fileFor(original.id, 'mine.txt', c.id);
  await fileFor(original.id, 'other.txt', keep.id);
  await fileFor(original.id, 'plain.txt');
  const created = expectOk(await split(w.admin.agent, original.id, c.id), 201).ticket;
  const moved = await Comment.findByPk(c.id);
  expect(moved.ticketId).toBe(created.id);
  expect(moved.createdAt.toISOString()).toBe(stamp.toISOString());
  expect((await Comment.findByPk(keep.id)).ticketId).toBe(original.id);
  const byName = Object.fromEntries((await Attachment.findAll()).map((a) => [a.filename, a.ticketId]));
  expect(byName).toEqual({ 'mine.txt': created.id, 'other.txt': original.id, 'plain.txt': original.id });
  expect(fs.existsSync(path.join(UPLOAD_ROOT, String(created.id), 'mine.txt'))).toBe(true);
  expect(fs.existsSync(path.join(UPLOAD_ROOT, String(original.id), 'mine.txt'))).toBe(false);
});

it('refuses a comment from another ticket the same way as a missing one', async () => {
  const a = await makeTicket(w.admin.agent, { title: 'A', contactId: w.contact.id, departmentId: w.deptA.id });
  const b = await makeTicket(w.admin.agent, { title: 'B', contactId: w.contact.id, departmentId: w.deptA.id });
  const onB = await comment(b.id, 'b');
  const foreign = await split(w.admin.agent, a.id, onB.id);
  const missing = await split(w.admin.agent, a.id, 999999);
  expect(foreign.status).toBe(404);
  expect(foreign.body).toEqual(missing.body);
  expect(await Ticket.count()).toBe(2);
});

it('refuses without edit rights', async () => {
  const sam = await makeStaff('sam', w.deptA.id); // can view the department's tickets, edit only own
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  const c = await comment(t.id, 'x');
  expect((await split(sam.agent, t.id, c.id)).status).toBe(403);
  expect(await Ticket.count()).toBe(1);
});
