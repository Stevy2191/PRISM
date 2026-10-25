const Sequelize = require('sequelize');
const { resetData, closeDb, createUser, ROLE, sequelize, models } = require('./helpers');
const migration = require('../../migrations/20260101000069-project-structure');

const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const enumOf = async () => {
  const [rows] = await sequelize.query("SHOW COLUMNS FROM `Notifications` LIKE 'type'");
  return [...String(rows[0].Type).matchAll(/'([^']*)'/g)].map((m) => m[1]);
};
const NEW_TYPES = ['task_unblocked', 'task_added', 'budget_warning', 'budget_reached'];

beforeEach(resetData);
afterAll(closeDb);

it('up adds tables and columns', async () => {
  expect(await tables()).toEqual(expect.arrayContaining(['ProjectPhases', 'TaskDependencies', 'TaskAssignees']));
  expect(Object.keys(await qi().describeTable('ProjectPhases'))).toEqual(expect.arrayContaining(['id', 'projectId', 'name', 'position', 'hourBudgetMinutes', 'createdAt', 'updatedAt']));
  expect(Object.keys(await qi().describeTable('TaskDependencies'))).toEqual(expect.arrayContaining(['id', 'predecessorId', 'successorId', 'createdBy', 'createdAt']));
  expect(Object.keys(await qi().describeTable('TaskAssignees'))).toEqual(expect.arrayContaining(['id', 'taskId', 'userId', 'addedBy', 'createdAt']));
  expect(Object.keys(await qi().describeTable('Tasks'))).toEqual(expect.arrayContaining(['phaseId', 'startDate', 'isMilestone']));
  expect(Object.keys(await qi().describeTable('Projects'))).toEqual(expect.arrayContaining(['startDate', 'hourBudgetMinutes', 'budgetAlertLevel', 'budgetAlert80', 'budgetAlert100']));
  expect((await qi().describeTable('Notifications')).projectId).toBeDefined();
  expect(await enumOf()).toEqual(expect.arrayContaining([...NEW_TYPES, 'virus_blocked']));
});

it('registers the models and the helpers association', () => {
  expect(models.ProjectPhase).toBeDefined();
  expect(models.TaskDependency).toBeDefined();
  expect(models.TaskAssignee).toBeDefined();
  expect(models.Task.associations.helpers).toBeDefined();
  expect(models.Task.associations.phase).toBeDefined();
  expect(models.Project.associations.phases).toBeDefined();
});

it('down removes them and the enum values (rows with new types are deleted first)', async () => {
  const { user } = await createUser({ username: 'ps-admin2', roleName: ROLE.ADMIN });
  await models.Notification.create({ userId: user.id, type: 'budget_warning', message: 'x' });
  await models.Notification.create({ userId: user.id, type: 'comment', message: 'keep' });
  await migration.down(qi(), Sequelize);
  try {
    expect(await tables()).not.toEqual(expect.arrayContaining(['ProjectPhases']));
    const t = await tables();
    expect(t).not.toContain('TaskDependencies');
    expect(t).not.toContain('TaskAssignees');
    expect((await qi().describeTable('Tasks')).phaseId).toBeUndefined();
    expect((await qi().describeTable('Tasks')).isMilestone).toBeUndefined();
    expect((await qi().describeTable('Projects')).budgetAlertLevel).toBeUndefined();
    expect((await qi().describeTable('Notifications')).projectId).toBeUndefined();
    const e = await enumOf();
    for (const v of NEW_TYPES) expect(e).not.toContain(v);
    expect(e).toContain('virus_blocked');
    const [rows] = await sequelize.query('SELECT COUNT(*) AS n FROM Notifications');
    expect(Number(rows[0].n)).toBe(1);
  } finally {
    await migration.up(qi(), Sequelize);
  }
});

it('up again succeeds', async () => {
  await migration.down(qi(), Sequelize);
  await migration.up(qi(), Sequelize);
  await migration.up(qi(), Sequelize); // idempotent
  expect(await tables()).toEqual(expect.arrayContaining(['ProjectPhases', 'TaskDependencies', 'TaskAssignees']));
  expect(await enumOf()).toEqual(expect.arrayContaining(NEW_TYPES));
});
