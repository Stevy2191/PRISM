const { resetData, closeDb, models, sequelize } = require('./helpers');
const { generateProjectCode } = require('../../src/services/projectCodeService');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeTicket, makeProject,
  makeTask, makeTeam, projectStatusId, freezeClock, unfreezeClock,
} = require('./fixtures');

// Baseline for projects themselves: create and codes, get, update, delete,
// list, tags and stats.

let w;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
});
afterEach(unfreezeClock);
afterAll(closeDb);

const projUrl = (p) => `${API}/projects/${p.id}`;
const addMember = async (p, userId, role) => expectOk(
  await w.admin.agent.post(`${projUrl(p)}/members`).send({ userId, role }), 201
);
const grantOverride = async (userId, permissionKey, granted) => expectOk(
  await w.admin.agent.post(`${API}/users/${userId}/overrides`).send({ permissionKey, granted }), 201
);

describe('POST /projects', () => {
  it('applies defaults', async () => {
    const p = await makeProject(tech.agent, { name: '  Refresh  ', ownerDepartmentId: w.deptA.id });
    expect(p).toEqual(expect.objectContaining({
      name: 'Refresh', projectCode: 'SD-P00001', status: 'Active', forDepartmentId: w.deptA.id,
      assignedToUserId: null, teamId: null, dueDate: null, tags: null, description: null,
      createdBy: tech.user.id, closedAt: null, members: [],
    }));
    expect(p.ownerDepartment).toEqual({ id: w.deptA.id, name: 'Service Desk' });
    expect(p.stats).toEqual({
      completionPercent: 0, totalTasks: 0, closedTasks: 0, totalTimeSeconds: 0, laborCost: 0, totalCost: 0, openTicketsCount: 0,
    });
  });

  it('numbers projects per department', async () => {
    const codes = [];
    for (const dept of [w.deptA, w.deptA, w.deptB]) {
      // eslint-disable-next-line no-await-in-loop
      codes.push((await makeProject(tech.agent, { name: 'P', ownerDepartmentId: dept.id })).projectCode);
    }
    expect(codes).toEqual(['SD-P00001', 'SD-P00002', 'FAC-P00001']);
  });

  // The per-department counter used to race: a department's first project
  // lost a findOrCreate race (400), and later ones hit MariaDB 11's
  // snapshot-isolation error 1020 on the FOR UPDATE read (500). Several
  // rounds, including the very first project, so both paths are exercised.
  it('simultaneous creates in one department all succeed with distinct codes', async () => {
    const send = (name) => tech.agent.post(`${API}/projects`).send({ name, ownerDepartmentId: w.deptA.id });
    const codes = [];
    for (let round = 0; round < 3; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all([send('One'), send('Two'), send('Three')]);
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      codes.push(...results.map((r) => r.body.project.projectCode));
    }
    expect(codes.sort()).toEqual(Array.from({ length: 9 }, (_, i) => `SD-P0000${i + 1}`));
  });

  it('the counter refuses a transaction that would fail under concurrency', async () => {
    // Guards future callers: under the default REPEATABLE READ, MariaDB 11
    // fails concurrent increments instead of queueing them.
    await expect(sequelize.transaction((t) => generateProjectCode(w.deptA.id, t)))
      .rejects.toThrow('nextProjectSequence needs a READ COMMITTED transaction');
  });

  it('never reuses a deleted project\'s number', async () => {
    const first = await makeProject(tech.agent, { name: 'First', ownerDepartmentId: w.deptA.id });
    expectOk(await w.admin.agent.delete(projUrl(first)));
    const second = await makeProject(tech.agent, { name: 'Second', ownerDepartmentId: w.deptA.id });
    expect(second.projectCode).toBe('SD-P00002');
  });

  it('makes the lead a lead member and the rest members', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const staff = await makeStaff('staff', w.deptA.id);
    const p = await makeProject(tech.agent, {
      name: 'P', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id,
      memberIds: [mgr.user.id, staff.user.id, tech.user.id],
    });
    const roles = Object.fromEntries(p.members.map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [tech.user.id]: 'lead', [mgr.user.id]: 'member', [staff.user.id]: 'member' });
    expect(p.lead.username).toBe('tech');
  });

  it('keeps an explicit status and stamps closedAt for a closed one', async () => {
    const onHold = await makeProject(tech.agent, { name: 'H', ownerDepartmentId: w.deptA.id, status: 'On Hold' });
    expect(onHold).toEqual(expect.objectContaining({ status: 'On Hold', closedAt: null }));
    const done = await makeProject(tech.agent, { name: 'D', ownerDepartmentId: w.deptA.id, status: 'Completed' });
    expect(typeof done.closedAt).toBe('string');
  });

  it('validates input', async () => {
    const cases = [
      [{ ownerDepartmentId: w.deptA.id }, 'Project name is required'],
      [{ name: '   ', ownerDepartmentId: w.deptA.id }, 'Project name is required'],
      [{ name: 'x' }, 'Owned by department is required'],
      [{ name: 'x', ownerDepartmentId: 99999 }, 'Owned-by department does not exist'],
      [{ name: 'x', ownerDepartmentId: w.deptA.id, forDepartmentId: 99999 }, 'For-department does not exist'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(`${API}/projects`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('logs project_created', async () => {
    const p = await makeProject(tech.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
    const { activity } = expectOk(await tech.agent.get(`${projUrl(p)}/activity`));
    expect(activity.map((a) => ({ action: a.action, detail: a.detail })))
      .toEqual([{ action: 'project_created', detail: { name: 'Refresh', projectCode: 'SD-P00001' } }]);
  });
});

describe('GET /projects/:id and scope', () => {
  it('GET a missing or non-numeric project', async () => {
    const res = await tech.agent.get(`${API}/projects/99999`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Project not found', code: 'NOT_FOUND' });
    expect((await tech.agent.get(`${API}/projects/abc`)).status).toBe(404);
  });

  it('own-tier sees only projects they are a member of', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const before = await own.agent.get(projUrl(p));
    expect(before.status).toBe(403);
    expect(before.body).toEqual({ error: true, message: 'You do not have access to this project', code: 'FORBIDDEN' });
    await addMember(p, own.user.id);
    expect((await own.agent.get(projUrl(p))).status).toBe(200);
  });

  it('department-tier sees projects owned by or for their department, or that they belong to', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const a = w.admin.agent;
    const bForB = await makeProject(a, { name: 'P', ownerDepartmentId: w.deptB.id });
    const bForA = await makeProject(a, { name: 'Q', ownerDepartmentId: w.deptB.id, forDepartmentId: w.deptA.id });
    const bMember = await makeProject(a, { name: 'R', ownerDepartmentId: w.deptB.id, memberIds: [mgr.user.id] });
    expect((await mgr.agent.get(projUrl(bForB))).status).toBe(403);
    expect((await mgr.agent.get(projUrl(bForA))).status).toBe(200);
    expect((await mgr.agent.get(projUrl(bMember))).status).toBe(200);
  });
});

describe('PATCH /projects/:id', () => {
  it('updates every allowed field', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const team = await makeTeam(w.admin, 'Projects', [{ userId: tech.user.id, isLead: true }]);
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const changes = {
      name: 'Renamed', description: 'Desc', status: 'On Hold', ownerDepartmentId: w.deptB.id, forDepartmentId: w.deptB.id,
      assignedToUserId: mgr.user.id, teamId: team.id, dueDate: '2026-12-31', tags: ['vpn'],
    };
    const { project } = expectOk(await tech.agent.patch(projUrl(p)).send(changes));
    expect(project).toEqual(expect.objectContaining(changes));
  });

  // Likely correct: 400 VALIDATION_ERROR, as on create. Expected to change in sub-project 3.
  it('[quirk] Q38: update accepts a blank or whitespace name', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    for (const name of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop
      expect(expectOk(await tech.agent.patch(projUrl(p)).send({ name })).project.name).toBe(name);
    }
  });

  it('an empty tags list is stored as null', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id, tags: ['x'] });
    expect(expectOk(await tech.agent.patch(projUrl(p)).send({ tags: [] })).project.tags).toBeNull();
  });

  it('logs a status change and stamps or clears closedAt', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const patch = async (status) => expectOk(await tech.agent.patch(projUrl(p)).send({ status })).project;
    await patch('On Hold');
    await patch('On Hold');
    const { activity } = expectOk(await tech.agent.get(`${projUrl(p)}/activity`));
    expect(activity.filter((a) => a.action === 'status_changed').map((a) => a.detail))
      .toEqual([{ from: 'Active', to: 'On Hold' }]);
    expect(typeof (await patch('Completed')).closedAt).toBe('string');
    expect((await patch('Active')).closedAt).toBeNull();
  });

  // Likely correct: the new lead becomes a lead member. Expected to change in sub-project 3.
  it('[quirk] Q30: changing the lead does not change membership', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id });
    const { project } = expectOk(await tech.agent.patch(projUrl(p)).send({ assignedToUserId: mgr.user.id }));
    expect(project.members.map((m) => [m.userId, m.role])).toEqual([[tech.user.id, 'lead']]);
  });

  // Likely correct: 400 for a status no ProjectStatus row has. Expected to change in sub-project 3.
  it('[quirk] Q25: accepts a status no ProjectStatus row has', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    expect(expectOk(await tech.agent.patch(projUrl(p)).send({ status: 'Bogus' })).project.status).toBe('Bogus');
  });

  // Likely correct: projects.edit_own limits edits to the user's own projects. Expected to change in sub-project 3.
  it('[quirk] Q26: edit access follows the view tier', async () => {
    const p = await makeProject(w.admin.agent, { name: 'B project', ownerDepartmentId: w.deptB.id });
    expect((await tech.agent.patch(projUrl(p)).send({ name: 'Edited' })).status).toBe(200);
  });

  it('own-tier users can\'t update others\' projects', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const res = await own.agent.patch(projUrl(p)).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this project');
  });

  it('non-numeric project id', async () => {
    expect((await tech.agent.patch(`${API}/projects/abc`).send({ name: 'x' })).status).toBe(404);
  });
});

describe('DELETE /projects/:id', () => {
  it('admin deletes a project', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    expect(expectOk(await w.admin.agent.delete(projUrl(p)))).toEqual({ ok: true });
    expect((await w.admin.agent.get(projUrl(p))).status).toBe(404);
  });

  // Likely correct: a project's tasks and time go with it. Expected to change in sub-project 3.
  it('[quirk] Q13: deleting a project leaves its tasks and time behind', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    await makeTask(tech.agent, p.id);
    expectOk(await tech.agent.post(`${projUrl(p)}/time-entries`).send({
      startTime: '2026-01-05T15:00:00Z', endTime: '2026-01-05T16:00:00Z',
    }), 201);
    expectOk(await w.admin.agent.delete(projUrl(p)));
    // No endpoint lists a deleted project's rows.
    expect(await models.Task.count({ where: { projectId: p.id } })).toBe(1);
    expect(await models.TimeEntry.count({ where: { projectId: p.id } })).toBe(1);
  });

  // Likely correct: refused like GET for a project out of scope. Expected to change in sub-project 2.
  it('[quirk] Q28: delete does not re-check scope', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await grantOverride(staff.user.id, 'projects.delete', true);
    const p = await makeProject(w.admin.agent, { name: 'B project', ownerDepartmentId: w.deptB.id });
    expect((await staff.agent.get(projUrl(p))).status).toBe(403);
    expect((await staff.agent.delete(projUrl(p))).status).toBe(200);
  });
});

describe('GET /projects', () => {
  it('lists with the paginated shape and per-project rollups', async () => {
    await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const body = expectOk(await tech.agent.get(`${API}/projects`));
    expect(body).toEqual(expect.objectContaining({ page: 1, limit: 50, total: 1, totalPages: 1 }));
    expect(body.projects[0]).toEqual(expect.objectContaining({
      statusColor: expect.any(String),
      completion: { percent: 0, totalTasks: 0, closedTasks: 0 },
      totalCost: 0,
      members: [],
    }));
  });

  describe('filters', () => {
    beforeEach(async () => {
      freezeClock('2026-03-11T17:00:00Z');
      const t = tech.agent;
      const alpha = await makeProject(t, {
        name: 'Alpha', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id, dueDate: '2026-03-10', tags: ['vpn', 'urgent'],
      });
      const bravo = await makeProject(t, {
        name: 'Bravo', ownerDepartmentId: w.deptB.id, forDepartmentId: w.deptA.id, description: 'boiler swap', tags: ['vpn-legacy'],
      });
      const charlie = await makeProject(t, { name: 'Charlie', ownerDepartmentId: w.deptB.id, status: 'Completed', dueDate: '2026-03-01' });
      expect([alpha.projectCode, bravo.projectCode, charlie.projectCode]).toEqual(['SD-P00001', 'FAC-P00001', 'FAC-P00002']);
    });

    it.each([
      ['status=Active', () => 'status=Active', ['Alpha', 'Bravo']],
      ['status=closed', () => 'status=closed', ['Charlie']],
      ['ownerDept', () => `ownerDept=${w.deptB.id}`, ['Bravo', 'Charlie']],
      ['forDept', () => `forDept=${w.deptA.id}`, ['Alpha', 'Bravo']],
      ['assignee', () => `assignee=${tech.user.id}`, ['Alpha']],
      ['myProjects=true', () => 'myProjects=true', ['Alpha']],
      ['myDepartment=true', () => 'myDepartment=true', ['Alpha', 'Bravo']],
      ['overdue=true', () => 'overdue=true', ['Alpha']],
      ['search=boiler', () => 'search=boiler', ['Bravo']],
      ['search=FAC-P00002', () => 'search=FAC-P00002', ['Charlie']],
      ['search=urgent', () => 'search=urgent', ['Alpha']],
      ['tag=vpn', () => 'tag=vpn', ['Alpha']],
    ])('%s', async (_label, query, names) => {
      const { projects } = expectOk(await tech.agent.get(`${API}/projects?${query()}`));
      expect(projects.map((p) => p.name).sort()).toEqual(names);
    });
  });

  it('myProjects with no memberships returns nothing', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const body = expectOk(await mgr.agent.get(`${API}/projects?myProjects=true`));
    expect(body.projects).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('scopes the list', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const mgr = await makeManager('mgr', w.deptA.id);
    const a = w.admin.agent;
    const p = await makeProject(a, { name: 'P (A, own member)', ownerDepartmentId: w.deptA.id });
    await addMember(p, own.user.id);
    await makeProject(a, { name: 'Q (B for A)', ownerDepartmentId: w.deptB.id, forDepartmentId: w.deptA.id });
    await makeProject(a, { name: 'R (B)', ownerDepartmentId: w.deptB.id });
    await makeProject(a, { name: 'S (B, mgr member)', ownerDepartmentId: w.deptB.id, memberIds: [mgr.user.id] });
    const names = async (u) => expectOk(await u.agent.get(`${API}/projects`)).projects.map((x) => x.name).sort();
    expect(await names(own)).toEqual(['P (A, own member)']);
    expect(await names(mgr)).toEqual(['P (A, own member)', 'Q (B for A)', 'S (B, mgr member)']);
  });

  it('own-tier with no memberships gets an empty list', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const body = expectOk(await own.agent.get(`${API}/projects`));
    expect(body.projects).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('lists distinct tags the caller can see, sorted', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const p1 = await makeProject(w.admin.agent, { name: 'P1', ownerDepartmentId: w.deptA.id, tags: ['vpn', 'net'] });
    await makeProject(w.admin.agent, { name: 'P2', ownerDepartmentId: w.deptB.id, tags: ['zeta', 'net'] });
    await addMember(p1, own.user.id);
    expect(expectOk(await tech.agent.get(`${API}/projects/tags`)).tags).toEqual(['net', 'vpn', 'zeta']);
    expect(expectOk(await own.agent.get(`${API}/projects/tags`)).tags).toEqual(['net', 'vpn']);
  });
});

describe('stats', () => {
  it('stats roll up tasks, time, cost and open tickets', async () => {
    const a = w.admin.agent;
    const p = await makeProject(a, { name: 'P', ownerDepartmentId: w.deptA.id });
    await makeTask(a, p.id, { statusId: await projectStatusId(a, 'Completed') });
    await makeTask(a, p.id);
    expectOk(await a.post(`${projUrl(p)}/time-entries`).send({ startTime: '2026-01-05T15:00:00Z', endTime: '2026-01-05T16:30:00Z' }), 201);
    expectOk(await a.post(`${projUrl(p)}/expenses`).send({ description: 'Cables', amount: 100 }), 201);
    expectOk(await a.post(`${projUrl(p)}/materials`).send({ itemName: 'Switch', quantity: 2, unitCost: 25 }), 201);
    await makeTicket(a, { title: 'Open one', contactId: w.contact.id, projectId: p.id });
    await makeTicket(a, { title: 'Done one', contactId: w.contact.id, projectId: p.id, status: 'Resolved' });
    const expected = {
      completionPercent: 50, totalTasks: 2, closedTasks: 1, totalTimeSeconds: 5400, laborCost: 0, totalCost: 150, openTicketsCount: 1,
    };
    expect(expectOk(await a.get(projUrl(p))).project.stats).toEqual(expected);
    expect(expectOk(await a.get(`${projUrl(p)}/stats`)).stats).toEqual(expected);
  });

  it('stats are scope-checked', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    expect((await own.agent.get(`${projUrl(p)}/stats`)).status).toBe(403);
  });
});
