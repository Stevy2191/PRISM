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

  // Ticket links store the parsed id, but a non-integer id is still refused
  // rather than quietly read as another ticket.
  it.each([[1.6], ['1e1']])('refuses a linked ticket id that is not a plain integer (%p)', async (bad) => {
    const rel = await staff.agent.post(`${API}/tickets/${mine.id}/relations`).send({ relatedTicketId: bad });
    expect(rel.status).toBe(404);
    const created = await staff.agent.post(`${API}/tickets`).send({
      title: 'New', contactId: w.contact.id, departmentId: w.deptA.id, parentTicketId: bad,
    });
    expect(created.status).toBe(400);
    expect(created.body.message).toBe('Linked ticket not found');
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

describe('relations', () => {
  let tech;
  let A;
  let B;
  let C;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    const mk = (title) => makeTicket(w.admin.agent, { title, contactId: w.contact.id, departmentId: w.deptA.id });
    A = await mk('Alpha');
    B = await mk('Bravo');
    C = await mk('Charlie');
  });
  const link = (from, body, agent = tech.agent) => agent.post(`${API}/tickets/${from.id}/relations`).send(body);
  const listOf = async (t, agent = tech.agent) => expectOk(await agent.get(`${API}/tickets/${t.id}/relations`)).relations;
  // ticketNumber is the model's virtual, added by toJSON on top of the five
  // selected columns.
  const relTicket = (t) => ({
    id: t.id, title: t.title, status: 'Open', priority: 'medium', type: 'request', ticketNumber: String(t.id).padStart(5, '0'),
  });

  it('links two tickets as related by default', async () => {
    const res = await link(A, { relatedTicketId: B.id });
    expect(res.status).toBe(201);
    expect(res.body.relation).toEqual({
      id: expect.any(Number), relationType: 'related', direction: 'outgoing',
      ticket: expect.objectContaining({ id: B.id, title: 'Bravo' }),
    });
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${A.id}/activity`));
    expect(activity.map((a) => [a.action, a.fromValue, a.toValue])).toContainEqual(['relation_added', null, 'related: Bravo']);
  });

  it('lists a relation from both sides', async () => {
    const { relation } = expectOk(await link(A, { relatedTicketId: B.id }), 201);
    expect(await listOf(A)).toEqual([{ id: relation.id, relationType: 'related', direction: 'outgoing', ticket: relTicket(B) }]);
    expect(await listOf(B)).toEqual([{ id: relation.id, relationType: 'related', direction: 'incoming', ticket: relTicket(A) }]);
  });

  it('stores "parent" as this ticket → its parent', async () => {
    const { relation } = expectOk(await link(A, { relatedTicketId: B.id, relationType: 'parent' }), 201);
    expect(relation).toEqual(expect.objectContaining({ relationType: 'parent', direction: 'outgoing' }));
    expect(await listOf(B)).toEqual([expect.objectContaining({ relationType: 'parent', direction: 'incoming', ticket: relTicket(A) })]);
  });

  it('stores "child" from the child\'s side', async () => {
    const { relation } = expectOk(await link(A, { relatedTicketId: B.id, relationType: 'child' }), 201);
    expect(relation).toEqual(expect.objectContaining({
      relationType: 'parent', direction: 'incoming', ticket: expect.objectContaining({ id: B.id }),
    }));
    expect(await listOf(B)).toEqual([expect.objectContaining({ relationType: 'parent', direction: 'outgoing', ticket: relTicket(A) })]);
  });

  it('accepts caused_by and duplicates', async () => {
    expect(expectOk(await link(A, { relatedTicketId: B.id, relationType: 'caused_by' }), 201).relation.relationType).toBe('caused_by');
    expect(expectOk(await link(A, { relatedTicketId: C.id, relationType: 'duplicates' }), 201).relation.relationType).toBe('duplicates');
  });

  it('validates relation input', async () => {
    const cases = [
      [{}, 'relatedTicketId is required'],
      [{ relatedTicketId: A.id }, 'A ticket cannot be related to itself'],
      [{ relatedTicketId: B.id, relationType: 'blocks' }, 'Invalid relation type'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await link(A, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('refuses the same stored pair twice', async () => {
    expectOk(await link(A, { relatedTicketId: B.id }), 201);
    const again = await link(A, { relatedTicketId: B.id, relationType: 'parent' });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: true, message: 'These tickets are already linked', code: 'DUPLICATE_RELATION' });
    // A "child of C" is stored as C→A, so C→A related is the same pair.
    expectOk(await link(A, { relatedTicketId: C.id, relationType: 'child' }), 201);
    expect((await link(C, { relatedTicketId: A.id })).status).toBe(409);
  });

  // Likely correct: one link per pair of tickets, whatever the direction. Expected to change in sub-project 3.
  it('[quirk] Q24: links the same two tickets again in the opposite direction', async () => {
    expectOk(await link(A, { relatedTicketId: B.id }), 201);
    expect((await link(B, { relatedTicketId: A.id })).status).toBe(201);
    expect(await listOf(A)).toHaveLength(2);
  });

  it('removes a relation from either side', async () => {
    const { relation } = expectOk(await link(A, { relatedTicketId: B.id }), 201);
    expect(expectOk(await tech.agent.delete(`${API}/tickets/${B.id}/relations/${relation.id}`))).toEqual({ ok: true });
    expect(await listOf(A)).toEqual([]);
  });

  it('a relation is not found through an unrelated ticket', async () => {
    const { relation } = expectOk(await link(A, { relatedTicketId: B.id }), 201);
    const res = await tech.agent.delete(`${API}/tickets/${C.id}/relations/${relation.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Relation not found', code: 'NOT_FOUND' });
  });

  it('create-time links are stored in their documented directions', async () => {
    const N = await makeTicket(tech.agent, {
      title: 'New', contactId: w.contact.id, parentTicketId: A.id, childTicketIds: [B.id], relatedTicketIds: [C.id],
    });
    const rels = await listOf(N);
    const view = rels.map((r) => [r.ticket.id, r.relationType, r.direction]).sort((x, y) => x[0] - y[0]);
    expect(view).toEqual([[A.id, 'parent', 'outgoing'], [B.id, 'parent', 'incoming'], [C.id, 'related', 'outgoing']]);
  });

  // Likely correct: hide or redact links to tickets the viewer can't open. Expected to change in sub-project 3.
  it('[quirk] Q18: relation lists show linked tickets the viewer cannot open', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const S = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
    expectOk(await link(A, { relatedTicketId: S.id }, w.admin.agent), 201);
    expect(await listOf(A, staff.agent)).toEqual([expect.objectContaining({ ticket: relTicket(S) })]);
  });
});

describe('watchers', () => {
  let tech;
  let mgr;
  let A;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    mgr = await makeManager('mgr', w.deptA.id);
    A = await makeTicket(w.admin.agent, { title: 'Alpha', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
  });
  const url = () => `${API}/tickets/${A.id}/watchers`;

  it('adds a watcher, and adding again is a no-op', async () => {
    const first = expectOk(await tech.agent.post(url()).send({ userId: mgr.user.id }), 201).watcher;
    const second = expectOk(await tech.agent.post(url()).send({ userId: mgr.user.id }), 201).watcher;
    expect(second.id).toBe(first.id);
    expect(first.user.username).toBe('mgr');
    expect(expectOk(await tech.agent.get(url())).watchers).toHaveLength(1);
  });

  it('requires a userId', async () => {
    const res = await tech.agent.post(url()).send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'userId is required', code: 'VALIDATION_ERROR' });
  });

  it('removes a watcher; removing a non-watcher is fine', async () => {
    expectOk(await tech.agent.post(url()).send({ userId: mgr.user.id }), 201);
    expect(expectOk(await tech.agent.delete(`${url()}/${mgr.user.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.delete(`${url()}/${mgr.user.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(url())).watchers).toEqual([]);
  });

  it('watchers given at create are listed', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const t = await makeTicket(tech.agent, { title: 'W', contactId: w.contact.id, watcherIds: [mgr.user.id, staff.user.id] });
    const ids = expectOk(await tech.agent.get(`${API}/tickets/${t.id}/watchers`)).watchers.map((x) => x.userId);
    // Same createdAt second and no id tiebreak, so order is not pinned.
    expect(ids.sort()).toEqual([mgr.user.id, staff.user.id].sort());
  });

  it('own-tier users can\'t read watchers of others\' tickets', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    expect((await own.agent.get(url())).status).toBe(403);
  });
});

describe('custom field values', () => {
  let tech;
  let A;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    A = await makeTicket(w.admin.agent, { title: 'Alpha', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
    const field = (body) => w.admin.agent.post(`${API}/custom-fields`).send(body);
    expectOk(await field({ label: 'Asset tag', fieldKey: 'asset_tag', fieldType: 'text' }), 201);
    expectOk(await field({ label: 'Systems', fieldKey: 'systems', fieldType: 'multiselect', options: ['A', 'B', 'C'] }), 201);
  });
  const url = () => `${API}/tickets/${A.id}/custom-field-values`;
  const set = async (values) => expectOk(await tech.agent.patch(url()).send({ values })).customFields;

  it('sets, reads and round-trips custom field values', async () => {
    expect(await set({ asset_tag: 'X1', systems: ['A', 'C'] })).toEqual({ asset_tag: 'X1', systems: ['A', 'C'] });
    expect(expectOk(await tech.agent.get(url())).customFields).toEqual({ asset_tag: 'X1', systems: ['A', 'C'] });
    expect(expectOk(await tech.agent.get(`${API}/tickets/${A.id}`)).ticket.customFields).toEqual({ asset_tag: 'X1', systems: ['A', 'C'] });
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${A.id}/activity`));
    expect(activity.map((a) => [a.action, a.fromValue, a.toValue])).toContainEqual(['custom_fields', null, null]);
  });

  it('an empty or null value removes the field', async () => {
    await set({ asset_tag: 'X1', systems: ['A'] });
    expect(await set({ asset_tag: '', systems: null })).toEqual({});
  });

  it('ignores unknown keys', async () => {
    expect(await set({ nope: 'x' })).toEqual({});
  });

  it('rejects a non-object values payload', async () => {
    for (const body of [{ values: 'x' }, { values: ['x'] }, {}]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.patch(url()).send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('values must be an object of { fieldKey: value }');
    }
  });

  it('accepts custom field values at create', async () => {
    const t = await makeTicket(tech.agent, { title: 'CF', contactId: w.contact.id, customFieldValues: { asset_tag: 'Y2' } });
    expect(t.customFields).toEqual({ asset_tag: 'Y2' });
  });

  // Likely correct: 400 for a non-number or an option the field doesn't have. Expected to change in sub-project 3.
  it('[quirk] Q29: stores values the field\'s type or options don\'t allow', async () => {
    expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Rank', fieldKey: 'rank', fieldType: 'number' }), 201);
    expect(await set({ rank: 'abc', systems: ['Z'] })).toEqual({ rank: 'abc', systems: ['Z'] });
  });

  it('own-tier users can\'t read or set values on others\' tickets', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    expect((await own.agent.get(url())).status).toBe(403);
    expect((await own.agent.patch(url()).send({ values: { asset_tag: 'x' } })).status).toBe(403);
  });
});

describe('staff-entered CSAT', () => {
  let tech;
  let A;
  beforeEach(async () => {
    tech = await makeTech('tech', w.deptA.id);
    A = await makeTicket(w.admin.agent, { title: 'Alpha', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
  });
  const url = () => `${API}/tickets/${A.id}/csat`;
  const resolve = async () => expectOk(await tech.agent.patch(`${API}/tickets/${A.id}`).send({ status: 'Resolved' }));

  it('won\'t take a rating until the ticket is closed', async () => {
    const res = await tech.agent.post(url()).send({ rating: 'happy' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_RATEABLE');
  });

  it('validates the rating', async () => {
    await resolve();
    const res = await tech.agent.post(url()).send({ rating: 'meh' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'rating must be happy, neutral, or unhappy', code: 'VALIDATION_ERROR' });
  });

  it('records and then updates a rating', async () => {
    await resolve();
    const first = expectOk(await tech.agent.post(url()).send({ rating: 'happy', comment: 'Great' }), 201).csat;
    expect(first).toEqual(expect.objectContaining({ rating: 'happy', comment: 'Great', userId: tech.user.id }));
    const second = expectOk(await tech.agent.post(url()).send({ rating: 'unhappy' }), 201).csat;
    expect(second).toEqual(expect.objectContaining({ rating: 'unhappy', comment: null }));
    expect(expectOk(await tech.agent.get(url())).csat).toEqual(expect.objectContaining({ rating: 'unhappy' }));
  });

  it('GET before any rating', async () => {
    expect(expectOk(await tech.agent.get(url()))).toEqual({ csat: null });
  });
});
