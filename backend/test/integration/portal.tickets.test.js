const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  makeWorld, makeContact, makeCompany, makeTicket, makeTech, expectOk,
} = require('./fixtures');
const { startFakeClamd } = require('../helpers/fakeClamd');
const { _resetThrottleForTest } = require('../../src/services/virusScan');
const { UPLOAD_ROOT } = require('../../src/middleware/upload');
const { getSystemActorUserId } = require('../../src/services/inboundEmailService');

// Sub-project 7a, task 4: raise, list, read and reply to tickets in the portal.

const API = '/api/v1';
const P = `${API}/portal`;
const PASSWORD = 'Harbour-Lights-2026';
const TXT = Buffer.from('hello');

let w; let alpha; let beta; let billing; let reception;
let plain; let deptAdmin; let receptionist; let outsider;
let hash;

async function portalAs(contact) {
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: contact.id } });
  const agent = request.agent(getApp());
  expectOk(await agent.post(`${P}/auth/login`).send({ email: contact.email, password: PASSWORD }));
  return agent;
}
const listFiles = (dir = UPLOAD_ROOT) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
};
const statusBySystemKey = async (key) => (await models.TicketStatus.findOne({ where: { systemKey: key } })).name;

beforeAll(async () => { hash = await bcrypt.hash(PASSWORD, 4); });
beforeEach(async () => {
  await resetData();
  _resetThrottleForTest();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  beta = await makeCompany(w.admin, { name: 'Beta' });
  billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  reception = expectOk(await a.post(`${API}/departments`).send({ name: 'Reception', companyId: alpha.id }), 201).department;
  plain = await makeContact(w.admin, { firstName: 'Pat', lastName: 'Plain', companyId: alpha.id, departmentId: billing.id });
  deptAdmin = await makeContact(w.admin, { firstName: 'Dana', lastName: 'Admin', companyId: alpha.id, departmentId: billing.id });
  receptionist = await makeContact(w.admin, { firstName: 'Rita', lastName: 'Desk', companyId: alpha.id, departmentId: reception.id });
  outsider = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id });
  await models.DepartmentPortalAdmin.create({ departmentId: billing.id, contactId: deptAdmin.id });
});
// The scanner is on unless CLAMAV_ENABLED is 'false' (as .env.test sets it),
// so restore the values rather than deleting them.
const SCAN_ENV = ['CLAMAV_ENABLED', 'CLAMAV_HOST', 'CLAMAV_PORT'];
const savedEnv = Object.fromEntries(SCAN_ENV.map((k) => [k, process.env[k]]));
afterEach(async () => {
  SCAN_ENV.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
});
afterAll(closeDb);

describe('raising a ticket', () => {
  it('needs a title and a description; the title is at most 255 characters', async () => {
    const me = await portalAs(plain);
    expect((await me.post(`${P}/tickets`).send({ description: 'x' })).status).toBe(400);
    expect((await me.post(`${P}/tickets`).send({ title: 'x' })).status).toBe(400);
    expect((await me.post(`${P}/tickets`).send({ title: 'x', description: '   ' })).status).toBe(400);
    expect((await me.post(`${P}/tickets`).send({ title: 'x'.repeat(256), description: 'd' })).status).toBe(400);
    expect((await me.post(`${P}/tickets`).send({ title: 'x', description: 'd', priority: 'urgent!' })).status).toBe(400);
  });

  it('creates a portal ticket for me, in my department, through the normal create path', async () => {
    const cat = expectOk(await w.admin.agent.post(`${API}/ticket-categories`).send({ name: 'Printers' }), 201).category;
    const me = await portalAs(plain);
    const res = await me.post(`${P}/tickets`).send({
      title: 'Printer jam', description: 'Tray 2 jams', priority: 'high', categoryId: cat.id,
      // Fields a contact may not set are ignored.
      assigneeId: w.admin.user.id, status: 'Closed', source: 'email', departmentId: reception.id,
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.ticket)).toEqual(['id']);
    const t = await models.Ticket.findByPk(res.body.ticket.id);
    expect(t).toMatchObject({
      source: 'portal', contactId: plain.id, departmentId: billing.id, companyId: alpha.id, priority: 'high',
      categoryId: cat.id, portalCreatedByContactId: null, assigneeId: null, createdBy: await getSystemActorUserId(),
    });
    expect(t.status).not.toBe('Closed');
    // Minimal: category and priority are optional.
    expect((await me.post(`${P}/tickets`).send({ title: 'Mouse', description: 'Broken' })).status).toBe(201);
  });

  it('"For": plain contacts can\'t; a department admin can for their department only', async () => {
    const pat = await portalAs(plain);
    expect((await pat.post(`${P}/tickets`).send({ title: 't', description: 'd', forContactId: receptionist.id })).status).toBe(403);
    expect((await pat.post(`${P}/tickets`).send({ title: 't', description: 'd', forContactId: plain.id })).status).toBe(201);

    const dana = await portalAs(deptAdmin);
    const ok = expectOk(await dana.post(`${P}/tickets`).send({ title: 'For Pat', description: 'd', forContactId: plain.id }), 201);
    expect(await models.Ticket.findByPk(ok.ticket.id)).toMatchObject({ contactId: plain.id, portalCreatedByContactId: deptAdmin.id });
    expect((await dana.post(`${P}/tickets`).send({ title: 't', description: 'd', forContactId: receptionist.id })).status).toBe(404);
    expect((await dana.post(`${P}/tickets`).send({ title: 't', description: 'd', forContactId: outsider.id })).status).toBe(404);
    expect((await dana.post(`${P}/tickets`).send({ title: 't', description: 'd', forContactId: '12abc' })).status).toBe(404);

    const meta = expectOk(await dana.get(`${P}/meta`));
    expect(meta.priorities).toEqual(['low', 'medium', 'high', 'critical']);
    expect(meta.forContacts.map((c) => c.id).sort()).toEqual([plain.id, deptAdmin.id].sort());
    expect(Object.keys(meta.forContacts[0]).sort()).toEqual(['displayName', 'id']);
  });
});

describe('reading tickets', () => {
  let mine; let raised; let theirs; let foreign;
  beforeEach(async () => {
    mine = await makeTicket(w.admin.agent, { title: 'Pat laptop', contactId: plain.id });
    theirs = await makeTicket(w.admin.agent, { title: 'Rita phone', contactId: receptionist.id });
    raised = await makeTicket(w.admin.agent, { title: 'Pat raised for Rita', contactId: receptionist.id });
    await models.Ticket.update({ portalCreatedByContactId: plain.id }, { where: { id: raised.id } });
    foreign = await makeTicket(w.admin.agent, { title: 'Beta thing', contactId: outsider.id });
  });

  it('lists my tickets with the status filter and search', async () => {
    const me = await portalAs(plain);
    const ids = async (qs = '') => expectOk(await me.get(`${P}/tickets${qs}`)).tickets.map((t) => t.id).sort();
    expect(await ids()).toEqual([mine.id, raised.id].sort());
    expectOk(await w.admin.agent.patch(`${API}/tickets/${mine.id}`).send({ status: 'Closed' }));
    expect(await ids('?status=open')).toEqual([raised.id]);
    expect(await ids('?status=closed')).toEqual([mine.id]);
    expect(await ids(`?q=${String(mine.id).padStart(5, '0')}`)).toEqual([mine.id]);
    expect(await ids(`?q=%23${mine.id}`)).toEqual([mine.id]);
    expect(await ids('?q=raised')).toEqual([raised.id]);
    expect(await ids('?q=%25')).toEqual([]);
    expect(await ids('?scope=company')).toEqual([]);
    const body = expectOk(await me.get(`${P}/tickets`));
    expect(body.total).toBe(2);
    expect(Object.keys(body.tickets[0]).sort()).toEqual(['contact', 'id', 'status', 'statusBehavior', 'title', 'updatedAt']);
    expect(Object.keys(body.tickets[0].contact).sort()).toEqual(['displayName', 'id']);
  });

  it('a ticket shows only customer-visible comments, with exactly the allowed keys', async () => {
    const staffAgent = w.admin.agent;
    expectOk(await staffAgent.post(`${API}/tickets/${mine.id}/comments`).send({ body: 'Secret note', type: 'comment_private' }), 201);
    expectOk(await staffAgent.post(`${API}/tickets/${mine.id}/comments`).send({ body: 'We are on it', type: 'comment_public' }), 201);
    const me = await portalAs(plain);
    const body = expectOk(await me.get(`${P}/tickets/${mine.id}`));
    expect(Object.keys(body).sort()).toEqual(['attachments', 'comments', 'ticket']);
    expect(Object.keys(body.ticket).sort()).toEqual(
      ['category', 'contact', 'createdAt', 'description', 'handledBy', 'id', 'priority', 'status', 'statusBehavior', 'title', 'updatedAt'].sort()
    );
    expect(body.comments.map((c) => c.body)).toEqual(['We are on it']);
    expect(Object.keys(body.comments[0]).sort()).toEqual(['attachments', 'author', 'body', 'createdAt', 'id']);
    expect(body.comments[0].author).toEqual({ displayName: expect.any(String), side: 'support' });
    expect(JSON.stringify(body)).not.toContain('Secret note');

    for (const id of [foreign.id, theirs.id, `${mine.id}abc`, 999999]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await me.get(`${P}/tickets/${id}`)).status).toBe(404);
    }
  });

  it('a contact session is required', async () => {
    expect((await request(getApp()).get(`${P}/tickets`)).status).toBe(401);
    expect((await w.admin.agent.get(`${P}/tickets/${mine.id}`)).status).toBe(401);
  });
});

describe('replying', () => {
  it('stores a customer reply by me and moves an open ticket to User responded', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Pat laptop', contactId: plain.id });
    const me = await portalAs(plain);
    const html = '<b>bold</b><script>alert(1)</script>';
    expect((await me.post(`${P}/tickets/${t.id}/replies`).send({ body: '  ' })).status).toBe(400);
    const res = await me.post(`${P}/tickets/${t.id}/replies`).send({ body: html, type: 'comment_private' });
    expect(res.status).toBe(201);
    const comment = await models.Comment.findByPk(res.body.comment.id);
    expect(comment).toMatchObject({
      type: 'reply', authorContactId: plain.id, authorId: await getSystemActorUserId(), ticketId: t.id,
    });
    expect((await models.Ticket.findByPk(t.id)).status).toBe(await statusBySystemKey('user_responded'));
    const detail = expectOk(await me.get(`${P}/tickets/${t.id}`));
    const last = detail.comments[detail.comments.length - 1];
    expect(last.body).toBe(html);
    expect(last.author).toEqual({ displayName: 'Pat Plain', side: 'you' });
  });

  it('a reply on a closed ticket leaves it closed and tells the assignee', async () => {
    const tech = await makeTech('tina', w.deptA.id);
    const t = await makeTicket(w.admin.agent, { title: 'Done', contactId: plain.id });
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ assigneeId: tech.user.id, status: 'Closed' }));
    await models.Notification.destroy({ where: {} });
    const me = await portalAs(plain);
    expectOk(await me.post(`${P}/tickets/${t.id}/replies`).send({ body: 'Still broken' }), 201);
    expect((await models.Ticket.findByPk(t.id)).status).toBe('Closed');
    const n = await models.Notification.findOne({ where: { userId: tech.user.id } });
    expect(n.message).toMatch(/Customer replied to closed ticket/);
  });

  it('an admin replying on someone else\'s ticket shows as themselves; no reply outside scope', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Pat laptop', contactId: plain.id });
    const other = await makeTicket(w.admin.agent, { title: 'Rita phone', contactId: receptionist.id });
    const dana = await portalAs(deptAdmin);
    const res = expectOk(await dana.post(`${P}/tickets/${t.id}/replies`).send({ body: 'Chasing this' }), 201);
    expect((await models.Comment.findByPk(res.comment.id)).authorContactId).toBe(deptAdmin.id);
    const pat = await portalAs(plain);
    const seen = expectOk(await pat.get(`${P}/tickets/${t.id}`)).comments.find((c) => c.id === res.comment.id);
    expect(seen.author).toEqual({ displayName: 'Dana Admin', side: 'contact' });
    expect((await dana.post(`${P}/tickets/${other.id}/replies`).send({ body: 'x' })).status).toBe(404);
  });
});

describe('attachments', () => {
  let fake;
  afterEach(async () => { if (fake) await fake.close(); fake = null; });
  const scannerOn = async (opts) => {
    fake = await startFakeClamd(opts);
    process.env.CLAMAV_ENABLED = 'true';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(fake.port);
  };

  it('uploads to a visible ticket and its own reply; downloads only customer-visible files', async () => {
    fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
    const t = await makeTicket(w.admin.agent, { title: 'Pat laptop', contactId: plain.id });
    const me = await portalAs(plain);
    const up = await me.post(`${P}/tickets/${t.id}/attachments`).attach('file', TXT, { filename: 'notes.txt' });
    expect([up.status, up.body.code]).toEqual([201, undefined]);
    const reply = expectOk(await me.post(`${P}/tickets/${t.id}/replies`).send({ body: 'see file' }), 201);
    const onReply = expectOk(await me.post(`${P}/tickets/${t.id}/attachments`).field('commentId', String(reply.comment.id))
      .attach('file', TXT, { filename: 'reply.txt' }), 201);
    expect((await models.Attachment.findByPk(onReply.attachment.id)).commentId).toBe(reply.comment.id);

    // A private staff comment's file is never served.
    const priv = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'internal', type: 'comment_private' }), 201);
    const privId = priv.comment.id;
    fs.writeFileSync(path.join(UPLOAD_ROOT, String(t.id), 'priv.txt'), 'secret');
    const privFile = await models.Attachment.create({
      filename: 'priv.txt', originalName: 'priv.txt', size: 6, ticketId: t.id, commentId: privId, uploadedById: w.admin.user.id,
    });
    // Nor can my upload hang off someone else's (private) comment.
    expect((await me.post(`${P}/tickets/${t.id}/attachments`).field('commentId', String(privId))
      .attach('file', TXT, { filename: 'x.txt' })).status).toBe(400);

    const detail = expectOk(await me.get(`${P}/tickets/${t.id}`));
    expect(detail.attachments.map((a) => a.originalName)).toEqual(['notes.txt']);
    expect(detail.comments.find((c) => c.id === reply.comment.id).attachments.map((a) => a.originalName)).toEqual(['reply.txt']);
    expect(JSON.stringify(detail)).not.toContain('priv.txt');
    expect(Object.keys(detail.attachments[0]).sort()).toEqual(['createdAt', 'id', 'originalName', 'size']);

    const dl = await me.get(`${P}/tickets/${t.id}/attachments/${up.body.attachment.id}/download`);
    expect([dl.status, dl.text ?? dl.body.toString()]).toEqual([200, 'hello']);
    expect((await me.get(`${P}/tickets/${t.id}/attachments/${privFile.id}/download`)).status).toBe(404);

    // Another ticket's file through my ticket id: no.
    const other = await makeTicket(w.admin.agent, { title: 'Rita', contactId: receptionist.id });
    const otherUp = expectOk(await w.admin.agent.post(`${API}/tickets/${other.id}/attachments`).attach('file', TXT, { filename: 'o.txt' }), 201);
    expect((await me.get(`${P}/tickets/${t.id}/attachments/${otherUp.attachment.id}/download`)).status).toBe(404);
    expect((await me.get(`${P}/tickets/${other.id}/attachments/${otherUp.attachment.id}/download`)).status).toBe(404);
  });

  it('nothing reaches disk for a ticket out of scope', async () => {
    fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
    const foreign = await makeTicket(w.admin.agent, { title: 'Beta', contactId: outsider.id });
    const me = await portalAs(plain);
    const res = await me.post(`${P}/tickets/${foreign.id}/attachments`).attach('file', TXT, { filename: 'n.txt' });
    expect(res.status).toBe(404);
    expect(listFiles()).toEqual([]);
  });

  it('virus scanning and the size limit apply as on staff uploads', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Pat laptop', contactId: plain.id });
    const me = await portalAs(plain);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await scannerOn({ mode: 'found', signature: 'Win.Test.EICAR_HDB-1' });
    const infected = await me.post(`${P}/tickets/${t.id}/attachments`).attach('file', TXT, { filename: 'v.txt' });
    expect([infected.status, infected.body.code]).toEqual([422, 'VIRUS_FOUND']);
    expect(await models.Attachment.count({ where: { ticketId: t.id } })).toBe(0);
    await fake.close(); fake = null;
    process.env.CLAMAV_ENABLED = 'false';

    await models.SystemSettings.upsert({ key: 'system.maxAttachmentSizeMB', value: '1' });
    try {
      const big = await me.post(`${P}/tickets/${t.id}/attachments`).attach('file', Buffer.alloc(1024 * 1024 + 10, 'a'), { filename: 'big.txt' });
      expect([big.status, big.body.code]).toEqual([400, 'FILE_TOO_LARGE']);
    } finally {
      await models.SystemSettings.destroy({ where: { key: 'system.maxAttachmentSizeMB' } });
    }
  });
});
