const { checkBudgetAlerts } = require('../../src/services/projects/budget');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeOwnTier, makeProject, makeTask, makeSubtask,
} = require('./fixtures');

// Project hour budgets (sub-project 6, task 8): the summary, the PATCH, and the
// 80% / 100% alerts to the lead, fired once each after every ledger change.

let w;
let lead;
let proj;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  lead = await makeTech('lead', w.deptA.id);
  proj = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id, assignedToUserId: lead.user.id });
});
afterAll(closeDb);

const timeUrl = `${API}/projects`;
const logTime = async (agent, minutes, extra = {}) => expectOk(
  await agent.post(`${timeUrl}/${proj.id}/time-entries`).send({ durationMinutes: minutes, ...extra }),
  201,
).entry;
const setBudget = (body) => w.admin.agent.patch(`${timeUrl}/${proj.id}`).send(body);
const budget = async () => expectOk(await w.admin.agent.get(`${timeUrl}/${proj.id}/budget`)).budget;
const alerts = (type) => models.Notification.findAll({ where: { projectId: proj.id, ...(type ? { type } : { type: ['budget_warning', 'budget_reached'] }) } });
const level = async () => (await models.Project.findByPk(proj.id)).budgetAlertLevel;

describe('budget summary', () => {
  it('summary splits by phase, by person and billable', async () => {
    expectOk(await setBudget({ hourBudgetMinutes: 600 }));
    const phase = expectOk(await w.admin.agent.post(`${timeUrl}/${proj.id}/phases`).send({ name: 'Build' }), 201).phase;
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/phases/${phase.id}`).send({ hourBudgetMinutes: 120 }));
    const t = await makeTask(w.admin.agent, proj.id, { title: 'Rack', estimateMinutes: 100 });
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/tasks/${t.id}`).send({ phaseId: phase.id }));
    await logTime(w.admin.agent, 60, { taskId: t.id });
    await logTime(lead.agent, 30, { taskId: t.id, billable: false });
    await logTime(lead.agent, 20);
    const b = await budget();
    expect(b).toEqual(expect.objectContaining({
      budgetMinutes: 600, usedMinutes: 110, billableMinutes: 80, noTaskMinutes: 20, remainingEstimateMinutes: 10,
    }));
    expect(b.phases).toEqual([{ id: phase.id, name: 'Build', budgetMinutes: 120, usedMinutes: 90 }]);
    expect(b.people.map((p) => [p.userId, p.minutes])).toEqual([[w.admin.user.id, 60], [lead.user.id, 50]]);
    expect(b.people[0].name).toBeTruthy();
  });

  it('entry on a subtask counts toward the parent\'s phase', async () => {
    const phase = expectOk(await w.admin.agent.post(`${timeUrl}/${proj.id}/phases`).send({ name: 'Build' }), 201).phase;
    const t = await makeTask(w.admin.agent, proj.id, { title: 'Rack' });
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/tasks/${t.id}`).send({ phaseId: phase.id }));
    const sub = await makeSubtask(w.admin.agent, proj.id, t.id, { title: 'Cable' });
    await logTime(w.admin.agent, 45, { taskId: sub.id });
    expect((await budget()).phases[0].usedMinutes).toBe(45);
  });

  it('needs view access to the project', async () => {
    const other = await makeOwnTier(w.admin, 'other', w.deptB.id);
    expect((await other.agent.get(`${timeUrl}/${proj.id}/budget`)).status).toBe(403);
    expect((await w.admin.agent.get(`${timeUrl}/abc/budget`)).status).toBe(404);
  });
});

describe('budget fields', () => {
  it('PATCH sets and clears the budget, flags and start date; budget audited as project.budget, start date as project.update', async () => {
    const res = expectOk(await setBudget({
      hourBudgetMinutes: 600, budgetAlert80: false, budgetAlert100: true, startDate: '2026-03-02',
    }));
    expect(res.project).toEqual(expect.objectContaining({
      hourBudgetMinutes: 600, budgetAlert80: false, budgetAlert100: true, startDate: '2026-03-02',
    }));
    const audits = await models.AuditLog.findAll({ where: { entityType: 'Project', entityId: proj.id }, order: [['id', 'ASC']] });
    const budgetRow = audits.filter((r) => r.action === 'project.budget');
    expect(budgetRow).toHaveLength(1);
    expect(budgetRow[0].meta).not.toHaveProperty('startDate');
    expect(audits.find((r) => r.action === 'project.update' && r.meta && r.meta.startDate)).toBeTruthy();
    // A start date on its own is a project.update, not a budget change.
    const before = await models.AuditLog.count({ where: { action: 'project.budget', entityId: proj.id } });
    expectOk(await setBudget({ startDate: '2026-03-03' }));
    expect(await models.AuditLog.count({ where: { action: 'project.budget', entityId: proj.id } })).toBe(before);
    expect(expectOk(await setBudget({ hourBudgetMinutes: null, startDate: null })).project.hourBudgetMinutes).toBeNull();
  });

  it('a budget of 0 is stored as none, for the project and its phases', async () => {
    expect(expectOk(await setBudget({ hourBudgetMinutes: 0 })).project.hourBudgetMinutes).toBeNull();
    const phase = expectOk(await w.admin.agent.post(`${timeUrl}/${proj.id}/phases`).send({ name: 'Build' }), 201).phase;
    const res = expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/phases/${phase.id}`).send({ hourBudgetMinutes: 0 }));
    expect(res.phase.hourBudgetMinutes).toBeNull();
    expect((await budget()).budgetMinutes).toBeNull();
  });

  it('rejects bad values', async () => {
    for (const body of [
      { hourBudgetMinutes: -1 }, { hourBudgetMinutes: 1.5 }, { hourBudgetMinutes: true }, { hourBudgetMinutes: [] },
      { hourBudgetMinutes: 999999999 }, { budgetAlert80: 'yes' }, { budgetAlert100: 1 },
      { startDate: '2026-3-2' }, { startDate: '2026-02-30' }, { startDate: 5 },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      expect([body, (await setBudget(body)).status]).toEqual([body, 400]);
    }
    expectOk(await setBudget({ dueDate: '2026-03-10' }));
    expect((await setBudget({ startDate: '2026-03-11' })).status).toBe(400);
    expectOk(await setBudget({ startDate: '2026-03-10' }));
  });

  it('phase budgets use the same validator', async () => {
    const phase = expectOk(await w.admin.agent.post(`${timeUrl}/${proj.id}/phases`).send({ name: 'Build' }), 201).phase;
    for (const v of [true, [], 999999999, -5]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.patch(`${timeUrl}/${proj.id}/phases/${phase.id}`).send({ hourBudgetMinutes: v })).status).toBe(400);
    }
  });

  it('only someone with edit access can change it', async () => {
    const viewer = await makeStaff('viewer', w.deptA.id);
    expect((await viewer.agent.get(`${timeUrl}/${proj.id}/budget`)).status).toBe(200);
    expect((await viewer.agent.patch(`${timeUrl}/${proj.id}`).send({ hourBudgetMinutes: 5 })).status).toBe(403);
  });
});

describe('alerts', () => {
  beforeEach(async () => { expectOk(await setBudget({ hourBudgetMinutes: 600 })); });

  it('crossing 80% notifies the lead once with budget_warning', async () => {
    await logTime(w.admin.agent, 400);
    expect(await alerts()).toHaveLength(0);
    await logTime(w.admin.agent, 80);
    await logTime(w.admin.agent, 10);
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ type: 'budget_warning', userId: lead.user.id }));
    expect(await level()).toBe(80);
  });

  it('crossing 100% sends budget_reached', async () => {
    await logTime(w.admin.agent, 480);
    await logTime(w.admin.agent, 120);
    await logTime(w.admin.agent, 30);
    const types = (await alerts()).map((n) => n.type).sort();
    expect(types).toEqual(['budget_reached', 'budget_warning']);
    expect(await level()).toBe(100);
  });

  it('two concurrent time entries crossing 80% → exactly one budget_warning', async () => {
    await logTime(w.admin.agent, 400);
    const tech = await makeTech('tech', w.deptA.id);
    await Promise.all([logTime(w.admin.agent, 50), logTime(tech.agent, 50)]);
    expect(await alerts('budget_warning')).toHaveLength(1);
  });

  it('concurrent checks after one crossing -> exactly one budget_warning', async () => {
    // Seeded directly, so no request has run a check: all three race on the level.
    await models.TimeEntry.create({
      projectId: proj.id, userId: w.admin.user.id, loggedById: w.admin.user.id, entryDate: '2026-03-02',
      durationSeconds: 490 * 60, billable: true, workTypeId: (await models.WorkType.findOne()).id,
    });
    await Promise.all([checkBudgetAlerts(proj.id), checkBudgetAlerts(proj.id), checkBudgetAlerts(proj.id)]);
    expect(await alerts('budget_warning')).toHaveLength(1);
    expect(await level()).toBe(80);
  });

  it('a timer stop that crosses 80% sends one budget_warning', async () => {
    await logTime(w.admin.agent, 470);
    const timer = expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'project', id: proj.id }), 201).timer;
    expectOk(await w.admin.agent.post(`${API}/timer/${timer.timerId}/stop`).send({ entry: { durationMinutes: 20 } }));
    const rows = await alerts();
    expect(rows.map((n) => n.type)).toEqual(['budget_warning']);
  });

  it('deleting time back under 80% re-arms without notifying', async () => {
    await logTime(w.admin.agent, 500);
    const e = await logTime(w.admin.agent, 10);
    expect(await alerts()).toHaveLength(1);
    const del = async (entry) => expectOk(await w.admin.agent.delete(`${timeUrl}/${proj.id}/time-entries/${entry.id}`));
    await del(e);
    const big = await models.TimeEntry.findOne({ where: { projectId: proj.id, durationSeconds: 30000 } });
    await del(big);
    expect(await level()).toBe(0);
    expect(await alerts()).toHaveLength(1);
    await logTime(w.admin.agent, 500);
    expect(await alerts()).toHaveLength(2);
  });

  it('editing an entry down re-arms, up fires', async () => {
    const e = await logTime(w.admin.agent, 500);
    expect(await level()).toBe(80);
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/time-entries/${e.id}`).send({ durationMinutes: 100 }));
    expect(await level()).toBe(0);
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/time-entries/${e.id}`).send({ durationMinutes: 650 }));
    expect(await level()).toBe(100);
    expect((await alerts()).map((n) => n.type).sort()).toEqual(['budget_reached', 'budget_warning']);
  });

  it('raising the budget re-arms', async () => {
    await logTime(w.admin.agent, 500);
    expect(await level()).toBe(80);
    expectOk(await setBudget({ hourBudgetMinutes: 1200 }));
    expect(await level()).toBe(0);
    expect(await alerts()).toHaveLength(1);
    await logTime(w.admin.agent, 500);
    expect(await alerts()).toHaveLength(2);
  });

  it('budgetAlert80 off → no 80% alert', async () => {
    expectOk(await setBudget({ budgetAlert80: false }));
    await logTime(w.admin.agent, 500);
    expect(await alerts()).toHaveLength(0);
    await logTime(w.admin.agent, 100);
    expect((await alerts()).map((n) => n.type)).toEqual(['budget_reached']);
  });

  it('budgetAlert100 off → no 100% alert (a jump past 80% still warns)', async () => {
    expectOk(await setBudget({ budgetAlert100: false }));
    await logTime(w.admin.agent, 650);
    expect((await alerts()).map((n) => n.type)).toEqual(['budget_warning']);
  });

  it('logging past 100% still succeeds', async () => {
    await logTime(w.admin.agent, 700);
    const e = await logTime(w.admin.agent, 60);
    expect(e.durationSeconds).toBe(3600);
    expect((await budget()).usedMinutes).toBe(760);
  });

  it('no budget → no alerts', async () => {
    expectOk(await setBudget({ hourBudgetMinutes: null }));
    await logTime(w.admin.agent, 700);
    expect(await alerts()).toHaveLength(0);
    expect(await level()).toBe(0);
  });

  it('no lead → nobody is notified, logging still works', async () => {
    expectOk(await setBudget({ assignedToUserId: null }));
    await logTime(w.admin.agent, 500);
    expect(await alerts()).toHaveLength(0);
  });

  it('a lead who can no longer reach the project is not notified', async () => {
    await models.User.update({ isActive: false }, { where: { id: lead.user.id } });
    await logTime(w.admin.agent, 500);
    expect(await alerts()).toHaveLength(0);
  });

  it('phase budget never alerts', async () => {
    const phase = expectOk(await w.admin.agent.post(`${timeUrl}/${proj.id}/phases`).send({ name: 'Build' }), 201).phase;
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/phases/${phase.id}`).send({ hourBudgetMinutes: 60 }));
    const t = await makeTask(w.admin.agent, proj.id, { title: 'Rack' });
    expectOk(await w.admin.agent.patch(`${timeUrl}/${proj.id}/tasks/${t.id}`).send({ phaseId: phase.id }));
    await logTime(w.admin.agent, 90, { taskId: t.id });
    expect(await alerts()).toHaveLength(0);
  });
});
