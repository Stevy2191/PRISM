const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000061-sla-due-dates');
// CS: 091 moved hours and holidays onto each company's SLA row; it is rolled
// back for these cases and put back after.
const companySla = require('../../migrations/20260101000091-company-sla');

// SLA due dates (spec 2026-10-13 change): targets per ticket type ×
// priority with units, no pausing statuses, a due date history and the
// Adjust SLA due dates permission.

const { SlaTarget, TicketSla } = models;
const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

// Raw read: the SlaPolicy model carries 091's columns.
const defaultPolicy = async () => (await select('SELECT id FROM SlaPolicies WHERE isDefault = 1 ORDER BY id LIMIT 1'))[0];
// A ticket and its SLA row, written raw: with 091 rolled back the Ticket
// model's SLA hooks can't run. Call with 061 rolled back (no ticketType yet).
async function rawTicket(title, sla) {
  const [company] = await select('SELECT id FROM Companies WHERE isInternal = 1');
  await sequelize.query("INSERT INTO Tickets (title, companyId, createdBy, status, type) VALUES (?, ?, 1, 'Open', 'incident')", { replacements: [title, company.id] });
  const [ticket] = await select('SELECT id, type FROM Tickets WHERE title = ? ORDER BY id DESC LIMIT 1', [title]);
  const std = await defaultPolicy();
  const cols = Object.keys(sla);
  await sequelize.query(
    `INSERT INTO TicketSlas (ticketId, slaPolicyId, priority, createdAt, updatedAt${cols.map((c) => `, ${c}`).join('')})
     VALUES (?, ?, 'medium', NOW(), NOW()${cols.map(() => ', ?').join('')})`,
    { replacements: [ticket.id, std.id, ...cols.map((c) => sla[c])] },
  );
  return ticket;
}

beforeAll(async () => { await resetData(); await companySla.down(qi(), Sequelize); });
beforeEach(resetData);
afterAll(async () => {
  await companySla.up(qi(), Sequelize);
  await closeDb();
});

it("copies each priority target to all five ticket types", async () => {
  await migration.down(qi(), Sequelize);
  const std = await defaultPolicy();
  await sequelize.query("UPDATE SlaTargets SET resolutionMinutes = 999 WHERE slaPolicyId = ? AND priority = 'low'", { replacements: [std.id] });
  await migration.up(qi(), Sequelize);
  const lows = await SlaTarget.findAll({ where: { slaPolicyId: std.id, priority: 'low' } });
  expect(lows.map((t) => t.ticketType).sort()).toEqual(['change', 'incident', 'problem', 'request', 'task']);
  expect(lows.map((t) => [t.resolutionMinutes, t.resolutionUnit])).toEqual(Array(5).fill([999, 'minutes']));
  expect(await SlaTarget.count({ where: { slaPolicyId: std.id } })).toBe(20);
});

it('backfills the original due date', async () => {
  await migration.down(qi(), Sequelize);
  const due = new Date('2026-03-20T15:00:00Z');
  const ticket = await rawTicket('t', { resolutionDueAt: '2026-03-20 15:00:00' }); // stored as UTC
  await migration.up(qi(), Sequelize);
  const row = await TicketSla.findOne({ where: { ticketId: ticket.id } });
  expect(new Date(row.resolutionOriginalDueAt).toISOString()).toBe(due.toISOString());
  expect(row.ticketType).toBe(ticket.type);
});

it('drops Pauses SLA from statuses', async () => {
  expect((await qi().describeTable('TicketStatuses')).pausesSla).toBeUndefined();
});

it('grants Adjust SLA due dates to System Administrator only', async () => {
  const rows = await select(`SELECT r.name FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId
    JOIN Permissions p ON p.id = rp.permissionId WHERE p.\`key\` = 'tickets.adjust_sla_due' AND rp.granted = 1`);
  expect(rows.map((r) => r.name)).toEqual(['System Administrator']);
});

it('rolls back and re-applies', async () => {
  const std = await defaultPolicy();
  await SlaTarget.update({ resolutionMinutes: 20, resolutionUnit: 'business_days' }, { where: { slaPolicyId: std.id, ticketType: 'incident', priority: 'low' } });
  await migration.down(qi(), Sequelize);
  expect(await tables()).not.toContain('TicketDueDateChanges');
  expect((await qi().describeTable('TicketStatuses')).pausesSla).toBeDefined();
  expect((await qi().describeTable('SlaTargets')).ticketType).toBeUndefined();
  const [low] = await select("SELECT resolutionMinutes FROM SlaTargets WHERE slaPolicyId = ? AND priority = 'low'", [std.id]);
  expect(low.resolutionMinutes).toBe(20 * 1440);
  expect(await select("SELECT id FROM Permissions WHERE `key` = 'tickets.adjust_sla_due'")).toEqual([]);

  await migration.up(qi(), Sequelize);
  expect(await tables()).toContain('TicketDueDateChanges');
  expect(await SlaTarget.count({ where: { slaPolicyId: std.id } })).toBe(20);
});

it('starts the resolution clock of open tickets the first SLA build had paused', async () => {
  await migration.down(qi(), Sequelize);
  const ticket = await rawTicket('paused', { resolutionTargetMinutes: 60, resolutionUsedMinutes: 10 });
  await migration.up(qi(), Sequelize);
  const row = await TicketSla.findOne({ where: { ticketId: ticket.id } });
  expect(row.resolutionRunningSince).not.toBeNull();
  const left = (new Date(row.resolutionDueAt) - new Date(row.resolutionRunningSince)) / 60000;
  expect(left).toBe(50);
  expect(new Date(row.resolutionOriginalDueAt).getTime()).toBe(new Date(row.resolutionDueAt).getTime());
});
