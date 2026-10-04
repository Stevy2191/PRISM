const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeContact, makeTicket,
  makeTeam, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S3: links never reach a ticket the user cannot see', () => {
  let staff;
  let mine;
  let hidden;
  beforeEach(async () => {
    staff = await makeStaff('staff', w.deptA.id);
    mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id });
    hidden = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
  });

  it('POST /:id/relations treats an out-of-scope target exactly like a missing one', async () => {
    const outOfScope = await staff.agent.post(`${API}/tickets/${mine.id}/relations`).send({ relatedTicketId: hidden.id });
    const missing = await staff.agent.post(`${API}/tickets/${mine.id}/relations`).send({ relatedTicketId: 99999 });
    expect(outOfScope.status).toBe(404);
    expect(outOfScope.body).toEqual(missing.body);
    expect(missing.body).toEqual({ error: true, message: 'Related ticket not found', code: 'NOT_FOUND' });
    const rels = expectOk(await w.admin.agent.get(`${API}/tickets/${mine.id}/relations`)).relations;
    expect(rels).toEqual([]);
  });

  it.each([
    ['parentTicketId', (id) => ({ parentTicketId: id })],
    ['childTicketIds', (id) => ({ childTicketIds: [id] })],
    ['relatedTicketIds', (id) => ({ relatedTicketIds: [id] })],
  ])('create with %s: out-of-scope and missing get the same 400', async (_name, link) => {
    const base = { title: 'New', contactId: w.contact.id, departmentId: w.deptA.id };
    const outOfScope = await staff.agent.post(`${API}/tickets`).send({ ...base, ...link(hidden.id) });
    const missing = await staff.agent.post(`${API}/tickets`).send({ ...base, ...link(99999) });
    expect(outOfScope.status).toBe(400);
    expect(outOfScope.body).toEqual({ error: true, message: 'Linked ticket not found', code: 'VALIDATION_ERROR' });
    expect(missing.body).toEqual(outOfScope.body);
    // Nothing was created by either refused request.
    const list = expectOk(await w.admin.agent.get(`${API}/tickets`)).tickets;
    expect(list.map((t) => t.title).sort()).toEqual(['Mine', 'Secret']);
  });

  it('create still links tickets the user can see', async () => {
    const res = await staff.agent.post(`${API}/tickets`).send({
      title: 'Child', contactId: w.contact.id, departmentId: w.deptA.id, parentTicketId: mine.id,
    });
    expect(res.status).toBe(201);
    const rels = expectOk(await staff.agent.get(`${API}/tickets/${res.body.ticket.id}/relations`)).relations;
    expect(rels).toEqual([expect.objectContaining({ relationType: 'parent', direction: 'outgoing', ticket: expect.objectContaining({ id: mine.id }) })]);
  });
});
