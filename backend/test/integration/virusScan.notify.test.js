const {
  resetData, closeDb, createUser, createUserAndLogin, ROLE, models,
} = require('./helpers');
const { notifyVirusBlocked, notifyScannerUnavailable, _resetThrottleForTest } = require('../../src/services/virusScan');
const { notifySecurityAdmins } = require('../../src/services/notifications');
const { activeUserIdsWithPermission, hasPermission } = require('../../src/services/permissionService');

const { Notification, SystemSettings } = models;

beforeEach(async () => { await resetData(); _resetThrottleForTest(); });
afterEach(() => jest.restoreAllMocks());
afterAll(closeDb);

describe('notifySecurityAdmins', () => {
  it('only active settings.manage_system holders get it', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin', roleName: ROLE.ADMIN });
    const { user: tech } = await createUser({ username: 'sec-tech', roleName: ROLE.TECHNICIAN });
    const { user: gone } = await createUser({ username: 'sec-gone', roleName: ROLE.ADMIN });
    await gone.update({ isActive: false });
    const n = await notifySecurityAdmins({ type: 'virus_blocked', message: 'm' });
    expect(n).toBe(1);
    const rows = await Notification.findAll({ where: { type: 'virus_blocked' } });
    expect(rows.map((r) => r.userId)).toEqual([admin.id]);
    expect(rows[0]).toMatchObject({ ticketId: null, isRead: false, message: 'm' });
    expect(rows.find((r) => r.userId === tech.id)).toBeUndefined();
  });

  it('is still delivered when notifications.enabledTypes excludes it', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin2', roleName: ROLE.ADMIN });
    await SystemSettings.upsert({ key: 'notifications.enabledTypes', value: JSON.stringify(['assigned']) });
    await notifySecurityAdmins({ type: 'scanner_unavailable', message: 'down' });
    expect(await Notification.count({ where: { userId: admin.id, type: 'scanner_unavailable' } })).toBe(1);
  });

  it('never throws (logs instead)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Notification, 'create').mockRejectedValue(new Error('db down'));
    await createUser({ username: 'sec-admin3', roleName: ROLE.ADMIN });
    await expect(notifySecurityAdmins({ type: 'virus_blocked', message: 'x' })).resolves.toBe(0);
  });

  it('the new types are not in the Notifications settings list', async () => {
    const { agent } = await createUserAndLogin({ username: 'sec-admin4', roleName: ROLE.ADMIN });
    const res = await agent.get('/api/v1/settings');
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/virus_blocked|scanner_unavailable/);
  });
});

describe('notifyVirusBlocked', () => {
  it('writes the spec message', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin5', roleName: ROLE.ADMIN });
    await notifyVirusBlocked({ place: 'Ticket #4', filename: 'a.pdf', signature: 'Eicar-Test-Signature', who: 'sam' });
    const row = await Notification.findOne({ where: { userId: admin.id } });
    expect(row.message).toBe('Virus blocked: "a.pdf" (Eicar-Test-Signature) uploaded by sam to Ticket #4');
  });
});

describe('alert text', () => {
  it('a hostile filename cannot forge the message: control chars stripped, quotes escaped, length capped', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin7', roleName: ROLE.ADMIN });
    await notifyVirusBlocked({
      place: 'Ticket #4', filename: `x.pdf" (clean) uploaded by CEO\n${'a'.repeat(500)}`, signature: 'Sig', who: 'sam',
    });
    const { message } = await Notification.findOne({ where: { userId: admin.id } });
    expect(message).not.toMatch(/[\n\r]/);
    expect(message).not.toContain('x.pdf" (clean)');
    expect(message.length).toBeLessThan(300);
  });
});

describe('notifyScannerUnavailable throttle', () => {
  it('two calls in an hour → one row per admin; after 61 minutes → a second', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin6', roleName: ROLE.ADMIN });
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await notifyScannerUnavailable();
    now.mockReturnValue(t0 + 30 * 60 * 1000);
    await notifyScannerUnavailable();
    expect(await Notification.count({ where: { userId: admin.id, type: 'scanner_unavailable' } })).toBe(1);
    now.mockReturnValue(t0 + 61 * 60 * 1000);
    await notifyScannerUnavailable();
    expect(await Notification.count({ where: { userId: admin.id, type: 'scanner_unavailable' } })).toBe(2);
  });
});

describe('activeUserIdsWithPermission (one query set, not one lookup per user)', () => {
  it('agrees with hasPermission: roles, grant/revoke overrides, expired overrides, owners, inactive', async () => {
    const { UserPermissionOverride } = models;
    const KEY = 'settings.manage_system';
    const { user: admin } = await createUser({ username: 'p-admin', roleName: ROLE.ADMIN });
    const { user: tech } = await createUser({ username: 'p-tech', roleName: ROLE.TECHNICIAN });
    const { user: granted } = await createUser({ username: 'p-granted', roleName: ROLE.TECHNICIAN });
    const { user: revoked } = await createUser({ username: 'p-revoked', roleName: ROLE.ADMIN });
    const { user: expired } = await createUser({ username: 'p-expired', roleName: ROLE.ADMIN });
    const { user: owner } = await createUser({ username: 'p-owner', roleName: ROLE.READ_ONLY, ownerLevel: 'secondary' });
    const { user: extra } = await createUser({ username: 'p-extra', roleName: ROLE.READ_ONLY, extraRoles: [ROLE.ADMIN] });
    const { user: gone } = await createUser({ username: 'p-gone', roleName: ROLE.ADMIN });
    await gone.update({ isActive: false });
    await UserPermissionOverride.create({ userId: granted.id, permissionKey: KEY, granted: true });
    await UserPermissionOverride.create({ userId: revoked.id, permissionKey: KEY, granted: false });
    await UserPermissionOverride.create({ userId: expired.id, permissionKey: KEY, granted: false, expiresAt: new Date(Date.now() - 60000) });
    await UserPermissionOverride.create({ userId: owner.id, permissionKey: KEY, granted: false });

    const ids = (await activeUserIdsWithPermission(KEY)).sort((a, b) => a - b);
    const expected = [];
    for (const u of [admin, tech, granted, revoked, expired, owner, extra]) {
      // eslint-disable-next-line no-await-in-loop
      if (await hasPermission(u.id, KEY)) expected.push(u.id);
    }
    expect(ids).toEqual(expected.sort((a, b) => a - b));
    expect(ids).toEqual(expect.arrayContaining([admin.id, granted.id, expired.id, owner.id, extra.id]));
    expect(ids).not.toContain(tech.id);
    expect(ids).not.toContain(revoked.id);
    expect(ids).not.toContain(gone.id);
  });
});

describe('throttle only counts a delivered notice', () => {
  it('a scanner-unavailable notice that reached nobody does not silence the next one', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin8', roleName: ROLE.ADMIN });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const create = jest.spyOn(Notification, 'create').mockRejectedValueOnce(new Error('db down'));
    await notifyScannerUnavailable();
    create.mockRestore();
    await notifyScannerUnavailable();
    expect(await Notification.count({ where: { userId: admin.id, type: 'scanner_unavailable' } })).toBe(1);
  });
});

describe('virus alerts are capped', () => {
  it('at most 10 an hour; the 10th says alerts are paused; the next after the hour reports how many were held back', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin9', roleName: ROLE.ADMIN });
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    for (let i = 1; i <= 13; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await notifyVirusBlocked({ place: 'Ticket #1', filename: `f${i}.pdf`, signature: 'Sig', who: 'x' });
    }
    let rows = await Notification.findAll({ where: { userId: admin.id, type: 'virus_blocked' }, order: [['id', 'ASC']] });
    expect(rows).toHaveLength(10);
    expect(rows[9].message).toMatch(/Further virus alerts are paused/);
    now.mockReturnValue(t0 + 61 * 60 * 1000);
    await notifyVirusBlocked({ place: 'Ticket #1', filename: 'late.pdf', signature: 'Sig', who: 'x' });
    rows = await Notification.findAll({ where: { userId: admin.id, type: 'virus_blocked' }, order: [['id', 'ASC']] });
    expect(rows).toHaveLength(11);
    expect(rows[10].message).toContain('"late.pdf"');
    expect(rows[10].message).toMatch(/3 more blocked while alerts were paused/);
  });

  it('several files in one alert are listed together', async () => {
    const { user: admin } = await createUser({ username: 'sec-admin10', roleName: ROLE.ADMIN });
    await notifyVirusBlocked({
      place: 'Ticket #2', who: 'inbound email',
      files: [{ filename: 'a.pdf', signature: 'S1' }, { filename: 'b.doc', signature: 'S2' }],
    });
    const rows = await Notification.findAll({ where: { userId: admin.id, type: 'virus_blocked' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('Virus blocked: 2 files ("a.pdf" (S1), "b.doc" (S2)) uploaded by inbound email to Ticket #2');
  });
});
