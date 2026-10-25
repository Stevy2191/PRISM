const s = require('../../src/services/projects/schedule');

it('addDays across DST and month end', () => {
  expect(s.addDays('2026-03-07', 1)).toBe('2026-03-08');
  expect(s.addDays('2026-03-08', 1)).toBe('2026-03-09'); // US spring-forward
  expect(s.addDays('2026-11-01', 1)).toBe('2026-11-02'); // US fall-back
  expect(s.addDays('2026-03-28', 1)).toBe('2026-03-29'); // EU spring-forward
  expect(s.addDays('2026-01-31', 1)).toBe('2026-02-01');
  expect(s.addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(s.addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(s.addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(s.addDays('2026-03-08', 0)).toBe('2026-03-08');
  expect(s.daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  expect(s.daysBetween('2026-04-01', '2026-03-01')).toBe(-31);
  expect(s.daysBetween('2026-11-01', '2026-11-02')).toBe(1);
  expect(s.isoWeekday('2026-10-25')).toBe(7); // Sunday
  expect(s.isoWeekday('2026-10-26')).toBe(1); // Monday
});

it('phaseSpan ignores undated tasks and is null when none dated', () => {
  expect(s.phaseSpan([])).toBeNull();
  expect(s.phaseSpan([{ startDate: null, dueDate: null }])).toBeNull();
  expect(s.phaseSpan([
    { startDate: '2026-05-03', dueDate: '2026-05-10' },
    { startDate: null, dueDate: null },
    { startDate: '2026-05-01', dueDate: '2026-05-04' },
  ])).toEqual({ startDate: '2026-05-01', dueDate: '2026-05-10' });
  // a task with only one date still counts for that edge
  expect(s.phaseSpan([{ startDate: null, dueDate: '2026-06-01' }, { startDate: '2026-05-20', dueDate: null }]))
    .toEqual({ startDate: '2026-05-20', dueDate: '2026-06-01' });
});

it('waitingOn excludes done predecessors', () => {
  const deps = [{ predecessorId: 1, successorId: 3 }, { predecessorId: 2, successorId: 3 }, { predecessorId: 3, successorId: 4 }];
  expect(s.waitingOn(3, deps, new Set())).toEqual([1, 2]);
  expect(s.waitingOn(3, deps, new Set([1]))).toEqual([2]);
  expect(s.waitingOn(3, deps, new Set([1, 2]))).toEqual([]);
  expect(s.waitingOn(1, deps, new Set())).toEqual([]);
});

it('wouldCycle true for self, direct and 3-step loop', () => {
  const deps = [{ predecessorId: 1, successorId: 2 }, { predecessorId: 2, successorId: 3 }, { predecessorId: 3, successorId: 4 }];
  expect(s.wouldCycle(deps, 5, 5)).toBe(true);
  expect(s.wouldCycle(deps, 2, 1)).toBe(true); // direct reverse
  expect(s.wouldCycle(deps, 4, 1)).toBe(true); // closes a 3-step loop
  expect(s.wouldCycle(deps, 1, 4)).toBe(false);
  expect(s.wouldCycle(deps, 5, 1)).toBe(false);
});

it('downstream is transitive and deduplicated on a diamond', () => {
  const deps = [
    { predecessorId: 1, successorId: 2 }, { predecessorId: 1, successorId: 3 },
    { predecessorId: 2, successorId: 4 }, { predecessorId: 3, successorId: 4 },
    { predecessorId: 4, successorId: 5 },
  ];
  const out = s.downstream(deps, 1);
  expect([...out].sort()).toEqual([2, 3, 4, 5]);
  expect(out).toHaveLength(4);
  // topological: every task after all its predecessors in the list
  expect(out.indexOf(4)).toBeGreaterThan(out.indexOf(2));
  expect(out.indexOf(4)).toBeGreaterThan(out.indexOf(3));
  expect(out.indexOf(5)).toBe(3);
  expect(s.downstream(deps, 5)).toEqual([]);
});

it('shiftTasks keeps null dates', () => {
  const tasks = [
    { id: 1, startDate: '2026-03-07', dueDate: '2026-03-09' },
    { id: 2, startDate: null, dueDate: '2026-01-31' },
    { id: 3, startDate: null, dueDate: null },
    { id: 4, startDate: '2026-01-01', dueDate: '2026-01-02' },
  ];
  expect(s.shiftTasks(tasks, [1, 2, 3], 2)).toEqual([
    { id: 1, startDate: '2026-03-09', dueDate: '2026-03-11' },
    { id: 2, startDate: null, dueDate: '2026-02-02' },
    { id: 3, startDate: null, dueDate: null },
  ]);
});

it('stretch keeps length >= 1 and milestones at 0', () => {
  expect(s.stretch(10, 4, 2)).toEqual({ offset: 20, length: 8 });
  expect(s.stretch(10, 4, 0.1)).toEqual({ offset: 1, length: 1 });
  expect(s.stretch(3, 0, 5)).toEqual({ offset: 15, length: 0 });
  expect(s.stretch(0, 1, 0.01)).toEqual({ offset: 0, length: 1 });
});

it('is safe in any process time zone', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try {
    expect(s.addDays('2026-09-26', 1)).toBe('2026-09-27'); // NZ spring-forward
    expect(s.daysBetween('2026-09-26', '2026-09-28')).toBe(2);
  } finally { process.env.TZ = prev; }
});
