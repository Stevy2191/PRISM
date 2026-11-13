const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, makeContact, makeTicket,
} = require('./fixtures');

// The dashboard's "Needs attention": unassigned, category not sure, SLA trouble.

let w;
let amy;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const company = await makeCompany(w.admin, { name: 'Alpha Dental' });
  amy = await makeContact(w.admin, { companyId: company.id, firstName: 'Amy', lastName: 'Ng' });
});
afterAll(closeDb);

it('lists unassigned and not-sure tickets with who they are for; assigned and sure ones are left out', async () => {
  const a = w.admin.agent;
  const loose = await makeTicket(a, { title: 'Nobody has this', contactId: amy.id });
  const mine = await makeTicket(a, { title: 'Taken', contactId: amy.id, assigneeId: w.admin.user.id });
  const unsure = await makeTicket(a, { title: 'Which category?', contactId: amy.id, assigneeId: w.admin.user.id });
  await models.Ticket.update({ categoryUnsure: true }, { where: { id: unsure.id } });
  const { needsAttention } = expectOk(await a.get(`${API}/dashboard`));
  expect(needsAttention.total).toBe(2);
  expect(needsAttention.tickets.map((t) => t.id)).toEqual([loose.id, unsure.id]);
  expect(needsAttention.tickets[0]).toMatchObject({ contact: { displayName: 'Amy Ng' }, company: { name: 'Alpha Dental' }, assignee: null });
  expect(needsAttention.tickets[1].categoryUnsure).toBe(true);
  expect(needsAttention.tickets.map((t) => t.id)).not.toContain(mine.id);
  // Closed: no longer needs anyone.
  const closed = (await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } })).name;
  await models.Ticket.update({ status: closed }, { where: { id: loose.id } });
  expect(expectOk(await a.get(`${API}/dashboard`)).needsAttention.total).toBe(1);
});

it('one person\'s dashboard lists theirs and the unassigned ones, not other people\'s', async () => {
  const tech = await makeTech('tech-na', w.deptA.id);
  const base = { contactId: w.contact.id, departmentId: w.deptA.id };
  const theirs = await makeTicket(w.admin.agent, { ...base, title: 'Theirs, not sure', assigneeId: tech.user.id });
  await models.Ticket.update({ categoryUnsure: true }, { where: { id: theirs.id } });
  const loose = await makeTicket(w.admin.agent, { ...base, title: 'Loose' });
  const other = await makeTicket(w.admin.agent, { ...base, title: 'Someone else\'s, not sure', assigneeId: w.admin.user.id });
  await models.Ticket.update({ categoryUnsure: true }, { where: { id: other.id } });
  const { needsAttention, mode } = expectOk(await w.admin.agent.get(`${API}/dashboard`).query({ userId: tech.user.id }));
  expect(mode).toBe('admin_filtered');
  expect(needsAttention.tickets.map((t) => t.id).sort()).toEqual([theirs.id, loose.id].sort());
});

it('asking for your own dashboard is your own, not "viewing someone"; with no one named it is everyone\'s', async () => {
  const mine = expectOk(await w.admin.agent.get(`${API}/dashboard`).query({ userId: w.admin.user.id }));
  expect(mine.mode).toBe('tech');
  expect(mine.viewingUser.id).toBe(w.admin.user.id);
  expect(expectOk(await w.admin.agent.get(`${API}/dashboard`)).mode).toBe('admin_system');
  // Someone who can only see their own gets it either way.
  const tech = await makeTech('tech-own', w.deptA.id);
  expect((await tech.agent.get(`${API}/dashboard`).query({ userId: tech.user.id })).status).toBe(200);
});
