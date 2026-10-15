const Sequelize = require('sequelize');
const {
  resetData, closeDb, sequelize, createUserAndLogin, ROLE,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket,
} = require('./fixtures');

const migration = require('../../migrations/20260101000062-retire-assign-close-permissions');

// User rule 2026-10-14: anyone who can edit a ticket may reassign it (to
// themselves or anyone else — e.g. a tech out sick) and close it from the
// ticket. Edit access is the only gate; tickets.assign and tickets.close
// were UI-only switches and are retired.

let w;
let staff;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  staff = await makeStaff('staff', w.deptA.id); // Department Staff: edit_own
  tech = await makeTech('tech', w.deptA.id); // System Technician: edit_all
});
afterAll(closeDb);

const base = () => ({ title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });

describe('edit access is the gate for reassigning and closing', () => {
  it('a tech can hand their own ticket to someone else and back', async () => {
    const mine = await makeTicket(w.admin.agent, { ...base(), assigneeId: staff.user.id });
    const handed = expectOk(await staff.agent.patch(`${API}/tickets/${mine.id}`).send({ assigneeId: tech.user.id })).ticket;
    expect(handed.assigneeId).toBe(tech.user.id);
  });

  it('anyone who can edit can take or reassign someone else\'s ticket', async () => {
    const sick = await makeTicket(w.admin.agent, { ...base(), assigneeId: staff.user.id });
    const taken = expectOk(await tech.agent.patch(`${API}/tickets/${sick.id}`).send({ assigneeId: tech.user.id })).ticket;
    expect(taken.assigneeId).toBe(tech.user.id);
    const cleared = expectOk(await tech.agent.patch(`${API}/tickets/${sick.id}`).send({ assigneeId: null })).ticket;
    expect(cleared.assigneeId).toBeNull();
  });

  it('a tech can close their ticket from the ticket itself', async () => {
    const mine = await makeTicket(w.admin.agent, { ...base(), assigneeId: staff.user.id });
    expect(expectOk(await staff.agent.patch(`${API}/tickets/${mine.id}`).send({ status: 'Closed' })).ticket.status).toBe('Closed');
  });

  it('view-only access can neither reassign nor close', async () => {
    const reader = await createUserAndLogin({ username: 'reader', roleName: ROLE.READ_ONLY, departmentId: w.deptA.id });
    const t = await makeTicket(w.admin.agent, { ...base(), assigneeId: staff.user.id });
    expect((await reader.agent.patch(`${API}/tickets/${t.id}`).send({ assigneeId: tech.user.id })).status).toBe(403);
    expect((await reader.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Closed' })).status).toBe(403);
  });
});

describe('retire tickets.assign and tickets.close', () => {
  const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
  const keys = async () => (await q("SELECT `key` FROM Permissions WHERE `key` IN ('tickets.assign', 'tickets.close') ORDER BY `key`")).map((r) => r.key);

  it('removes the permissions with their role grants and overrides, and round-trips', async () => {
    expect(await keys()).toEqual([]);
    await migration.down(sequelize.getQueryInterface(), Sequelize);
    expect(await keys()).toEqual(['tickets.assign', 'tickets.close']);
    await sequelize.query(`INSERT INTO UserPermissionOverrides (userId, permissionKey, granted, createdAt)
      VALUES (:u, 'tickets.assign', 1, NOW())`, { replacements: { u: staff.user.id } });
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    expect(await keys()).toEqual([]);
    expect(await q("SELECT id FROM UserPermissionOverrides WHERE permissionKey IN ('tickets.assign', 'tickets.close')")).toEqual([]);
  });
});
