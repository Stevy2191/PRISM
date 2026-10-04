// Outbound email is recorded, not sent: ticketsController destructures
// sendMail when it loads, so spying after load would do nothing.
jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeContact, makeTicket,
  freezeClock, advanceClock, unfreezeClock, waitFor,
} = require('./fixtures');

// Baseline for ticket comments and attachments.

let w;
let tech;
let ticket;
beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id,
  });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const commentsUrl = (t = ticket) => `${API}/tickets/${t.id}/comments`;
const attachUrl = (t = ticket) => `${API}/tickets/${t.id}/attachments`;
const post = async (agent, body, t) => expectOk(await agent.post(commentsUrl(t)).send(body), 201).comment;
const upload = async (agent, name = 'notes.txt', content = 'hello', t = ticket) => expectOk(
  await agent.post(attachUrl(t)).attach('file', Buffer.from(content), name), 201
).attachment;
const settle = () => new Promise((r) => { setTimeout(r, 200); }); // give a stray send time to happen
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

describe('comments', () => {
  it('posts a reply by default, trimmed', async () => {
    const c = await post(tech.agent, { body: '  On my way  ' });
    expect(c).toEqual(expect.objectContaining({ body: 'On my way', type: 'reply', authorId: tech.user.id }));
    expect(c.author.displayName).toBe('Test tech');
  });

  it('rejects an empty or whitespace body', async () => {
    for (const body of [{}, { body: '   ' }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(commentsUrl()).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'Comment body is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('lets a holder of view_private_comments post internal notes', async () => {
    expect((await post(tech.agent, { body: 'x', type: 'comment_private' })).type).toBe('comment_private');
  });

  it('refuses internal or public-note types to users without view_private_comments', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    for (const type of ['comment_private', 'comment_public']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await staff.agent.post(commentsUrl()).send({ body: 'x', type });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have permission to post internal comments');
    }
  });

  it('rejects an unknown type', async () => {
    const res = await tech.agent.post(commentsUrl()).send({ body: 'x', type: 'shout' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'Invalid comment type', code: 'VALIDATION_ERROR' });
  });

  it('hides internal comments from users who can\'t view them', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await post(tech.agent, { body: 'public' });
    await post(tech.agent, { body: 'secret', type: 'comment_private' });
    expect(expectOk(await staff.agent.get(commentsUrl())).comments.map((c) => c.body)).toEqual(['public']);
    expect(expectOk(await tech.agent.get(commentsUrl())).comments).toHaveLength(2);
  });

  it('pages newest-first but returns each page oldest-first', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    for (const body of ['c1', 'c2', 'c3']) {
      // eslint-disable-next-line no-await-in-loop
      await post(tech.agent, { body });
      advanceClock(1000);
    }
    const page1 = expectOk(await tech.agent.get(`${commentsUrl()}?limit=2`));
    expect(page1.comments.map((c) => c.body)).toEqual(['c2', 'c3']);
    expect(page1).toEqual(expect.objectContaining({ total: 3, totalPages: 2 }));
    const page2 = expectOk(await tech.agent.get(`${commentsUrl()}?limit=2&page=2`));
    expect(page2.comments.map((c) => c.body)).toEqual(['c1']);
  });

  it('authors edit their own comment', async () => {
    const c = await post(tech.agent, { body: 'first' });
    const res = expectOk(await tech.agent.patch(`${commentsUrl()}/${c.id}`).send({ body: ' edited ' }));
    expect(res.comment.body).toBe('edited');
  });

  it('edit refuses an empty body', async () => {
    const c = await post(tech.agent, { body: 'first' });
    const res = await tech.agent.patch(`${commentsUrl()}/${c.id}`).send({ body: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Comment body is required');
  });

  it('edit_own users cannot edit others\' comments', async () => {
    const mgr2 = await makeManager('mgr2', w.deptA.id);
    const c = await post(mgr2.agent, { body: 'theirs' });
    const res = await tech.agent.patch(`${commentsUrl()}/${c.id}`).send({ body: 'mine now' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You can only edit your own comments', code: 'FORBIDDEN' });
  });

  it('department editors moderate comments in their department', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const c = await post(tech.agent, { body: 'tech wrote this' });
    expect((await mgr.agent.patch(`${commentsUrl()}/${c.id}`).send({ body: 'moderated' })).status).toBe(200);
    expect((await mgr.agent.delete(`${commentsUrl()}/${c.id}`)).status).toBe(200);
  });

  it('edit_own users cannot delete others\' comments', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const c = await post(mgr.agent, { body: 'theirs' });
    const res = await tech.agent.delete(`${commentsUrl()}/${c.id}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You can only delete your own comments');
  });

  it('a comment id from another ticket is not found through this one', async () => {
    const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const c = await post(w.admin.agent, { body: 'elsewhere' }, t2);
    for (const res of [
      await w.admin.agent.patch(`${commentsUrl()}/${c.id}`).send({ body: 'x' }),
      await w.admin.agent.delete(`${commentsUrl()}/${c.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Comment not found', code: 'NOT_FOUND' });
    }
  });

  it('logs a comment activity entry', async () => {
    await post(tech.agent, { body: 'hi' });
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
    expect(activity.map((a) => [a.action, a.fromValue, a.toValue])).toContainEqual(['comment', null, null]);
  });
});

describe('reply email to the contact', () => {
  it('emails a reply to the ticket\'s contact', async () => {
    expectOk(await tech.agent.post(commentsUrl()).send({ body: 'On my way' }), 201);
    await waitFor(() => sendMail.mock.calls.length === 1);
    expect(sendMail).toHaveBeenCalledWith({
      to: w.contact.email,
      subject: 'Re: [Ticket #00001] Printer offline',
      text: 'On my way\n\n--\nReply to this email to respond to your ticket.',
      headers: { 'X-PRISM-Ticket-ID': '00001' },
      messageId: expect.any(String),
    });
  });

  it('emails a public note the same way', async () => {
    await post(tech.agent, { body: 'note', type: 'comment_public' });
    await waitFor(() => sendMail.mock.calls.length === 1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an internal comment', async () => {
    await post(tech.agent, { body: 'note', type: 'comment_private' });
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends nothing when the contact has no email', async () => {
    const quiet = await makeContact(w.admin, { firstName: 'Quiet', email: null });
    const t = await makeTicket(w.admin.agent, { title: 'No email', contactId: quiet.id });
    await post(w.admin.agent, { body: 'hello' }, t);
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  it('uploads an attachment', async () => {
    const a = await upload(tech.agent);
    expect(a).toEqual(expect.objectContaining({
      originalName: 'notes.txt', size: 5, mimeType: 'text/plain', uploadedById: tech.user.id,
    }));
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
    expect(activity.map((x) => [x.action, x.fromValue, x.toValue])).toContainEqual(['attachment_added', null, 'notes.txt']);
  });

  it('lists attachments newest first', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    await upload(tech.agent, 'a.txt');
    advanceClock(1000);
    await upload(tech.agent, 'b.txt');
    const body = expectOk(await tech.agent.get(attachUrl()));
    expect(body.attachments.map((a) => a.originalName)).toEqual(['b.txt', 'a.txt']);
    expect(body.total).toBe(2);
  });

  it('downloads the stored bytes', async () => {
    const a = await upload(tech.agent);
    const res = await tech.agent.get(`${attachUrl()}/${a.id}/download`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');
    expect(res.headers['content-disposition']).toContain('notes.txt');
  });

  it('rejects an executable disguised as a PDF', async () => {
    const res = await tech.agent.post(attachUrl()).attach('file', EXE, 'report.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_CONTENT');
    expect(expectOk(await tech.agent.get(attachUrl())).attachments).toEqual([]);
  });

  it('rejects a request with no file', async () => {
    const res = await tech.agent.post(attachUrl());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_FILE');
  });

  it('uploaders delete their own; edit_own users can\'t delete others\'; department editors can', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const own = await upload(tech.agent, 'own.txt');
    expect((await tech.agent.delete(`${attachUrl()}/${own.id}`)).status).toBe(200);
    const mgrs = await upload(mgr.agent, 'mgr.txt');
    const refused = await tech.agent.delete(`${attachUrl()}/${mgrs.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('You can only remove your own attachments');
    const techs = await upload(tech.agent, 'tech.txt');
    expect((await mgr.agent.delete(`${attachUrl()}/${techs.id}`)).status).toBe(200);
  });

  it('an attachment from another ticket is not found through this one', async () => {
    const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const a = await upload(w.admin.agent, 'notes.txt', 'hello', t2);
    for (const res of [
      await w.admin.agent.get(`${attachUrl()}/${a.id}/download`),
      await w.admin.agent.delete(`${attachUrl()}/${a.id}`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Attachment not found', code: 'NOT_FOUND' });
    }
  });

  it('own-tier users can\'t list or upload on others\' tickets', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    for (const res of [
      await own.agent.get(attachUrl()),
      await own.agent.post(attachUrl()).attach('file', Buffer.from('x'), 'x.txt'),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have access to this ticket');
    }
  });
});
