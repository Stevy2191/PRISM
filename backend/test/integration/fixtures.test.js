const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeTicket, makeProject,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Guards for the harness itself: if these fail, every baseline suite's
// results are suspect.

afterAll(closeDb);
afterEach(unfreezeClock);

describe('resetData()', () => {
  it('restarts project codes and drops the previous run\'s project activity', async () => {
    await resetData();
    const w = await makeWorld();
    const p1 = await makeProject(w.admin.agent, { name: 'First', ownerDepartmentId: w.deptA.id });
    expect(p1.projectCode).toBe('SD-P00001');

    await resetData();
    const w2 = await makeWorld();
    const p2 = await makeProject(w2.admin.agent, { name: 'Second', ownerDepartmentId: w2.deptA.id });
    expect(p2.projectCode).toBe('SD-P00001');
    const activity = expectOk(await w2.admin.agent.get(`${API}/projects/${p2.id}/activity`)).activity;
    expect(activity.map((a) => a.detail.name)).toEqual(['Second']);
  });

  it('clears settings the baseline flips', async () => {
    await resetData();
    const w = await makeWorld();
    expectOk(await w.admin.agent.patch(`${API}/settings`).send({
      'timeTracking.requireBeforeClose': 'true', 'csat.enabled': 'true',
    }));
    await resetData();
    // No endpoint distinguishes "unset" from "set to the default".
    const keys = (await models.SystemSettings.findAll({ raw: true })).map((r) => r.key);
    expect(keys).not.toContain('timeTracking.requireBeforeClose');
    expect(keys).not.toContain('csat.enabled');
  });
});

describe('time zone', () => {
  it('runs every suite in America/Chicago so UTC and local dates can differ', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Chicago');
    expect(new Date('2026-03-10T03:30:00Z').getDate()).toBe(9);
  });
});

describe('fixtures', () => {
  beforeEach(resetData);

  it('makes an own-tier user who sees only tickets assigned to them', async () => {
    const w = await makeWorld();
    const own = await makeOwnTier(w.admin, 'owner', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: own.user.id });
    const theirs = await makeTicket(w.admin.agent, { title: 'Theirs', contactId: w.contact.id, departmentId: w.deptA.id });
    expect((await own.agent.get(`${API}/tickets/${mine.id}`)).status).toBe(200);
    expect((await own.agent.get(`${API}/tickets/${theirs.id}`)).status).toBe(403);
  });

  it('makes a contractor whose time carries labour cost', async () => {
    const w = await makeWorld();
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
    const entry = expectOk(await ctr.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 30 }), 201).entry;
    expect(entry.laborCost).toBe(30);
  });

  it('freezes only Date, leaving the database driver\'s timers alone', async () => {
    freezeClock('2026-03-10T03:30:00Z');
    const w = await makeWorld();
    const tech = await makeTech('clocky', w.deptA.id);
    const t = await makeTicket(tech.agent, { title: 'T', contactId: w.contact.id });
    expect(t.createdAt).toBe('2026-03-10T03:30:00.000Z');
    advanceClock(90 * 1000);
    expect(new Date().toISOString()).toBe('2026-03-10T03:31:30.000Z');
  });
});
