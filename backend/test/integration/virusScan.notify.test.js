const {
  resetData, closeDb, createUser, createUserAndLogin, ROLE, models,
} = require('./helpers');
const { notifyVirusBlocked, notifyScannerUnavailable, _resetThrottleForTest } = require('../../src/services/virusScan');
const { notifySecurityAdmins } = require('../../src/services/notifications');

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
