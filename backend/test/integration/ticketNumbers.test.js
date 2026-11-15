const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket,
} = require('./fixtures');
const migration = require('../../migrations/20260101000097-ticket-numbers');
const { findTicketIdByNumber } = require('../../src/services/tickets/numbers');
const { findTicketRef } = require('../../src/services/email/inboundClassify');

// Tickets numbered per company (CN part 2): WC-T0001, WC-T0002…, each company
// counting its own; old numbers stay findable.

let w;
let wc;
let acme;
let pat;
let lee;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  wc = await makeCompany(w.admin, { name: 'Washington County' });
  acme = await makeCompany(w.admin, { name: 'Acme', code: 'ACME' });
  pat = await makeContact(w.admin, { companyId: wc.id, email: 'pat@wc.test' });
  lee = await makeContact(w.admin, { companyId: acme.id, email: 'lee@acme.test' });
});
afterAll(closeDb);

const counter = async (companyId) => (await sequelize.query("SELECT seq FROM CompanyCounters WHERE companyId = ? AND kind = 'ticket'", { replacements: [companyId], type: Sequelize.QueryTypes.SELECT }))[0].seq;
const ticketFor = (contact, title = 'Printer') => makeTicket(w.admin.agent, { title, contactId: contact.id });

it('each company counts its own tickets, and a ticket task carries the number', async () => {
  const a = await ticketFor(pat);
  const b = await ticketFor(lee);
  const c = await ticketFor(pat);
  expect([a.ticketNumber, b.ticketNumber, c.ticketNumber]).toEqual(['WC-T0001', 'ACME-T0001', 'WC-T0002']);
  const shown = expectOk(await w.admin.agent.get(`${API}/tickets/${c.id}`));
  expect((shown.ticket || shown).ticketNumber).toBe('WC-T0002');
  const task = expectOk(await w.admin.agent.post(`${API}/tickets/${c.id}/tasks`).send({ title: 'Swap toner' }), 201).task;
  expect(task.code).toBe('WC-T0002-T01');
  expect(await counter(wc.id)).toBe(2);
});

it('a new company code renumbers its tickets and tasks; the old numbers still find them', async () => {
  const t = await ticketFor(pat);
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'Swap toner' }), 201);
  expectOk(await w.admin.agent.patch(`${API}/companies/${wc.id}`).send({ code: 'WCO' }));
  const fresh = await models.Ticket.findByPk(t.id);
  expect(fresh.number).toBe('WCO-T0001');
  expect(fresh.previousNumbers).toEqual(expect.arrayContaining(['WC-T0001']));
  expect((await models.Task.findOne({ where: { ticketId: t.id } })).code).toBe('WCO-T0001-T01');
  expect(await findTicketIdByNumber('wc-t1')).toBe(t.id);
  expect(await findTicketIdByNumber(String(t.id).padStart(5, '0'))).toBe(t.id);
  const found = expectOk(await w.admin.agent.get(`${API}/tickets`).query({ search: 'WC-T0001' }));
  expect((found.tickets || found.rows || []).map((x) => x.id)).toContain(t.id);
  const searched = expectOk(await w.admin.agent.get(`${API}/search`).query({ q: 'WCO-T0001' }));
  expect(searched.tickets.map((x) => x.id)).toContain(t.id);
});

it('a contact moving company takes their tickets to the next numbers there', async () => {
  await ticketFor(lee);
  const t = await ticketFor(pat);
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'Swap toner' }), 201);
  const contact = await models.Contact.findByPk(pat.id);
  await contact.update({ companyId: acme.id, departmentId: null });
  const moved = await models.Ticket.findByPk(t.id);
  expect(moved.number).toBe('ACME-T0002');
  expect(moved.previousNumbers).toEqual(expect.arrayContaining(['WC-T0001']));
  expect((await models.Task.findOne({ where: { ticketId: t.id } })).code).toBe('ACME-T0002-T01');
  // WC's counter doesn't go back: its next ticket is WC-T0002.
  const next = await ticketFor(await makeContact(w.admin, { companyId: wc.id, email: 'sam@wc.test' }));
  expect(next.ticketNumber).toBe('WC-T0002');
});

it('merging a company gives its tickets numbers in the one it joins', async () => {
  await ticketFor(pat);
  const t = await ticketFor(lee);
  expectOk(await w.admin.agent.post(`${API}/companies/${acme.id}/merge`).send({ intoCompanyId: wc.id }));
  const moved = await models.Ticket.findByPk(t.id);
  expect(moved.number).toBe('WC-T0002');
  expect(await findTicketIdByNumber('ACME-T0001')).toBe(t.id);
});

it('email subjects carry the number; replies match new and old references', async () => {
  expect(findTicketRef('Re: [WC-T0042] Printer', null, null)).toEqual({ number: 'WC-T0042', loose: false });
  expect(findTicketRef('Re: [Ticket #wc-t0042] Printer', null, null)).toEqual({ number: 'WC-T0042', loose: false });
  expect(findTicketRef('Re: [Ticket #00042] Printer', null, null)).toEqual({ id: 42, loose: false });
  expect(findTicketRef('About WC-T0042, again', null, null)).toEqual({ number: 'WC-T0042', loose: true });
  const { CATALOG } = require('../../src/services/email/catalog'); // eslint-disable-line global-require
  const subjects = Object.values(CATALOG).map((t) => t.subject || '');
  expect(subjects.filter((s) => s.includes('{{ticket.number}}')).length).toBeGreaterThan(3);
  subjects.filter((s) => s.includes('{{ticket.number}}')).forEach((s) => expect(s).toContain('[{{ticket.number}}]'));
});

it('migration 097 numbers every ticket within its company, moves task codes, and rolls back', async () => {
  const qi = sequelize.getQueryInterface();
  const a = await ticketFor(pat);
  const b = await ticketFor(lee);
  const c = await ticketFor(pat);
  const made = expectOk(await w.admin.agent.post(`${API}/tickets/${c.id}/tasks`).send({ title: 'Swap toner' }), 201).task;
  await migration.down(qi, Sequelize);
  try {
    expect((await qi.describeTable('Tickets')).number).toBeUndefined();
    // Rolled back, the task has its old code again.
    const [old] = await sequelize.query('SELECT code FROM Tasks WHERE id = ?', { replacements: [made.id], type: Sequelize.QueryTypes.SELECT });
    expect(old.code).toBe(`#${String(c.id).padStart(5, '0')}-T01`);
  } finally {
    await migration.up(qi, Sequelize);
  }
  const rows = await sequelize.query('SELECT id, number, previousNumbers FROM Tickets ORDER BY id', { type: Sequelize.QueryTypes.SELECT });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  expect([byId[a.id].number, byId[b.id].number, byId[c.id].number]).toEqual(['WC-T0001', 'ACME-T0001', 'WC-T0002']);
  const prev = byId[c.id].previousNumbers;
  expect(typeof prev === 'string' ? JSON.parse(prev) : prev).toEqual([String(c.id).padStart(5, '0')]);
  const task = await models.Task.findOne({ where: { ticketId: c.id } });
  expect(task.code).toBe('WC-T0002-T01');
  expect(await counter(wc.id)).toBe(2);
  await migration.up(qi, Sequelize); // twice is harmless
});
