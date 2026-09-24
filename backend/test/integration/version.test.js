const request = require('supertest');
const { getApp, createUserAndLogin, resetData, closeDb, ROLE } = require('./helpers');

const API = '/api/v1';

beforeEach(resetData);
afterAll(closeDb);

describe('GET /version', () => {
  test('is not readable without a session', async () => {
    const res = await request(getApp()).get(`${API}/version`);
    expect(res.status).toBe(401);
    // Nothing about the build may leak to an anonymous caller.
    expect(JSON.stringify(res.body)).not.toMatch(/APP_VERSION|gitSha/);
  });

  test('any authenticated user may read it', async () => {
    // Read Only is the least-privileged seeded role — no permission gate
    // beyond being logged in.
    const { agent } = await createUserAndLogin({ username: 'versionreader', roleName: ROLE.READ_ONLY });
    const res = await agent.get(`${API}/version`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: expect.any(String),
      gitSha: expect.any(String),
      release: expect.any(Boolean),
    });
  });

  test('reports the version stamped into the image', async () => {
    const saved = process.env.APP_VERSION;
    process.env.APP_VERSION = '9.9.9';
    try {
      const { agent } = await createUserAndLogin({ username: 'versionreader2', roleName: ROLE.READ_ONLY });
      const res = await agent.get(`${API}/version`);
      expect(res.body.version).toBe('9.9.9');
      expect(res.body.release).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = saved;
    }
  });

  test('/health stays anonymous and carries no version', async () => {
    const res = await request(getApp()).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'prism-backend' });
  });
});
