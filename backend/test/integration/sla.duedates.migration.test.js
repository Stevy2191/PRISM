const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000061-sla-due-dates');

// SLA due dates (spec 2026-10-13 change): targets per ticket type ×
// priority with units, no pausing statuses, a due date history and the
// Adjust SLA due dates permission.

const { SlaPolicy, SlaTarget, TicketSla } = models;
const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

beforeEach(resetData);
afterAll(closeDb);

it("copies each priority target to all five ticket types", async () => {
  await migration.down(qi(), Sequelize);
  const std = await SlaPolicy.findOne({ where: { isDefault: true } });
  await sequelize.query("UPDATE SlaTargets SET resolutionMinutes = 999 WHERE slaPolicyId = ? AND priority = 'low'", { replacements: [std.id] });
  await migration.up(qi(), Sequelize);
  const lows = await SlaTarget.findAll({ where: { slaPolicyId: std.id, priority: 'low' } });
  expect(lows.map((t) => t.ticketType).sort()).toEqual(['change', 'incident', 'problem', 'request', 'task']);
  expect(lows.map((t) => [t.resolutionMinutes, t.resolutionUnit])).toEqual(Array(5).fill([999, 'minutes']));
  expect(await SlaTarget.count({ where: { slaPolicyId: std.id } })).toBe(20);
});

it('backfills the original due date', async () => {
  const ticket = await models.Ticket.create({
    title: 't', companyId: (await models.Company.findOne({ where: { isInternal: true } })).id, createdBy: 1, status: 'Open',
  });
  await migration.down(qi(), Sequelize);
  const due = new Date('2026-03-20T15:00:00Z');
  await TicketSla.update({ resolutionDueAt: due }, { where: { ticketId: ticket.id } });
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
  const std = await SlaPolicy.findOne({ where: { isDefault: true } });
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
  const ticket = await models.Ticket.create({
    title: 'paused', companyId: (await models.Company.findOne({ where: { isInternal: true } })).id, createdBy: 1, status: 'Open',
  });
  await migration.down(qi(), Sequelize);
  await sequelize.query(`UPDATE TicketSlas SET resolutionTargetMinutes = 60, resolutionUsedMinutes = 10,
    resolutionRunningSince = NULL, resolutionDueAt = NULL, resolutionWarnAt = NULL, resolutionMetAt = NULL WHERE ticketId = ?`, { replacements: [ticket.id] });
  await migration.up(qi(), Sequelize);
  const row = await TicketSla.findOne({ where: { ticketId: ticket.id } });
  expect(row.resolutionRunningSince).not.toBeNull();
  const left = (new Date(row.resolutionDueAt) - new Date(row.resolutionRunningSince)) / 60000;
  expect(left).toBe(50);
  expect(new Date(row.resolutionOriginalDueAt).getTime()).toBe(new Date(row.resolutionDueAt).getTime());
});
