const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, makeContact, setCompanyAccess,
  setSla, slaRowOf, internalCompany, freezeClock, unfreezeClock,
} = require('./fixtures');

// Company settings (CS part 2): each company has its own SLA (targets by
// ticket type and priority, support hours and time zone, holidays) on its
// page. A new company starts from Settings › Starting values; changing
// those later changes no existing company.

const { SlaPolicy, SlaTarget, Holiday, AuditLog, TicketSla, Ticket } = models;
const weekdays = () => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  .map((d, i) => [d, { start: '09:00', end: '17:00', enabled: i < 5 }]));

let w;
let acme;
const slaUrl = (id) => `${API}/companies/${id}/sla`;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  acme = await makeCompany(w.admin);
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('a company gets its own SLA', () => {
  it('copied from the starting values when it is created', async () => {
    await setSla(w.admin, 'start', { warnAtPercent: 60, targets: [{ ticketType: 'incident', priority: 'high', responseMinutes: 33 }] });
    const beta = await makeCompany(w.admin, { name: 'Beta Law' });
    const row = await slaRowOf(beta.id);
    expect([row.warnAtPercent, row.isDefault]).toEqual([60, false]);
    const t = await SlaTarget.findOne({ where: { slaPolicyId: row.id, ticketType: 'incident', priority: 'high' } });
    expect(t.responseMinutes).toBe(33);
    expect(await SlaTarget.count({ where: { slaPolicyId: row.id } })).toBe(20);
  });

  it('changing the starting values changes no existing company', async () => {
    await setSla(w.admin, 'start', { targets: [{ ticketType: 'incident', priority: 'high', responseMinutes: 5 }] });
    const sla = expectOk(await w.admin.agent.get(slaUrl(acme.id))).sla;
    expect(sla.targets.incident.high.responseMinutes).toBe(240);
  });

  it("one company's change leaves every other company alone", async () => {
    const beta = await makeCompany(w.admin, { name: 'Beta Law' });
    await setSla(w.admin, acme.id, { targets: [{ ticketType: 'request', priority: 'low', responseMinutes: 7 }] });
    expect(expectOk(await w.admin.agent.get(slaUrl(acme.id))).sla.targets.request.low.responseMinutes).toBe(7);
    expect(expectOk(await w.admin.agent.get(slaUrl(beta.id))).sla.targets.request.low.responseMinutes).toBe(1440);
    const own = await internalCompany();
    expect(expectOk(await w.admin.agent.get(slaUrl(own.id))).sla.targets.request.low.responseMinutes).toBe(1440);
  });

  it('goes with the company when it is deleted', async () => {
    const row = await slaRowOf(acme.id);
    await models.Company.destroy({ where: { id: acme.id } });
    expect(await SlaPolicy.findByPk(row.id)).toBeNull();
  });
});

describe('reading and saving', () => {
  it('reads the whole SLA: every type and priority, hours, zone, holidays', async () => {
    const res = expectOk(await w.admin.agent.get(slaUrl(acme.id)));
    expect(res.canChange).toBe(true);
    expect(Object.keys(res.sla.targets)).toEqual(['incident', 'request', 'problem', 'change', 'task']);
    expect(Object.keys(res.sla.targets.task)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(res.sla.targets.request.medium).toMatchObject({ responseMinutes: 480, resolutionMinutes: null, resolutionUnit: 'minutes' });
    expect([res.sla.is24x7, res.sla.timezone, res.sla.holidays]).toEqual([true, 'UTC', []]);
  });

  it('saves support hours, time zone and targets, and audits it', async () => {
    const sla = await setSla(w.admin, acme.id, {
      is24x7: false,
      timezone: 'America/Chicago',
      schedule: weekdays(),
      targets: [{ ticketType: 'request', priority: 'low', resolutionMinutes: 3, resolutionUnit: 'business_days' }],
    });
    expect([sla.is24x7, sla.timezone, sla.schedule.monday, sla.schedule.saturday.enabled])
      .toEqual([false, 'America/Chicago', { enabled: true, start: '09:00', end: '17:00' }, false]);
    expect(sla.targets.request.low).toMatchObject({ resolutionMinutes: 3, resolutionUnit: 'business_days' });
    expect(await AuditLog.count({ where: { action: 'company.sla', entityId: acme.id } })).toBe(1);
  });

  it('refuses bad input', async () => {
    const put = (body) => w.admin.agent.put(slaUrl(acme.id)).send(body);
    expect((await put({ warnAtPercent: 0 })).status).toBe(400);
    expect((await put({ timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await put({ is24x7: false, schedule: { ...weekdays(), monday: { enabled: true, start: '17:00', end: '09:00' } } })).status).toBe(400);
    expect((await put({ targets: { incident: { high: { responseMinutes: -5 } } } })).status).toBe(400);
    expect((await put({ targets: { incident: { high: { responseMinutes: 5, responseUnit: 'weeks' } } } })).status).toBe(400);
    // Off the clock with no hours to keep.
    expect((await put({ is24x7: false })).status).toBe(400);
  });

  it('holidays: add, refuse a repeat, remove', async () => {
    let sla = expectOk(await w.admin.agent.post(`${slaUrl(acme.id)}/holidays`).send({ name: 'Founders day', date: '2026-12-01' }), 201).sla;
    expect(sla.holidays).toEqual([expect.objectContaining({ name: 'Founders day', date: '2026-12-01' })]);
    expect((await w.admin.agent.post(`${slaUrl(acme.id)}/holidays`).send({ name: 'Again', date: '2026-12-01' })).status).toBe(400);
    expect((await w.admin.agent.post(`${slaUrl(acme.id)}/holidays`).send({ name: '', date: '2026-12-02' })).status).toBe(400);
    sla = expectOk(await w.admin.agent.delete(`${slaUrl(acme.id)}/holidays/${sla.holidays[0].id}`)).sla;
    expect(sla.holidays).toEqual([]);
    // Another company's holiday can't be removed through this one.
    const own = await internalCompany();
    const theirs = expectOk(await w.admin.agent.post(`${slaUrl(own.id)}/holidays`).send({ name: 'Ours', date: '2026-12-03' }), 201).sla.holidays[0];
    expect((await w.admin.agent.delete(`${slaUrl(acme.id)}/holidays/${theirs.id}`)).status).toBe(404);
  });

  it('reset puts the starting values back', async () => {
    await setSla(w.admin, acme.id, { is24x7: false, schedule: weekdays(), targets: [{ ticketType: 'task', priority: 'low', responseMinutes: 9 }] });
    expectOk(await w.admin.agent.post(`${slaUrl(acme.id)}/holidays`).send({ name: 'Day', date: '2026-12-01' }), 201);
    const sla = expectOk(await w.admin.agent.post(`${slaUrl(acme.id)}/reset`)).sla;
    expect([sla.is24x7, sla.holidays, sla.targets.task.low.responseMinutes]).toEqual([true, [], 1440]);
    expect(await Holiday.count({ where: { slaPolicyId: sla.id } })).toBe(0);
  });
});

describe('access', () => {
  it('reading follows company access; changing needs System settings', async () => {
    const tech = await makeTech('tech-sla', w.deptA.id);
    const res = expectOk(await tech.agent.get(slaUrl(acme.id)));
    expect(res.canChange).toBe(false);
    expect((await tech.agent.put(slaUrl(acme.id)).send({ warnAtPercent: 50 })).status).toBe(403);
    expect((await tech.agent.post(`${slaUrl(acme.id)}/reset`)).status).toBe(403);
    expect((await tech.agent.post(`${slaUrl(acme.id)}/holidays`).send({ name: 'x', date: '2026-12-01' })).status).toBe(403);
    expect((await tech.agent.get(`${API}/sla/starting-values`)).status).toBe(403);
    expect((await tech.agent.put(`${API}/sla/starting-values`).send({ warnAtPercent: 50 })).status).toBe(403);
    const beta = await makeCompany(w.admin, { name: 'Beta Law' });
    await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [acme.id] });
    expect([403, 404]).toContain((await tech.agent.get(slaUrl(beta.id))).status);
  });
});

describe("tickets run on their company's SLA", () => {
  it('targets, support hours, holidays and the due date time zone are the company\'s', async () => {
    freezeClock('2026-03-03T15:00:00.000Z'); // Tue 09:00 in Chicago (CST)
    await setSla(w.admin, acme.id, {
      is24x7: false,
      timezone: 'America/Chicago',
      schedule: weekdays(),
      targets: [{ ticketType: 'incident', priority: 'high', resolutionMinutes: 600, useBusinessHours: true }],
    });
    expectOk(await w.admin.agent.post(`${slaUrl(acme.id)}/holidays`).send({ name: 'Closed', date: '2026-03-04' }), 201);
    const contact = await makeContact(w.admin, { companyId: acme.id });
    const t = await makeTicket(w.admin.agent, { title: 'Acme', contactId: contact.id, type: 'incident', priority: 'high' });
    const s = await TicketSla.findOne({ where: { ticketId: t.id } });
    expect(s.slaPolicyId).toBe((await slaRowOf(acme.id)).id);
    // 8h Tuesday (09-17), Wednesday off, 2h Thursday: 11:00 Chicago on Thu 5 Mar.
    expect(new Date(s.resolutionDueAt).toISOString()).toBe('2026-03-05T17:00:00.000Z');
    const fresh = await Ticket.findByPk(t.id);
    expect([fresh.dueDate, String(fresh.dueTime).slice(0, 5)]).toEqual(['2026-03-05', '11:00']);
    // Your company's tickets keep your SLA (around the clock).
    const ours = await makeTicket(w.admin.agent, { title: 'Ours', contactId: w.contact.id, type: 'incident', priority: 'high' });
    expect((await TicketSla.findOne({ where: { ticketId: ours.id } })).slaPolicyId).toBe((await slaRowOf((await internalCompany()).id)).id);
  });
});
