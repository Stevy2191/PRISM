const { addBusinessMinutes, businessMinutesBetween } = require('../../src/services/sla/businessTime');

// Mon–Fri 09:00–17:00 in Chicago. 2026-03-09 is a Monday (CDT, UTC-5).
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
function schedule(open = WEEKDAYS, start = '09:00', end = '17:00') {
  const s = {};
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach((d) => {
    s[d] = { start, end, enabled: open.includes(d) };
  });
  return s;
}
const cal = (extra = {}) => ({
  timezone: 'America/Chicago', schedule: schedule(), is24x7: false, holidays: new Set(), ...extra,
});
const at = (iso) => new Date(iso);
const iso = (d) => d.toISOString();

describe('addBusinessMinutes', () => {
  it('adds within one open day', () => {
    expect(iso(addBusinessMinutes(at('2026-03-09T15:00:00Z'), 60, cal()))).toBe('2026-03-09T16:00:00.000Z');
  });

  it('rolls past closing into the next open day', () => {
    // Mon 16:30 + 60 → Tue 09:30
    expect(iso(addBusinessMinutes(at('2026-03-09T21:30:00Z'), 60, cal()))).toBe('2026-03-10T14:30:00.000Z');
  });

  it('counts from opening when started before it', () => {
    expect(iso(addBusinessMinutes(at('2026-03-09T12:00:00Z'), 30, cal()))).toBe('2026-03-09T14:30:00.000Z');
  });

  it('lands on Monday when started Friday evening', () => {
    // Fri 2026-03-13 18:00 CDT + 60 → Mon 10:00
    expect(iso(addBusinessMinutes(at('2026-03-13T23:00:00Z'), 60, cal()))).toBe('2026-03-16T15:00:00.000Z');
  });

  it('skips a holiday', () => {
    const c = cal({ holidays: new Set(['2026-03-16']) });
    expect(iso(addBusinessMinutes(at('2026-03-13T23:00:00Z'), 60, c))).toBe('2026-03-17T15:00:00.000Z');
  });

  it('treats 24x7 and a null calendar as wall-clock time', () => {
    const fri = at('2026-03-13T23:00:00Z');
    expect(iso(addBusinessMinutes(fri, 90, null))).toBe('2026-03-14T00:30:00.000Z');
    expect(iso(addBusinessMinutes(fri, 90, cal({ is24x7: true })))).toBe('2026-03-14T00:30:00.000Z');
  });

  it('returns the start unchanged for zero minutes', () => {
    const sat = at('2026-03-14T15:00:00Z');
    expect(iso(addBusinessMinutes(sat, 0, cal()))).toBe(iso(sat));
  });

  it('treats a day whose end is not after its start as closed', () => {
    const s = schedule();
    s.monday = { start: '17:00', end: '09:00', enabled: true };
    // Fri 18:00 + 60 → Tue 10:00 (Monday is effectively closed)
    expect(iso(addBusinessMinutes(at('2026-03-13T23:00:00Z'), 60, cal({ schedule: s })))).toBe('2026-03-17T15:00:00.000Z');
  });

  it('throws for a schedule with no open time at all', () => {
    expect(() => addBusinessMinutes(at('2026-03-09T15:00:00Z'), 60, cal({ schedule: schedule([]) }))).toThrow(/no open hours/i);
  });
});

describe('businessMinutesBetween', () => {
  it('counts only open minutes across a weekend', () => {
    // Fri 16:00 → Mon 10:00 = 60 + 60
    expect(businessMinutesBetween(at('2026-03-13T21:00:00Z'), at('2026-03-16T15:00:00Z'), cal())).toBe(120);
  });

  it('is zero when the end is not after the start', () => {
    expect(businessMinutesBetween(at('2026-03-09T16:00:00Z'), at('2026-03-09T15:00:00Z'), cal())).toBe(0);
  });

  it('uses wall-clock minutes for a null calendar', () => {
    expect(businessMinutesBetween(at('2026-03-13T21:00:00Z'), at('2026-03-16T15:00:00Z'), null)).toBe(66 * 60);
  });

  it('round-trips with addBusinessMinutes', () => {
    const start = at('2026-03-12T20:17:00Z');
    [1, 59, 480, 2000].forEach((n) => {
      expect(businessMinutesBetween(start, addBusinessMinutes(start, n, cal()), cal())).toBe(n);
    });
  });

  it('counts real open minutes on the days the clocks change', () => {
    const sundays = cal({ schedule: schedule(['sunday'], '01:00', '05:00') });
    // Spring forward: 01:00 CST → 05:00 CDT is 3 real hours.
    expect(businessMinutesBetween(at('2026-03-08T00:00:00Z'), at('2026-03-09T00:00:00Z'), sundays)).toBe(180);
    // Fall back: 01:00 CDT → 05:00 CST is 5 real hours.
    expect(businessMinutesBetween(at('2026-11-01T00:00:00Z'), at('2026-11-02T00:00:00Z'), sundays)).toBe(300);
  });
});
