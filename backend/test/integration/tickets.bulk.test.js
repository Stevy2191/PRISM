jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, makeTeam, makeCompany, makeContact, setSettings,
} = require('./fixtures');

// Service desk 5b task 5: POST /tickets/bulk. Every ticket goes through the
// same service function as the single edit, and missing and unseen tickets
// get the same answer.

let w;
let tina;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
});
afterAll(closeDb);

const ticket = (fields = {}) => makeTicket(w.admin.agent, {
  title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, ...fields,
});
const bulk = (agent, body) => agent.post(`${API}/tickets/bulk`).send(body);
const grant = async (userId, permissionKey, granted) => expectOk(
  await w.admin.agent.post(`${API}/users/${userId}/overrides`).send({ permissionKey, granted }), 201
);

it('refuses more than 100 ids and unknown actions', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => i + 1);
  expect((await bulk(w.admin.agent, { ids, action: 'priority', value: 'low' })).status).toBe(400);
  expect((await bulk(w.admin.agent, { ids: [], action: 'priority', value: 'low' })).status).toBe(400);
  expect((await bulk(w.admin.agent, { ids: [1], action: 'explode' })).status).toBe(400);
});

it('mixed access: unseen and missing ids get the same error, the rest apply', async () => {
  const olly = await makeOwnTier(w.admin, 'olly', w.deptA.id);
  const mine = await ticket({ assigneeId: olly.user.id });
  const hidden = await ticket();
  const body = expectOk(await bulk(olly.agent, { ids: [mine.id, hidden.id, 999999, 'abc'], action: 'priority', value: 'high' }));
  expect(body.results).toEqual([
    { id: mine.id, ok: true },
    { id: hidden.id, ok: false, error: 'Ticket not found' },
    { id: 999999, ok: false, error: 'Ticket not found' },
    { id: 'abc', ok: false, error: 'Ticket not found' },
  ]);
  expect((await models.Ticket.findByPk(mine.id)).priority).toBe('high');
  expect((await models.Ticket.findByPk(hidden.id)).priority).toBe('medium');
});

it('status bulk matches single PATCH: activity rows and ticket_status_changed rules fire', async () => {
  const rule = await models.WorkflowRule.create({ name: 'On status', triggerEvent: 'ticket_status_changed', isActive: true });
  await models.WorkflowAction.create({ ruleId: rule.id, actionType: 'set_priority', actionValue: { priority: 'critical' } });
  const a = await ticket();
  const b = await ticket();
  expectOk(await w.admin.agent.patch(`${API}/tickets/${a.id}`).send({ status: 'On Hold' }));
  expectOk(await bulk(w.admin.agent, { ids: [b.id], action: 'status', value: 'On Hold' }));
  const shape = async (id) => (await models.TicketActivity.findAll({ where: { ticketId: id }, order: [['id', 'ASC']] }))
    .map((r) => [r.action, r.fromValue, r.toValue]);
  expect(await shape(b.id)).toEqual(await shape(a.id));
  expect((await models.Ticket.findByPk(b.id)).priority).toBe('critical');
});

it('close uses the systemKey closed status even after it is renamed', async () => {
  const closed = await models.TicketStatus.findOne({ where: { systemKey: 'closed' } });
  const t = await ticket();
  try {
    await closed.update({ name: 'Shut' });
    expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'close' }));
    expect((await models.Ticket.findByPk(t.id)).status).toBe('Shut');
  } finally {
    await models.Ticket.update({ status: 'Open' }, { where: { id: t.id }, hooks: false });
    await closed.update({ name: 'Closed' });
  }
});

it('assign and team go through the same checks as PATCH (company fence, unknown team)', async () => {
  const acme = await makeCompany(w.admin);
  const acmeContact = await makeContact(w.admin, { companyId: acme.id });
  const t = await ticket({ contactId: acmeContact.id, departmentId: null });
  const [{ id: internalId }] = await models.sequelize.query('SELECT id FROM Companies WHERE isInternal = 1', { type: 'SELECT' });
  expectOk(await w.admin.agent.put(`${API}/users/${tina.user.id}/company-access`).send({ allCompanies: false, companyIds: [internalId] }));
  const assign = expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'assign', value: tina.user.id }));
  expect(assign.results[0]).toEqual({ id: t.id, ok: false, error: "Assignee can't see tickets for this company" });
  const team = expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'team', value: 99999 }));
  expect(team.results[0]).toEqual({ id: t.id, ok: false, error: 'Team not found' });
  const desk = await makeTeam(w.admin, 'Desk', []);
  expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'team', value: desk.id }));
  expect((await models.Ticket.findByPk(t.id)).teamId).toBe(desk.id);
  expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'assign', value: null }));
});

it('add_watcher needs manage_watchers; delete needs tickets.delete', async () => {
  const t = await ticket({ assigneeId: tina.user.id });
  await grant(tina.user.id, 'tickets.manage_watchers', false);
  const watch = expectOk(await bulk(tina.agent, { ids: [t.id], action: 'add_watcher', value: w.admin.user.id }));
  expect(watch.results[0]).toEqual({ id: t.id, ok: false, error: 'Insufficient permissions' });
  const del = expectOk(await bulk(tina.agent, { ids: [t.id], action: 'delete' }));
  expect(del.results[0]).toEqual({ id: t.id, ok: false, error: 'Insufficient permissions' });
  expect(await models.Ticket.count({ where: { id: t.id } })).toBe(1);

  expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'add_watcher', value: tina.user.id }));
  expect(await models.TicketWatcher.count({ where: { ticketId: t.id, userId: tina.user.id } })).toBe(1);
  expectOk(await bulk(w.admin.agent, { ids: [t.id], action: 'delete' }));
  expect(await models.Ticket.count({ where: { id: t.id } })).toBe(0);
});

it('require-time-before-close fails only the tickets without time', async () => {
  await setSettings(w.admin, { 'timeTracking.requireBeforeClose': 'true' });
  const withTime = await ticket();
  const without = await ticket();
  expectOk(await w.admin.agent.post(`${API}/tickets/${withTime.id}/time`).send({ durationMinutes: 30 }), 201);
  const body = expectOk(await bulk(w.admin.agent, { ids: [withTime.id, without.id], action: 'close' }));
  expect(body.results).toEqual([
    { id: withTime.id, ok: true },
    { id: without.id, ok: false, error: 'Log time on this ticket before closing it' },
  ]);
});

it('a view-only user changes nothing: each ticket refuses for lack of edit access', async () => {
  const { createUserAndLogin, ROLE } = require('./helpers'); // eslint-disable-line global-require
  const viewer = await createUserAndLogin({ username: 'vera', roleName: ROLE.READ_ONLY, departmentId: w.deptA.id });
  const t = await ticket();
  for (const [action, value] of [['status', 'On Hold'], ['priority', 'high'], ['assign', viewer.user.id], ['close', undefined], ['delete', undefined]]) {
    // eslint-disable-next-line no-await-in-loop
    const body = expectOk(await bulk(viewer.agent, { ids: [t.id], action, value }));
    expect(body.results[0].ok).toBe(false);
  }
  const fresh = await models.Ticket.findByPk(t.id);
  expect([fresh.status, fresh.priority, fresh.assigneeId]).toEqual(['Open', 'medium', null]);
});
