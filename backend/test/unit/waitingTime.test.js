const { waitingFor } = require('../../src/services/waitingTime');

// Time a ticket spent in "waiting on the customer" statuses, read from its
// status activity rows (user decisions 2026-10-15).

const H = 3600000;
const T0 = new Date('2026-03-09T12:00:00.000Z');
const at = (hours) => new Date(T0.getTime() + hours * H);
const row = (id, hours, fromValue, toValue) => ({ id, createdAt: at(hours), fromValue, toValue });
const base = { createdAt: T0, waitingNames: ['Waiting on User'] };

it('adds up every stretch spent in a waiting status', () => {
  const r = waitingFor({
    ...base,
    endAt: at(10),
    currentStatus: 'Closed',
    rows: [
      row(1, 1, 'Open', 'Waiting on User'),
      row(2, 3, 'Waiting on User', 'User responded'),
      row(3, 4, 'User responded', 'Waiting on User'),
      row(4, 7, 'Waiting on User', 'Closed'),
    ],
  });
  expect(r).toEqual({ waitingMs: 5 * H, lifeMs: 10 * H, waitingNow: false });
});

it('counts the whole life when the ticket never left a waiting status', () => {
  const r = waitingFor({ ...base, endAt: at(4), currentStatus: 'Waiting on User', rows: [] });
  expect(r).toEqual({ waitingMs: 4 * H, lifeMs: 4 * H, waitingNow: true });
});

it('takes the starting status from the first change', () => {
  const r = waitingFor({
    ...base, endAt: at(5), currentStatus: 'Open', rows: [row(1, 2, 'Waiting on User', 'Open')],
  });
  expect(r.waitingMs).toBe(2 * H);
});

it('keeps counting a wait that is still running', () => {
  const r = waitingFor({
    ...base, endAt: at(6), currentStatus: 'Waiting on User', rows: [row(1, 2, 'Open', 'Waiting on User')],
  });
  expect(r).toEqual({ waitingMs: 4 * H, lifeMs: 6 * H, waitingNow: true });
});

it('orders changes in the same second by id', () => {
  const r = waitingFor({
    ...base,
    endAt: at(4),
    currentStatus: 'Open',
    rows: [row(2, 1, 'Waiting on User', 'Open'), row(1, 1, 'Open', 'Waiting on User')],
  });
  // Waiting on User for zero time at hour 1, then Open.
  expect(r.waitingMs).toBe(0);
});

it('trusts the logged "from" status when a change went unlogged', () => {
  // Logged Open → Closed, but the next row says it was waiting: some
  // unlogged change happened in between, so that stretch counts as waiting.
  const r = waitingFor({
    ...base,
    endAt: at(6),
    currentStatus: 'Open',
    rows: [row(1, 1, 'Open', 'Closed'), row(2, 3, 'Waiting on User', 'Open')],
  });
  expect(r.waitingMs).toBe(2 * H);
});

it('uses the current status after the last change', () => {
  const r = waitingFor({
    ...base, endAt: at(5), currentStatus: 'Waiting on User', rows: [row(1, 1, 'Waiting on User', 'Open')],
  });
  expect(r).toEqual({ waitingMs: 5 * H, lifeMs: 5 * H, waitingNow: true });
});

it('ignores time after the ticket closed', () => {
  const r = waitingFor({
    ...base,
    endAt: at(3),
    currentStatus: 'Closed',
    rows: [row(1, 1, 'Open', 'Waiting on User'), row(2, 5, 'Waiting on User', 'Closed')],
  });
  expect(r).toEqual({ waitingMs: 2 * H, lifeMs: 3 * H, waitingNow: false });
});

it('matches names the activity log wrote with spaces for underscores', () => {
  const r = waitingFor({
    ...base,
    waitingNames: ['Waiting_on_customer'],
    endAt: at(2),
    currentStatus: 'Open',
    rows: [row(1, 1, 'Waiting on customer', 'Open')],
  });
  expect(r.waitingMs).toBe(1 * H);
});

it('never reports negative times', () => {
  const r = waitingFor({ ...base, endAt: at(-1), currentStatus: 'Waiting on User', rows: [] });
  expect(r).toEqual({ waitingMs: 0, lifeMs: 0, waitingNow: true });
});
