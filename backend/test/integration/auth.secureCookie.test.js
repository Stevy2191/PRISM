// COOKIE_SECURE=true while the request reaches the backend as plain HTTP:
// express-session leaves the cookie off, so sign-in used to "succeed" and the
// next request bounced back to the login page with no error. It now says why.
const request = require('supertest');
const { createApp } = require('../../src/app');
const {
  getApp, createUser, resetData, closeDb, ROLE,
} = require('./helpers');

const PASSWORD = 'IntegrationPass!2026';
const saved = { COOKIE_SECURE: process.env.COOKIE_SECURE, TRUST_PROXY: process.env.TRUST_PROXY };

function secureApp(trustProxy) {
  getApp(); // the shared session store, synced by resetData
  process.env.COOKIE_SECURE = 'true';
  if (trustProxy === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = trustProxy;
  try {
    return createApp({ sessionStore: getApp().locals.sessionStore });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

beforeEach(resetData);
afterAll(closeDb);

describe('sign-in with COOKIE_SECURE=true', () => {
  let warn;
  beforeEach(async () => {
    await createUser({ username: 'alice', roleName: ROLE.TECHNICIAN });
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('refuses with a clear message over plain HTTP instead of a cookie-less success', async () => {
    const res = await request(secureApp()).post('/api/v1/auth/login')
      .send({ username: 'alice', password: PASSWORD });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SESSION_COOKIE_BLOCKED');
    expect(res.body.message).toMatch(/COOKIE_SECURE/);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('still says a wrong password is wrong', async () => {
    const res = await request(secureApp()).post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'nope-nope-nope' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('signs in when a trusted proxy reports HTTPS', async () => {
    const app = secureApp('1');
    const res = await request(app).post('/api/v1/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'alice', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('prism.sid'));
    expect(cookie).toMatch(/Secure/);
    expect(warn).not.toHaveBeenCalled();
  });

  // The dev stack behind Nginx Proxy Manager: TRUST_PROXY unset, the HTTPS
  // proxy's X-Forwarded-Proto passed on by PRISM's nginx.
  it('signs in behind an HTTPS proxy without TRUST_PROXY', async () => {
    const app = secureApp();
    const res = await request(app).post('/api/v1/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ username: 'alice', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('prism.sid'));
    expect(cookie).toMatch(/Secure/);
    // Sent back as the browser would over HTTPS (supertest's own jar keeps a
    // Secure cookie off its plain-HTTP connection).
    const me = await request(app).get('/api/v1/auth/me')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookie.split(';')[0]);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('alice');
  });

  it('keeps believing X-Forwarded-For only with TRUST_PROXY', () => {
    expect(secureApp().get('trust proxy')).toBe(false);
  });
});
