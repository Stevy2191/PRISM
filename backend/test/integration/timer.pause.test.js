const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// The server timer pauses and resumes (user decision 2026-10-11): elapsed
// time counts running stretches only, and stopping logs that much, ending now.

let w;
let tech;
let ticket;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const post = async (path, body = {}) => expectOk(await tech.agent.post(`${API}/timer/${path}`).send(body), path === 'start' ? 201 : 200);
const current = async () => expectOk(await tech.agent.get(`${API}/timer`)).timer;

it('counts only running stretches, and stopping a paused timer logs what it showed', async () => {
  freezeClock('2026-03-10T15:00:00Z');
  await post('start', { type: 'ticket', id: ticket.id });
  advanceClock(10 * 60 * 1000);
  expect((await post('pause')).timer).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 600 }));
  advanceClock(3 * 60 * 60 * 1000); // three hours paused
  expect(await current()).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 600 }));
  await post('resume');
  advanceClock(5 * 60 * 1000);
  expect((await current()).elapsedSeconds).toBe(900);
  const { entry } = await post('stop');
  expect(entry.durationSeconds).toBe(900);
  expect(new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()).toBe(900 * 1000);
});

it('pause and resume are idempotent; with no timer they say so', async () => {
  await post('start', { type: 'ticket', id: ticket.id });
  await post('pause');
  expect((await post('pause')).timer.state).toBe('paused');
  await post('resume');
  expect((await post('resume')).timer.state).toBe('running');
  await tech.agent.delete(`${API}/timer`);
  expect((await tech.agent.post(`${API}/timer/pause`)).body).toEqual({ error: true, message: 'No timer is running', code: 'NOT_FOUND' });
});

it('starting elsewhere while paused logs the paused time', async () => {
  freezeClock('2026-03-10T15:00:00Z');
  await post('start', { type: 'ticket', id: ticket.id });
  advanceClock(20 * 60 * 1000);
  await post('pause');
  advanceClock(60 * 60 * 1000);
  const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id, departmentId: w.deptA.id });
  const { logged } = await post('start', { type: 'ticket', id: other.id });
  expect(logged.durationSeconds).toBe(1200);
});

it('stop with discard cancels without logging', async () => {
  await post('start', { type: 'ticket', id: ticket.id });
  expect(await post('stop', { discard: true })).toEqual({ timer: null, entry: null, discarded: true });
  expect(await models.TimeEntry.count()).toBe(0);
  expect(await current()).toBeNull();
});
