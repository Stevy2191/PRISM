const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeOwnTier, makeProject, makeTask, taskStatusId,
} = require('./fixtures');

// Sub-project 6, task 9: the projects list rows (hours, current phase, next
// milestone), the mine / attention filters and GET /projects/attention.
// (The older list filters stay in projects.core.test.js.)

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

const url = (p) => `${API}/projects/${p.id}`;
const list = async (agent, query = '') => expectOk(await agent.get(`${API}/projects?${query}`)).projects;
const names = (projects) => projects.map((p) => p.name).sort();
const attention = async (agent, query = 'today=2026-03-10') => expectOk(await agent.get(`${API}/projects/attention?${query}`));
const log = async (agent, p, minutes) => expectOk(await agent.post(`${url(p)}/time-entries`).send({ durationMinutes: minutes }), 201);
const budgetOf = async (p, minutes) => expectOk(await w.admin.agent.patch(url(p)).send({ hourBudgetMinutes: minutes }));
const mkProject = (fields) => makeProject(w.admin.agent, { ownerDepartmentId: w.deptA.id, ...fields });

describe('attention=over_budget', () => {
  it('attention=over_budget lists only over-budget projects', async () => {
    const over = await mkProject({ name: 'Over' });
    const exact = await mkProject({ name: 'Exact' });
    const under = await mkProject({ name: 'Under' });
    await mkProject({ name: 'No budget' });
    for (const [p, budget, spent] of [[over, 60, 90], [exact, 60, 60], [under, 60, 10]]) {
      await budgetOf(p, budget);
      await log(w.admin.agent, p, spent);
    }
    expect(names(await list(w.admin.agent, 'attention=over_budget'))).toEqual(['Over']);
    expect((await attention(w.admin.agent)).overBudget).toBe(1);
  });

  it('a closed project is not listed or counted', async () => {
    const p = await mkProject({ name: 'Done and over', status: 'Completed' });
    await budgetOf(p, 30);
    await log(w.admin.agent, p, 60);
    expect(await list(w.admin.agent, 'attention=over_budget')).toEqual([]);
    expect((await attention(w.admin.agent)).overBudget).toBe(0);
  });
});

describe('attention=milestones_7d and unassigned', () => {
  it('counts and filters by the date the client sends', async () => {
    const soon = await mkProject({ name: 'Soon' });
    const later = await mkProject({ name: 'Later' });
    const a = w.admin.agent;
    await makeTask(a, soon.id, { title: 'Go live', isMilestone: true, startDate: '2026-03-17', dueDate: '2026-03-17' });
    await makeTask(a, soon.id, { title: 'Past', isMilestone: true, startDate: '2026-03-09', dueDate: '2026-03-09' });
    await makeTask(a, later.id, { title: 'Far', isMilestone: true, startDate: '2026-03-18', dueDate: '2026-03-18' });
    expect(names(await list(a, 'attention=milestones_7d&today=2026-03-10'))).toEqual(['Soon']);
    expect((await attention(a)).milestonesSoon).toBe(1);
    expect((await attention(a, 'today=2026-03-11')).milestonesSoon).toBe(2);
    // A junk date falls back to the server's own, which is years from these milestones.
    expect((await attention(a, 'today=nonsense')).milestonesSoon).toBe(0);
  });

  it('a done milestone does not count', async () => {
    const p = await mkProject({ name: 'P' });
    const doneId = await taskStatusId(w.admin.agent, 'project', 'Completed');
    await makeTask(w.admin.agent, p.id, {
      title: 'Done ms', isMilestone: true, startDate: '2026-03-12', dueDate: '2026-03-12', statusId: doneId,
    });
    expect((await attention(w.admin.agent)).milestonesSoon).toBe(0);
  });

  it('unassigned counts open tasks with no assignee and filters the list', async () => {
    const withLoose = await mkProject({ name: 'Loose' });
    const covered = await mkProject({ name: 'Covered' });
    const a = w.admin.agent;
    await makeTask(a, withLoose.id, { title: 'one' });
    await makeTask(a, withLoose.id, { title: 'two' });
    await makeTask(a, covered.id, { title: 'three', assigneeId: w.admin.user.id });
    expect((await attention(a)).unassignedTasks).toBe(2);
    expect(names(await list(a, 'attention=unassigned'))).toEqual(['Loose']);
  });

  it('refuses nothing on an unknown attention value but narrows to nothing', async () => {
    await mkProject({ name: 'P' });
    expect(await list(w.admin.agent, 'attention=bogus')).toEqual([]);
  });
});

describe('attention counts respect project scope', () => {
  it('attention counts respect project scope', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const mgr = await makeManager('mgr', w.deptA.id);
    const a = w.admin.agent;
    const mine = await mkProject({ name: 'Mine', memberIds: [own.user.id] });
    const hiddenB = await mkProject({ name: 'Hidden', ownerDepartmentId: w.deptB.id });
    for (const p of [mine, hiddenB]) {
      await budgetOf(p, 10);
      await log(a, p, 30);
      await makeTask(a, p.id, { title: 'loose' });
      await makeTask(a, p.id, { title: 'ms', isMilestone: true, startDate: '2026-03-12', dueDate: '2026-03-12' });
    }
    expect(await attention(own.agent)).toEqual({ overBudget: 1, milestonesSoon: 1, unassignedTasks: 2 });
    expect(await attention(a)).toEqual({ overBudget: 2, milestonesSoon: 2, unassignedTasks: 4 });
    // Department tier: the A project, not the B one it is not in.
    expect(await attention(mgr.agent)).toEqual({ overBudget: 1, milestonesSoon: 1, unassignedTasks: 2 });
    expect(names(await list(own.agent, 'attention=over_budget'))).toEqual(['Mine']);
  });

  it('respects the company fence', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const p = await mkProject({ name: 'P', assignedToUserId: tech.user.id });
    await budgetOf(p, 10);
    await log(w.admin.agent, p, 30);
    expect((await attention(tech.agent)).overBudget).toBe(1);
  });
});

describe('mine', () => {
  it('mine=lead lists the projects I lead; mine=member any role', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const other = await makeTech('other', w.deptA.id);
    await mkProject({ name: 'Led', assignedToUserId: tech.user.id });
    await mkProject({ name: 'Member', assignedToUserId: other.user.id, memberIds: [tech.user.id] });
    const helper = await mkProject({ name: 'Helper', assignedToUserId: other.user.id });
    expectOk(await w.admin.agent.post(`${url(helper)}/members`).send({ userId: tech.user.id, role: 'helper' }), 201);
    await mkProject({ name: 'Not mine', assignedToUserId: other.user.id });
    expect(names(await list(tech.agent, 'mine=lead'))).toEqual(['Led']);
    expect(names(await list(tech.agent, 'mine=member'))).toEqual(['Helper', 'Led', 'Member']);
    expect(await list(tech.agent, 'mine=nothing')).toEqual([]);
  });

  it('state=open and state=closed split by status behaviour', async () => {
    await mkProject({ name: 'Open one' });
    await mkProject({ name: 'Closed one', status: 'Completed' });
    expect(names(await list(w.admin.agent, 'state=open'))).toEqual(['Open one']);
    expect(names(await list(w.admin.agent, 'state=closed'))).toEqual(['Closed one']);
  });
});

describe('list rows', () => {
  it('rows carry hours, budget, current phase and next milestone', async () => {
    const a = w.admin.agent;
    const p = await mkProject({ name: 'P' });
    await budgetOf(p, 120);
    await log(a, p, 45);
    expect((await list(a))[0]).toEqual(expect.objectContaining({
      loggedMinutes: 45, hourBudgetMinutes: 120, currentPhase: null, nextMilestone: null,
    }));
  });

  it('currentPhase is the first phase with open tasks', async () => {
    const a = w.admin.agent;
    const p = await mkProject({ name: 'P' });
    const doneId = await taskStatusId(a, 'project', 'Completed');
    const mk = async (name) => expectOk(await a.post(`${url(p)}/phases`).send({ name }), 201).phase;
    const prepare = await mk('Prepare');
    const build = await mk('Build');
    await mk('Close out');
    const put = async (task, phase) => expectOk(await a.patch(`${url(p)}/tasks/${task.id}`).send({ phaseId: phase.id }));
    await put(await makeTask(a, p.id, { title: 'a', statusId: doneId }), prepare);
    await put(await makeTask(a, p.id, { title: 'b', statusId: doneId }), build);
    await put(await makeTask(a, p.id, { title: 'c' }), build);
    await put(await makeTask(a, p.id, { title: 'd' }), build);
    const row = (await list(a))[0];
    expect(row.currentPhase).toEqual({ name: 'Build', doneCount: 1, taskCount: 3 });
  });

  it('nextMilestone is the earliest open milestone', async () => {
    const a = w.admin.agent;
    const p = await mkProject({ name: 'P' });
    const doneId = await taskStatusId(a, 'project', 'Completed');
    await makeTask(a, p.id, { title: 'Closed', isMilestone: true, startDate: '2026-03-01', dueDate: '2026-03-01', statusId: doneId });
    await makeTask(a, p.id, { title: 'Second', isMilestone: true, startDate: '2026-04-01', dueDate: '2026-04-01' });
    const first = await makeTask(a, p.id, { title: 'First', isMilestone: true, startDate: '2026-03-20', dueDate: '2026-03-20' });
    expect((await list(a))[0].nextMilestone).toEqual({
      id: first.id, code: first.code, title: 'First', dueDate: '2026-03-20',
    });
  });

  it('pagination still counts projects, not rows', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const p = await mkProject({ name: 'A', memberIds: [w.admin.user.id, tech.user.id] });
    await makeTask(w.admin.agent, p.id, { title: 'one' });
    await makeTask(w.admin.agent, p.id, { title: 'two' });
    await mkProject({ name: 'B', assignedToUserId: tech.user.id });
    const body = expectOk(await w.admin.agent.get(`${API}/projects?limit=1&attention=unassigned`));
    expect(body.total).toBe(1);
    expect(body.projects).toHaveLength(1);
  });
});

describe('tiles follow the list filters', () => {
  it('company and department params narrow the tile counts', async () => {
    const a = w.admin.agent;
    const inA = await mkProject({ name: 'In A' });
    const inB = await mkProject({ name: 'In B', ownerDepartmentId: w.deptB.id });
    for (const p of [inA, inB]) {
      await budgetOf(p, 10);
      await log(a, p, 30);
      await makeTask(a, p.id, { title: 'loose' });
    }
    expect(await attention(a, 'today=2026-03-10')).toEqual(expect.objectContaining({ overBudget: 2, unassignedTasks: 2 }));
    expect(await attention(a, `today=2026-03-10&ownerDept=${w.deptB.id}`)).toEqual(expect.objectContaining({ overBudget: 1, unassignedTasks: 1 }));
    expect((await attention(a, `today=2026-03-10&companyId=${inA.companyId}`)).overBudget).toBe(2);
    expect((await attention(a, 'today=2026-03-10&companyId=999999')).overBudget).toBe(0);
    expect((await attention(a, 'today=2026-03-10&forDept=abc')).overBudget).toBe(0);
  });

  it('over budget uses whole minutes, like the row', async () => {
    const p = await mkProject({ name: 'Edge' });
    await budgetOf(p, 100);
    const entry = (await log(w.admin.agent, p, 100)).entry;
    await models.TimeEntry.update({ durationSeconds: 6029 }, { where: { id: entry.id } }); // 100.48 min -> 100
    expect((await attention(w.admin.agent)).overBudget).toBe(0);
    expect(await list(w.admin.agent, 'attention=over_budget')).toEqual([]);
    await models.TimeEntry.update({ durationSeconds: 6031 }, { where: { id: entry.id } }); // 100.52 min -> 101
    expect((await attention(w.admin.agent)).overBudget).toBe(1);
    expect((await list(w.admin.agent))[0].loggedMinutes).toBe(101);
  });
});

describe('list filters refuse junk query shapes', () => {
  it('object/array id filters narrow to nothing instead of a 500; status must be a string', async () => {
    await mkProject({ name: 'Any' });
    const a = w.admin.agent;
    for (const q of ['ownerDept[x]=1', 'forDept[]=1&forDept[]=2', 'assignee[x]=1', 'ownerDept=12abc']) {
      expect(await list(a, q)).toEqual([]);
    }
    const res = await a.get(`${API}/projects?status[]=a`);
    expect(res.status).toBe(400);
    const res2 = await a.get(`${API}/projects?status[x]=a`);
    expect(res2.status).toBe(400);
  });
});
