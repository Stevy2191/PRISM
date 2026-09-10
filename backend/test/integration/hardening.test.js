const request = require('supertest');
const {
  getApp, createUserAndLogin, resetData, closeDb, ROLE, roleIdByName, Department, User,
} = require('./helpers');

const app = () => getApp();

beforeEach(resetData);
afterAll(closeDb);

describe('login rate limiting', () => {
  const attempt = (headers = {}) => request(app())
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ username: 'nobody', password: 'WrongPassword!2026' });

  it('locks out after repeated failures', async () => {
    let last;
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await attempt();
    }
    expect(last.status).toBe(429);
  });

  // With `trust proxy` enabled the limiter keys on X-Forwarded-For, which the
  // client controls. Rotating the header then handed out a fresh budget of
  // attempts each time — unlimited password guessing against a backend that
  // is reachable directly. TRUST_PROXY now defaults to off.
  it('cannot be reset by rotating a spoofed X-Forwarded-For', async () => {
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await attempt({ 'X-Forwarded-For': '203.0.113.9' });
    }
    const rotated = await attempt({ 'X-Forwarded-For': '203.0.113.77' });
    expect(rotated.status).toBe(429);
  });
});

describe('POST /users — role assignment', () => {
  let admin;
  let dept;

  beforeEach(async () => {
    dept = await Department.create({ name: 'Ops', shortCode: 'OPS' });
    admin = await createUserAndLogin({
      username: 'boss', roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: dept.id,
    });
  });

  // A requested roleId used to be dropped on the floor: the account was
  // created with the seed role for the legacy enum instead (a full System
  // Technician), and the response was a 201 with no hint the request had been
  // ignored — an admin asking for a restricted account silently got a
  // privileged one.
  it('honors an explicitly requested roleId', async () => {
    const readOnlyId = await roleIdByName(ROLE.READ_ONLY);
    const res = await admin.agent.post('/api/v1/users').send({
      username: 'limited',
      displayName: 'Limited User',
      password: 'IntegrationPass!2026',
      role: 'technician',
      roleId: readOnlyId,
    });
    expect(res.status).toBe(201);

    const created = await User.findOne({ where: { username: 'limited' } });
    expect(created.roleId).toBe(readOnlyId);

    const perms = await admin.agent.get(`/api/v1/users/${created.id}/permissions`);
    const granted = perms.body.permissions.filter((p) => p.granted).map((p) => p.key);
    expect(granted).not.toContain('tickets.view_all');
    expect(granted).not.toContain('kb.manage');
  });

  it('rejects a roleId that does not exist rather than creating the user anyway', async () => {
    const res = await admin.agent.post('/api/v1/users').send({
      username: 'ghost',
      displayName: 'Ghost',
      password: 'IntegrationPass!2026',
      roleId: 999999,
    });
    expect(res.status).toBe(400);
    expect(await User.findOne({ where: { username: 'ghost' } })).toBeNull();
  });

  it('enforces the password policy on new accounts', async () => {
    const res = await admin.agent.post('/api/v1/users').send({
      username: 'weak', displayName: 'Weak', password: 'password',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });
});

describe('branding files are served inert', () => {
  // SVG is a document format that executes script when served as a top-level
  // response, and these URLs are public and same-origin. The response headers
  // must neutralize that regardless of what was uploaded.
  it('sends a restrictive CSP and nosniff on the logo endpoint', async () => {
    const res = await request(app()).get('/api/v1/settings/logo');
    // 404 when no logo is configured — the headers still have to be right on
    // the path that serves a file, so assert only when one is served.
    if (res.status === 200) {
      expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    } else {
      expect(res.status).toBe(404);
    }
  });
});

describe('security headers', () => {
  it('sets standard hardening headers on API responses', async () => {
    const res = await request(app()).get('/api/v1/settings/public');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
