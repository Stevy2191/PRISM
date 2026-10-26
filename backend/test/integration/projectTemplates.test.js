const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeOwnTier, makeProject, makeTask, makeSubtask, makeCompany,
} = require('./fixtures');

// Project templates, copying a project, saving one as a template (sub-project 6, task 10).

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

const T = `${API}/project-templates`;
// A little plan: Design (a, b with a sub-task), Build (c), a milestone m. a -> b -> m, a -> c.
const structure = () => ({
  phases: [{ id: 'p1', name: 'Design', hourBudgetMinutes: 600 }, { id: 'p2', name: 'Build' }],
  tasks: [
    { id: 'a', phaseId: 'p1', title: 'Survey', startDay: 1, lengthDays: 3, estimateMinutes: 120, priority: 'high' },
    { id: 'b', phaseId: 'p1', title: 'Plan', startDay: 4, lengthDays: 2, estimateMinutes: 60 },
    { id: 'b1', parentId: 'b', title: 'Draft', startDay: 4, lengthDays: 1, estimateMinutes: 30 },
    { id: 'c', phaseId: 'p2', title: 'Install', startDay: 4, lengthDays: 4, priority: 'urgent' },
    { id: 'm', title: 'Go live', startDay: 8, lengthDays: 0, isMilestone: true },
  ],
  dependencies: [
    { predecessorId: 'a', successorId: 'b' }, { predecessorId: 'b', successorId: 'm' }, { predecessorId: 'a', successorId: 'c' },
  ],
});
const template = (extra = {}) => ({
  name: 'Office refresh', description: 'Standard refresh', hourBudgetMinutes: 2400, tags: ['refresh', 'office'], ...structure(), ...extra,
});
const addTemplate = async (extra) => expectOk(await w.admin.agent.post(T).send(template(extra)), 201).template;
const projectBody = (extra = {}) => ({ name: 'Floor 3', ownerDepartmentId: w.deptA.id, startDate: '2026-03-02', ...extra });
const readProject = async (id) => {
  const project = await models.Project.findByPk(id);
  const tasks = await models.Task.findAll({ where: { projectId: id }, order: [['position', 'ASC'], ['id', 'ASC']] });
  return { project, tasks, byTitle: Object.fromEntries(tasks.map((t) => [t.title, t])) };
};

describe('create from a template', () => {
  it('create from template makes phases, tasks, subtasks, links, budget, tags with no assignees', async () => {
    const t = await addTemplate();
    expect(t.tasks).toHaveLength(5);
    const lead = (await makeTech('lead1', w.deptA.id)).user;
    const created = expectOk(await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id, assignedToUserId: lead.id })), 201).project;
    const { project, tasks, byTitle } = await readProject(created.id);
    expect(project.templateId).toBe(t.id);
    expect(project.startDate).toBe('2026-03-02');
    expect(project.hourBudgetMinutes).toBe(2400);
    expect(project.tags).toEqual(['refresh', 'office']);
    expect(project.dueDate).toBe('2026-03-09');
    expect(tasks).toHaveLength(5);
    expect(tasks.every((x) => x.assigneeId === null)).toBe(true);
    expect(await models.TaskAssignee.count({ where: { taskId: tasks.map((x) => x.id) } })).toBe(0);
    // the lead (named on the form) is a member, nobody else is
    expect((await models.ProjectMember.findAll({ where: { projectId: created.id } })).map((m) => m.userId)).toEqual([lead.id]);
    expect(byTitle.Survey.code).toBe(`${project.projectCode}-T01`);
    expect(byTitle.Plan.code).toBe(`${project.projectCode}-T02`);
    expect(byTitle.Draft.code).toBe(`${byTitle.Plan.code}-S01`);
    expect(byTitle.Draft.parentTaskId).toBe(byTitle.Plan.id);
    expect([byTitle.Survey.startDate, byTitle.Survey.dueDate, byTitle.Survey.priority, byTitle.Survey.estimateMinutes]).toEqual(['2026-03-02', '2026-03-04', 'high', 120]);
    expect([byTitle['Go live'].startDate, byTitle['Go live'].dueDate, byTitle['Go live'].isMilestone]).toEqual(['2026-03-09', '2026-03-09', true]);
    const phases = await models.ProjectPhase.findAll({ where: { projectId: created.id }, order: [['position', 'ASC']] });
    expect(phases.map((p) => [p.name, p.hourBudgetMinutes])).toEqual([['Design', 600], ['Build', null]]);
    expect(byTitle.Survey.phaseId).toBe(phases[0].id);
    expect(byTitle.Draft.phaseId).toBeNull();
    const links = await models.TaskDependency.findAll({ where: { predecessorId: tasks.map((x) => x.id) } });
    expect(links.map((l) => [l.predecessorId, l.successorId]).sort()).toEqual([
      [byTitle.Survey.id, byTitle.Plan.id], [byTitle.Survey.id, byTitle.Install.id], [byTitle.Plan.id, byTitle['Go live'].id],
    ].sort());
    const listed = expectOk(await w.admin.agent.get(T)).templates[0];
    expect(listed).toEqual(expect.objectContaining({ id: t.id, phaseCount: 2, taskCount: 5, hourBudgetMinutes: 2400, usedCount: 1 }));
  });

  it('a finish date stretches the plan, and preview shows the same dates', async () => {
    const t = await addTemplate();
    const q = `startDate=2026-03-02&finishDate=2026-03-17`;
    const preview = expectOk(await w.admin.agent.get(`${T}/${t.id}/preview?${q}`));
    // the milestone sits on the template's last day, so it lands on the requested finish
    expect(preview.finishDate).toBe('2026-03-17');
    expect((await w.admin.agent.get(`${T}/${t.id}/preview?startDate=2026-03-02&finishDate=2046-03-17`)).status).toBe(400);
    expect((await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id, finishDate: '2046-03-17' }))).status).toBe(400);
    const created = expectOk(await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id, finishDate: '2026-03-17' })), 201).project;
    const { byTitle, project } = await readProject(created.id);
    expect(project.dueDate).toBe('2026-03-17');
    expect(byTitle['Go live'].dueDate).toBe('2026-03-17');
    expect(preview.tasks.find((x) => x.title === 'Plan').startDate).toBe(byTitle.Plan.startDate);
    expect(byTitle.Plan.startDate > byTitle.Survey.dueDate).toBe(true);
  });

  it('the form can override budget and tags; bad ids and dates are refused', async () => {
    const t = await addTemplate();
    const created = expectOk(await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id, hourBudgetMinutes: 60, tags: ['x'] })), 201).project;
    expect(created.hourBudgetMinutes).toBe(60);
    expect(created.tags).toEqual(['x']);
    const post = (b) => w.admin.agent.post(`${API}/projects`).send(projectBody(b));
    expect((await post({ templateId: '12abc' })).status).toBe(404);
    expect((await post({ templateId: 999999 })).status).toBe(404);
    expect((await post({ templateId: t.id, startDate: undefined })).status).toBe(400);
    expect((await post({ templateId: t.id, startDate: '2026-02-30' })).status).toBe(400);
    expect((await post({ templateId: t.id, finishDate: '2026-02-01' })).status).toBe(400);
    expect((await post({ templateId: t.id, copyFromProjectId: created.id })).status).toBe(400);
    expect(await models.Project.count()).toBe(1);
  });

  it('the usual company and lead checks still apply', async () => {
    const t = await addTemplate();
    const client = await makeCompany(w.admin, { name: 'Client Co' });
    const res = await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id, assignedToUserId: 999999 }));
    expect(res.status).toBe(400);
    expect(await models.Project.count()).toBe(0);
    expect(await models.ProjectPhase.count()).toBe(0);
    expect(await models.Task.count()).toBe(0);
    // The company comes from the form; the template holds none.
    const ok = expectOk(await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id, companyId: client.id })), 201).project;
    expect((await models.Project.findByPk(ok.id)).companyId).toBe(client.id);
  });
});

describe('copy a project', () => {
  const source = async () => {
    const p = await makeProject(w.admin.agent, { name: 'Original', ownerDepartmentId: w.deptA.id, startDate: '2026-04-06', tags: ['t1'], hourBudgetMinutes: 300 });
    const phase = expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/phases`).send({ name: 'Stage 1' }), 201).phase;
    const a = await makeTask(w.admin.agent, p.id, { title: 'First', phaseId: phase.id, startDate: '2026-04-06', dueDate: '2026-04-08', estimateMinutes: 90 });
    const b = await makeTask(w.admin.agent, p.id, { title: 'Second', startDate: '2026-04-09', dueDate: '2026-04-10' });
    await makeSubtask(w.admin.agent, p.id, a.id, { title: 'Sub' });
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/dependencies`).send({ predecessorId: a.id, successorId: b.id }), 201);
    return { p, a, b, phase };
  };

  it('copies structure to a new start date', async () => {
    const { p } = await source();
    const created = expectOk(await w.admin.agent.post(`${API}/projects`).send({
      name: 'Copy', ownerDepartmentId: w.deptA.id, copyFromProjectId: p.id, startDate: '2026-06-01',
    }), 201).project;
    const { project, tasks, byTitle } = await readProject(created.id);
    expect(project.templateId).toBeNull();
    expect(project.hourBudgetMinutes).toBe(300);
    expect(project.tags).toEqual(['t1']);
    expect(tasks.map((t) => t.title).sort()).toEqual(['First', 'Second', 'Sub']);
    expect([byTitle.First.startDate, byTitle.First.dueDate, byTitle.Second.startDate]).toEqual(['2026-06-01', '2026-06-03', '2026-06-04']);
    expect(byTitle.Sub.parentTaskId).toBe(byTitle.First.id);
    expect(await models.TaskDependency.count({ where: { predecessorId: byTitle.First.id, successorId: byTitle.Second.id } })).toBe(1);
    // the original is untouched
    expect(await models.Task.count({ where: { projectId: p.id } })).toBe(3);
  });

  it('copy project needs view on the source; restricted user copying an unseen project → 404', async () => {
    const { p } = await source();
    const own = await makeOwnTier(w.admin, 'owner1', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${own.user.id}/overrides`).send({ permissionKey: 'projects.create', granted: true }), 201);
    const res = await own.agent.post(`${API}/projects`).send({ name: 'Copy', ownerDepartmentId: w.deptA.id, copyFromProjectId: p.id, startDate: '2026-06-01' });
    expect(res.status).toBe(404);
    const missing = await own.agent.post(`${API}/projects`).send({ name: 'Copy', ownerDepartmentId: w.deptA.id, copyFromProjectId: 999999, startDate: '2026-06-01' });
    expect(missing.status).toBe(404);
    expect(missing.body.error || missing.body.message).toEqual(res.body.error || res.body.message);
    expect(await models.Project.count()).toBe(1);
    // once they are a member they can see it, and copy it
    await models.ProjectMember.create({ projectId: p.id, userId: own.user.id, role: 'member' });
    expectOk(await own.agent.post(`${API}/projects`).send({ name: 'Copy', ownerDepartmentId: w.deptA.id, copyFromProjectId: p.id, startDate: '2026-06-01' }), 201);
  });

  it('copy keeps no time, files or costs', async () => {
    const { p, a } = await source();
    const helper = (await makeTech('h1', w.deptA.id)).user;
    expectOk(await w.admin.agent.patch(`${API}/projects/${p.id}/tasks/${a.id}`).send({ assigneeId: helper.id }));
    const other = (await makeTech('h2', w.deptA.id)).user;
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/tasks/${a.id}/helpers`).send({ userId: other.id }), 201);
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/time-entries`).send({ entryDate: '2026-04-07', durationMinutes: 30, taskId: a.id }), 201);
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/expenses`).send({ description: 'Cables', amount: 100 }), 201);
    expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/materials`).send({ itemName: 'Switch', quantity: 2, unitCost: 25 }), 201);
    await models.ProjectFile.create({ projectId: p.id, fileName: 'x.txt', originalName: 'x.txt', filePath: 'x', fileSize: 1, mimeType: 'text/plain', uploadedBy: w.admin.user.id }).catch(() => null);
    const created = expectOk(await w.admin.agent.post(`${API}/projects`).send({
      name: 'Copy', ownerDepartmentId: w.deptA.id, copyFromProjectId: p.id, startDate: '2026-06-01',
    }), 201).project;
    const copyTasks = await models.Task.findAll({ where: { projectId: created.id } });
    expect(copyTasks.every((t) => t.assigneeId === null)).toBe(true);
    expect(await models.TaskAssignee.count({ where: { taskId: copyTasks.map((t) => t.id) } })).toBe(0);
    expect(await models.TimeEntry.count({ where: { projectId: created.id } })).toBe(0);
    expect(await models.ProjectExpense.count({ where: { projectId: created.id } })).toBe(0);
    expect(await models.ProjectMaterial.count({ where: { projectId: created.id } })).toBe(0);
    expect(await models.ProjectFile.count({ where: { projectId: created.id } })).toBe(0);
    expect(await models.ProjectMember.count({ where: { projectId: created.id } })).toBe(0);
  });
});

describe('save as template', () => {
  it('save-as-template without manage_templates → 403', async () => {
    const p = await makeProject(w.admin.agent, { name: 'Original', ownerDepartmentId: w.deptA.id });
    const tech = await makeTech('tech1', w.deptA.id);
    const res = await tech.agent.post(`${API}/projects/${p.id}/save-as-template`).send({ name: 'Mine' });
    expect(res.status).toBe(403);
    expect(await models.ProjectTemplate.count()).toBe(0);
  });

  it('saves the structure with day offsets, and 404s for a project the caller cannot see', async () => {
    const p = await makeProject(w.admin.agent, { name: 'Original', description: 'Client secret plan', ownerDepartmentId: w.deptA.id, startDate: '2026-04-06', tags: ['t1'], hourBudgetMinutes: 300 });
    const a = await makeTask(w.admin.agent, p.id, { title: 'First', startDate: '2026-04-07', dueDate: '2026-04-09', estimateMinutes: 90 });
    await makeTask(w.admin.agent, p.id, { title: 'Undated' });
    await makeTask(w.admin.agent, p.id, { title: 'Done', isMilestone: true, dueDate: '2026-04-20' });
    await makeSubtask(w.admin.agent, p.id, a.id, { title: 'Sub' });
    const saved = expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/save-as-template`).send({ name: 'From original' }), 201).template;
    expect(saved.sourceProjectId).toBe(p.id);
    expect(saved.description).toBeNull(); // not the project's own description
    expect(saved.hourBudgetMinutes).toBe(300);
    expect(saved.tags).toEqual(['t1']);
    const byTitle = Object.fromEntries(saved.tasks.map((t) => [t.title, t]));
    expect([byTitle.First.startDay, byTitle.First.lengthDays]).toEqual([2, 3]);
    expect([byTitle.Undated.startDay, byTitle.Undated.lengthDays]).toEqual([1, 1]);
    expect([byTitle.Done.startDay, byTitle.Done.lengthDays, byTitle.Done.isMilestone]).toEqual([15, 0, true]);
    expect(byTitle.Sub.parentId).toBe(byTitle.First.id);
    expect((await w.admin.agent.post(`${API}/projects/${p.id}/save-as-template`).send({ name: 'From original' })).status).toBe(409);

    // a manager without sight of the project gets 404, not 403
    const mgr = await makeOwnTier(w.admin, 'owner2', w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'projects.manage_templates', granted: true }), 201);
    expect((await mgr.agent.post(`${API}/projects/${p.id}/save-as-template`).send({ name: 'Spy' })).status).toBe(404);
  });
});

describe('template structure checks', () => {
  const post = (b) => w.admin.agent.post(T).send(b);

  it('template structure with a dependency to a task not in the template → 400', async () => {
    const s = structure();
    s.dependencies.push({ predecessorId: 'a', successorId: 'zzz' });
    const res = await post(template(s));
    expect(res.status).toBe(400);
    expect(await models.ProjectTemplate.count()).toBe(0);
    const s2 = structure();
    s2.tasks[2].parentId = 'nope';
    expect((await post(template(s2))).status).toBe(400);
  });

  it('rejects cycles, deep subtasks, bad milestones and out-of-range numbers', async () => {
    const cyc = structure();
    cyc.dependencies.push({ predecessorId: 'm', successorId: 'a' });
    const res = await post(template(cyc));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEPENDENCY_CYCLE');
    const deep = structure();
    deep.tasks.push({ id: 'b2', parentId: 'b1', title: 'Deeper', startDay: 4, lengthDays: 1 });
    expect((await post(template(deep))).status).toBe(400);
    const subOnMilestone = structure();
    subOnMilestone.tasks.push({ id: 'ms', parentId: 'm', title: 'No', startDay: 8, lengthDays: 1 });
    expect((await post(template(subOnMilestone))).status).toBe(400);
    const depOnSub = structure();
    depOnSub.dependencies.push({ predecessorId: 'b1', successorId: 'c' });
    expect((await post(template(depOnSub))).status).toBe(400);
    for (const patch of [{ startDay: 0 }, { lengthDays: -1 }, { lengthDays: 0 }, { startDay: 'x' }, { startDay: 99999 }, { title: '' }, { priority: 'asap' }]) {
      const s = structure();
      Object.assign(s.tasks[0], patch);
      // eslint-disable-next-line no-await-in-loop
      expect((await post(template(s))).status).toBe(400);
    }
    const longMilestone = structure();
    longMilestone.tasks[4].lengthDays = 2;
    expect((await post(template(longMilestone))).status).toBe(400);
    const many = structure();
    many.tasks = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, title: 'x', startDay: 1, lengthDays: 1 }));
    many.dependencies = [];
    expect((await post(template(many))).status).toBe(400);
    expect((await post({ ...template(), name: 'x'.repeat(151) })).status).toBe(400);
    expect((await post({ ...template(), tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect(await models.ProjectTemplate.count()).toBe(0);
  });

  it('duplicate template name → 409', async () => {
    await addTemplate();
    expect((await post(template())).status).toBe(409);
    const other = await addTemplate({ name: 'Other' });
    expect((await w.admin.agent.put(`${T}/${other.id}`).send(template({ name: 'Office refresh' }))).status).toBe(409);
    expect((await w.admin.agent.put(`${T}/${other.id}`).send(template({ name: 'Other' }))).status).toBe(200);
  });

  it('PUT replaces the whole structure; DELETE leaves projects made from it alone', async () => {
    const t = await addTemplate();
    const trimmed = { ...template(), tasks: [{ id: 'z', title: 'Only', startDay: 1, lengthDays: 2 }], phases: [], dependencies: [] };
    const updated = expectOk(await w.admin.agent.put(`${T}/${t.id}`).send(trimmed)).template;
    expect(updated.tasks.map((x) => x.title)).toEqual(['Only']);
    expect(await models.ProjectTemplateTask.count({ where: { templateId: t.id } })).toBe(1);
    expect(await models.ProjectTemplatePhase.count({ where: { templateId: t.id } })).toBe(0);
    const created = expectOk(await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id })), 201).project;
    expectOk(await w.admin.agent.delete(`${T}/${t.id}`));
    expect((await models.Project.findByPk(created.id)).templateId).toBeNull();
    expect(await models.Task.count({ where: { projectId: created.id } })).toBe(1);
    expect((await w.admin.agent.get(`${T}/${t.id}`)).status).toBe(404);
    expect((await w.admin.agent.get(`${T}/12abc`)).status).toBe(404);
  });

  it('who may do what', async () => {
    const t = await addTemplate();
    const tech = await makeTech('tech2', w.deptA.id); // projects.create, no manage_templates
    expectOk(await tech.agent.get(T));
    expect(expectOk(await tech.agent.get(`${T}/${t.id}`)).template).not.toHaveProperty('sourceProjectId');
    expect(expectOk(await w.admin.agent.get(`${T}/${t.id}`)).template).toHaveProperty('sourceProjectId');
    expectOk(await tech.agent.get(`${T}/${t.id}/preview?startDate=2026-03-02`));
    expect((await tech.agent.post(T).send(template({ name: 'N' }))).status).toBe(403);
    expect((await tech.agent.put(`${T}/${t.id}`).send(template())).status).toBe(403);
    expect((await tech.agent.delete(`${T}/${t.id}`)).status).toBe(403);
    const staff = await makeOwnTier(w.admin, 'owner3', w.deptA.id); // no projects.create
    expect((await staff.agent.get(T)).status).toBe(403);
    expect((await w.admin.agent.get(`${T}/${t.id}/preview`)).status).toBe(400);
  });
});

it('audit rows for create/update/delete/saveFromProject/createFromTemplate/copy', async () => {
  const t = await addTemplate();
  expectOk(await w.admin.agent.put(`${T}/${t.id}`).send(template({ description: 'changed' })));
  const p = expectOk(await w.admin.agent.post(`${API}/projects`).send(projectBody({ templateId: t.id })), 201).project;
  expectOk(await w.admin.agent.post(`${API}/projects`).send({
    name: 'Copy', ownerDepartmentId: w.deptA.id, copyFromProjectId: p.id, startDate: '2026-07-01',
  }), 201);
  expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/save-as-template`).send({ name: 'Saved' }), 201);
  expectOk(await w.admin.agent.delete(`${T}/${t.id}`));
  const rows = await models.AuditLog.findAll({ order: [['id', 'ASC']] });
  const actions = rows.map((r) => r.action);
  for (const a of ['projectTemplate.create', 'projectTemplate.update', 'projectTemplate.delete', 'projectTemplate.saveFromProject', 'project.createFromTemplate', 'project.copy']) {
    expect(actions).toContain(a);
  }
  const copyRow = rows.find((r) => r.action === 'project.copy');
  expect(copyRow.meta.sourceProjectId).toBe(p.id);
});

it('save-as trims a live project that exceeds template limits', async () => {
  const p = await makeProject(w.admin.agent, {
    name: 'Big', ownerDepartmentId: w.deptA.id, tags: Array.from({ length: 25 }, (_, i) => `tag${i}`),
  });
  await makeTask(w.admin.agent, p.id, { title: 'Long', description: 'x'.repeat(12000), startDate: '2026-01-01', dueDate: '2036-12-31' });
  const saved = expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/save-as-template`).send({ name: 'Trimmed' }), 201).template;
  expect(saved.tags).toHaveLength(20);
  expect(saved.tasks[0].description).toHaveLength(10000);
  expect(saved.tasks[0].lengthDays).toBe(3650);
});
