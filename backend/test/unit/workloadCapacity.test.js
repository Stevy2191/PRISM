const {
  capacityFor, spread, itemMinutes, shareMinutes, DEFAULT_WORK_HOURS,
} = require('../../src/services/workload/capacity');

const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']; // Mon..Fri
const obj = (m) => Object.fromEntries(m);

it('default hours Mon–Fri 8h, weekend 0', () => {
  expect(capacityFor(null, DEFAULT_WORK_HOURS, new Set(), '2026-11-02')).toBe(480); // Monday
  expect(capacityFor(null, DEFAULT_WORK_HOURS, new Set(), '2026-11-06')).toBe(480); // Friday
  expect(capacityFor(null, DEFAULT_WORK_HOURS, new Set(), '2026-11-07')).toBe(0); // Saturday
  expect(capacityFor(null, DEFAULT_WORK_HOURS, new Set(), '2026-11-08')).toBe(0); // Sunday
  // A person's own hours win over the defaults.
  expect(capacityFor({ 1: 240, 6: 120 }, DEFAULT_WORK_HOURS, new Set(), '2026-11-02')).toBe(240);
  expect(capacityFor({ 1: 240, 6: 120 }, DEFAULT_WORK_HOURS, new Set(), '2026-11-07')).toBe(120);
  expect(capacityFor({ 1: 240 }, DEFAULT_WORK_HOURS, new Set(), '2026-11-03')).toBe(0); // missing key = off
});

it('holiday capacity 0', () => {
  expect(capacityFor(null, DEFAULT_WORK_HOURS, new Set(['2026-11-03']), '2026-11-03')).toBe(0);
});

it('spread 6h over 3 working days is 2h each', () => {
  expect(obj(spread(360, '2026-11-02', '2026-11-04', week, '2026-11-02'))).toEqual({
    '2026-11-02': 120, '2026-11-03': 120, '2026-11-04': 120,
  });
});

it('spread skips weekend and holiday', () => {
  // Fri..Tue with Monday a holiday: working days are Fri and Tue only.
  const working = ['2026-11-06', '2026-11-10'];
  expect(obj(spread(240, '2026-11-06', '2026-11-10', working, '2026-11-02'))).toEqual({
    '2026-11-06': 120, '2026-11-10': 120,
  });
  // The window starts at today when the start date is already past.
  expect(obj(spread(100, '2026-11-02', '2026-11-04', week, '2026-11-03'))).toEqual({
    '2026-11-03': 50, '2026-11-04': 50,
  });
  // Rounding remainder lands on the last day.
  expect(obj(spread(7, '2026-11-02', '2026-11-03', week, '2026-11-02'))).toEqual({ '2026-11-02': 3, '2026-11-03': 4 });
});

it('due date only puts everything on the due date', () => {
  expect(obj(spread(90, null, '2026-11-05', week, '2026-11-02'))).toEqual({ '2026-11-05': 90 });
});

it('past-due goes to today', () => {
  expect(obj(spread(90, '2026-10-20', '2026-10-30', week, '2026-11-02'))).toEqual({ '2026-11-02': 90 });
  expect(obj(spread(90, null, '2026-10-30', week, '2026-11-02'))).toEqual({ '2026-11-02': 90 });
});

it('no dates goes to none', () => {
  expect(obj(spread(90, null, null, week, '2026-11-02'))).toEqual({ none: 90 });
});

it('window with no working days goes to due date', () => {
  // Sat..Sun window: nothing to spread over.
  expect(obj(spread(90, '2026-11-07', '2026-11-08', week, '2026-11-02'))).toEqual({ '2026-11-08': 90 });
});

describe('itemMinutes', () => {
  it('a task is its estimate less everyone\'s logged time, never below 0', () => {
    expect(itemMinutes({ kind: 'task', estimateMinutes: 240, loggedMinutes: 60 }, 60)).toBe(180);
    expect(itemMinutes({ kind: 'task', estimateMinutes: 30, loggedMinutes: 90 }, 60)).toBe(0);
    expect(itemMinutes({ kind: 'task', estimateMinutes: null, loggedMinutes: 0 }, 60)).toBe(0);
  });

  it('ticket with no tasks uses the default size', () => {
    expect(itemMinutes({ kind: 'ticket', tasks: [] }, 60)).toBe(60);
    expect(itemMinutes({ kind: 'ticket' }, 45)).toBe(45);
  });

  it('a ticket with open tasks is the sum of their remaining estimates', () => {
    const tasks = [{ estimateMinutes: 100, loggedMinutes: 40 }, { estimateMinutes: 30, loggedMinutes: 0 }];
    expect(itemMinutes({ kind: 'ticket', tasks }, 60)).toBe(90);
  });
});

describe('shareMinutes', () => {
  it('4 h task with a main assignee and one helper → 2 h each', () => {
    expect(obj(shareMinutes(240, [7, 9]))).toEqual({ 7: 120, 9: 120 });
  });

  it('7 min split between 2 → 3 and 4', () => {
    expect(obj(shareMinutes(7, [7, 9]))).toEqual({ 7: 3, 9: 4 });
  });

  it('one person takes it all, nobody gets nothing', () => {
    expect(obj(shareMinutes(50, [7]))).toEqual({ 7: 50 });
    expect(shareMinutes(50, []).size).toBe(0);
  });
});

it('weekend days snap back to Friday, or forward to Monday for today', () => {
  const { snapBack, snapForward } = require('../../src/services/workload/capacity');
  expect(snapBack('2026-11-07')).toBe('2026-11-06'); // Saturday
  expect(snapBack('2026-11-08')).toBe('2026-11-06'); // Sunday
  expect(snapBack('2026-11-04')).toBe('2026-11-04');
  expect(snapForward('2026-11-07')).toBe('2026-11-09');
  expect(snapForward('2026-11-08')).toBe('2026-11-09');
  expect(snapForward('2026-11-06')).toBe('2026-11-06');
});

describe('long windows (no year cap)', () => {
  const { workingSpan, workingWeekdays } = require('../../src/services/workload/capacity');
  const monFri = workingWeekdays(null, DEFAULT_WORK_HOURS);
  const range = ['2026-11-02', '2026-11-13']; // the two visible weeks

  // Brute-force count for checking the arithmetic.
  const { addDays, isoWeekday } = require('../../src/services/projects/schedule');
  const walk = (lo, due, workdays, holidays) => {
    let n = 0;
    for (let d = lo; d <= due; d = addDays(d, 1)) if (workdays.has(isoWeekday(d)) && !holidays.has(d)) n += 1;
    return n;
  };

  it('counts working days arithmetically, minus holidays on working days', () => {
    const holidays = new Set(['2026-12-25', '2027-01-01', '2027-07-04', '2028-07-04', '2027-11-06']); // 2027-11-06 is a Saturday
    for (const [lo, due] of [['2026-11-02', '2028-11-01'], ['2026-11-04', '2026-11-04'], ['2026-11-07', '2026-11-08'], ['2026-11-05', '2027-02-10']]) {
      const span = workingSpan(lo, due, '2026-11-02', monFri, holidays, range);
      expect([lo, due, span.count]).toEqual([lo, due, walk(lo, due, monFri, holidays)]);
    }
  });

  it("a 2-year task's per-day minutes are the remaining minutes over 2 years of working days", () => {
    const span = workingSpan('2026-11-02', '2028-11-01', '2026-11-02', monFri, new Set(), range);
    expect(span.count).toBe(walk('2026-11-02', '2028-11-01', monFri, new Set())); // ~522, not ~261
    const minutes = 60 * 522;
    const out = spread(minutes, '2026-11-02', '2028-11-01', span, '2026-11-02');
    expect(out.get('2026-11-02')).toBe(Math.floor(minutes / span.count));
    expect(out.get('2026-11-02')).toBeLessThan(65); // about an hour a day, not two
    // Only the visible weekdays are materialised.
    expect([...out.keys()].sort()).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it("uses the person's own working weekdays; weekend hours do not take a share", () => {
    const monWedSat = workingWeekdays({ 1: 480, 3: 240, 6: 300 }, DEFAULT_WORK_HOURS);
    expect([...monWedSat].sort()).toEqual([1, 3]);
    const span = workingSpan('2026-11-02', '2026-11-13', '2026-11-02', monWedSat, new Set(['2026-11-04']), range);
    expect(span).toEqual({ count: 3, last: '2026-11-11', days: ['2026-11-02', '2026-11-09', '2026-11-11'] });
  });

  it('the window starts at today, and the remainder lands on the last working day even when it is off screen', () => {
    const span = workingSpan('2026-10-01', '2026-11-20', '2026-11-04', monFri, new Set(), range);
    expect(span.count).toBe(13); // Nov 4..20 weekdays
    expect(span.last).toBe('2026-11-20');
    expect(span.days[0]).toBe('2026-11-04');
    const out = spread(100, '2026-10-01', '2026-11-20', span, '2026-11-04');
    expect([...out.values()].every((m) => m === 7)).toBe(true); // floor(100/13); the 9 left are on Nov 20, off screen
  });

  it('no working days in the window, a past due date or no start gives an empty span', () => {
    expect(workingSpan('2026-11-07', '2026-11-08', '2026-11-02', monFri, new Set(), range).count).toBe(0);
    expect(workingSpan('2026-10-01', '2026-10-30', '2026-11-02', monFri, new Set(), range).count).toBe(0);
    expect(workingSpan(null, '2026-11-30', '2026-11-02', monFri, new Set(), range).count).toBe(0);
  });
});
