jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const { simpleParser } = require('mailparser');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeContact,
} = require('./fixtures');
const migration = require('../../migrations/20260101000064-ticket-status-rework');
const { handleParsedMessage } = require('../../src/services/inboundEmailService');
const { getTicketStatusBuckets, getTicketStatusBehaviorMap, getTicketStatusKindMap } = require('../../src/services/statusBehavior');

// Ticket status rework (user decisions 2026-10-15): an "on hold" kind,
// the seeded set Open / Waiting on User / User responded / On Hold /
// Postponed / Request completed / Request cancelled / Closed, and the
// automatic moves on replies.

const { TicketStatus, Ticket, Comment, Notification } = models;
const qi = () => sequelize.getQueryInterface();
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const statusRows = async () => (await TicketStatus.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] }))
  .map((s) => [s.name, s.behaviorType, s.systemKey || null]);

const SEEDED = [
  ['Open', 'open', null], ['Waiting on User', 'open', 'waiting_on_user'], ['User responded', 'open', 'user_responded'],
  ['On Hold', 'on_hold', null], ['Postponed', 'on_hold', null],
  ['Request completed', 'closed', null], ['Request cancelled', 'closed', null], ['Closed', 'closed', null],
];

let w;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

describe('migration', () => {
  const insertTicket = async (status) => {
    const [internal] = await select('SELECT id FROM Companies WHERE isInternal = 1');
    await sequelize.query("INSERT INTO Tickets (title, status, priority, type, companyId, createdAt, updatedAt) VALUES (?, ?, 'medium', 'request', ?, NOW(), NOW())",
      { replacements: [status, status, internal.id] });
  };

  it('migration maps In Progress, Pending, Resolved and keeps admin statuses', async () => {
    await migration.down(qi(), Sequelize);
    const names = (await select('SELECT name, behaviorType FROM TicketStatuses ORDER BY position, id')).map((r) => [r.name, r.behaviorType]);
    expect(names).toEqual([['Open', 'open'], ['In Progress', 'open'], ['Pending', 'open'], ['On Hold', 'open'], ['Resolved', 'closed'], ['Closed', 'closed']]);
    await sequelize.query("INSERT INTO TicketStatuses (name, color, behaviorType, position, isDefault, isProtected, createdAt) VALUES ('With vendor', '#000000', 'open', 9, 0, 0, NOW())");
    for (const s of ['In Progress', 'Pending', 'On Hold', 'Resolved', 'Closed', 'With vendor']) await insertTicket(s); // eslint-disable-line no-await-in-loop
    const rule = await models.WorkflowRule.create({ name: 'r', triggerEvent: 'ticket_updated', isActive: true });
    await models.WorkflowCondition.create({ ruleId: rule.id, field: 'status', operator: 'equals', value: 'Resolved' });
    await models.WorkflowAction.create({ ruleId: rule.id, actionType: 'set_status', actionValue: { status: 'Pending' } });

    await migration.up(qi(), Sequelize);
    expect(await statusRows()).toEqual([...SEEDED, ['With vendor', 'open', null]]);
    const byTitle = Object.fromEntries((await Ticket.findAll()).map((t) => [t.title, t.status]));
    expect(byTitle).toEqual({
      'In Progress': 'Open', Pending: 'On Hold', 'On Hold': 'On Hold', Resolved: 'Request completed', Closed: 'Closed', 'With vendor': 'With vendor',
    });
    expect((await models.WorkflowCondition.findOne()).value).toBe('Request completed');
    expect((await models.WorkflowAction.findOne()).actionValue).toEqual({ status: 'On Hold' });
    await TicketStatus.destroy({ where: { name: 'With vendor' } });
  });

  it('round-trips (down then up)', async () => {
    await migration.down(qi(), Sequelize);
    expect((await qi().describeTable('TicketStatuses')).systemKey).toBeUndefined();
    const [col] = await select("SHOW COLUMNS FROM TicketStatuses LIKE 'behaviorType'");
    expect(col.Type).not.toContain('on_hold');
    await migration.up(qi(), Sequelize);
    expect(await statusRows()).toEqual(SEEDED);
  });
});

describe('the on hold kind', () => {
  it('on-hold tickets still count as open and keep their SLA running', async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Parked', contactId: w.contact.id, departmentId: w.deptA.id });
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'On Hold' }));
    const buckets = await getTicketStatusBuckets();
    expect(buckets.open).toEqual(expect.arrayContaining(['Open', 'On Hold', 'Postponed']));
    expect(buckets.onHold).toEqual(['On Hold', 'Postponed']);
    expect((await getTicketStatusBehaviorMap()).get('On Hold')).toBe('open');
    expect((await getTicketStatusKindMap()).get('On Hold')).toBe('on_hold');
    const sla = await models.TicketSla.findOne({ where: { ticketId: t.id } });
    expect(sla.responseRunningSince).not.toBeNull();
    // The open list includes it; the on-hold filter picks it out.
    const all = expectOk(await w.admin.agent.get(`${API}/tickets`)).tickets.map((x) => x.id);
    expect(all).toContain(t.id);
    expect(expectOk(await w.admin.agent.get(`${API}/tickets?status=closed`)).tickets).toEqual([]);
    const onHold = expectOk(await w.admin.agent.get(`${API}/tickets?status=on_hold`)).tickets.map((x) => x.id);
    expect(onHold).toEqual([t.id]);
  });

  it('on_hold is refused for project statuses', async () => {
    const res = await w.admin.agent.post(`${API}/project-statuses`).send({ name: 'Parked', behaviorType: 'on_hold' });
    expect(res.status).toBe(400);
    const ok = expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Parts on order', behaviorType: 'on_hold' }), 201);
    expect(ok.status.behaviorType).toBe('on_hold');
    await TicketStatus.destroy({ where: { id: ok.status.id } });
  });
});

describe('automatic moves', () => {
  let ann;
  let ticket;
  const handle = async (subject) => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mail', 'contact-reply.eml'), 'utf8')
      .replace('Re: [Ticket #%TICKET%] Printer offline', subject);
    return handleParsedMessage(await simpleParser(raw), { address: 'help@prism.example' });
  };
  const num = (id) => String(id).padStart(5, '0');
  beforeEach(async () => {
    ann = await makeContact(w.admin, { firstName: 'Ann', email: 'ann@acme.com', departmentId: w.deptA.id });
    ticket = await makeTicket(w.admin.agent, {
      title: 'Printer offline', contactId: ann.id, departmentId: w.deptA.id, assigneeId: tech.user.id,
    });
  });

  it('User responded cannot be chosen by hand', async () => {
    const res = await tech.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'User responded' });
    expect(res.status).toBe(400);
    const created = await tech.agent.post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, status: 'User responded' });
    expect(created.status).toBe(400);
    // Waiting on User is an ordinary status.
    expectOk(await tech.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Waiting on User' }));
  });

  it('a contact reply moves an open ticket to User responded', async () => {
    expectOk(await tech.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'On Hold' }));
    await handle(`Re: [Ticket #${num(ticket.id)}]`);
    expect((await Ticket.findByPk(ticket.id)).status).toBe('User responded');
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
    expect(activity.map((a) => [a.action, a.fromValue, a.toValue])).toContainEqual(['status', 'On Hold', 'User responded']);
    // Tickets in it can still be saved without touching the status.
    expectOk(await tech.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'User responded', priority: 'high' }));
  });

  it('a contact reply to a closed ticket stays closed and notifies the assignee', async () => {
    expectOk(await tech.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Request completed' }));
    await Notification.destroy({ where: {} });
    const out = await handle(`Re: [Ticket #${num(ticket.id)}] thanks!`);
    expect(out.action).toBe('reply_added');
    expect((await Ticket.findByPk(ticket.id)).status).toBe('Request completed');
    const [n] = await Notification.findAll({ where: { userId: tech.user.id } });
    expect([n.type, n.message]).toEqual(['comment', `Customer replied to closed ticket #${num(ticket.id)}: Printer offline`]);
  });

  it('a tech public reply moves User responded to Waiting on User; a private note does not', async () => {
    await handle(`Re: [Ticket #${num(ticket.id)}]`);
    const post = (body) => tech.agent.post(`${API}/tickets/${ticket.id}/comments`).send(body);
    expectOk(await post({ body: 'internal', type: 'comment_private' }), 201);
    expect((await Ticket.findByPk(ticket.id)).status).toBe('User responded');
    expectOk(await post({ body: 'Try now?' }), 201);
    expect((await Ticket.findByPk(ticket.id)).status).toBe('Waiting on User');
    // Only from User responded.
    expectOk(await tech.agent.patch(`${API}/tickets/${ticket.id}`).send({ status: 'Open' }));
    expectOk(await post({ body: 'Another' }), 201);
    expect((await Ticket.findByPk(ticket.id)).status).toBe('Open');
    expect(await Comment.count({ where: { ticketId: ticket.id } })).toBe(4);
  });
});
