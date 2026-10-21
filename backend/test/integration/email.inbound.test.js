// Outbound email (the auto-reply) is recorded, not sent.
jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const { resetData, closeDb, models } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  makeWorld, makeTech, makeTicket, makeContact, waitFor,
} = require('./fixtures');
const { handleParsedMessage } = require('../../src/services/inboundEmailService');
const { startFakeClamd } = require('../helpers/fakeClamd');
const { _resetThrottleForTest } = require('../../src/services/virusScan');

// Inbound mail, fed in as parsed RFC822 messages (test/fixtures/mail).

// The generic fixtures are stamped by mx.prism.example, the trusted server.
const CONFIG = { address: 'help@prism.example', trustedAuthServId: 'mx.prism.example' };
const { Comment, Ticket, EmailProcessingLog } = models;

async function mail(name, vars = {}) {
  let raw = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mail', `${name}.eml`), 'utf8');
  for (const [k, v] of Object.entries(vars)) raw = raw.split(`%${k}%`).join(String(v));
  return simpleParser(raw);
}
const handle = async (name, vars) => handleParsedMessage(await mail(name, vars), CONFIG);
const num = (id) => String(id).padStart(5, '0');

let w;
let tech;
let ann;
let ticket;
beforeEach(async () => {
  await resetData();
  sendMail.mockReset();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
  ann = await makeContact(w.admin, { firstName: 'Ann', lastName: 'Smith', email: 'ann@acme.com', departmentId: w.deptA.id });
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: ann.id, departmentId: w.deptA.id, assigneeId: tech.user.id,
  });
});
afterAll(closeDb);

describe('today\'s behaviour', () => {
  it('contact reply appends', async () => {
    const out = await handle('contact-reply', { TICKET: num(ticket.id) });
    expect(out).toEqual({ action: 'reply_added', ticketId: ticket.id });
    const comments = await Comment.findAll({ where: { ticketId: ticket.id } });
    expect(comments.map((c) => [c.type, c.body.trim(), c.viaEmail])).toEqual([['reply', 'It is still offline.', false]]);
    expect(await Ticket.count()).toBe(1);
    const log = await EmailProcessingLog.findOne();
    expect([log.action, log.ticketId, log.fromEmail]).toEqual(['reply_added', ticket.id, 'ann@acme.com']);
  });

  it('stranger with a guessed number gets a new ticket', async () => {
    const out = await handle('stranger-guess', { TICKET: num(ticket.id) });
    expect(out.action).toBe('ticket_created');
    expect(out.ticketId).not.toBe(ticket.id);
    expect(await Comment.count({ where: { ticketId: ticket.id } })).toBe(0);
    const created = await Ticket.findByPk(out.ticketId, { include: [{ model: models.Contact, as: 'contact' }] });
    expect([created.source, created.contact.email]).toEqual(['email', 'mallory@evil.example']);
    // The new sender gets the auto-reply, after the message is handled.
    await waitFor(() => sendMail.mock.calls.length === 1);
    expect(sendMail.mock.calls.map(([m]) => m.to)).toEqual([['mallory@evil.example']]);
  });

  it('own-mailbox loop is ignored', async () => {
    const out = await handle('own-loop', { TICKET: num(ticket.id) });
    expect(out).toEqual({ action: 'ignored', ticketId: null });
    expect(await Comment.count()).toBe(0);
    expect(await Ticket.count()).toBe(1);
    expect((await EmailProcessingLog.findOne()).error).toMatch(/inbox itself/);
  });
});

describe('sender check settings', () => {
  const URL = '/api/v1/settings/inbound-email';
  it('default strict; owners set off and a trusted server id; bad values are 400', async () => {
    const before = (await w.admin.agent.get(URL)).body;
    expect([before.staffSenderCheck, before.trustedAuthServId]).toEqual(['strict', '']);
    expect((await w.admin.agent.patch(URL).send({ staffSenderCheck: 'off', trustedAuthServId: ' MX.Receiver.example ' })).status).toBe(200);
    const after = (await w.admin.agent.get(URL)).body;
    expect([after.staffSenderCheck, after.trustedAuthServId]).toEqual(['off', 'mx.receiver.example']);
    expect((await w.admin.agent.patch(URL).send({ staffSenderCheck: 'loose' })).status).toBe(400);
    expect((await w.admin.agent.patch(URL).send({ trustedAuthServId: 'bad id; dmarc=pass' })).status).toBe(400);
    expect((await tech.agent.patch(URL).send({ staffSenderCheck: 'off' })).status).toBe(403);
  });
});

describe('staff mail and CC\'d senders', () => {
  const settle = () => new Promise((r) => { setTimeout(r, 200); });
  const generic = (vars) => handle('generic', {
    DMARC: 'pass', CC: 'help@prism.example', ID: Math.random().toString(36).slice(2), ...vars,
  });
  let admin;
  beforeEach(async () => {
    admin = await models.User.findOne({ where: { username: 'admin' } });
    await models.User.update({ email: 'tina@acme.com' }, { where: { id: tech.user.id } });
    await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
  });

  it('a CC-listed address replying is appended', async () => {
    await models.TicketCc.create({ ticketId: ticket.id, email: 'boss@acme.com' });
    const out = await generic({
      FROM: 'Boss <Boss@acme.com>', TO: 'help@prism.example', CC: '', SUBJECT: `Re: [Ticket #${num(ticket.id)}] Printer offline`,
    });
    expect(out).toEqual({ action: 'reply_added', ticketId: ticket.id });
    const [c] = await Comment.findAll({ where: { ticketId: ticket.id } });
    expect([c.type, c.authorId]).toEqual(['reply', admin.id]);
  });

  it('a verified tech CCing the helpdesk with #N adds a via-email reply and sends nothing', async () => {
    const out = await generic({ FROM: 'Tina <TINA@acme.com>', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}] printer` });
    expect(out).toEqual({ action: 'staff_reply_added', ticketId: ticket.id });
    const [c] = await Comment.findAll({ where: { ticketId: ticket.id } });
    expect([c.type, c.authorId, c.viaEmail, c.body.trim()]).toEqual(['comment_public', tech.user.id, true, 'Ran the update; it should be fixed now.']);
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
    // Only the comment endpoint records a first response.
    const sla = await models.TicketSla.findOne({ where: { ticketId: ticket.id } });
    if (sla) expect(sla.responseMetAt).toBeNull();
    expect((await EmailProcessingLog.findOne()).action).toBe('staff_reply_added');
  });

  it('an unverified tech becomes a private unverified note', async () => {
    const out = await generic({
      DMARC: 'fail', FROM: 'tina@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}]`,
    });
    expect(out).toEqual({ action: 'unverified_note', ticketId: ticket.id });
    const [c] = await Comment.findAll({ where: { ticketId: ticket.id } });
    expect([c.type, c.authorId, c.viaEmail]).toEqual(['comment_private', admin.id, true]);
    expect(c.body).toMatch(/^Unverified sender tina@acme\.com:\n\nRan the update/);
  });

  it('a verified tech without edit access becomes an unverified note', async () => {
    const { makeStaff } = require('./fixtures'); // eslint-disable-line global-require
    const sam = await makeStaff('sam', w.deptA.id); // edit_own; the ticket is Tina's
    await models.User.update({ email: 'sam@acme.com' }, { where: { id: sam.user.id } });
    const out = await generic({ FROM: 'sam@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}]` });
    expect(out.action).toBe('unverified_note');
    const [c] = await Comment.findAll({ where: { ticketId: ticket.id } });
    expect([c.type, c.authorId]).toEqual(['comment_private', admin.id]);
  });

  it('a tech with no number opens a ticket for the customer, assigned to the tech, others CC\'d, no auto-reply', async () => {
    const otto = await makeTech('otto', w.deptA.id);
    await models.User.update({ email: 'otto@acme.com' }, { where: { id: otto.user.id } });
    const out = await generic({
      FROM: 'tina@acme.com', TO: 'Ann Smith <ANN@acme.com>, otto@acme.com', CC: 'help@prism.example, carl@client.example, noreply@prism.example', SUBJECT: 'Printer setup',
    });
    expect(out.action).toBe('staff_ticket_created');
    const t = await Ticket.findByPk(out.ticketId);
    expect([t.contactId, t.assigneeId, t.source, t.title]).toEqual([ann.id, tech.user.id, 'email', 'Printer setup']);
    expect((await models.TicketCc.findAll({ where: { ticketId: t.id } })).map((c) => [c.email, c.addedById])).toEqual([['carl@client.example', null]]);
    const [c] = await Comment.findAll({ where: { ticketId: t.id } });
    expect([c.type, c.authorId, c.viaEmail]).toEqual(['comment_public', tech.user.id, true]);
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('an unverified tech with no number: unassigned, note, no CCs, no contact for the tech', async () => {
    const out = await generic({
      DMARC: 'fail', FROM: 'tina@acme.com', TO: 'New Customer <new@client.example>', CC: 'carl@client.example', SUBJECT: 'Hello',
    });
    expect(out.action).toBe('staff_ticket_unverified');
    const t = await Ticket.findByPk(out.ticketId, { include: [{ model: models.Contact, as: 'contact' }] });
    expect([t.assigneeId, t.contact.email]).toEqual([null, 'new@client.example']);
    expect(await models.TicketCc.count()).toBe(0);
    const [c] = await Comment.findAll({ where: { ticketId: t.id } });
    expect([c.type, c.authorId]).toEqual(['comment_private', admin.id]);
    expect(await models.Contact.count({ where: { email: 'tina@acme.com' } })).toBe(0);
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('only staff recipients: ignored', async () => {
    const out = await generic({ FROM: 'tina@acme.com', TO: 'tina@acme.com', CC: 'help@prism.example', SUBJECT: 'note to self' });
    expect(out).toEqual({ action: 'ignored', ticketId: null });
    expect((await EmailProcessingLog.findOne()).error).toBe('No customer on the email');
    expect(await Ticket.count()).toBe(1);
    expect(await models.Contact.count({ where: { email: 'tina@acme.com' } })).toBe(0);
  });

  it('new ticket from email captures its Cc list minus our mailbox', async () => {
    const out = await generic({
      FROM: 'Nia <nia@client.example>', TO: 'help@prism.example', CC: 'HELP@prism.example, x@client.example, nia@client.example, not-an-address', SUBJECT: 'VPN down',
    });
    expect(out.action).toBe('ticket_created');
    expect((await models.TicketCc.findAll({ where: { ticketId: out.ticketId } })).map((c) => c.email)).toEqual(['x@client.example']);
  });

  it('a contact with "#77" in the subject on someone else\'s ticket 77 gets a new ticket', async () => {
    await makeContact(w.admin, { firstName: 'Bob', email: 'bob@acme.com', departmentId: w.deptA.id });
    const out = await generic({ FROM: 'bob@acme.com', TO: 'help@prism.example', SUBJECT: `Problem #${ticket.id}` });
    expect(out.action).toBe('ticket_created');
    expect(out.ticketId).not.toBe(ticket.id);
    expect(await Comment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});

describe('review fixes', () => {
  const generic = (vars) => handle('generic', {
    DMARC: 'pass', CC: 'help@prism.example', ID: Math.random().toString(36).slice(2), ...vars,
  });
  beforeEach(async () => {
    await models.User.update({ email: 'tina@acme.com' }, { where: { id: tech.user.id } });
  });

  it('a tech on the CC list replying goes through the staff check', async () => {
    await models.TicketCc.create({ ticketId: ticket.id, email: 'tina@acme.com' });
    const out = await generic({ DMARC: 'fail', FROM: 'tina@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}]` });
    expect(out.action).toBe('unverified_note');
    expect((await Ticket.findByPk(ticket.id)).status).toBe('Open');
  });

  it('unverified mail keeps its attachments out of the ticket', async () => {
    const out = await handle('generic-attach', {
      DMARC: 'fail', FROM: 'tina@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}]`,
    });
    expect(out.action).toBe('unverified_note');
    expect(await models.Attachment.count()).toBe(0);
    const [c] = await Comment.findAll({ where: { ticketId: ticket.id } });
    expect(c.body).toContain('Attachments not saved: invoice.exe');
    // Verified mail keeps them.
    await handle('generic-attach', {
      DMARC: 'pass', FROM: 'tina@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}]`,
    });
    expect(await models.Attachment.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it('a tech\'s "Invoice #N" subject opens a new ticket instead of commenting on ticket N', async () => {
    const out = await generic({ FROM: 'tina@acme.com', TO: 'x@client.example', SUBJECT: `Invoice #${ticket.id} overdue` });
    expect(out.action).toBe('staff_ticket_created');
    expect(out.ticketId).not.toBe(ticket.id);
    expect(await Comment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it('a customer reply-all to a tech-opened ticket threads by Message-ID', async () => {
    const opened = await generic({
      FROM: 'tina@acme.com', TO: 'new@client.example', SUBJECT: 'Hello', ID: 'orig-1',
    });
    expect(opened.action).toBe('staff_ticket_created');
    const reply = await handle('thread-reply', { FROM: 'new@client.example', SUBJECT: 'Re: Hello', INREPLYTO: '<msg-orig-1@acme.com>' });
    expect(reply).toEqual({ action: 'reply_added', ticketId: opened.ticketId });
    // A stranger citing the same Message-ID still gets a ticket of their own.
    const stranger = await handle('thread-reply', { FROM: 'mallory@evil.example', SUBJECT: 'Re: Hello', INREPLYTO: '<msg-orig-1@acme.com>' });
    expect(stranger.action).toBe('ticket_created');
    expect(stranger.ticketId).not.toBe(opened.ticketId);
  });

  it('two active users with one address are unverified', async () => {
    const twin = await makeTech('twin', w.deptA.id);
    await models.User.update({ email: 'TINA@acme.com' }, { where: { id: twin.user.id } });
    const out = await generic({ FROM: 'tina@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: [Ticket #${num(ticket.id)}]` });
    expect(out.action).toBe('unverified_note');
  });
});

describe('merged tickets (5b)', () => {
  const mergeInto = async (targetId, sourceIds) => {
    const res = await w.admin.agent.post(`/api/v1/tickets/${targetId}/merge`).send({ sourceIds });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  };

  it('reply to a merged ticket lands on the target (A→B→C)', async () => {
    const b = await makeTicket(w.admin.agent, { title: 'B', contactId: ann.id, departmentId: w.deptA.id });
    const c = await makeTicket(w.admin.agent, { title: 'C', contactId: ann.id, departmentId: w.deptA.id });
    await mergeInto(b.id, [ticket.id]);
    await mergeInto(c.id, [b.id]);
    const out = await handle('contact-reply', { TICKET: num(ticket.id) });
    expect(out).toEqual({ action: 'reply_added', ticketId: c.id });
    expect(await Comment.count({ where: { ticketId: c.id, type: 'reply' } })).toBe(1);
  });

  it('old contact of a merged source replies → contact-side reply on the target', async () => {
    const bob = await makeContact(w.admin, { firstName: 'Bob', email: 'bob@acme.com', departmentId: w.deptA.id });
    const target = await makeTicket(w.admin.agent, { title: 'Target', contactId: bob.id, departmentId: w.deptA.id });
    await mergeInto(target.id, [ticket.id]);
    const out = await handle('contact-reply', { TICKET: num(ticket.id) });
    expect(out).toEqual({ action: 'reply_added', ticketId: target.id });
  });

  it('inbound attachments are stored with their commentId', async () => {
    const out = await handle('generic-attach', {
      DMARC: 'pass', FROM: 'ann@acme.com', TO: 'help@prism.example', SUBJECT: `Re: [Ticket #${num(ticket.id)}]`,
    });
    expect(out.action).toBe('reply_added');
    const [att] = await models.Attachment.findAll({ where: { ticketId: ticket.id } });
    const [reply] = await Comment.findAll({ where: { ticketId: ticket.id, type: 'reply' } });
    expect(att.commentId).toBe(reply.id);
  });
});

describe('virus scanning', () => {
  let fake;
  const file = (filename, text) => ({ filename, content: Buffer.from(text), contentType: 'application/octet-stream' });
  // The fake flags a stream "FOUND" for the whole connection, so each file
  // needs its own verdict: mode is switched per attachment by content.
  const scannerOn = async (mode) => {
    fake = await startFakeClamd({ mode });
    process.env.CLAMAV_ENABLED = 'true';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(fake.port);
  };
  const mailWith = async (name, vars, attachments) => {
    const parsed = await mail(name, vars);
    parsed.attachments = attachments;
    return handleParsedMessage(parsed, CONFIG);
  };
  const replyVars = () => ({
    DMARC: 'pass', FROM: 'ann@acme.com', TO: 'help@prism.example', CC: '', SUBJECT: `Re: [Ticket #${num(ticket.id)}]`, ID: 'v1',
  });
  const newVars = () => ({
    DMARC: 'pass', FROM: 'newcomer@acme.com', TO: 'help@prism.example', CC: '', SUBJECT: 'Brand new', ID: 'v2',
  });
  const notes = (id) => Comment.findAll({ where: { ticketId: id, type: 'comment_private' } });

  beforeEach(() => { _resetThrottleForTest(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(async () => {
    if (fake) await fake.close();
    fake = null;
    delete process.env.CLAMAV_ENABLED;
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
    jest.restoreAllMocks();
  });

  it('clean attachments are saved as before', async () => {
    await scannerOn('ok');
    const out = await mailWith('generic', replyVars(), [file('a.txt', 'one'), file('b.txt', 'two')]);
    expect(out.action).toBe('reply_added');
    expect(await models.Attachment.count({ where: { ticketId: ticket.id } })).toBe(2);
    expect(await notes(ticket.id)).toHaveLength(0);
  });

  it('an infected attachment is not written; the note, audit and admin notification record it', async () => {
    await scannerOn('found');
    const before = fs.existsSync(path.join(process.env.UPLOAD_DIR, String(ticket.id)))
      ? fs.readdirSync(path.join(process.env.UPLOAD_DIR, String(ticket.id))).length : 0;
    const out = await mailWith('generic', replyVars(), [file('evil.pdf', 'x')]);
    expect(out.action).toBe('reply_added');
    expect(await models.Attachment.count({ where: { ticketId: ticket.id } })).toBe(0);
    const dir = path.join(process.env.UPLOAD_DIR, String(ticket.id));
    expect(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0).toBe(before);
    const [note] = await notes(ticket.id);
    expect(note.body).toContain('Removed: evil.pdf — virus detected (Eicar-Test-Signature)');
    const audit = await models.AuditLog.findOne({ where: { action: 'upload.virus_blocked' } });
    expect(audit).toMatchObject({ userId: null, entityType: 'Ticket', entityId: ticket.id });
    expect(audit.meta).toMatchObject({ filename: 'evil.pdf', signature: 'Eicar-Test-Signature', route: 'inbound-email', from: 'ann@acme.com' });
    expect(await models.Notification.count({ where: { type: 'virus_blocked', userId: w.admin.user.id } })).toBe(1);
  });

  it('a mix: clean saved, infected listed, ticket still created', async () => {
    // clamd verdicts come from a script keyed on call order: ok, found, ok.
    fake = await startFakeClamd({ mode: 'ok' });
    process.env.CLAMAV_ENABLED = 'true';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(fake.port);
    const scan = require('../../src/services/virusScan'); // eslint-disable-line global-require
    const real = scan.scanBuffer;
    jest.spyOn(scan, 'scanBuffer').mockImplementation(async (buf) => (buf.toString() === 'bad' ? { clean: false, signature: 'Test.Sig' } : real(buf)));
    const out = await mailWith('generic', newVars(), [file('ok1.txt', 'good1'), file('bad.exe.pdf', 'bad'), file('ok2.txt', 'good2')]);
    expect(out.action).toBe('ticket_created');
    const saved = await models.Attachment.findAll({ where: { ticketId: out.ticketId } });
    expect(saved.map((a) => a.originalName).sort()).toEqual(['ok1.txt', 'ok2.txt']);
    const [note] = await notes(out.ticketId);
    expect(note.body).toContain('Removed: bad.exe.pdf — virus detected (Test.Sig)');
    expect(note.body).not.toContain('ok1.txt');
  });

  it('scanner down: nothing saved, ticket still created, each listed as not saved, admins notified once', async () => {
    await scannerOn('error');
    const out = await mailWith('generic', newVars(), [file('a.txt', 'one'), file('b.txt', 'two')]);
    expect(out.action).toBe('ticket_created');
    expect(await Ticket.findByPk(out.ticketId)).toBeTruthy();
    expect(await models.Attachment.count({ where: { ticketId: out.ticketId } })).toBe(0);
    const [note] = await notes(out.ticketId);
    expect(note.body).toContain("Not saved: a.txt — the virus scanner wasn't reachable");
    expect(note.body).toContain("Not saved: b.txt — the virus scanner wasn't reachable");
    expect(await models.Notification.count({ where: { type: 'scanner_unavailable', userId: w.admin.user.id } })).toBe(1);
    // A second message inside the hour does not notify again.
    await mailWith('generic', { ...newVars(), ID: 'v3', SUBJECT: 'Another' }, [file('c.txt', 'three')]);
    expect(await models.Notification.count({ where: { type: 'scanner_unavailable', userId: w.admin.user.id } })).toBe(1);
  });

  it('the note is private (never a customer-visible comment)', async () => {
    await scannerOn('found');
    await mailWith('generic', replyVars(), [file('evil.pdf', 'x')]);
    const [note] = await notes(ticket.id);
    expect(note.type).toBe('comment_private');
    expect(await Comment.count({ where: { ticketId: ticket.id, body: { [require('sequelize').Op.like]: '%Removed:%' }, type: ['reply', 'comment_public'] } })).toBe(0);
    expect(sendMail).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Removed:') }));
  });

  it('scanning off: attachments saved without contacting the scanner', async () => {
    await scannerOn('found');
    process.env.CLAMAV_ENABLED = 'false';
    await mailWith('generic', replyVars(), [file('a.txt', 'one')]);
    expect(fake.received).toHaveLength(0);
    expect(await models.Attachment.count({ where: { ticketId: ticket.id } })).toBe(1);
  });
});
