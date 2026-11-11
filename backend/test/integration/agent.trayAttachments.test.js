const fs = require('fs');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const { API, makeWorld, makeCompany } = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { enrollDevice } = require('./agentClient');

// Files and screenshots from the tray's Submit a ticket window (owner, 2026-11-11).

const TICKETS = '/api/v1/agent/v1/tray/tickets';
const PNG = Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(200, 7)]);
let w;
let company;
let device;
let otherDevice;
const filesUrl = (id, name, type = 'image/png') => `${TICKETS}/${id}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
const raise = async (d = device) => (await d.post(TICKETS, { account: 'R\\amy', subject: 'Screen is blue', snapshot: {} })).body.ticketId;

beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  const key = await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'Rollout' });
  device = await enrollDevice(getApp(), key.body.secret, { hostname: 'PC-1', serialNumber: 'S1' });
  otherDevice = await enrollDevice(getApp(), key.body.secret, { hostname: 'PC-2', serialNumber: 'S2' });
});
afterAll(closeDb);

it('a screenshot reaches the ticket the computer just raised, as an attachment staff can see', async () => {
  const id = await raise();
  const res = await device.postBytes(filesUrl(id, 'Screenshot 2026-11-11 at 09.12.png'), PNG);
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ name: 'Screenshot 2026-11-11 at 09.12.png', size: PNG.length });
  const att = await models.Attachment.findByPk(res.body.id);
  expect(att).toMatchObject({ ticketId: id, mimeType: 'image/png', size: PNG.length });
  expect(fs.readFileSync(`${process.env.UPLOAD_DIR}/${id}/${att.filename}`).equals(PNG)).toBe(true);
  const list = (await w.admin.agent.get(`${API}/tickets/${id}/attachments`)).body;
  expect(JSON.stringify(list)).toContain('Screenshot 2026-11-11 at 09.12.png');
});

it('only to its own fresh tray ticket: not another computer\'s, not a staff one, not an old one', async () => {
  const theirs = await raise(otherDevice);
  expect((await device.postBytes(filesUrl(theirs, 'x.png'), PNG)).status).toBe(404);
  const staff = (await w.admin.agent.post(`${API}/tickets`).send({ title: 'Staff', contactId: w.contact.id })).body.ticket.id;
  expect((await device.postBytes(filesUrl(staff, 'x.png'), PNG)).status).toBe(404);
  const mine = await raise();
  await models.Ticket.update({ createdAt: new Date(Date.now() - 31 * 60 * 1000) }, { where: { id: mine }, silent: true });
  expect((await device.postBytes(filesUrl(mine, 'x.png'), PNG)).status).toBe(404);
  expect(await models.Attachment.count()).toBe(0);
});

it('the usual checks: blocked types, content that doesn\'t match, a program in disguise, at most 5', async () => {
  const id = await raise();
  expect((await device.postBytes(filesUrl(id, 'setup.exe', 'application/octet-stream'), PNG)).status).toBe(400);
  expect((await device.postBytes(filesUrl(id, 'photo.png'), Buffer.from('not a png at all'))).status).toBe(400);
  expect((await device.postBytes(filesUrl(id, 'notes.txt', 'text/plain'), Buffer.from('MZ\x90\x00 a windows program'))).status).toBe(400);
  // A path in the name is only a name.
  const ok = await device.postBytes(filesUrl(id, '../../etc/passwd.txt', 'text/plain'), Buffer.from('hello'));
  expect(ok.status).toBe(201);
  expect(ok.body.name).toBe('passwd.txt');
  for (let n = 0; n < 4; n += 1) {
    expect((await device.postBytes(filesUrl(id, `log${n}.txt`, 'text/plain'), Buffer.from('x'))).status).toBe(201); // eslint-disable-line no-await-in-loop
  }
  expect((await device.postBytes(filesUrl(id, 'sixth.txt', 'text/plain'), Buffer.from('x'))).status).toBe(400);
  expect(await models.Attachment.count({ where: { ticketId: id } })).toBe(5);
});

it('the bytes are what was signed, and a revoked computer can\'t attach', async () => {
  const id = await raise();
  const path = filesUrl(id, 'x.png');
  // Signed for one body, sent with another: refused.
  const crypto = require('crypto'); // eslint-disable-line global-require
  const request = require('supertest'); // eslint-disable-line global-require
  const { canonical, sign } = require('./agentClient'); // eslint-disable-line global-require
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(12).toString('base64url');
  const sig = sign(device.keys.privateKey, canonical('POST', path, ts, nonce, PNG));
  const send = (body, n) => request(getApp()).post(path)
    .set('X-Prism-Device', String(device.deviceId)).set('X-Prism-Timestamp', ts).set('X-Prism-Nonce', n).set('X-Prism-Signature', sig)
    .set('Content-Type', 'application/octet-stream').send(body);
  expect((await send(Buffer.concat([PNG, Buffer.from('x')]), nonce)).status).toBe(401);
  // The same signature with the bytes it was made for is accepted (so the
  // refusal above was the body).
  expect((await send(PNG, nonce)).status).toBe(201);
  await models.Device.update({ revokedAt: new Date() }, { where: { id: device.deviceId } });
  expect((await device.postBytes(path, PNG)).status).toBe(401);
});
