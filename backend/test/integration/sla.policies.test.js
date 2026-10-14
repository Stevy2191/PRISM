const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, makeTicket,
} = require('./fixtures');

// SLA policies (sub-project 4): named policies with per-priority targets,
// one default, companies attached in the policy editor.

const { SlaPolicy, TicketSla, AuditLog, BusinessHours } = models;
const URL = `${API}/sla-policies`;
const err = (res) => [res.status, res.body.code];

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(async () => {
  await BusinessHours.destroy({ where: {} });
  await closeDb();
});

const body = (fields = {}) => ({
  name: 'Gold',
  warnAtPercent: 80,
  targets: [{ ticketType: 'incident', priority: 'high', assignMinutes: 15, responseMinutes: 60, resolutionMinutes: 240, useBusinessHours: false }],
  ...fields,
});

describe('listing and creating', () => {
  it('lists the Standard default policy with four targets', async () => {
    const { policies } = expectOk(await w.admin.agent.get(URL));
    expect(policies).toHaveLength(1);
    expect([policies[0].name, policies[0].isDefault, policies[0].targets.length]).toEqual(['Standard', true, 20]);
    expect(policies[0].targets.slice(0, 5).map((t) => `${t.ticketType}:${t.priority}`))
      .toEqual(['incident:critical', 'incident:high', 'incident:medium', 'incident:low', 'request:critical']);
  });

  it('creates a policy with targets and companies, and audits it', async () => {
    const acme = await makeCompany(w.admin);
    const hours = await BusinessHours.create({ name: 'Office', timezone: 'America/Chicago' });
    const { policy } = expectOk(await w.admin.agent.post(URL).send(body({ businessHoursId: hours.id, companyIds: [acme.id] })), 201);
    expect([policy.name, policy.isDefault, policy.warnAtPercent, policy.businessHoursId]).toEqual(['Gold', false, 80, hours.id]);
    const high = policy.targets.find((t) => t.ticketType === 'incident' && t.priority === 'high');
    expect([high.assignMinutes, high.responseMinutes, high.resolutionMinutes, high.useBusinessHours]).toEqual([15, 60, 240, false]);
    const low = policy.targets.find((t) => t.ticketType === 'incident' && t.priority === 'low');
    expect([low.assignMinutes, low.responseMinutes, low.resolutionMinutes]).toEqual([null, null, null]);
    expect(policy.companies.map((c) => c.id)).toEqual([acme.id]);
    expect(await AuditLog.count({ where: { action: 'slaPolicy.create' } })).toBe(1);
  });

  it('rejects bad input', async () => {
    const post = (b) => w.admin.agent.post(URL).send(b);
    expect(err(await post(body({ name: 'Standard' })))).toEqual([409, 'DUPLICATE_NAME']);
    expect(err(await post(body({ name: '  ' })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(body({ warnAtPercent: 100 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(body({ warnAtPercent: 0 })))).toEqual([400, 'VALIDATION_ERROR']);
    const t = (fields) => body({ targets: [{ ticketType: 'incident', priority: 'high', ...fields }] });
    expect(err(await post(t({ priority: 'urgent', responseMinutes: 5 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ ticketType: 'question', responseMinutes: 5 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ ticketType: undefined, responseMinutes: 5 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ responseMinutes: -5 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ responseMinutes: 1.5 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ responseMinutes: 600000 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ resolutionMinutes: 5, resolutionUnit: 'weeks' })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(t({ resolutionMinutes: 400, resolutionUnit: 'business_days' })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(body({ companyIds: [999999] })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(body({ companyIds: ['12abc'] })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(err(await post(body({ businessHoursId: 999999 })))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await SlaPolicy.count()).toBe(1);
  });
});

it('creates a policy with a Request/Low 20-business-day resolution target', async () => {
  const { policy } = expectOk(await w.admin.agent.post(URL).send({
    name: 'Desk', targets: [{ ticketType: 'request', priority: 'low', resolutionMinutes: 20, resolutionUnit: 'business_days' }],
  }), 201);
  expect(policy.targets).toHaveLength(20);
  const t = policy.targets.find((x) => x.ticketType === 'request' && x.priority === 'low');
  expect([t.resolutionMinutes, t.resolutionUnit, t.responseUnit]).toEqual([20, 'business_days', 'minutes']);
});

describe('editing', () => {
  it('moves a company from one policy to another', async () => {
    const acme = await makeCompany(w.admin);
    const gold = expectOk(await w.admin.agent.post(URL).send(body({ companyIds: [acme.id] })), 201).policy;
    const silver = expectOk(await w.admin.agent.post(URL).send(body({ name: 'Silver', companyIds: [acme.id] })), 201).policy;
    expect(silver.companies.map((c) => c.id)).toEqual([acme.id]);
    expect(expectOk(await w.admin.agent.get(`${URL}/${gold.id}`)).policy.companies).toEqual([]);
  });

  it('updates name, percent, a target and the company list', async () => {
    const acme = await makeCompany(w.admin);
    const gold = expectOk(await w.admin.agent.post(URL).send(body({ companyIds: [acme.id] })), 201).policy;
    const { policy } = expectOk(await w.admin.agent.patch(`${URL}/${gold.id}`).send({
      name: 'Gold+', warnAtPercent: 50, targets: [{ ticketType: 'incident', priority: 'high', responseMinutes: 30 }], companyIds: [],
    }));
    const high = policy.targets.find((t) => t.ticketType === 'incident' && t.priority === 'high');
    expect([policy.name, policy.warnAtPercent, high.responseMinutes, high.resolutionMinutes, policy.companies]).toEqual(['Gold+', 50, 30, 240, []]);
    expect(await AuditLog.count({ where: { action: 'slaPolicy.update' } })).toBe(1);
  });

  it('switches the default atomically', async () => {
    const gold = expectOk(await w.admin.agent.post(URL).send(body()), 201).policy;
    expectOk(await w.admin.agent.post(`${URL}/${gold.id}/default`));
    const defaults = await SlaPolicy.findAll({ where: { isDefault: true } });
    expect(defaults.map((p) => p.id)).toEqual([gold.id]);
  });
});

describe('deleting', () => {
  it('cannot delete the default policy', async () => {
    const std = await SlaPolicy.findOne({ where: { isDefault: true } });
    expect(err(await w.admin.agent.delete(`${URL}/${std.id}`))).toEqual([409, 'DEFAULT_POLICY']);
  });

  it('moves its companies and open tickets to the default', async () => {
    const acme = await makeCompany(w.admin);
    const gold = expectOk(await w.admin.agent.post(URL).send(body({ companyIds: [acme.id] })), 201).policy;
    const ticket = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
    await TicketSla.destroy({ where: { ticketId: ticket.id } });
    await TicketSla.create({ ticketId: ticket.id, slaPolicyId: gold.id, priority: 'medium' });
    expectOk(await w.admin.agent.delete(`${URL}/${gold.id}`));
    const std = await SlaPolicy.findOne({ where: { isDefault: true } });
    expect((await TicketSla.findOne({ where: { ticketId: ticket.id } })).slaPolicyId).toBe(std.id);
    expect((await models.Company.findByPk(acme.id)).slaPolicyId).toBeNull();
    expect(await AuditLog.count({ where: { action: 'slaPolicy.delete' } })).toBe(1);
  });
});

describe('access', () => {
  it('needs system settings permission on every route', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const std = await SlaPolicy.findOne({ where: { isDefault: true } });
    const a = tech.agent;
    for (const res of [
      await a.get(URL), await a.get(`${URL}/${std.id}`), await a.post(URL).send(body()),
      await a.patch(`${URL}/${std.id}`).send({ name: 'x' }), await a.delete(`${URL}/${std.id}`),
      await a.post(`${URL}/${std.id}/default`),
    ]) expect(res.status).toBe(403);
  });

  it('a company cannot be put on a policy through the company form', async () => {
    const acme = await makeCompany(w.admin);
    const gold = expectOk(await w.admin.agent.post(URL).send(body()), 201).policy;
    expectOk(await w.admin.agent.patch(`${API}/companies/${acme.id}`).send({ slaPolicyId: gold.id }));
    expect((await models.Company.findByPk(acme.id)).slaPolicyId).toBeNull();
  });

  it('company detail shows its policy name', async () => {
    const acme = await makeCompany(w.admin);
    const gold = expectOk(await w.admin.agent.post(URL).send(body({ companyIds: [acme.id] })), 201).policy;
    const { company } = expectOk(await w.admin.agent.get(`${API}/companies/${acme.id}`));
    expect(company.slaPolicy).toEqual({ id: gold.id, name: 'Gold' });
  });
});

describe('ticket statuses', () => {
  it('no longer take a Pauses SLA switch', async () => {
    const { status } = expectOk(await w.admin.agent.post(`${API}/ticket-statuses`).send({ name: 'Waiting on customer', pausesSla: true }), 201);
    expect(status.pausesSla).toBeUndefined();
    await models.TicketStatus.destroy({ where: { id: status.id } });
  });
});
