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
