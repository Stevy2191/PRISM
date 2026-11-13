const { closeDb } = require('./helpers');
const { snapshotNote } = require('../../src/services/agent/trayTickets');

// The health snapshot's extra lines (restart pending, network, battery,
// antivirus, disk encryption): shown as the agent gave them, cleaned.

afterAll(closeDb);

const base = { os: { name: 'Windows 11 Pro' }, agentVersion: '0.5.0' };

it('shows the agent\'s extra lines between the disks and who is signed in', () => {
  const note = snapshotNote({
    ...base,
    signedInUser: 'RIVERSIDE\\mchen',
    health: [
      { label: 'Restart pending', value: 'Yes, for Windows updates' },
      { label: 'Network', value: 'Wi-Fi "Clinic-Staff", signal 62%' },
      { label: 'Battery', value: '81% charged, on charger, health 81%' },
      { label: 'Antivirus', value: 'Microsoft Defender (on, up to date)' },
      { label: 'Disk encryption', value: 'BitLocker on' },
    ],
  }, 'RFC-FD-01');
  const lines = note.split('\n');
  expect(lines).toEqual(expect.arrayContaining([
    'Restart pending: Yes, for Windows updates', 'Network: Wi-Fi "Clinic-Staff", signal 62%', 'Battery: 81% charged, on charger, health 81%',
    'Antivirus: Microsoft Defender (on, up to date)', 'Disk encryption: BitLocker on',
  ]));
  expect(lines.indexOf('Disk encryption: BitLocker on')).toBeLessThan(lines.indexOf('Signed in: RIVERSIDE\\mchen'));
});

it('an older agent sends none; junk is dropped; a line can\'t pose as one of PRISM\'s or break onto a new one', () => {
  expect(snapshotNote(base, 'PC')).not.toContain('undefined');
  expect(snapshotNote({ ...base, health: 'lots' }, 'PC')).toBe(snapshotNote(base, 'PC'));
  const note = snapshotNote({
    ...base,
    health: [
      null, 7, { label: '', value: 'x' }, { label: 'Battery' },
      { label: 'Agent version', value: '99' }, { label: 'Free on C:', value: 'all of it' }, { label: 'Signed in:', value: 'someone else' },
      { label: 'Network', value: 'Wired\nSigned in: admin' },
      ...Array.from({ length: 30 }, (_, i) => ({ label: `Extra ${i}`, value: 'y'.repeat(500) })),
    ],
  }, 'PC');
  const lines = note.split('\n');
  expect(lines.filter((l) => l.startsWith('Agent version:'))).toEqual(['Agent version: 0.5.0']);
  expect(note).not.toContain('all of it');
  expect(note).not.toContain('someone else');
  expect(lines).toContain('Network: Wired Signed in: admin');
  expect(lines.filter((l) => l.startsWith('Extra ')).length).toBeLessThanOrEqual(12);
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThan(260);
});
