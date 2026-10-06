const {
  dateInZone, todayInZone, zoneDayStart, zoneDayEnd, addDays, toDateString, isValidZone,
} = require('../../src/utils/orgTime');

// The organization's calendar: work dates and report days are whole days in
// one configured zone, whatever zone the server or the browser runs in.

describe('dateInZone / todayInZone', () => {
  it('reads an instant on the zone\'s wall calendar', () => {
    const late = new Date('2026-03-10T03:30:00Z'); // 22:30 on the 9th in Chicago
    expect(dateInZone(late, 'UTC')).toBe('2026-03-10');
    expect(dateInZone(late, 'America/Chicago')).toBe('2026-03-09');
    expect(dateInZone(late, 'Asia/Tokyo')).toBe('2026-03-10');
    expect(todayInZone('America/Chicago', late)).toBe('2026-03-09');
  });
});

describe('zoneDayStart / zoneDayEnd', () => {
  it('bounds a day in the zone, as UTC instants', () => {
    expect(zoneDayStart('2026-03-11', 'UTC').toISOString()).toBe('2026-03-11T00:00:00.000Z');
    expect(zoneDayEnd('2026-03-11', 'UTC').toISOString()).toBe('2026-03-11T23:59:59.999Z');
    expect(zoneDayStart('2026-03-11', 'America/Chicago').toISOString()).toBe('2026-03-11T05:00:00.000Z');
    expect(zoneDayStart('2026-03-11', 'Asia/Tokyo').toISOString()).toBe('2026-03-10T15:00:00.000Z');
  });

  it('handles the days the clocks change', () => {
    // US DST starts 2026-03-08: the day is 23 hours long in Chicago.
    expect(zoneDayStart('2026-03-08', 'America/Chicago').toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(zoneDayEnd('2026-03-08', 'America/Chicago').toISOString()).toBe('2026-03-09T04:59:59.999Z');
    // ...and ends 2026-11-01: 25 hours.
    expect(zoneDayStart('2026-11-01', 'America/Chicago').toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(zoneDayEnd('2026-11-01', 'America/Chicago').toISOString()).toBe('2026-11-02T05:59:59.999Z');
  });
});

describe('helpers', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('reads a date string and refuses anything else', () => {
    expect(toDateString('2026-03-10')).toBe('2026-03-10');
    expect(toDateString('2026-03-10T22:00:00Z')).toBe('2026-03-10');
    for (const bad of [undefined, null, '', 'garbage', '2026-02-30', '2026-13-01', '10/03/2026']) {
      expect(toDateString(bad)).toBeNull();
    }
  });

  it('knows a real zone from a typo', () => {
    expect(isValidZone('America/Chicago')).toBe(true);
    expect(isValidZone('UTC')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
    expect(isValidZone('')).toBe(false);
  });
});
