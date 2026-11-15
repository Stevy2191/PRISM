const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000091-company-sla');

// Migration 091 (CS part 2): shared SLA policies, business hours and holiday
// lists become one SLA row per company, plus the starting values. Raw SQL
// throughout: the models describe the migrated shape.

const qi = () => sequelize.getQueryInterface();
const sel = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const run = (sql, replacements) => sequelize.query(sql, { replacements });
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const week = JSON.stringify(Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  .map((d, i) => [d, { start: '08:00', end: '16:00', enabled: i < 5 }])));

beforeEach(resetData);
afterAll(async () => {
  // Leave it migrated, and the probe companies gone.
  if (!(await qi().describeTable('SlaPolicies')).companyId) await migration.up(qi(), Sequelize);
  await resetData();
  await closeDb();
});

async function company(name) {
  await run("INSERT INTO Companies (name, isClient, isVendor, isInternal, status, createdAt, updatedAt) VALUES (?, 1, 0, 0, 'active', NOW(), NOW())", [name]);
  return (await sel('SELECT id FROM Companies WHERE name = ?', [name]))[0].id;
}

it('gives each company a copy of its policy, with its hours, zone and holidays', async () => {
  await migration.down(qi(), Sequelize);
  expect(await tables()).toEqual(expect.arrayContaining(['BusinessHours', 'HolidayLists']));
  const [std] = await sel('SELECT id FROM SlaPolicies WHERE isDefault = 1');

  // Gold: Chicago office hours with a holiday list; Acme is on Gold.
  await run("INSERT INTO HolidayLists (name, createdAt) VALUES ('Gold days', NOW())");
  const [{ id: listId }] = await sel("SELECT id FROM HolidayLists WHERE name = 'Gold days'");
  await run("INSERT INTO Holidays (holidayListId, name, date) VALUES (?, 'Gold day', '2026-12-24')", [listId]);
  await run("INSERT INTO BusinessHours (name, timezone, schedule, is24x7, holidayListId, createdAt) VALUES ('Office', 'America/Chicago', ?, 0, ?, NOW())", [week, listId]);
  const [{ id: bhId }] = await sel("SELECT id FROM BusinessHours WHERE name = 'Office'");
  await run("INSERT INTO SlaPolicies (name, isDefault, warnAtPercent, businessHoursId, createdAt, updatedAt) VALUES ('Gold', 0, 60, ?, NOW(), NOW())", [bhId]);
  const [{ id: goldId }] = await sel("SELECT id FROM SlaPolicies WHERE name = 'Gold'");
  await run(`INSERT INTO SlaTargets (slaPolicyId, ticketType, priority, responseMinutes, useBusinessHours, createdAt, updatedAt)
    VALUES (?, 'incident', 'high', 15, 1, NOW(), NOW())`, [goldId]);
  const acme = await company('Acme Probe');
  await run('UPDATE Companies SET slaPolicyId = ? WHERE id = ?', [goldId, acme]);
  const beta = await company('Beta Probe');
  // A rule that set a shared policy.
  await run("INSERT INTO WorkflowRules (name, triggerEvent, isActive, createdAt, updatedAt) VALUES ('Gold rule', 'ticket_created', 1, NOW(), NOW())");
  const [{ id: ruleId }] = await sel("SELECT id FROM WorkflowRules WHERE name = 'Gold rule'");
  await run(`INSERT INTO WorkflowActions (ruleId, actionType, actionValue, position, createdAt, updatedAt)
    VALUES (?, 'set_sla_policy', ?, 0, NOW(), NOW())`, [ruleId, JSON.stringify({ slaPolicyId: goldId })]);

  await migration.up(qi(), Sequelize);

  const [acmeRow] = await sel('SELECT * FROM SlaPolicies WHERE companyId = ?', [acme]);
  expect([acmeRow.warnAtPercent, acmeRow.timezone, !!acmeRow.is24x7]).toEqual([60, 'America/Chicago', false]);
  const sched = typeof acmeRow.schedule === 'string' ? JSON.parse(acmeRow.schedule) : acmeRow.schedule;
  expect(sched.monday).toEqual({ start: '08:00', end: '16:00', enabled: true });
  expect(await sel('SELECT responseMinutes FROM SlaTargets WHERE slaPolicyId = ?', [acmeRow.id])).toEqual([{ responseMinutes: 15 }]);
  expect((await sel('SELECT name FROM Holidays WHERE slaPolicyId = ?', [acmeRow.id])).map((h) => h.name)).toEqual(['Gold day']);

  // Beta was on the default: its targets, around the clock.
  const [betaRow] = await sel('SELECT * FROM SlaPolicies WHERE companyId = ?', [beta]);
  expect([!!betaRow.is24x7, betaRow.warnAtPercent]).toEqual([true, 75]);
  expect((await sel('SELECT COUNT(*) AS n FROM SlaTargets WHERE slaPolicyId = ?', [betaRow.id]))[0].n).toBe(20);

  // Your company has its own row and the shared holiday lists' days.
  const [own] = await sel('SELECT p.id FROM SlaPolicies p JOIN Companies c ON c.id = p.companyId WHERE c.isInternal = 1');
  expect((await sel('SELECT name FROM Holidays WHERE slaPolicyId = ?', [own.id])).map((h) => h.name)).toEqual(['Gold day']);

  // The default is the starting values; Gold and the rule action are gone.
  const shared = await sel('SELECT id, name, isDefault FROM SlaPolicies WHERE companyId IS NULL');
  expect(shared).toEqual([{ id: std.id, name: 'Starting values', isDefault: 1 }]);
  expect(await sel("SELECT id FROM WorkflowActions WHERE actionType = 'set_sla_policy'")).toEqual([]);
  expect(await tables()).toEqual(expect.not.arrayContaining(['BusinessHours', 'HolidayLists']));
  expect((await qi().describeTable('Companies')).slaPolicyId).toBeUndefined();
  expect((await qi().describeTable('Holidays')).holidayListId).toBeUndefined();
});

it('moves tickets onto their company\'s copy', async () => {
  await migration.down(qi(), Sequelize);
  const acme = await company('Acme Probe');
  const [std] = await sel('SELECT id FROM SlaPolicies WHERE isDefault = 1');
  await run("INSERT INTO Tickets (title, companyId, createdBy, status, priority, type, createdAt, updatedAt) VALUES ('t', ?, 1, 'Open', 'medium', 'incident', NOW(), NOW())", [acme]);
  const [{ id: ticketId }] = await sel("SELECT id FROM Tickets WHERE title = 't'");
  await run("INSERT INTO TicketSlas (ticketId, slaPolicyId, priority, ticketType, createdAt, updatedAt) VALUES (?, ?, 'medium', 'incident', NOW(), NOW())", [ticketId, std.id]);
  await migration.up(qi(), Sequelize);
  const [row] = await sel('SELECT id FROM SlaPolicies WHERE companyId = ?', [acme]);
  expect((await sel('SELECT slaPolicyId FROM TicketSlas WHERE ticketId = ?', [ticketId]))[0].slaPolicyId).toBe(row.id);
});

it('rolls back to one shared default and re-applies', async () => {
  await migration.down(qi(), Sequelize);
  expect(await sel('SELECT name, isDefault FROM SlaPolicies')).toEqual([expect.objectContaining({ isDefault: 1 })]);
  expect((await qi().describeTable('SlaPolicies')).companyId).toBeUndefined();
  expect((await qi().describeTable('Companies')).slaPolicyId).toBeDefined();
  await migration.up(qi(), Sequelize);
  expect((await qi().describeTable('SlaPolicies')).companyId).toBeDefined();
  // Up twice is harmless.
  await migration.up(qi(), Sequelize);
});
