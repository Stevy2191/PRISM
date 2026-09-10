const request = require('supertest');
const {
  getApp, createUser, createUserAndLogin, login, resetData, closeDb, ROLE,
} = require('./helpers');

const app = () => getApp();

beforeEach(resetData);
afterAll(closeDb);

describe('POST /auth/login — session fixation', () => {
  // Express-session reuses the session id across a login by default. An
  // attacker who could plant a session cookie in a victim's browser (shared
  // kiosk, plain-HTTP network position, XSS on an adjacent origin) therefore
  // still held a valid handle on that session once the victim authenticated.
  it('issues a new session id when a different identity logs in', async () => {
    await createUser({ username: 'alice', roleName: ROLE.TECHNICIAN });
    await createUser({ username: 'mallory', roleName: ROLE.TECHNICIAN });

    const agent = request.agent(app());
    const first = await agent.post('/api/v1/auth/login')
      .send({ username: 'mallory', password: 'IntegrationPass!2026' });
    expect(first.status).toBe(200);
    const firstCookie = first.headers['set-cookie'].find((c) => c.startsWith('prism.sid'));

    const second = await agent.post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'IntegrationPass!2026' });
    expect(second.status).toBe(200);
    const secondCookie = second.headers['set-cookie'].find((c) => c.startsWith('prism.sid'));

    expect(secondCookie).toBeDefined();
    expect(secondCookie).not.toBe(firstCookie);
  });

  it('invalidates the pre-login session id', async () => {
    await createUser({ username: 'alice', roleName: ROLE.TECHNICIAN });
    await createUser({ username: 'mallory', roleName: ROLE.TECHNICIAN });

    const attacker = request.agent(app());
    const planted = await attacker.post('/api/v1/auth/login')
      .send({ username: 'mallory', password: 'IntegrationPass!2026' });
    const plantedCookie = planted.headers['set-cookie'].find((c) => c.startsWith('prism.sid')).split(';')[0];

    // Victim logs in carrying the attacker's session id.
    const victim = request.agent(app());
    await victim.post('/api/v1/auth/login')
      .set('Cookie', plantedCookie)
      .send({ username: 'alice', password: 'IntegrationPass!2026' });

    // The planted id must no longer resolve to anyone.
    const replay = await request(app()).get('/api/v1/auth/me').set('Cookie', plantedCookie);
    expect(replay.status).toBe(401);
  });
});

describe('POST /auth/login', () => {
  it('rejects a wrong password', async () => {
    await createUser({ username: 'alice', roleName: ROLE.TECHNICIAN });
    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'WrongPassword!2026' });
    expect(res.status).toBe(401);
  });

  it('gives the same generic error for an unknown user', async () => {
    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'WrongPassword!2026' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a deactivated account', async () => {
    const { user } = await createUser({ username: 'gone', roleName: ROLE.TECHNICIAN });
    await user.update({ isActive: false });
    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'gone', password: 'IntegrationPass!2026' });
    expect(res.status).toBe(401);
  });

  it('never returns the password hash', async () => {
    await createUser({ username: 'alice', roleName: ROLE.TECHNICIAN });
    const res = await request(app()).post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'IntegrationPass!2026' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('POST /auth/change-password', () => {
  it('enforces the password policy', async () => {
    const { agent } = await createUserAndLogin({ username: 'alice', roleName: ROLE.TECHNICIAN });
    const res = await agent.post('/api/v1/auth/change-password')
      .send({ currentPassword: 'IntegrationPass!2026', newPassword: 'password' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  it('rejects reusing the current password', async () => {
    const { agent } = await createUserAndLogin({ username: 'alice', roleName: ROLE.TECHNICIAN });
    const res = await agent.post('/api/v1/auth/change-password')
      .send({ currentPassword: 'IntegrationPass!2026', newPassword: 'IntegrationPass!2026' });
    expect(res.status).toBe(400);
  });

  it('requires the current password', async () => {
    const { agent } = await createUserAndLogin({ username: 'alice', roleName: ROLE.TECHNICIAN });
    const res = await agent.post('/api/v1/auth/change-password')
      .send({ currentPassword: 'NotTheRightOne!9', newPassword: 'BrandNewPhrase!2026' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  // Changing a password is the standard response to a suspected compromise,
  // so sessions opened with the old one must stop working.
  it('revokes other sessions belonging to the account', async () => {
    const { password } = await createUser({ username: 'alice', roleName: ROLE.TECHNICIAN });
    const stale = await login('alice', password);
    const current = await login('alice', password);

    expect((await stale.get('/api/v1/auth/me')).status).toBe(200);

    const changed = await current.post('/api/v1/auth/change-password')
      .send({ currentPassword: password, newPassword: 'BrandNewPhrase!2026' });
    expect(changed.status).toBe(200);

    expect((await stale.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('unauthenticated access', () => {
  it('rejects protected endpoints without a session', async () => {
    for (const path of ['/api/v1/tickets', '/api/v1/users', '/api/v1/projects', '/api/v1/settings']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app()).get(path);
      expect(res.status).toBe(401);
    }
  });
});
