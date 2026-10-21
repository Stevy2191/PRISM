const {
  resetData, closeDb, createUserAndLogin, ROLE,
} = require('./helpers');
const { startFakeClamd } = require('../helpers/fakeClamd');

let admin;
let tech;
let fake;
const URL = '/api/v1/settings/virus-scan/status';

beforeEach(async () => {
  await resetData();
  admin = await createUserAndLogin({ username: 'vs-admin', roleName: ROLE.ADMIN });
  tech = await createUserAndLogin({ username: 'vs-tech', roleName: ROLE.TECHNICIAN });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  delete process.env.CLAMAV_ENABLED;
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
  jest.restoreAllMocks();
});
afterAll(closeDb);

const point = async (opts) => {
  fake = await startFakeClamd(opts);
  process.env.CLAMAV_ENABLED = 'true';
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(fake.port);
};

it('403 without settings.manage_system', async () => {
  expect((await tech.agent.get(URL)).status).toBe(403);
});

it('requires a login', async () => {
  const request = require('supertest'); // eslint-disable-line global-require
  expect((await request(require('./helpers').getApp()).get(URL)).status).toBe(401); // eslint-disable-line global-require
});

it('ok → version + signatureDate', async () => {
  await point({ mode: 'ok' });
  const res = await admin.agent.get(URL);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ state: 'ok', version: 'ClamAV 1.5.4' });
  expect(new Date(res.body.signatureDate).getFullYear()).toBe(2026);
});

it('unreachable', async () => {
  await point({ mode: 'ok' });
  await fake.close();
  fake = null;
  const res = await admin.agent.get(URL);
  expect(res.body).toEqual({ state: 'unreachable', version: null, signatureDate: null });
});

it('off', async () => {
  process.env.CLAMAV_ENABLED = 'false';
  expect((await admin.agent.get(URL)).body).toEqual({ state: 'off', version: null, signatureDate: null });
});

it('body never contains host, port or socket errors', async () => {
  await point({ mode: 'ok' });
  const port = String(fake.port);
  await fake.close();
  fake = null;
  const text = JSON.stringify((await admin.agent.get(URL)).body);
  expect(text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|clamav|connect/i);
  expect(text).not.toContain(port);
});
