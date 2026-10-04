const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeContractor, makeTicket,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S2: POST /timer/start checks access to the ticket', () => {
  it('refuses a ticket the user cannot see, and starts nothing', async () => {
    // Department Staff holds projects.log_time (so the route lets them in)
    // but sees only department A's tickets.
    const staff = await makeStaff('staff', w.deptA.id);
    const other = await makeTicket(w.admin.agent, { title: 'B only', contactId: w.contact.id, departmentId: w.deptB.id });

    const res = await staff.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: other.id });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have access to this ticket', code: 'FORBIDDEN' });
    expect(expectOk(await staff.agent.get(`${API}/timer`)).timer).toBeNull();
  });

  it('still starts on a ticket the user can see', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { title: 'A', contactId: w.contact.id, departmentId: w.deptA.id });
    const res = await staff.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: mine.id });
    expect(res.status).toBe(201);
    expect(res.body.timer.id).toBe(mine.id);
  });
});
