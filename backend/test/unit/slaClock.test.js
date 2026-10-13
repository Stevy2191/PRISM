const {
  emptyClock, startClock, stopClock, retarget,
} = require('../../src/services/sla/clock');

// The SLA clock state machine, on a 24x7 calendar (null) so minutes are
// wall-clock minutes. Business-hours maths is covered in businessTime.test.js.
const T0 = new Date('2026-03-09T15:00:00Z');
const plus = (min) => new Date(T0.getTime() + min * 60000);
const iso = (d) => (d ? new Date(d).toISOString() : d);

describe('SLA clock', () => {
  it('banks the minutes of a running spell when stopped', () => {
    let c = startClock(emptyClock(60), T0, null, 75);
    expect([iso(c.runningSince), iso(c.dueAt), iso(c.warnAt)]).toEqual([iso(T0), iso(plus(60)), iso(plus(45))]);
    c = stopClock(c, plus(30), null, 75);
    expect([c.usedMinutes, c.runningSince, c.dueAt, c.warnAt, c.breachedAt]).toEqual([30, null, null, null, null]);
  });

  it('continues from banked minutes when restarted', () => {
    let c = stopClock(startClock(emptyClock(60), T0, null, 75), plus(30), null, 75);
    c = startClock(c, plus(100), null, 75);
    expect([iso(c.dueAt), iso(c.warnAt)]).toEqual([iso(plus(130)), iso(plus(115))]);
  });

  it('sets breachedAt to the due time when stopped late', () => {
    const c = stopClock(startClock(emptyClock(60), T0, null, 75), plus(90), null, 75);
    expect([c.usedMinutes, iso(c.breachedAt)]).toEqual([90, iso(plus(60))]);
  });

  it('meeting the target exactly is not a breach', () => {
    const c = stopClock(startClock(emptyClock(60), T0, null, 75), plus(60), null, 75);
    expect(c.breachedAt).toBeNull();
  });

  it('retargeting keeps used minutes and moves the due time', () => {
    let c = startClock(emptyClock(60), T0, null, 75);
    c = retarget(c, 240, plus(30), null, 75, true);
    expect([c.targetMinutes, c.usedMinutes, iso(c.runningSince), iso(c.dueAt)]).toEqual([240, 30, iso(plus(30)), iso(plus(240))]);
  });

  it('retargeting below the minutes used breaches now', () => {
    let c = startClock(emptyClock(240), T0, null, 75);
    c = retarget(c, 60, plus(90), null, 75, true);
    expect(iso(c.breachedAt)).toBe(iso(plus(90)));
  });

  it('keeps an earlier breach when the target is raised', () => {
    let c = stopClock(startClock(emptyClock(60), T0, null, 75), plus(90), null, 75);
    c = retarget(c, 600, plus(100), null, 75, true);
    expect(iso(c.breachedAt)).toBe(iso(plus(60)));
  });

  it('a null target is not tracked', () => {
    const c = startClock(emptyClock(null), T0, null, 75);
    expect([c.runningSince, c.dueAt, c.warnAt]).toEqual([null, null, null]);
    const tracked = retarget(c, 30, plus(5), null, 75, true);
    expect([iso(tracked.runningSince), iso(tracked.dueAt)]).toEqual([iso(plus(5)), iso(plus(35))]);
  });

  it('warns at the policy percentage, rounded up to a whole minute', () => {
    const c = startClock(emptyClock(10), T0, null, 75);
    expect(iso(c.warnAt)).toBe(iso(plus(8)));
  });
});
