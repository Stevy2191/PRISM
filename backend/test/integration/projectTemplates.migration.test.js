const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize, createUser, ROLE } = require('./helpers');
const migration = require('../../migrations/20260101000070-project-templates');

const qi = () => sequelize.getQueryInterface();
const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const NEW_TABLES = ['ProjectTemplates', 'ProjectTemplatePhases', 'ProjectTemplateTasks', 'ProjectTemplateDependencies'];

beforeEach(resetData);
afterAll(closeDb);

it('up creates the tables, the Projects column and the permission', async () => {
  expect(await tables()).toEqual(expect.arrayContaining(NEW_TABLES));
  expect(Object.keys(await qi().describeTable('ProjectTemplates'))).toEqual(expect.arrayContaining(['id', 'name', 'description', 'hourBudgetMinutes', 'tags', 'sourceProjectId', 'createdBy', 'createdAt', 'updatedAt']));
  expect(Object.keys(await qi().describeTable('ProjectTemplateTasks'))).toEqual(expect.arrayContaining(['templateId', 'templatePhaseId', 'parentId', 'title', 'startDay', 'lengthDays', 'estimateMinutes', 'priority', 'isMilestone', 'position']));
  expect((await qi().describeTable('Projects')).templateId).toBeDefined();
  const rows = await select(
    `SELECT p.\`key\`, p.category FROM Permissions p
       JOIN RolePermissions rp ON rp.permissionId = p.id JOIN Roles r ON r.id = rp.roleId
      WHERE r.name = 'System Administrator' AND p.\`key\` = 'projects.manage_templates'`
  );
  expect(rows).toEqual([{ key: 'projects.manage_templates', category: 'projects' }]);
});

it('round trip', async () => {
  const { user } = await createUser({ username: 'tpl-user', roleName: ROLE.ADMIN });
  await sequelize.query(
    "INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt) VALUES (?, 'projects.manage_templates', 1, NOW())",
    { replacements: [user.id] }
  );
  expect(await select("SELECT 1 FROM UserPermissionOverrides WHERE permissionKey = 'projects.manage_templates'")).toHaveLength(1);
  await migration.down(qi(), Sequelize);
  try {
    const t = await tables();
    for (const name of NEW_TABLES) expect(t).not.toContain(name);
    expect((await qi().describeTable('Projects')).templateId).toBeUndefined();
    expect(await select("SELECT id FROM Permissions WHERE `key` = 'projects.manage_templates'")).toHaveLength(0);
    expect(await select("SELECT 1 FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId WHERE p.`key` = 'projects.manage_templates'")).toHaveLength(0);
    expect(await select("SELECT 1 FROM UserPermissionOverrides WHERE permissionKey = 'projects.manage_templates'")).toHaveLength(0);
  } finally {
    await migration.up(qi(), Sequelize);
  }
  await migration.up(qi(), Sequelize); // idempotent
  expect(await tables()).toEqual(expect.arrayContaining(NEW_TABLES));
  expect(await select("SELECT id FROM Permissions WHERE `key` = 'projects.manage_templates'")).toHaveLength(1);
});
