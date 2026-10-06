const Sequelize = require('sequelize');
const { sequelize, closeDb, resetData, models } = require('./helpers');
const { makeWorld, makeTicket } = require('./fixtures');

const migration = require('../../migrations/20260101000050-one-work-model');

// The one-work-model migration (spec: Migration, Testing). Seeds today's
// shape with raw SQL — including the awkward rows a real install has — then
// checks nothing is lost, and that down() round-trips or refuses.

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
const run = (sql, replacements) => sequelize.query(sql, { replacements });
const one = async (sql, r) => (await q(sql, r))[0];
// The driver hands back JSON columns already parsed.
const detailOf = (row) => (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail);

let w;
let ticket;
let project;
let statuses; // project statuses by name
beforeAll(async () => {
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id });
  // Straight through the model: the API's response reads time, and which time
  // tables exist is exactly what this suite moves back and forth.
  project = await models.Project.create({ name: 'Refresh', projectCode: 'SD-P00001', ownerDepartmentId: w.deptA.id, status: 'Active' });
  statuses = Object.fromEntries((await q('SELECT id, name FROM ProjectStatuses')).map((s) => [s.name, s.id]));
});
afterAll(async () => {
  // Leave the schema migrated and empty for later suites.
  const names = (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!names.includes('legacy_TimeEntries')) await migration.up(qi(), Sequelize);
  await resetData();
  await closeDb();
});

// Today's shape, written straight into the old tables (down() puts them back).
async function seedLegacy() {
  const u = w.admin.user.id;
  await run(`INSERT INTO ProjectTasks (id, projectId, taskCode, title, description, statusId, priority, assignedToUserId, dueDate, linkedTicketId, position, completedAt, createdBy, createdAt, updatedAt) VALUES
    (1, :p, 'SD-P00001-T01', 'Rack', 'Two racks', :active, 'high', :u, '2026-04-01', :t, 1, NULL, :u, '2026-03-01 10:00:00', '2026-03-01 10:00:00'),
    (2, :p, NULL, 'Uncoded', NULL, :completed, 'medium', NULL, NULL, NULL, 2, '2026-03-02 10:00:00', :u, '2026-03-01 11:00:00', '2026-03-02 10:00:00')`,
  { p: project.id, active: statuses.Active, completed: statuses.Completed, u, t: ticket.id });
  await run(`INSERT INTO ProjectSubtasks (id, taskId, subtaskCode, title, statusId, assignedToUserId, dueDate, completedAt, position, createdAt, updatedAt) VALUES
    (1, 1, 'SD-P00001-T01-S01', 'Cable', :completed, :u, NULL, '2026-03-03 10:00:00', 1, '2026-03-01 12:00:00', '2026-03-03 10:00:00'),
    (2, 1, 'SD-P00001-T01-S02', 'Label', :active, NULL, '2026-04-02', NULL, 2, '2026-03-01 12:00:01', '2026-03-01 12:00:01'),
    (3, 999, 'GONE-T01-S01', 'Orphan', :active, NULL, NULL, NULL, 1, '2026-03-01 12:00:02', '2026-03-01 12:00:02')`,
  { active: statuses.Active, completed: statuses.Completed, u });
  // Two checklist items on the ticket, one done; 101 on a deleted ticket with a 6-digit id.
  await run(`INSERT INTO TicketTasks (id, ticketId, description, completed, assigneeId, createdAt, updatedAt) VALUES
    (1, :t, 'Swap toner', 0, :u, '2026-03-01 09:00:00', '2026-03-01 09:00:00'),
    (2, :t, 'Test print', 1, NULL, '2026-03-01 09:00:00', '2026-03-05 09:00:00')`, { t: ticket.id, u });
  // Rows that point at a deleted ticket need the old foreign keys off — on one
  // connection, so inside a transaction.
  const many = Array.from({ length: 101 }, (_, i) => `(${10 + i}, 123456, 'Item ${i + 1}', 0, NULL, '2026-03-01 09:00:00', '2026-03-01 09:00:00')`);
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    await sequelize.query(`INSERT INTO TicketTasks (id, ticketId, description, completed, assigneeId, createdAt, updatedAt) VALUES ${many.join(', ')}`, { transaction });
    // Ticket time: a span, a plain-minutes entry with no durationSeconds, and time on a deleted ticket.
    await sequelize.query(`INSERT INTO TimeEntries (id, ticketId, userId, loggedById, minutes, note, loggedAt, entryDate, startTime, endTime, durationSeconds, laborCost) VALUES
      (1, :t, :u, :u, 91, 'span', '2026-03-05 16:00:00', '2026-03-05', '2026-03-05 15:00:00', '2026-03-05 16:30:30', 5430, 113.13),
      (2, :t, :u, NULL, 45, 'timer', '2026-03-06 09:00:00', '2026-03-06', NULL, NULL, NULL, NULL),
      (3, 777777, :u, :u, 10, 'orphan ticket', '2026-03-06 10:00:00', '2026-03-06', NULL, NULL, 600, NULL)`,
    { replacements: { t: ticket.id, u }, transaction });
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
  });
  // Project time: logged by the admin for themselves, and on a task.
  await run(`INSERT INTO ProjectTimeEntries (id, projectId, taskId, userId, loggedForUserId, description, startTime, endTime, durationSeconds, entryDate, createdAt, laborCost) VALUES
    (1, :p, 1, :u, :u, 'racking', '2026-03-10 13:00:00', '2026-03-10 15:00:00', 7200, '2026-03-10', '2026-03-10 15:00:00', NULL),
    (2, :p, NULL, :u, NULL, 'old row', '2026-03-10 16:00:00', '2026-03-10 16:30:00', NULL, '2026-03-10', '2026-03-10 16:30:00', 37.5)`,
  { p: project.id, u });
  await run(`INSERT INTO ProjectActivities (projectId, userId, action, detail, createdAt) VALUES
    (:p, :u, 'subtask_closed', '{"subtaskId":1,"title":"Cable","subtaskCode":"SD-P00001-T01-S01"}', NOW())`, { p: project.id, u });
  await run('INSERT INTO ActiveTimers (userId, entityType, entityId, label, startedAt) VALUES (:u, \'ticket\', :t, \'Working\', NOW())', { u, t: ticket.id });
}

const totals = async () => ({
  ticketSeconds: Number((await one('SELECT COALESCE(SUM(durationSeconds),0) AS s FROM TimeEntries WHERE ticketId = :t', { t: ticket.id })).s),
  projectSeconds: Number((await one('SELECT COALESCE(SUM(durationSeconds),0) AS s FROM TimeEntries WHERE projectId = :p', { p: project.id })).s),
  labour: Math.round(Number((await one('SELECT COALESCE(SUM(laborCost),0) AS s FROM TimeEntries')).s) * 100) / 100,
});

describe('the one-work-model migration', () => {
  it('copies tasks, subtasks, checklist items and time without loss', async () => {
    await migration.down(qi(), Sequelize);
    await seedLegacy();
    await migration.up(qi(), Sequelize);

    // Time: every second and every cent arrives; who it's for is fixed (Q4).
    expect(await totals()).toEqual({ ticketSeconds: 5430 + 2700, projectSeconds: 7200 + 1800, labour: 150.63 });
    expect(await one('SELECT id, loggedById, durationSeconds FROM TimeEntries WHERE id = 2')).toEqual({ id: 2, loggedById: null, durationSeconds: 2700 });
    expect(Number((await one('SELECT COUNT(*) AS n FROM TimeEntries WHERE ticketId = 777777')).n)).toBe(1);
    const projectTime = await q('SELECT e.id, e.userId, e.loggedById, e.note, w.name AS workType FROM TimeEntries e JOIN WorkTypes w ON w.id = e.workTypeId WHERE e.projectId = :p ORDER BY e.id', { p: project.id });
    expect(projectTime.map((e) => [e.note, e.workType])).toEqual([['racking', 'Project work'], ['old row', 'Project work']]);
    expect(projectTime.every((e) => e.id > 3)).toBe(true); // above every ticket time id
    expect(await q('SELECT oldTable, oldId, newId FROM TimeEntryIdMap ORDER BY oldId')).toEqual([
      { oldTable: 'ProjectTimeEntries', oldId: 1, newId: projectTime[0].id },
      { oldTable: 'ProjectTimeEntries', oldId: 2, newId: projectTime[1].id },
    ]);

    // Project tasks keep their ids, statuses and codes; a missing code is generated.
    const tasks = await q('SELECT id, code, title, statusId, priority, assigneeId, dueDate, position, linkedTicketId FROM Tasks WHERE projectId = :p AND parentTaskId IS NULL ORDER BY id', { p: project.id });
    expect(tasks.map((t) => [t.id, t.code, t.statusId, t.priority])).toEqual([
      [1, 'SD-P00001-T01', statuses.Active, 'high'], [2, 'SD-P00001-T02', statuses.Completed, 'medium'],
    ]);
    expect(tasks[0].linkedTicketId).toBe(ticket.id);
    // The project-scope task statuses are the project statuses, ids and all.
    const scope = await q("SELECT id, name, behaviorType FROM TaskStatuses WHERE scope = 'project' ORDER BY id");
    const projectStatuses = await q('SELECT id, name, behaviorType FROM ProjectStatuses ORDER BY id');
    expect(scope).toEqual(projectStatuses);

    // Subtasks become tasks under their task; the orphan stays behind.
    const subs = await q('SELECT t.id, t.code, t.title, t.parentTaskId, m.oldId FROM Tasks t JOIN TaskIdMap m ON m.newId = t.id AND m.oldTable = \'ProjectSubtasks\' ORDER BY m.oldId');
    expect(subs.map((s) => [s.oldId, s.code, s.parentTaskId])).toEqual([[1, 'SD-P00001-T01-S01', 1], [2, 'SD-P00001-T01-S02', 1]]);
    expect(Number((await one("SELECT COUNT(*) AS n FROM Tasks WHERE title = 'Orphan'")).n)).toBe(0);
    expect(Number((await one('SELECT COUNT(*) AS n FROM legacy_ProjectSubtasks')).n)).toBe(3);

    // Checklist items: To do / Done, numbered per ticket, even past 99 and past ticket 99999.
    const items = await q(`SELECT t.code, t.title, s.name AS status, t.completedAt FROM Tasks t JOIN TaskStatuses s ON s.id = t.statusId
      WHERE t.ticketId = :t ORDER BY t.position`, { t: ticket.id });
    const pad = String(ticket.id).padStart(5, '0');
    expect(items.map((i) => [i.code, i.title, i.status])).toEqual([
      [`#${pad}-T01`, 'Swap toner', 'To do'], [`#${pad}-T02`, 'Test print', 'Done'],
    ]);
    expect(items[1].completedAt).not.toBeNull();
    const big = await q("SELECT code FROM Tasks WHERE ticketId = 123456 ORDER BY position DESC LIMIT 2");
    expect(big.map((b) => b.code)).toEqual(['#123456-T101', '#123456-T100']);

    // Activity naming a subtask, and timers, point at the new ids.
    const [act] = await q("SELECT detail FROM ProjectActivities WHERE action = 'subtask_closed'");
    expect(detailOf(act).subtaskId).toBe(subs[0].id);
    expect(await one('SELECT entityType, entityId, taskId FROM ActiveTimers')).toEqual({ entityType: 'ticket', entityId: ticket.id, taskId: null });
  });

  it('grants the time permissions to the roles that could log time', async () => {
    const holders = async (key) => (await q(`SELECT r.name FROM Roles r JOIN RolePermissions rp ON rp.roleId = r.id JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` = :key AND rp.granted = 1 ORDER BY r.name`, { key })).map((r) => r.name);
    const logTime = await holders('projects.log_time');
    for (const name of logTime) expect(await holders('time.log')).toContain(name);
    expect(await holders('time.log')).not.toContain('Read Only');
    expect(await holders('time.manage_others')).toEqual(['Department Manager', 'System Administrator']);
  });

  it('round-trips through down() while nothing new exists', async () => {
    const before = await totals();
    await migration.down(qi(), Sequelize);
    expect(Number((await one('SELECT COUNT(*) AS n FROM TicketTasks WHERE ticketId = :t', { t: ticket.id })).n)).toBe(2);
    expect(await q('SELECT id, taskCode FROM ProjectTasks ORDER BY id')).toEqual([
      { id: 1, taskCode: 'SD-P00001-T01' }, { id: 2, taskCode: 'SD-P00001-T02' },
    ]);
    expect((await q('SELECT id, subtaskCode FROM ProjectSubtasks ORDER BY id')).map((s) => s.id)).toEqual([1, 2]);
    expect(await q('SELECT id, loggedForUserId FROM ProjectTimeEntries ORDER BY id')).toEqual([
      { id: 1, loggedForUserId: w.admin.user.id }, { id: 2, loggedForUserId: w.admin.user.id },
    ]);
    const [act] = await q("SELECT detail FROM ProjectActivities WHERE action = 'subtask_closed'");
    expect(detailOf(act).subtaskId).toBe(1);
    await migration.up(qi(), Sequelize);
    expect(await totals()).toEqual(before);
  });

  it('refuses to roll back once something the old tables can\'t hold exists', async () => {
    const [todo] = await q("SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND name = 'To do'");
    const [parentTask] = await q('SELECT id FROM Tasks WHERE ticketId = :t ORDER BY id LIMIT 1', { t: ticket.id });
    await run(`INSERT INTO Tasks (ticketId, parentTaskId, code, title, statusId, priority, position, createdAt, updatedAt)
      VALUES (:t, :parent, 'X-SUB', 'Sub', :todo, 'medium', 1, NOW(), NOW())`, { t: ticket.id, parent: parentTask.id, todo: todo.id });
    await expect(migration.down(qi(), Sequelize)).rejects.toThrow(/ticket tasks with subtasks/);
    expect((await qi().describeTable('Tasks')).id).toBeDefined();
  });
});
