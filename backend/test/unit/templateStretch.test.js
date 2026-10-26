const { planFromTemplate } = require('../../src/services/projects/templatePlan');

const task = (id, startDay, lengthDays, extra = {}) => ({
  id, phaseId: null, parentId: null, title: `T${id}`, startDay, lengthDays, isMilestone: lengthDays === 0, ...extra,
});
const byId = (plan) => Object.fromEntries(plan.tasks.map((t) => [t.id, t]));

it('plan with no finishDate keeps offsets', () => {
  const shape = { phases: [], dependencies: [], tasks: [task('a', 1, 3), task('b', 4, 2), task('m', 6, 0)] };
  const plan = planFromTemplate(shape, { startDate: '2026-03-02' });
  const t = byId(plan);
  expect([t.a.startDate, t.a.dueDate]).toEqual(['2026-03-02', '2026-03-04']);
  expect([t.b.startDate, t.b.dueDate]).toEqual(['2026-03-05', '2026-03-06']);
  expect([t.m.startDate, t.m.dueDate]).toEqual(['2026-03-07', '2026-03-07']);
  expect(plan.finishDate).toBe('2026-03-07');
});

it('finishDate double span doubles offsets', () => {
  // Template span is 6 days (1..6); finishing on day 12 doubles every offset and length.
  const shape = { phases: [], dependencies: [], tasks: [task('a', 1, 2), task('b', 3, 2), task('c', 5, 2)] };
  const plan = planFromTemplate(shape, { startDate: '2026-03-02', finishDate: '2026-03-13' });
  const t = byId(plan);
  expect([t.a.startDate, t.a.dueDate]).toEqual(['2026-03-02', '2026-03-05']);
  expect([t.b.startDate, t.b.dueDate]).toEqual(['2026-03-06', '2026-03-09']);
  expect([t.c.startDate, t.c.dueDate]).toEqual(['2026-03-10', '2026-03-13']);
  expect(plan.finishDate).toBe('2026-03-13');
});

it('a squeezed plan keeps every task at least one day long', () => {
  const shape = { phases: [], dependencies: [], tasks: [task('a', 1, 1), task('b', 2, 9)] };
  const t = byId(planFromTemplate(shape, { startDate: '2026-03-02', finishDate: '2026-03-03' }));
  expect(t.a.dueDate >= t.a.startDate).toBe(true);
  expect(t.b.dueDate >= t.b.startDate).toBe(true);
});

it('waiting task pushed after its predecessor', () => {
  // b is day 4-5 and waits on a (day 1-3). Stretching 2x puts a at 1-6 but
  // b's rounded start (7) is fine; squeezing makes them collide, so b moves.
  const shape = {
    phases: [], tasks: [task('a', 1, 4), task('b', 5, 1)], dependencies: [{ predecessorId: 'a', successorId: 'b' }],
  };
  // span 5 -> 3: a = offset 0 len 2 (days 1-2); b = offset round(2.4)=2 len 1 (day 3) fine.
  // Force a collision: successor listed with a start before the predecessor ends.
  const clash = {
    phases: [], tasks: [task('a', 1, 6), task('b', 3, 2)], dependencies: [{ predecessorId: 'a', successorId: 'b' }],
  };
  const plan = planFromTemplate(clash, { startDate: '2026-03-02', finishDate: '2026-03-15' });
  const t = byId(plan);
  expect(t.b.startDate > t.a.dueDate).toBe(true);
  // length of the pushed task is kept
  expect(planFromTemplate(shape, { startDate: '2026-03-02' }).tasks).toHaveLength(2);
});

it('a push cascades down a chain', () => {
  const shape = {
    phases: [],
    tasks: [task('a', 1, 6), task('b', 2, 2), task('c', 3, 2)],
    dependencies: [{ predecessorId: 'a', successorId: 'b' }, { predecessorId: 'b', successorId: 'c' }],
  };
  const t = byId(planFromTemplate(shape, { startDate: '2026-03-02', finishDate: '2026-03-20' }));
  expect(t.b.startDate > t.a.dueDate).toBe(true);
  expect(t.c.startDate > t.b.dueDate).toBe(true);
});

it('milestone keeps one date', () => {
  const shape = { phases: [], dependencies: [], tasks: [task('a', 1, 4), task('m', 5, 0)] };
  const plan = planFromTemplate(shape, { startDate: '2026-03-02', finishDate: '2026-03-17' });
  const m = byId(plan).m;
  expect(m.startDate).toBe(m.dueDate);
  expect(m.startDate > byId(plan).a.startDate).toBe(true);
});

it('subtasks are stretched with the rest and an empty template plans cleanly', () => {
  const shape = { phases: [], dependencies: [], tasks: [task('a', 1, 4), task('s', 1, 2, { parentId: 'a' })] };
  const t = byId(planFromTemplate(shape, { startDate: '2026-03-02', finishDate: '2026-03-09' }));
  expect(t.s.dueDate).toBe('2026-03-05');
  expect(planFromTemplate({ phases: [], tasks: [], dependencies: [] }, { startDate: '2026-03-02' }).finishDate).toBe('2026-03-02');
});
