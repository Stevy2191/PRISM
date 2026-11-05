const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, getApp, sequelize,
} = require('./helpers');
const { makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');
const migration = require('../../migrations/20260101000075-tray-placeholder');

// Sub-project 8a, task 5: tickets from the tray, with a health snapshot.

const TICKETS = '/api/v1/agent/v1/tray/tickets';
const WHOAMI = '/api/v1/agent/v1/tray/whoami';
let w;
let company;
let other;
let device;
let assetId;

const snapshot = {
  os: { name: 'Windows 11 Pro', version: '24H2', build: '26100.2314' },
  uptimeSec: 3 * 86400 + 4 * 3600 + 5 * 60,
  memory: { usedBytes: 11 * 1024 ** 3, totalBytes: 16 * 1024 ** 3 },
  disks: [{ name: 'C:', freeBytes: 212 * 1024 ** 3, sizeBytes: 476 * 1024 ** 3 }],
  signedInUser: 'RIVERSIDE\\mchen',
  domain: 'RIVERSIDE',
  ipAddresses: ['10.20.1.45'],
  agentVersion: '0.5.1',
  takenAt: '2026-11-03T14:02:00Z',
};
const ask = (extra = {}) => ({
  account: 'RIVERSIDE\\mchen', upn: 'maria.chen@riversideclinic.org', subject: 'Printer won\'t print', description: 'The front desk printer shows offline.', snapshot, ...extra,
});
const contactIn = (c, email) => models.Contact.create({
  firstName: email.split('@')[0], displayName: email.split('@')[0], email, companyId: c.id,
});
const placeholders = (c) => models.Contact.findAll({ where: { companyId: c.id, isPlaceholder: true } });

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  other = await makeCompany(w.admin, { name: 'Lakeside' });
  const res = await w.admin.agent.post(`/api/v1/companies/${company.id}/agent-keys`).send({ name: 'Rollout' });
  device = await enrollDevice(getApp(), res.body.secret);
  ({ assetId } = await models.Device.findByPk(device.deviceId));
});
afterAll(closeDb);

it('a ticket is raised as the matched contact, linked to the computer, with a private health snapshot', async () => {
  const maria = await contactIn(company, 'maria.chen@riversideclinic.org');
  const res = await device.post(TICKETS, ask());
  expect(res.status).toBe(201);
  expect(res.body.number).toBe(String(res.body.ticketId).padStart(5, '0'));
  expect(res.body.replyTo).toBe('maria.chen@riversideclinic.org');
  const t = await models.Ticket.findByPk(res.body.ticketId);
  expect(t).toMatchObject({
    source: 'agent', contactId: maria.id, companyId: company.id, title: 'Printer won\'t print', description: 'The front desk printer shows offline.',
  });
  expect(await models.AssetTicket.count({ where: { assetId, ticketId: t.id } })).toBe(1);
  const notes = await models.Comment.findAll({ where: { ticketId: t.id }, raw: true });
  expect(notes).toHaveLength(1);
  expect(notes[0].type).toBe('comment_private');
  expect(notes[0].body).toContain('Health snapshot from');
  expect(notes[0].body).toContain('OS: Windows 11 Pro 24H2 (build 26100.2314)');
  expect(notes[0].body).toContain('Uptime: 3 d 4 h 5 min');
  expect(notes[0].body).toContain('Memory in use: 11.0 GB of 16.0 GB (69%)');
  expect(notes[0].body).toContain('Free on C:: 212 GB of 476 GB');
  expect(notes[0].body).toContain('IP addresses: 10.20.1.45');
  // No time zone set: UTC (the agent sent UTC here).
  expect(notes[0].body).toContain('Taken: Nov 3, 2026, 2:02 PM UTC');
});

it('the snapshot\'s time is in the help desk\'s time zone, with the computer\'s clock when it differs', async () => {
  await contactIn(company, 'maria.chen@riversideclinic.org');
  await models.SystemSettings.upsert({ key: 'company.timezone', value: 'America/Chicago' });
  const body = async (takenAt) => {
    resetRateLimits();
    const res = await device.post(TICKETS, { ...ask(), snapshot: { ...ask().snapshot, takenAt } });
    expect(res.status).toBe(201);
    return (await models.Comment.findOne({ where: { ticketId: res.body.ticketId } })).body;
  };
  // A computer in the same zone: just the time.
  expect(await body('2026-11-03T08:02:00-06:00')).toMatch(/^Taken: Nov 3, 2026, 8:02 AM CST$/m);
  // Elsewhere: the computer's own clock too.
  expect(await body('2026-11-03T19:32:00+05:30')).toMatch(/^Taken: Nov 3, 2026, 8:02 AM CST \(7:32 PM on the computer, UTC\+05:30\)$/m);
  // An older agent's UTC time: shown in the help desk's zone.
  expect(await body('2026-11-03T14:02:00Z')).toMatch(/^Taken: Nov 3, 2026, 8:02 AM CST$/m);
});

it('with no match the requester is the company\'s one placeholder, created once and reused', async () => {
  const before = await models.Contact.count();
  const r1 = await device.post(TICKETS, ask({ upn: 'nobody@riversideclinic.org' }));
  expect(r1.status).toBe(201);
  const r2 = await device.post(TICKETS, ask({ upn: undefined, account: 'RIVERSIDE\\temp' }));
  expect(r2.status).toBe(201);
  const ph = await placeholders(company);
  expect(ph).toHaveLength(1);
  expect(ph[0]).toMatchObject({
    displayName: 'Unknown tray user', email: null, portalAccess: false, isPlaceholder: true,
  });
  expect(await models.Contact.count()).toBe(before + 1);
  // Nobody to email: the tray doesn't promise a reply by email.
  expect(r1.body.replyTo).toBeNull();
  const t1 = await models.Ticket.findByPk(r1.body.ticketId);
  const t2 = await models.Ticket.findByPk(r2.body.ticketId);
  expect(t1.contactId).toBe(ph[0].id);
  expect(t2.contactId).toBe(ph[0].id);
  // Staff can see who to set as the requester.
  expect(t1.description).toMatch(/^Raised from \S+ by RIVERSIDE\\mchen\n\nThe front desk printer/);
  expect(t2.description).toMatch(/by RIVERSIDE\\temp/);
});

it('two tickets at once still make only one placeholder', async () => {
  const [a, b] = await Promise.all([device.post(TICKETS, ask({ upn: null })), device.post(TICKETS, ask({ upn: null }))]);
  expect([a.status, b.status]).toEqual([201, 201]);
  expect(await placeholders(company)).toHaveLength(1);
});

it('a ticket can\'t be raised for another company\'s contact; the placeholder is never matched', async () => {
  const theirs = await contactIn(other, 'maria.chen@riversideclinic.org'.replace('riversideclinic', 'lakeside'));
  const res = await device.post(TICKETS, ask({ upn: theirs.email }));
  const t = await models.Ticket.findByPk(res.body.ticketId);
  expect(t.contactId).not.toBe(theirs.id);
  expect(t.companyId).toBe(company.id);
  expect((await placeholders(company))[0].id).toBe(t.contactId);
  // Another company gets its own placeholder.
  expect(await placeholders(other)).toHaveLength(0);
});

it('the subject is required; untrusted text is cleaned', async () => {
  expect((await device.post(TICKETS, ask({ subject: '   ' }))).status).toBe(400);
  expect((await device.post(TICKETS, ask({ subject: { $ne: 1 } }))).status).toBe(400);
  const res = await device.post(TICKETS, ask({ subject: `Line one\nline two${'x'.repeat(400)}`, snapshot: 'not an object' }));
  expect(res.status).toBe(201);
  const t = await models.Ticket.findByPk(res.body.ticketId);
  expect(t.title.startsWith('Line one line two')).toBe(true);
  expect(t.title.length).toBeLessThanOrEqual(255);
});

it('the 11th ticket in an hour from one computer is refused', async () => {
  for (let i = 0; i < 10; i += 1) expect((await device.post(TICKETS, ask())).status).toBe(201); // eslint-disable-line no-await-in-loop
  expect((await device.post(TICKETS, ask())).status).toBe(429);
});

it('needs a device signature', async () => {
  const request = require('supertest'); // eslint-disable-line global-require
  expect((await request(getApp()).post(TICKETS).send(ask())).status).toBe(401);
  expect((await request(getApp()).get(WHOAMI)).status).toBe(401);
});

it('whoami fills the form and says how to reach the help desk', async () => {
  const sales = await models.Department.create({ name: 'Front desk', companyId: company.id });
  const maria = await contactIn(company, 'maria.chen@riversideclinic.org');
  await maria.update({ displayName: 'Maria Chen', departmentId: sales.id });
  await models.SystemSettings.upsert({ key: 'inboundEmail.enabled', value: 'true' });
  await models.SystemSettings.upsert({ key: 'inboundEmail.address', value: 'help@msp.test' });
  const asset = await models.Asset.findByPk(assetId);
  const res = await device.get(`${WHOAMI}?account=${encodeURIComponent('RIVERSIDE\\mchen')}&upn=maria.chen%40riversideclinic.org`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    name: 'Maria Chen', company: 'Riverside', department: 'Front desk', computer: asset.name,
  });
  expect(res.body.helpdesk.email).toBe('help@msp.test');
  expect(res.body.helpdesk).toHaveProperty('portalUrl', null);
  // Someone unknown: their account name, nothing created.
  const before = await models.Contact.count();
  const res2 = await device.get(`${WHOAMI}?account=${encodeURIComponent('RIVERSIDE\\temp')}`);
  expect(res2.body).toMatchObject({ name: 'RIVERSIDE\\temp', company: 'Riverside', department: null });
  expect(await models.Contact.count()).toBe(before);
});

it('inventory never makes the placeholder a computer\'s usual user', async () => {
  await device.post(TICKETS, ask({ upn: null }));
  const ph = (await placeholders(company))[0];
  // Even if someone gave the placeholder an email that matches.
  await ph.update({ email: 'maria.chen@riversideclinic.org' });
  await device.post('/api/v1/agent/v1/inventory', {
    hostname: 'RFC-FD-01', signedInUser: { account: 'RIVERSIDE\\mchen', upn: 'maria.chen@riversideclinic.org' },
  }).expect(200);
  expect((await models.Asset.findByPk(assetId)).assignedToContactId).toBeNull();
});

it('round trip: down removes the mark and keeps the contacts; up puts the column back', async () => {
  await device.post(TICKETS, ask({ upn: null }));
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  expect((await qi.describeTable('Contacts')).isPlaceholder).toBeUndefined();
  const [rows] = await sequelize.query("SELECT COUNT(*) AS n FROM Contacts WHERE displayName = 'Unknown tray user'");
  expect(Number(rows[0].n)).toBe(1);
  await migration.up(qi, Sequelize);
  expect((await qi.describeTable('Contacts')).isPlaceholder).toBeDefined();
});
