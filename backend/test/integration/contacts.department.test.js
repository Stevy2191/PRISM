const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeManager, makeContact, makeTicket,
} = require('./fixtures');

// S8: assigning a contact's department also moves every ticket that contact
// owns into that department, so it decides who can see those tickets. It
// must not let a user pull another department's contact (and its tickets)
// into view.

let w;
let staff;
let contactB;
let ticketB;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  // Department Staff holds tickets.create (the route's gate) but only
  // people.view_own_department.
  staff = await makeStaff('staff', w.deptA.id);
  contactB = await makeContact(w.admin, { firstName: 'Bea', departmentId: w.deptB.id });
  ticketB = await makeTicket(w.admin.agent, { title: 'B secret', contactId: contactB.id, departmentId: w.deptB.id });
});
afterAll(closeDb);

const assign = (agent, contact, departmentId) => agent.patch(`${API}/contacts/${contact.id ?? contact}/department`).send({ departmentId });
const notFound = { error: true, message: 'Contact not found', code: 'NOT_FOUND' };

describe('S8: PATCH /contacts/:id/department', () => {
  it('refuses another department\'s contact, exactly like a missing one, and moves nothing', async () => {
    const out = await assign(staff.agent, contactB, w.deptA.id);
    expect(out.status).toBe(404);
    expect(out.body).toEqual(notFound);
    const missing = await assign(staff.agent, 99999, w.deptA.id);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(notFound);
    expect((await staff.agent.get(`${API}/tickets/${ticketB.id}`)).status).toBe(403);
    const { ticket } = expectOk(await w.admin.agent.get(`${API}/tickets/${ticketB.id}`));
    expect(ticket.departmentId).toBe(w.deptB.id);
  });

  it('refuses moving a contact into another department', async () => {
    const res = await assign(staff.agent, w.contact, w.deptB.id);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: true, message: 'You can only assign contacts to your own department', code: 'FORBIDDEN',
    });
    expect(expectOk(await w.admin.agent.get(`${API}/contacts/${w.contact.id}`)).contact.departmentId).toBe(w.deptA.id);
  });

  it('still lets a user give their quick-created contact their own department', async () => {
    const mine = expectOk(await staff.agent.post(`${API}/contacts`).send({ firstName: 'New', email: 'new@example.com' }), 201).contact;
    const t = await makeTicket(staff.agent, { title: 'Mine', contactId: mine.id });
    const res = expectOk(await assign(staff.agent, mine, w.deptA.id));
    expect(res.contact.departmentId).toBe(w.deptA.id);
    expect(res.ticketsUpdated).toBe(1);
    expect(expectOk(await staff.agent.get(`${API}/tickets/${t.id}`)).ticket.departmentId).toBe(w.deptA.id);
  });

  it('users who can view all people may move any contact anywhere', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expect(expectOk(await assign(tech.agent, contactB, w.deptA.id)).ticketsUpdated).toBe(1);
  });

  it('still validates the department', async () => {
    expect((await assign(staff.agent, w.contact, undefined)).body.message).toBe('departmentId is required');
    const tech = await makeTech('tech', w.deptA.id);
    expect((await assign(tech.agent, w.contact, 99999)).body.message).toBe('Department does not exist');
  });
});

describe('S9: editing and deleting a contact checks scope', () => {
  it('refuses to edit another department\'s contact', async () => {
    const res = await staff.agent.patch(`${API}/contacts/${contactB.id}`).send({ email: 'hijack@example.com' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have access to this contact', code: 'FORBIDDEN' });
    expect(expectOk(await w.admin.agent.get(`${API}/contacts/${contactB.id}`)).contact.email).not.toBe('hijack@example.com');
  });

  it('refuses to delete another department\'s contact', async () => {
    // Department Manager holds people.edit_users (the delete route's gate) but
    // only people.view_own_department.
    const mgr = await makeManager('mgr', w.deptA.id);
    const res = await mgr.agent.delete(`${API}/contacts/${contactB.id}?force=true`);
    expect(res.status).toBe(403);
    expect((await w.admin.agent.get(`${API}/contacts/${contactB.id}`)).status).toBe(200);
  });

  it('still lets users edit contacts in their own department, and ones they created', async () => {
    expect((await staff.agent.patch(`${API}/contacts/${w.contact.id}`).send({ jobTitle: 'Clerk' })).status).toBe(200);
    const mine = expectOk(await staff.agent.post(`${API}/contacts`).send({ firstName: 'Mine', email: 'mine@example.com' }), 201).contact;
    expect((await staff.agent.patch(`${API}/contacts/${mine.id}`).send({ jobTitle: 'Clerk' })).status).toBe(200);
    expect((await staff.agent.get(`${API}/contacts/${mine.id}`)).status).toBe(200);
  });

  it('a missing contact is still a 404', async () => {
    expect((await staff.agent.patch(`${API}/contacts/99999`).send({ jobTitle: 'x' })).status).toBe(404);
  });
});
