const { chargesFor } = require('../../src/services/money/billingRules');

// Phase 3, step 1, task 6: the owner's billing rules (2026-11-25).
//   Event-basis customer: an on-site call = trip charge + at least 1 hour,
//   then 30-minute steps; remote work in 30-minute steps, no minimum.
//   Recurring customer: an on-site call = trip charge only (labor covered in
//   hours); remote in hours covered. After hours: the after-hours rate in
//   30-minute steps (an event customer's call keeps its 1-hour minimum).

const rates = { hourlyRate: '100.00', afterHoursRate: '150.00', tripCharge: '45.00' };
const base = { rates, minimumMinutes: 60, stepMinutes: 30 };
let id = 0;
const e = (minutes, extra = {}) => {
  id += 1;
  return {
    id, ticketId: 7, entryDate: '2026-12-02', durationSeconds: Math.round(minutes * 60), onSite: false, afterHours: false, billable: true, ...extra,
  };
};
const site = (minutes, extra = {}) => e(minutes, { onSite: true, ...extra });
const event = (entries) => chargesFor(entries, { ...base, recurring: false });
const recurring = (entries) => chargesFor(entries, { ...base, recurring: true });
const brief = (r) => r.lines.map((l) => [l.kind, l.billedMinutes, l.amount]);

describe('event-basis customer, on site', () => {
  test.each([
    [20, 60, '100.00'],
    [60, 60, '100.00'],
    [61, 90, '150.00'],
    [89, 90, '150.00'],
    [90, 90, '150.00'],
    [91, 120, '200.00'],
  ])('%s min → trip + %s min', (minutes, billed, amount) => {
    expect(brief(event([site(minutes)]))).toEqual([['trip', 0, '45.00'], ['labor', billed, amount]]);
  });

  it('two entries on one ticket on one day are one call', () => {
    expect(brief(event([site(25), site(25)]))).toEqual([['trip', 0, '45.00'], ['labor', 60, '100.00']]);
  });

  it('the same ticket on two days is two calls', () => {
    const r = event([site(30), site(30, { entryDate: '2026-12-03' })]);
    expect(r.lines.filter((l) => l.kind === 'trip')).toHaveLength(2);
    expect(r.lines.filter((l) => l.kind === 'labor').map((l) => l.billedMinutes)).toEqual([60, 60]);
  });

  it('after hours keeps the minimum, at the after-hours rate', () => {
    expect(brief(event([site(20, { afterHours: true })]))).toEqual([['trip', 0, '45.00'], ['after_hours', 60, '150.00']]);
  });
});

describe('event-basis customer, remote', () => {
  it('30-minute steps, no minimum', () => {
    expect(brief(event([e(10)]))).toEqual([['labor', 30, '50.00']]);
    expect(brief(event([e(31)]))).toEqual([['labor', 60, '100.00']]);
  });
  it('adds up one ticket\'s day before rounding', () => {
    expect(brief(event([e(10), e(10)]))).toEqual([['labor', 30, '50.00']]);
  });
  it('after hours remote: steps at the after-hours rate', () => {
    expect(brief(event([e(40, { afterHours: true })]))).toEqual([['after_hours', 60, '150.00']]);
  });
  it('nothing for no time', () => {
    expect(event([e(0)]).lines).toEqual([]);
  });
});

describe('recurring customer', () => {
  it('on site in hours: the trip charge only; the labor is covered', () => {
    const r = recurring([site(180)]);
    expect(brief(r)).toEqual([['trip', 0, '45.00']]);
    expect(r.covered).toEqual([{ ticketId: 7, date: '2026-12-02', minutes: 180, entryIds: [expect.any(Number)] }]);
  });
  it('remote in hours: all covered, nothing billed', () => {
    const r = recurring([e(50), e(20)]);
    expect(r.lines).toEqual([]);
    expect(r.covered[0].minutes).toBe(70);
  });
  it('after hours: steps at the after-hours rate, no minimum', () => {
    expect(brief(recurring([e(40, { afterHours: true })]))).toEqual([['after_hours', 60, '150.00']]);
    expect(brief(recurring([e(10, { afterHours: true })]))).toEqual([['after_hours', 30, '75.00']]);
    expect(brief(recurring([site(20, { afterHours: true })]))).toEqual([['trip', 0, '45.00'], ['after_hours', 30, '75.00']]);
  });
});

it('ignores time that isn\'t billable', () => {
  expect(event([e(60, { billable: false }), site(60, { billable: false })])).toEqual({ lines: [], covered: [] });
});

it('every line lists the entries it bills, and the rate', () => {
  const a = site(20);
  const b = site(15);
  const r = event([a, b]);
  const labor = r.lines.find((l) => l.kind === 'labor');
  expect(labor).toMatchObject({ ticketId: 7, date: '2026-12-02', minutes: 35, rate: '100.00' });
  expect(labor.entryIds.sort()).toEqual([a.id, b.id].sort());
  expect(r.lines.find((l) => l.kind === 'trip').entryIds.sort()).toEqual([a.id, b.id].sort());
});
