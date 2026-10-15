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

// Inbound mail, fed in as parsed RFC822 messages (test/fixtures/mail).

const CONFIG = { address: 'help@prism.example' };
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
    const out = await generic({ FROM: 'Tina <TINA@acme.com>', TO: 'ann@acme.com', SUBJECT: `Re: #${ticket.id} printer` });
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
    const out = await generic({ FROM: 'sam@acme.com', TO: 'ann@acme.com', SUBJECT: `Re: #${ticket.id}` });
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
