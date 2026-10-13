const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeTeam, makeCompany, makeContact,
} = require('./fixtures');
const migration = require('../../migrations/20260101000059-settings-cleanup');

// The Settings cleanup (user request 2026-10-12, "I don't want to over bloat
// the system"): no settings that do nothing, one organization name,
// assignment rules folded into workflow rules, Modules & tabs gone.

const {
  SystemSettings, Company, WorkflowRule, WorkflowCondition, WorkflowAction, Notification, Department,
} = models;
const DEAD = ['company.supportEmail', 'company.dateFormat', 'company.timeFormat', 'company.language'];
const err = (res) => [res.status, res.body.code, res.body.message];
const internal = () => Company.findOne({ where: { isInternal: true } });

let w;
let tech;
let orgName;
let internalName;
beforeAll(async () => {
  orgName = (await SystemSettings.findOne({ where: { key: 'company.name' } }))?.value ?? null;
  internalName = (await internal())?.name;
});
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
});
afterAll(async () => {
  // Settings and the internal company outlive resetData: put them back.
  if (orgName === null) await SystemSettings.destroy({ where: { key: 'company.name' } });
  else await SystemSettings.upsert({ key: 'company.name', value: orgName });
  await Company.update({ name: internalName }, { where: { isInternal: true } });
  await closeDb();
});

describe('settings that did nothing', () => {
  it('are neither offered nor saved', async () => {
    await SystemSettings.destroy({ where: { key: DEAD } });
    const { settings, public: pub } = expectOk(await w.admin.agent.get(`${API}/settings`));
    for (const k of DEAD) expect([k, Object.hasOwn(settings, k)]).toEqual([k, false]);
    expect(Object.keys(pub.company).sort()).toEqual(['hasLogo', 'name', 'timezone']);
    expectOk(await w.admin.agent.patch(`${API}/settings`).send({ 'company.language': 'fr', 'company.supportEmail': 'x@example.com' }));
    expect(await SystemSettings.count({ where: { key: DEAD } })).toBe(0);
  });
});

describe('one organization name', () => {
  it('renaming it in Company profile renames the internal company, and the other way round', async () => {
    expectOk(await w.admin.agent.patch(`${API}/settings`).send({ 'company.name': 'Northwind IT' }));
    expect((await internal()).name).toBe('Northwind IT');
    expectOk(await w.admin.agent.patch(`${API}/companies/${(await internal()).id}`).send({ name: 'Contoso IT' }));
    expect((await SystemSettings.findOne({ where: { key: 'company.name' } })).value).toBe('Contoso IT');
  });

  it('can\'t be blank or another company\'s name, and nothing changes then', async () => {
    expectOk(await w.admin.agent.patch(`${API}/settings`).send({ 'company.name': 'Northwind IT' }));
    await makeCompany(w.admin, { name: 'Fabrikam' });
    expect(err(await w.admin.agent.patch(`${API}/settings`).send({ 'company.name': '  ' })))
      .toEqual([400, 'VALIDATION_ERROR', 'The organization name can\'t be blank']);
    expect(err(await w.admin.agent.patch(`${API}/settings`).send({ 'company.name': 'fabrikam', 'branding.tagline': 'x' })))
      .toEqual([409, 'COMPANY_NAME_TAKEN', 'A company with this name already exists']);
    expect([(await internal()).name, (await SystemSettings.findOne({ where: { key: 'company.name' } })).value])
      .toEqual(['Northwind IT', 'Northwind IT']);
  });
});

describe('workflow rules', () => {
  async function rule(conditions, actions, extra = {}) {
    const r = await WorkflowRule.create({ name: 'R', triggerEvent: 'ticket_created', isActive: true, conditionMatch: 'all', position: 0, ...extra });
    await WorkflowCondition.bulkCreate(conditions.map((c, i) => ({ ruleId: r.id, position: i, ...c })));
    await WorkflowAction.bulkCreate(actions.map((a, i) => ({ ruleId: r.id, position: i, ...a })));
    return r;
  }

  it('a department condition matches that department, not another company\'s department of the same name', async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme Clients' });
    const theirs = await Department.create({ name: 'Service Desk', companyId: acme.id });
    const ann = await makeContact(w.admin, { firstName: 'Ann', companyId: acme.id });
    await rule([{ field: 'department', operator: 'equals', value: String(w.deptA.id) }], [{ actionType: 'add_tag', actionValue: { tag: 'routed' } }]);
    const ours = await makeTicket(w.admin.agent, { title: 'ours', contactId: w.contact.id, departmentId: w.deptA.id });
    const other = await makeTicket(w.admin.agent, { title: 'theirs', contactId: ann.id, departmentId: theirs.id });
    expect([ours.tags, other.tags || []]).toEqual([['routed'], []]);
  });

  it('a department condition saved by name (before ids) still matches', async () => {
    await rule([{ field: 'department', operator: 'equals', value: 'Service Desk' }], [{ actionType: 'add_tag', actionValue: { tag: 'routed' } }]);
    const t = await makeTicket(w.admin.agent, { title: 't', contactId: w.contact.id, departmentId: w.deptA.id });
    expect(t.tags).toEqual(['routed']);
  });

  it('assigning by a rule tells the assignee, as assigning by hand does', async () => {
    await rule([], [{ actionType: 'assign_to_user', actionValue: { userId: tech.user.id } }]);
    const t = await makeTicket(w.admin.agent, { title: 'auto', contactId: w.contact.id });
    expect(t.assigneeId).toBe(tech.user.id);
    expect(await Notification.count({ where: { userId: tech.user.id, type: 'assigned', ticketId: t.id } })).toBe(1);
  });
});

it('Assignment rules and Modules & tabs are gone from the API', async () => {
  expect((await w.admin.agent.get(`${API}/assignment-rules`)).status).toBe(404);
  expect((await w.admin.agent.get(`${API}/modules`)).status).toBe(404);
});

describe('the migration', () => {
  const qi = () => sequelize.getQueryInterface();
  const tables = async () => (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  // The tables as they were before it.
  async function oldTables() {
    const dt = Sequelize;
    if (!(await tables()).includes('AssignmentRules')) {
      await qi().createTable('AssignmentRules', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(200), allowNull: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        ticketType: { type: dt.ENUM('incident', 'request', 'problem', 'change'), allowNull: true },
        departmentId: { type: dt.INTEGER, allowNull: true },
        priority: { type: dt.ENUM('critical', 'high', 'medium', 'low'), allowNull: true },
        assigneeId: { type: dt.INTEGER, allowNull: true },
        teamId: { type: dt.INTEGER, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!(await tables()).includes('ModuleVisibility')) {
      await qi().createTable('ModuleVisibility', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        moduleName: { type: dt.STRING(64), allowNull: false, unique: true },
        visibleToRoles: { type: dt.JSON, allowNull: false },
      });
    }
  }
  afterEach(async () => {
    const t = await tables();
    if (t.includes('AssignmentRules')) await qi().dropTable('AssignmentRules');
    if (t.includes('ModuleVisibility')) await qi().dropTable('ModuleVisibility');
  });
  const now = new Date();

  it('turns each assignment rule into a workflow rule that runs before the others, only on unassigned tickets', async () => {
    const team = await makeTeam(w.admin, 'Desk', [{ userId: tech.user.id, isLead: false }]);
    const existing = await WorkflowRule.create({ name: 'Existing', triggerEvent: 'ticket_created', position: 0 });
    await oldTables();
    await qi().bulkInsert('AssignmentRules', [
      { name: 'Incidents to tech', position: 0, isActive: true, ticketType: 'incident', departmentId: w.deptA.id, priority: 'high', assigneeId: tech.user.id, teamId: null, createdAt: now, updatedAt: now },
      { name: 'Rest to the desk', position: 1, isActive: false, ticketType: null, departmentId: null, priority: null, assigneeId: null, teamId: team.id, createdAt: now, updatedAt: now },
    ]);
    await qi().bulkInsert('ModuleVisibility', [{ moduleName: 'tickets', visibleToRoles: JSON.stringify(['admin']) }]);
    await migration.up(qi(), Sequelize);

    expect(await tables()).toEqual(expect.not.arrayContaining(['AssignmentRules', 'ModuleVisibility']));
    const converted = await WorkflowRule.findAll({
      where: { name: ['Incidents to tech', 'Rest to the desk'] },
      include: [{ model: WorkflowCondition, as: 'conditions' }, { model: WorkflowAction, as: 'actions' }],
      order: [['position', 'ASC']],
    });
    const shape = (r) => ({
      name: r.name, triggerEvent: r.triggerEvent, isActive: r.isActive, conditionMatch: r.conditionMatch,
      conditions: [...r.conditions].sort((a, b) => a.position - b.position).map((c) => [c.field, c.operator, c.value]),
      actions: r.actions.map((a) => [a.actionType, a.actionValue]),
    });
    expect(converted.map(shape)).toEqual([
      {
        name: 'Incidents to tech', triggerEvent: 'ticket_created', isActive: true, conditionMatch: 'all',
        conditions: [['assignee', 'equals', 'unassigned'], ['team', 'equals', 'no_team'], ['type', 'equals', 'incident'],
          ['department', 'equals', String(w.deptA.id)], ['priority', 'equals', 'high']],
        actions: [['assign_to_user', { userId: tech.user.id }]],
      },
      {
        name: 'Rest to the desk', triggerEvent: 'ticket_created', isActive: false, conditionMatch: 'all',
        conditions: [['assignee', 'equals', 'unassigned'], ['team', 'equals', 'no_team']],
        actions: [['assign_to_team', { teamId: team.id }]],
      },
    ]);
    expect(converted.every((r) => r.position < existing.position)).toBe(true);
  });

  it('the converted rules assign new tickets as the assignment rules did: first match wins, an explicit assignee beats them', async () => {
    const other = await makeTech('other', w.deptA.id);
    await oldTables();
    await qi().bulkInsert('AssignmentRules', [
      { name: 'High to tech', position: 0, isActive: true, ticketType: null, departmentId: w.deptA.id, priority: 'high', assigneeId: tech.user.id, teamId: null, createdAt: now, updatedAt: now },
      { name: 'High to other', position: 1, isActive: true, ticketType: null, departmentId: null, priority: 'high', assigneeId: other.user.id, teamId: null, createdAt: now, updatedAt: now },
    ]);
    await migration.up(qi(), Sequelize);
    const base = { contactId: w.contact.id, departmentId: w.deptA.id };
    expect((await makeTicket(w.admin.agent, { ...base, title: 'a', priority: 'high' })).assigneeId).toBe(tech.user.id);
    expect((await makeTicket(w.admin.agent, { ...base, title: 'b', priority: 'medium' })).assigneeId).toBeNull();
    expect((await makeTicket(w.admin.agent, { ...base, title: 'c', priority: 'high', assigneeId: other.user.id })).assigneeId).toBe(other.user.id);
  });

  it('turns unique department names in workflow conditions into ids, removes the dead settings, and names the internal company', async () => {
    const r = await WorkflowRule.create({ name: 'Legacy', triggerEvent: 'ticket_created' });
    await WorkflowCondition.bulkCreate([
      { ruleId: r.id, field: 'department', operator: 'equals', value: 'Service Desk', position: 0 },
      { ruleId: r.id, field: 'contact_department', operator: 'equals', value: 'Nowhere', position: 1 },
    ]);
    await SystemSettings.upsert({ key: 'company.language', value: 'fr' });
    await SystemSettings.upsert({ key: 'company.name', value: 'Org From Settings' });
    await migration.up(qi(), Sequelize);
    const values = (await WorkflowCondition.findAll({ where: { ruleId: r.id }, order: [['position', 'ASC']] })).map((c) => c.value);
    expect(values).toEqual([String(w.deptA.id), 'Nowhere']); // an unknown name is left as it was
    expect(await SystemSettings.count({ where: { key: DEAD } })).toBe(0);
    expect((await internal()).name).toBe('Org From Settings');
  });
});
