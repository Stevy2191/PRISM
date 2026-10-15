const { nextRun, previewRuns, validateSchedule } = require('../../src/services/recurring/schedule');

// Recurring ticket schedules: the next run strictly after an instant, at a
// wall time in the rule's zone.

const TZ = 'America/Chicago';
const rule = (fields) => ({
  frequency: 'daily', interval: 1, weekdays: null, dayOfMonth: null, monthOfYear: null,
  timeOfDay: '09:00', timezone: TZ, startDate: '2026-01-01', endDate: null, ...fields,
});
const iso = (dates) => dates.map((d) => d.toISOString());

it('daily interval 3 from start date', () => {
  const r = rule({ interval: 3 });
  expect(nextRun(r, new Date('2025-12-01T00:00:00Z')).toISOString()).toBe('2026-01-01T15:00:00.000Z');
  expect(iso(previewRuns(r, new Date('2026-01-01T15:00:00Z'), 3)))
    .toEqual(['2026-01-04T15:00:00.000Z', '2026-01-07T15:00:00.000Z', '2026-01-10T15:00:00.000Z']);
  // Far in the future it still lands on the 3-day grid.
  expect(nextRun(r, new Date('2027-01-01T00:00:00Z')).toISOString()).toBe('2027-01-02T15:00:00.000Z') // 366 days = 122 periods;
});

it('weekly on Mon/Thu every 2 weeks', () => {
  const r = rule({ frequency: 'weekly', interval: 2, weekdays: [4, 1], startDate: '2026-01-05' });
  expect(iso(previewRuns(r, new Date('2026-01-01T00:00:00Z'), 5))).toEqual([
    '2026-01-05T15:00:00.000Z', '2026-01-08T15:00:00.000Z', '2026-01-19T15:00:00.000Z', '2026-01-22T15:00:00.000Z', '2026-02-02T15:00:00.000Z',
  ]);
});

it('weekly skips weekdays before the start date in the first week', () => {
  const r = rule({ frequency: 'weekly', weekdays: [1, 5], startDate: '2026-01-07' }); // a Wednesday
  expect(iso(previewRuns(r, new Date('2026-01-01T00:00:00Z'), 2))).toEqual(['2026-01-09T15:00:00.000Z', '2026-01-12T15:00:00.000Z']);
});

it('monthly on the 31st clamps to Feb 28 and Apr 30', () => {
  const r = rule({ frequency: 'monthly', dayOfMonth: 31, startDate: '2026-01-31' });
  expect(iso(previewRuns(r, new Date('2026-01-01T00:00:00Z'), 4)).map((s) => s.slice(0, 10)))
    .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

it('monthly every 3 months counts from the start month', () => {
  const r = rule({ frequency: 'monthly', interval: 3, dayOfMonth: 15, startDate: '2026-02-01' });
  expect(iso(previewRuns(r, new Date('2026-01-01T00:00:00Z'), 3)).map((s) => s.slice(0, 10)))
    .toEqual(['2026-02-15', '2026-05-15', '2026-08-15']);
});

it('yearly Feb 29 runs Feb 28 in non-leap years', () => {
  const r = rule({ frequency: 'yearly', monthOfYear: 2, dayOfMonth: 29, startDate: '2028-01-01' });
  expect(iso(previewRuns(r, new Date('2027-06-01T00:00:00Z'), 5)).map((s) => s.slice(0, 10)))
    .toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
});

it('DST spring forward 02:30 runs 03:30 local; fall back 01:30 runs once', () => {
  const spring = rule({ timeOfDay: '02:30', startDate: '2026-03-07' });
  expect(iso(previewRuns(spring, new Date('2026-03-01T00:00:00Z'), 3)))
    .toEqual(['2026-03-07T08:30:00.000Z', '2026-03-08T08:30:00.000Z', '2026-03-09T07:30:00.000Z']);
  const fall = rule({ timeOfDay: '01:30', startDate: '2026-10-31' });
  expect(iso(previewRuns(fall, new Date('2026-11-01T00:00:00Z'), 2)))
    .toEqual(['2026-11-01T06:30:00.000Z', '2026-11-02T07:30:00.000Z']);
});

it('strictly after: a run at exactly after is skipped', () => {
  const r = rule({});
  expect(nextRun(r, new Date('2026-01-01T15:00:00Z')).toISOString()).toBe('2026-01-02T15:00:00.000Z');
});

it('returns null past endDate', () => {
  const r = rule({ endDate: '2026-01-02' });
  expect(nextRun(r, new Date('2026-01-01T15:00:00Z')).toISOString()).toBe('2026-01-02T15:00:00.000Z');
  expect(nextRun(r, new Date('2026-01-02T15:00:00Z'))).toBeNull();
});

it('validateSchedule rejects bad frequency, interval 0, empty weekdays, bad zone, end before start', () => {
  const base = {
    frequency: 'weekly', interval: 1, weekdays: [1], timeOfDay: '09:00', timezone: TZ, startDate: '2026-01-01',
  };
  expect(validateSchedule(base)).toEqual({
    frequency: 'weekly', interval: 1, weekdays: [1], dayOfMonth: null, monthOfYear: null,
    timeOfDay: '09:00', timezone: TZ, startDate: '2026-01-01', endDate: null,
  });
  const bad = [
    { frequency: 'hourly' }, { interval: 0 }, { interval: 1.5 }, { interval: 366 }, { weekdays: [] }, { weekdays: [7] },
    { timezone: 'Mars/Base' }, { timeOfDay: '25:00' }, { timeOfDay: '9am' }, { startDate: '2026-02-30' },
    { endDate: '2025-12-31' }, { frequency: 'monthly', dayOfMonth: 0 }, { frequency: 'monthly', dayOfMonth: 32 },
    { frequency: 'yearly', dayOfMonth: 1, monthOfYear: 13 },
  ];
  for (const change of bad) {
    expect(() => validateSchedule({ ...base, ...change })).toThrow(expect.objectContaining({ status: 400 }));
  }
});
