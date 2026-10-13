const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const migration = require('../../migrations/20260101000060-sla-engine');

// SLA engine schema (sub-project 4): the old one-row-per-priority SlaPolicies
// table becomes a "Standard" default policy with one target per priority.

const {
  SlaPolicy, SlaTarget, BusinessHours, TicketStatus, Department,
} = models;
const enumOf = async (table, column) => {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  return [...rows[0].Type.matchAll(/'([^']*)'/g)].map((m) => m[1]);
};
const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

beforeEach(resetData);
afterAll(async () => {
  await BusinessHours.destroy({ where: {} });
  await closeDb();
});

describe('sla-engine migration', () => {
  it('moves the per-priority rows into a Standard default policy, in minutes', async () => {
    await migration.down(qi());
    await sequelize.query("UPDATE SlaPolicies SET firstResponseHours = 2.5, useBusinessHours = 0 WHERE priority = 'high'");
    await migration.up(qi(), Sequelize);

    const policies = await SlaPolicy.findAll({ include: [{ model: SlaTarget, as: 'targets' }] });
    expect(policies).toHaveLength(1);
    const [std] = policies;
    expect([std.name, std.isDefault, std.warnAtPercent, std.businessHoursId]).toEqual(['Standard', true, 75, null]);
    const byPriority = Object.fromEntries(std.targets.map((t) => [t.priority, t]));
    expect(Object.keys(byPriority).sort()).toEqual(['critical', 'high', 'low', 'medium']);
    expect([byPriority.high.responseMinutes, byPriority.high.useBusinessHours, byPriority.high.assignMinutes]).toEqual([150, false, null]);
    expect(byPriority.low.resolutionMinutes).toBe(72 * 60);
  });

  it('links the global business-hours schedule when one exists', async () => {
    await migration.down(qi());
    const dept = await Department.create({ name: 'Facilities' });
    await BusinessHours.create({ name: 'Dept', departmentId: dept.id, timezone: 'UTC' });
    const global = await BusinessHours.create({ name: 'Office', departmentId: null, timezone: 'America/Chicago' });
    await migration.up(qi(), Sequelize);
    expect((await SlaPolicy.findOne({ where: { isDefault: true } })).businessHoursId).toBe(global.id);
  });

  it('adds the SLA notification types to a saved notification setting', async () => {
    await migration.down(qi());
    await models.SystemSettings.upsert({ key: 'notifications.enabledTypes', value: JSON.stringify(['assigned', 'reply']) });
    await migration.up(qi(), Sequelize);
    const row = await models.SystemSettings.findOne({ where: { key: 'notifications.enabledTypes' } });
    expect(JSON.parse(row.value)).toEqual(['assigned', 'reply', 'sla_warning', 'sla_breached']);
    expect(await enumOf('Notifications', 'type')).toEqual(expect.arrayContaining(['workflow', 'sla_warning', 'sla_breached']));
  });

  it('gives ticket statuses a Pauses SLA switch, off by default', async () => {
    const s = await TicketStatus.create({ name: 'Waiting', behaviorType: 'open', position: 99 });
    expect(s.pausesSla).toBe(false);
    await s.destroy();
  });

  it('rolls back to the old shape and re-applies', async () => {
    await migration.down(qi());
    expect(await tables()).toEqual(expect.not.arrayContaining(['SlaTargets', 'TicketSlas']));
    const [old] = await sequelize.query('SELECT priority, firstResponseHours, resolutionHours FROM SlaPolicies ORDER BY id', { type: Sequelize.QueryTypes.SELECT, plain: false });
    expect(old).toBeDefined();
    expect((await qi().describeTable('Companies')).slaPolicyId).toBeUndefined();
    expect((await qi().describeTable('TicketStatuses')).pausesSla).toBeUndefined();
    expect(await enumOf('WorkflowRules', 'triggerEvent')).toEqual(expect.arrayContaining(['ticket_created', 'ticket_closed']));
    expect(await enumOf('WorkflowRules', 'triggerEvent')).not.toContain('sla_warning');
    expect(await enumOf('WorkflowActions', 'actionType')).not.toContain('set_sla_policy');
    expect(await enumOf('Notifications', 'type')).toEqual(expect.arrayContaining(['workflow']));
    expect(await enumOf('Notifications', 'type')).not.toContain('sla_breached');

    await migration.up(qi(), Sequelize);
    expect(await tables()).toEqual(expect.arrayContaining(['SlaPolicies', 'SlaTargets', 'TicketSlas']));
    expect((await qi().describeTable('Companies')).slaPolicyId).toBeDefined();
    expect(await SlaTarget.count()).toBe(4);
    expect(await enumOf('WorkflowRules', 'triggerEvent')).toEqual(expect.arrayContaining(['ticket_created', 'ticket_overdue', 'sla_warning', 'sla_breached']));
    expect(await enumOf('WorkflowActions', 'actionType')).toEqual(expect.arrayContaining(['assign_to_user', 'escalate_to_user', 'set_sla_policy']));
  });

  it('down keeps the default policy targets as the per-priority rows', async () => {
    const std = await SlaPolicy.findOne({ where: { isDefault: true } });
    await SlaTarget.update({ responseMinutes: 45 }, { where: { slaPolicyId: std.id, priority: 'critical' } });
    await migration.down(qi());
    const rows = await sequelize.query("SELECT firstResponseHours FROM SlaPolicies WHERE priority = 'critical'", { type: Sequelize.QueryTypes.SELECT });
    expect(Number(rows[0].firstResponseHours)).toBe(0.75);
    await migration.up(qi(), Sequelize);
  });
});
