const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeOwnTier, makeTicket, makeTeam,
} = require('./fixtures');

// Service desk 5b task 4: canned responses. Personal ones are private to
// their owner (admins included); team ones are seen by the team's members;
// everyone ones by all staff. Shared ones need tickets.canned.manage.

let w;
let tina; // member of Desk, no canned.manage
let dana; // in no team
let desk;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  dana = await makeStaff('dana', w.deptA.id);
  desk = await makeTeam(w.admin, 'Desk', [{ userId: tina.user.id }]);
});
afterAll(closeDb);

const create = (agent, body) => agent.post(`${API}/canned-responses`).send(body);
const titles = async (agent, q = '') => expectOk(await agent.get(`${API}/canned-responses${q}`)).responses.map((r) => r.title).sort();

it('any user creates a personal response; team/everyone need canned.manage', async () => {
  const mine = expectOk(await create(dana.agent, { title: 'Mine', body: 'Hello', visibility: 'personal', teamId: desk.id }), 201).response;
  expect(mine).toEqual(expect.objectContaining({ visibility: 'personal', ownerId: dana.user.id, teamId: null }));
  expect((await create(tina.agent, { title: 'T', body: 'b', visibility: 'team', teamId: desk.id })).status).toBe(403);
  expect((await create(tina.agent, { title: 'E', body: 'b', visibility: 'everyone' })).status).toBe(403);
  expectOk(await create(w.admin.agent, { title: 'E', body: 'b', visibility: 'everyone' }), 201);
  expect((await create(dana.agent, { title: '', body: 'b' })).status).toBe(400);
  expect((await create(dana.agent, { title: 'x'.repeat(201), body: 'b' })).status).toBe(400);
  expect((await create(dana.agent, { title: 'x', body: 'b'.repeat(10001) })).status).toBe(400);
  expect((await create(dana.agent, { title: 'x', body: 'b', visibility: 'weird' })).status).toBe(400);
});

it("picker shows own, my teams and everyone; never another user's personal one", async () => {
  expectOk(await create(tina.agent, { title: 'Tina personal', body: 'b' }), 201);
  expectOk(await create(dana.agent, { title: 'Dana personal', body: 'b' }), 201);
  expectOk(await create(w.admin.agent, { title: 'Desk team', body: 'b', visibility: 'team', teamId: desk.id }), 201);
  expectOk(await create(w.admin.agent, { title: 'All', body: 'b', visibility: 'everyone' }), 201);
  expect(await titles(tina.agent)).toEqual(['All', 'Desk team', 'Tina personal']);
  expect(await titles(dana.agent)).toEqual(['All', 'Dana personal']);
});

it("admin cannot read or edit another user's personal response (404)", async () => {
  const r = expectOk(await create(tina.agent, { title: 'Private', body: 'b' }), 201).response;
  expect(await titles(w.admin.agent)).not.toContain('Private');
  expect(await titles(w.admin.agent, '?manage=1')).not.toContain('Private');
  const patch = await w.admin.agent.patch(`${API}/canned-responses/${r.id}`).send({ title: 'Hacked' });
  const missing = await w.admin.agent.patch(`${API}/canned-responses/999999`).send({ title: 'Hacked' });
  expect(patch.status).toBe(404);
  expect(patch.body).toEqual(missing.body);
  expect((await w.admin.agent.delete(`${API}/canned-responses/${r.id}`)).status).toBe(404);
  expectOk(await tina.agent.patch(`${API}/canned-responses/${r.id}`).send({ title: 'Renamed' }));
  expectOk(await tina.agent.delete(`${API}/canned-responses/${r.id}`));
});

it('team response needs an existing team; non-member does not see it; members cannot edit it', async () => {
  expect((await create(w.admin.agent, { title: 'T', body: 'b', visibility: 'team' })).status).toBe(400);
  expect((await create(w.admin.agent, { title: 'T', body: 'b', visibility: 'team', teamId: 99999 })).status).toBe(400);
  const r = expectOk(await create(w.admin.agent, { title: 'Desk', body: 'b', visibility: 'team', teamId: desk.id }), 201).response;
  expect(await titles(dana.agent)).toEqual([]);
  expect((await dana.agent.patch(`${API}/canned-responses/${r.id}`).send({ title: 'x' })).status).toBe(404);
  expect((await tina.agent.patch(`${API}/canned-responses/${r.id}`).send({ title: 'x' })).status).toBe(403);
  // A personal response can't be turned into a shared one without the permission.
  const p = expectOk(await create(tina.agent, { title: 'P', body: 'b' }), 201).response;
  expect((await tina.agent.patch(`${API}/canned-responses/${p.id}`).send({ visibility: 'everyone' })).status).toBe(403);
});

it('manage=1 lists all shared responses for canned.manage holders only', async () => {
  const other = await makeTeam(w.admin, 'Other', [{ userId: dana.user.id }]);
  expectOk(await create(w.admin.agent, { title: 'Other team', body: 'b', visibility: 'team', teamId: other.id }), 201);
  expectOk(await create(w.admin.agent, { title: 'All', body: 'b', visibility: 'everyone' }), 201);
  expectOk(await create(w.admin.agent, { title: 'Admin personal', body: 'b' }), 201);
  expectOk(await create(tina.agent, { title: 'Tina personal', body: 'b' }), 201);
  expect(await titles(w.admin.agent, '?manage=1')).toEqual(['Admin personal', 'All', 'Other team']);
  expect((await tina.agent.get(`${API}/canned-responses?manage=1`)).status).toBe(403);
});

it('search escapes LIKE wildcards', async () => {
  expectOk(await create(tina.agent, { title: '100% done', body: 'b' }), 201);
  expectOk(await create(tina.agent, { title: '100 percent', body: 'b' }), 201);
  expectOk(await create(tina.agent, { title: 'a_b', body: 'b' }), 201);
  expectOk(await create(tina.agent, { title: 'axb', body: 'b' }), 201);
  expect(await titles(tina.agent, `?search=${encodeURIComponent('100%')}`)).toEqual(['100% done']);
  expect(await titles(tina.agent, '?search=a_b')).toEqual(['a_b']);
});

it('render fills ticket placeholders; refused with no ticket access or unseen response', async () => {
  const t = await makeTicket(w.admin.agent, { title: 'Printer <jam>', contactId: w.contact.id, departmentId: w.deptA.id });
  const r = expectOk(await create(tina.agent, {
    title: 'Hi', body: 'Hi {{contact.firstName}}, #{{ticket.number}} {{ticket.title}} — {{tech.name}} / {{org.name}}',
  }), 201).response;
  const out = expectOk(await tina.agent.post(`${API}/tickets/${t.id}/canned/${r.id}/render`));
  expect(out.text).toMatch(/^Hi Casey, #00001 Printer <jam> — Test tina \/ /);

  // Someone who can't see the ticket, and someone who can't see the response.
  const olly = await makeOwnTier(w.admin, 'olly', w.deptA.id);
  const own = expectOk(await create(olly.agent, { title: 'O', body: 'x' }), 201).response;
  const noTicket = await olly.agent.post(`${API}/tickets/${t.id}/canned/${own.id}/render`);
  const noResponse = await dana.agent.post(`${API}/tickets/${t.id}/canned/${r.id}/render`);
  const missing = await dana.agent.post(`${API}/tickets/${t.id}/canned/999999/render`);
  expect(noTicket.status).toBe(404);
  expect(noResponse.status).toBe(404);
  expect(noResponse.body).toEqual(missing.body);
});
