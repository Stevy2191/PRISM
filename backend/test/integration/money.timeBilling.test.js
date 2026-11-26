const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech, setSla,
} = require('./fixtures');
const { isAfterHours } = require('../../src/services/money/afterHours');
const slaCalendar = require('../../src/services/sla/calendar');
const { downFrom, upFrom } = require('./moneyMigrations');
const migration = require('../../migrations/20260101000107-time-billing');

// Phase 3, step 1, task 6 (integration): after hours comes from the
// customer's SLA support hours; billed time is locked; technicians see no rates.

const WEEKDAYS = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => [d, { enabled: true, start: '08:00', end: '17:00' }]));
const SCHEDULE = { ...WEEKDAYS, saturday: { enabled: false }, sunday: { enabled: false } };
let w;
let alpha;
let ticket;
let tech;
const timeUrl = () => `${API}/tickets/${ticket.id}/time`;
const at = (iso) => ({ startTime: iso, afterHours: null });

beforeEach(async () => {
  await resetData();
  slaCalendar.invalidate();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  await setSla(w.admin, alpha.id, { is24x7: false, timezone: 'America/Chicago', schedule: SCHEDULE });
  expectOk(await w.admin.agent.post(`${API}/companies/${alpha.id}/sla/holidays`).send({ name: 'Christmas', date: '2026-12-25' }), 201);
  slaCalendar.invalidate();
  const amy = await makeContact(w.admin, { companyId: alpha.id, firstName: 'Amy', lastName: 'Ng' });
  ticket = await makeTicket(w.admin.agent, { title: 'Server down', contactId: amy.id });
  tech = await makeTech('tess', w.deptA.id);
});
afterAll(closeDb);

it('after hours follows the customer\'s support hours and holidays; a tech can override', async () => {
  // Tuesday 2026-12-01 in Chicago (UTC-6).
  expect(await isAfterHours(at('2026-12-01T22:30:00Z'), alpha.id)).toBe(false); // 16:30
  expect(await isAfterHours(at('2026-12-01T23:30:00Z'), alpha.id)).toBe(true); // 17:30
  expect(await isAfterHours(at('2026-12-01T13:30:00Z'), alpha.id)).toBe(true); // 07:30
  expect(await isAfterHours(at('2026-12-05T16:00:00Z'), alpha.id)).toBe(true); // Saturday 10:00
  expect(await isAfterHours(at('2026-12-25T16:00:00Z'), alpha.id)).toBe(true); // holiday 10:00
  expect(await isAfterHours({ startTime: '2026-12-05T16:00:00Z', afterHours: false }, alpha.id)).toBe(false);
  expect(await isAfterHours({ startTime: '2026-12-01T16:00:00Z', afterHours: true }, alpha.id)).toBe(true);
  expect(await isAfterHours({ startTime: null, afterHours: null }, alpha.id)).toBe(false);
  // Owner, 2026-11-25: remote work started in hours that runs past closing
  // is not after-hours work — the start time decides.
  expect(await isAfterHours({ startTime: '2026-12-01T22:30:00Z', endTime: '2026-12-01T23:45:00Z', afterHours: null }, alpha.id)).toBe(false);
});

it('a 24x7 customer is never after hours', async () => {
  await setSla(w.admin, alpha.id, { is24x7: true });
  slaCalendar.invalidate();
  expect(await isAfterHours(at('2026-12-05T08:00:00Z'), alpha.id)).toBe(false);
});

it('time entries carry the after-hours choice and a billing status', async () => {
  const e = expectOk(await tech.agent.post(timeUrl()).send({ durationMinutes: 30, afterHours: true }), 201).entry;
  expect(e).toMatchObject({ afterHours: true, billingStatus: 'unbilled' });
  const off = expectOk(await tech.agent.patch(`${timeUrl()}/${e.id}`).send({ billable: false })).entry;
  expect(off.billingStatus).toBe('non_billable');
  const back = expectOk(await tech.agent.patch(`${timeUrl()}/${e.id}`).send({ billable: true, afterHours: null })).entry;
  expect(back).toMatchObject({ billingStatus: 'unbilled', afterHours: null });
  expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 30, afterHours: 'maybe' })).status).toBe(400);
  // No rate anywhere in what a technician gets back.
  expect(JSON.stringify(back)).not.toMatch(/hourlyRate|afterHoursRate|tripCharge/);
});

it('billed time is locked; unbilled time is not', async () => {
  const e = expectOk(await tech.agent.post(timeUrl()).send({ durationMinutes: 45 }), 201).entry;
  await models.TimeEntry.update({ billingStatus: 'billed' }, { where: { id: e.id } });
  for (const res of [
    await tech.agent.patch(`${timeUrl()}/${e.id}`).send({ durationMinutes: 50 }),
    await w.admin.agent.patch(`${timeUrl()}/${e.id}`).send({ note: 'x' }),
    await w.admin.agent.delete(`${timeUrl()}/${e.id}`),
  ]) {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TIME_BILLED');
  }
  const other = expectOk(await tech.agent.post(timeUrl()).send({ durationMinutes: 15 }), 201).entry;
  expectOk(await tech.agent.patch(`${timeUrl()}/${other.id}`).send({ durationMinutes: 20 }));
  // Turning billable off can't sneak billed time out either.
  expect((await w.admin.agent.patch(`${timeUrl()}/${e.id}`).send({ billable: false })).status).toBe(409);
});

it('the On-site work type is on site; others are not; the flag can be set', async () => {
  const types = expectOk(await w.admin.agent.get(`${API}/work-types`)).workTypes;
  expect(types.find((t) => t.name === 'On-site').onSite).toBe(true);
  expect(types.find((t) => t.name === 'Remote support').onSite).toBe(false);
  const remote = types.find((t) => t.name === 'Remote support');
  expect(expectOk(await w.admin.agent.patch(`${API}/work-types/${remote.id}`).send({ onSite: true })).workType.onSite).toBe(true);
});

it('migration 107 rolls back and forward', async () => {
  const qi = sequelize.getQueryInterface();
  await downFrom('20260101000107');
  expect((await qi.describeTable('TimeEntries')).billingStatus).toBeUndefined();
  expect((await qi.describeTable('WorkTypes')).onSite).toBeUndefined();
  await upFrom('20260101000107');
  expect((await qi.describeTable('TimeEntries')).afterHours).toBeDefined();
  expect((await models.WorkType.findOne({ where: { name: 'On-site' } })).onSite).toBe(true);
});

describe('review fix: billed time is locked on every path', () => {
  const billIt = (id) => models.TimeEntry.update({ billingStatus: 'billed' }, { where: { id }, allowBilled: true });

  it('a ticket with billed time can\'t be merged away or deleted', async () => {
    const e = expectOk(await tech.agent.post(timeUrl()).send({ durationMinutes: 30 }), 201).entry;
    await billIt(e.id);
    const other = await makeTicket(w.admin.agent, { title: 'Keep', contactId: ticket.contactId || ticket.contact.id });
    const merge = await w.admin.agent.post(`${API}/tickets/${other.id}/merge`).send({ sourceIds: [ticket.id] });
    expect(merge.status).toBe(409);
    expect(merge.body.code).toBe('TIME_BILLED');
    expect((await models.TimeEntry.findByPk(e.id)).ticketId).toBe(ticket.id);
    const del = await w.admin.agent.delete(`${API}/tickets/${ticket.id}`);
    expect(del.status).toBe(409);
    expect(await models.TimeEntry.count({ where: { id: e.id } })).toBe(1);
  });

  it('a project with billed time can\'t be deleted', async () => {
    const { makeProject } = require('./fixtures');
    const project = await makeProject(w.admin.agent, { name: 'Network refresh', ownerDepartmentId: w.deptA.id });
    const e = expectOk(await w.admin.agent.post(`${API}/projects/${project.id}/time-entries`).send({ durationMinutes: 60 }), 201).entry;
    await billIt(e.id);
    const del = await w.admin.agent.delete(`${API}/projects/${project.id}`);
    expect(del.status).toBe(409);
    expect(await models.TimeEntry.count({ where: { id: e.id } })).toBe(1);
  });

  it('unbilled time moves and goes as before; invoicing itself can still un-bill', async () => {
    const e = expectOk(await tech.agent.post(timeUrl()).send({ durationMinutes: 30 }), 201).entry;
    await billIt(e.id);
    // Without the flag (any ordinary code path), changing billed time throws.
    await expect(models.TimeEntry.update({ durationSeconds: 1 }, { where: { id: e.id } })).rejects.toThrow(/invoice/i);
    const row = await models.TimeEntry.findByPk(e.id);
    await expect(row.update({ note: 'x' })).rejects.toThrow(/invoice/i);
    await expect(row.destroy()).rejects.toThrow(/invoice/i);
    // A voided invoice un-bills it (Phase 3 step 3), with the flag.
    await models.TimeEntry.update({ billingStatus: 'unbilled', invoiceLineId: null }, { where: { id: e.id }, allowBilled: true });
    expectOk(await tech.agent.patch(`${timeUrl()}/${e.id}`).send({ durationMinutes: 40 }));
    expectOk(await w.admin.agent.delete(`${API}/tickets/${ticket.id}`));
  });
});
