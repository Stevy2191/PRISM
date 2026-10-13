const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeTeam, makeCompany, makeContact,
  freezeClock, advanceClock, unfreezeClock, setCompanyAccess,
} = require('./fixtures');
const { runSlaPass } = require('../../src/services/sla/slaScheduler');

// SLA warnings and breaches (sub-project 4): the scheduler flags each once,
// notifies, and fires sla_warning / sla_breached workflow rules.

const {
  SlaPolicy, TicketSla, Notification, WorkflowRule, WorkflowAction, WorkflowRuleLog, SystemSettings,
} = models;
const T0 = '2026-03-09T15:00:00.000Z';
const MIN = 60000;
const now = () => new Date();

let w;
let tech;
let std;
const sla = (ticketId) => TicketSla.findOne({ where: { ticketId } });
const setStandard = async (fields) => expectOk(await w.admin.agent.patch(`${API}/sla-policies/${std.id}`).send(fields));
const newTicket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, priority: 'medium', ...fields,
});
const SLA_TYPES = ['sla_warning', 'sla_breached'];
const notes = (userId, type = SLA_TYPES) => Notification.findAll({ where: { userId, type } });
async function rule(triggerEvent, triggerConfig, actions) {
  const r = await WorkflowRule.create({ name: `${triggerEvent} rule`, triggerEvent, triggerConfig, isActive: true });
  await WorkflowAction.bulkCreate(actions.map((a, i) => ({ ruleId: r.id, position: i, ...a })));
  return r;
}

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  std = await SlaPolicy.findOne({ where: { isDefault: true } });
  // medium: assign 10, response 20, resolution 40; warn at 50%
  await setStandard({ warnAtPercent: 50, targets: [{ priority: 'medium', assignMinutes: 10, responseMinutes: 20, resolutionMinutes: 40 }] });
  freezeClock(T0);
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('warnings and breaches', () => {
  it('warns once at the warning point and notifies the assignee', async () => {
    const t = await newTicket({ assigneeId: tech.user.id });
    advanceClock(9 * MIN);
    await runSlaPass(now());
    expect(await notes(tech.user.id, 'sla_warning')).toHaveLength(0);
    advanceClock(1 * MIN); // response warns at 10
    await runSlaPass(now());
    await runSlaPass(now());
    const warned = await notes(tech.user.id, 'sla_warning');
    expect(warned.map((n) => n.message)).toEqual(['First response SLA at risk: Printer']);
    expect((await sla(t.id)).responseWarnedAt).not.toBeNull();
  });

  it('breaches once at the due time and fires sla_breached rules', async () => {
    const t = await newTicket({ assigneeId: tech.user.id });
    const r = await rule('sla_breached', { clock: 'any' }, [{ actionType: 'set_priority', actionValue: { priority: 'critical' } }]);
    advanceClock(20 * MIN);
    await runSlaPass(now());
    await runSlaPass(now());
    const s = await sla(t.id);
    expect(new Date(s.responseBreachedAt).toISOString()).toBe(new Date(new Date(T0).getTime() + 20 * MIN).toISOString());
    expect(await notes(tech.user.id, 'sla_breached')).toHaveLength(1);
    expect(await WorkflowRuleLog.count({ where: { ruleId: r.id, ticketId: t.id } })).toBe(1);
    expect((await models.Ticket.findByPk(t.id)).priority).toBe('critical');
  });

  it('two overlapping passes fire once', async () => {
    const t = await newTicket({ assigneeId: tech.user.id });
    const r = await rule('sla_breached', { clock: 'response' }, [{ actionType: 'add_tag', actionValue: { tag: 'late' } }]);
    advanceClock(20 * MIN);
    await Promise.all([runSlaPass(now()), runSlaPass(now())]);
    expect(await notes(tech.user.id, 'sla_breached')).toHaveLength(1);
    expect(await WorkflowRuleLog.count({ where: { ruleId: r.id, ticketId: t.id } })).toBe(1);
  });

  it('does not flag paused or stopped clocks', async () => {
    const t = await newTicket({ assigneeId: tech.user.id });
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({ body: 'On it' }), 201);
    expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Closed' }));
    advanceClock(60 * MIN);
    await runSlaPass(now());
    const s = await sla(t.id);
    expect([s.responseWarnedAt, s.responseBreachedAt, s.resolutionWarnedAt, s.resolutionBreachedAt]).toEqual([null, null, null, null]);
    expect(await notes(tech.user.id)).toHaveLength(0);
  });

  it('an unassigned ticket warns its team about the assignment clock', async () => {
    const lead = await makeTech('lead', w.deptA.id);
    const team = await makeTeam(w.admin, 'Desk', [{ userId: tech.user.id, isLead: false }, { userId: lead.user.id, isLead: true }]);
    await newTicket({ teamId: team.id });
    advanceClock(5 * MIN);
    await runSlaPass(now());
    for (const u of [tech.user, lead.user]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await notes(u.id, 'sla_warning')).map((n) => n.message)).toEqual(['Assignment SLA at risk: Printer']);
    }
  });

  it('sends nothing when the notification type is switched off', async () => {
    await SystemSettings.upsert({ key: 'notifications.enabledTypes', value: JSON.stringify(['assigned']) });
    await newTicket({ assigneeId: tech.user.id });
    advanceClock(30 * MIN);
    await runSlaPass(now());
    expect(await notes(tech.user.id)).toHaveLength(0);
  });

  it('skips a recipient who cannot reach the ticket', async () => {
    const acme = await makeCompany(w.admin);
    const contact = await makeContact(w.admin, { companyId: acme.id });
    const t = await newTicket({ contactId: contact.id, departmentId: undefined, assigneeId: tech.user.id });
    const internal = await models.Company.findOne({ where: { isInternal: true } });
    await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internal.id] });
    advanceClock(30 * MIN);
    await runSlaPass(now());
    expect(await notes(tech.user.id)).toHaveLength(0);
    expect((await sla(t.id)).responseBreachedAt).not.toBeNull();
  });
});

describe('workflow rules', () => {
  it('a rule for one clock ignores another clock', async () => {
    await setStandard({ targets: [{ priority: 'medium', assignMinutes: null, responseMinutes: null, resolutionMinutes: 40 }] });
    const t = await newTicket({ assigneeId: tech.user.id });
    const r = await rule('sla_breached', { clock: 'response' }, [{ actionType: 'add_tag', actionValue: { tag: 'late' } }]);
    advanceClock(40 * MIN);
    await runSlaPass(now());
    expect((await sla(t.id)).resolutionBreachedAt).not.toBeNull();
    expect(await WorkflowRuleLog.count({ where: { ruleId: r.id } })).toBe(0);
  });

  it('set_sla_policy switches the policy and re-times the ticket', async () => {
    const gold = expectOk(await w.admin.agent.post(`${API}/sla-policies`).send({
      name: 'Gold', targets: [{ priority: 'medium', responseMinutes: 5, resolutionMinutes: 600 }],
    }), 201).policy;
    await rule('ticket_created', null, [{ actionType: 'set_sla_policy', actionValue: { slaPolicyId: gold.id } }]);
    const t = await newTicket();
    const s = await sla(t.id);
    expect([s.slaPolicyId, s.responseTargetMinutes, s.resolutionTargetMinutes, s.assignTargetMinutes]).toEqual([gold.id, 5, 600, null]);
  });

  it('rule save validates the clock and the policy', async () => {
    const post = (b) => w.admin.agent.post(`${API}/workflow-rules`).send({
      name: 'r', triggerEvent: 'sla_breached', actions: [{ actionType: 'add_tag', actionValue: { tag: 'x' } }], ...b,
    });
    expect((await post({ triggerConfig: { clock: 'lunch' } })).status).toBe(400);
    expect((await post({ triggerConfig: { clock: 'resolution' } })).status).toBe(201);
    const bad = await post({ triggerEvent: 'ticket_created', actions: [{ actionType: 'set_sla_policy', actionValue: { slaPolicyId: 999999 } }] });
    expect(bad.status).toBe(400);
    const badId = await post({ triggerEvent: 'ticket_created', actions: [{ actionType: 'set_sla_policy', actionValue: { slaPolicyId: '1e1' } }] });
    expect(badId.status).toBe(400);
  });
});
