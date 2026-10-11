const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeTicket, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Plan 3c's final review and security review: the backend findings fixed in
// its one fix pass.

let w;
let tech;
let A;
let B;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  A = await makeTicket(w.admin.agent, { title: 'A', contactId: w.contact.id, departmentId: w.deptA.id });
  B = await makeTicket(w.admin.agent, { title: 'B', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const startOn = (t, body = {}) => tech.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: t.id, ...body });
const current = async () => expectOk(await tech.agent.get(`${API}/timer`)).timer;

describe('C1: automatic mode starts a timer only when none exists', () => {
  it('onlyIfIdle leaves a running timer elsewhere alone and logs nothing', async () => {
    expectOk(await startOn(A), 201);
    const res = expectOk(await startOn(B, { onlyIfIdle: true }));
    expect(res).toEqual(expect.objectContaining({ started: false, logged: null }));
    expect((await current()).id).toBe(A.id);
    expect(await models.TimeEntry.count()).toBe(0);
  });

  it('onlyIfIdle leaves a paused timer on the same ticket paused', async () => {
    expectOk(await startOn(A), 201);
    expectOk(await tech.agent.post(`${API}/timer/pause`));
    expect(expectOk(await startOn(A, { onlyIfIdle: true })).started).toBe(false);
    expect((await current()).state).toBe('paused');
  });

  it('onlyIfIdle starts when there is no timer', async () => {
    expect(expectOk(await startOn(A, { onlyIfIdle: true }), 201).started).toBe(true);
  });

  it('starting the same paused target again (without onlyIfIdle) resumes it', async () => {
    expectOk(await startOn(A), 201);
    expectOk(await tech.agent.post(`${API}/timer/pause`));
    expectOk(await startOn(A));
    expect((await current()).state).toBe('running');
  });
});

describe('I1/L1: stopping logs a timer once', () => {
  it('stop with the form\'s entry logs it and clears that timer in one call', async () => {
    freezeClock('2026-03-10T15:00:00Z');
    const { timer } = expectOk(await startOn(A), 201);
    advanceClock(20 * 60 * 1000);
    const res = expectOk(await tech.agent.post(`${API}/timer/stop`).send({
      expectTimerId: timer.timerId, entry: { durationMinutes: 20, note: 'From the form', billable: false },
    }));
    expect(res.entry).toEqual(expect.objectContaining({ ticketId: A.id, durationSeconds: 1200, note: 'From the form', billable: false }));
    expect(await current()).toBeNull();
  });

  it('a stop for a timer that was already replaced is refused, and nothing is logged twice', async () => {
    const { timer } = expectOk(await startOn(A), 201);
    expectOk(await startOn(B), 201); // logs A's timer
    const before = await models.TimeEntry.count();
    const res = await tech.agent.post(`${API}/timer/stop`).send({ expectTimerId: timer.timerId, entry: { durationMinutes: 5 } });
    expect([res.status, res.body.code]).toEqual([409, 'TIMER_CHANGED']);
    expect(await models.TimeEntry.count()).toBe(before);
    expect((await current()).id).toBe(B.id); // the new timer is untouched
  });

  it('a form entry the server refuses leaves the timer in place', async () => {
    const { timer } = expectOk(await startOn(A), 201);
    const res = await tech.agent.post(`${API}/timer/stop`).send({ expectTimerId: timer.timerId, entry: { durationMinutes: 0 } });
    expect(res.status).toBe(400);
    expect((await current()).id).toBe(A.id);
  });

  it('two stops at once log one entry', async () => {
    expectOk(await startOn(A), 201);
    await Promise.all([tech.agent.post(`${API}/timer/stop`).send({}), tech.agent.post(`${API}/timer/stop`).send({})]);
    expect(await models.TimeEntry.count()).toBe(1);
  });
});

it('L2: a long timer label is trimmed to fit, not a server error', async () => {
  const { timer } = expectOk(await startOn(A, { label: 'x'.repeat(600) }), 201);
  expect(timer.label).toHaveLength(255);
  expect(expectOk(await startOn(B, { label: ['not', 'a', 'string'] }), 201).timer.label).toBeNull();
});

describe('L3: cross-site writes are refused', () => {
  it('refuses a write a browser marks cross-site or same-site; allows same-origin, tools and reads', async () => {
    expectOk(await startOn(A), 201);
    for (const site of ['cross-site', 'same-site']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(`${API}/timer/stop`).set('Sec-Fetch-Site', site).send({});
      expect([site, res.status, res.body.code]).toEqual([site, 403, 'CROSS_SITE']);
    }
    expect((await current()).id).toBe(A.id);
    expectOk(await tech.agent.get(`${API}/timer`).set('Sec-Fetch-Site', 'cross-site'));
    expectOk(await tech.agent.post(`${API}/timer/pause`).set('Sec-Fetch-Site', 'same-origin'));
    expectOk(await tech.agent.post(`${API}/timer/resume`)); // no header: API tools, older clients
  });

  it('SAML\'s cross-site POST to the assertion consumer is not refused for being cross-site', async () => {
    const res = await w.admin.agent.post(`${API}/sso/nope/acs`).set('Sec-Fetch-Site', 'cross-site').type('form').send({ SAMLResponse: 'x' });
    expect(res.body.code).not.toBe('CROSS_SITE');
  });
});

describe('roles: nobody grants themselves or others more than they hold', () => {
  let mgr;
  let roles;
  const roleId = (name) => roles.find((r) => r.name === name).id;
  const toggle = (agent, role, key, granted) => agent.patch(`${API}/roles/${roleId(role)}/permissions/${key}`).send({ granted });
  beforeEach(async () => {
    mgr = await makeManager('mgr', w.deptA.id);
    for (const key of ['people.manage_roles', 'people.manage_permission_overrides']) {
      // eslint-disable-next-line no-await-in-loop
      expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: key, granted: true }), 201);
    }
    roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  });
  afterEach(async () => {
    // Seeded roles are not reset between tests: undo what a test granted.
    await toggle(w.admin.agent, 'Read Only', 'tickets.create', false);
    await toggle(w.admin.agent, 'Read Only', 'tickets.edit_own', false);
  });

  it('can\'t change the permissions of a role they hold', async () => {
    expect((await toggle(mgr.agent, 'Department Manager', 'tickets.view_all', true)).body)
      .toEqual({ error: true, message: 'You cannot change the permissions of a role you hold', code: 'FORBIDDEN' });
  });

  it('can grant only permissions they hold (a broader tier counts), on roles and new roles', async () => {
    expect((await toggle(mgr.agent, 'Read Only', 'settings.manage_system', true)).body)
      .toEqual({ error: true, message: 'You can only grant permissions you hold', code: 'FORBIDDEN' });
    expectOk(await toggle(mgr.agent, 'Read Only', 'tickets.create', true));
    expectOk(await toggle(mgr.agent, 'Read Only', 'tickets.edit_own', true)); // mgr holds edit_department
    const res = await mgr.agent.post(`${API}/roles`).send({ name: 'Sneaky', permissionKeys: ['settings.manage_system'] });
    expect(res.body.message).toBe('You can only grant permissions you hold');
    expect(await models.Role.count({ where: { name: 'Sneaky' } })).toBe(0);
  });

  it('can grant a user an override only for a permission they hold', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const res = await mgr.agent.post(`${API}/users/${staff.user.id}/overrides`).send({ permissionKey: 'settings.manage_system', granted: true });
    expect(res.body).toEqual({ error: true, message: 'You can only grant permissions you hold', code: 'FORBIDDEN' });
    expectOk(await mgr.agent.post(`${API}/users/${staff.user.id}/overrides`).send({ permissionKey: 'tickets.view_all', granted: false }), 201);
  });

  it('a System Administrator is not limited', async () => {
    expectOk(await toggle(w.admin.agent, 'Read Only', 'tickets.create', true));
  });
});

it('the time.log description says view access, not edit', async () => {
  const p = await models.Permission.findOne({ where: { key: 'time.log' } });
  expect(p.description).toBe('Log your own time on tickets and projects you can see');
});
