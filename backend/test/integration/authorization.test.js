const {
  createUserAndLogin, resetData, closeDb, ROLE, Department, Contact, Ticket, Comment,
} = require('./helpers');

// Every non-admin account carries the legacy User.role enum value
// 'technician', because that column only has two values and defaults to it.
// A set of routes gated on requireRole('admin', 'technician') therefore
// authorized *every logged-in user*, no matter what their granular
// permissions said — the permission system could be tightened all the way
// down to "Read Only" and these endpoints stayed open. These tests pin that
// shut.

let dept;
let contact;
let ticket;
let readOnly;   // Read Only role, legacy role still 'technician'
let manager;    // Department Manager — genuine authority in this department

beforeEach(async () => {
  await resetData();

  dept = await Department.create({ name: 'Service Desk', shortCode: 'SD' });
  contact = await Contact.create({ firstName: 'Casey', lastName: 'Contact', displayName: 'Casey Contact', email: 'casey@example.com' });

  readOnly = await createUserAndLogin({
    username: 'readonly', roleName: ROLE.READ_ONLY, departmentId: dept.id,
  });
  manager = await createUserAndLogin({
    username: 'manager', roleName: ROLE.DEPARTMENT_MANAGER, departmentId: dept.id,
  });

  ticket = await Ticket.create({
    title: 'Printer offline',
    description: 'Third floor',
    status: 'Open',
    priority: 'medium',
    departmentId: dept.id,
    contactId: contact.id,
    createdBy: manager.user.id,
  });
});

afterAll(closeDb);

describe('the legacy role enum does not grant permissions', () => {
  it('confirms the read-only account still carries legacy role "technician"', () => {
    // If this ever stops being true the tests below stop proving anything.
    expect(readOnly.user.role).toBe('technician');
  });

  it.each([
    ['post', '/api/v1/blueprints', { name: 'Template' }],
    ['post', '/api/v1/timer/start', { description: 'work' }],
  ])('denies %s %s to a read-only user', async (method, path, body) => {
    const res = await readOnly.agent[method](path).send(body);
    expect(res.status).toBe(403);
  });

  it('denies creating a ticket task', async () => {
    const res = await readOnly.agent.post(`/api/v1/tickets/${ticket.id}/tasks`).send({ description: 'do a thing' });
    expect(res.status).toBe(403);
  });

  it('denies logging time on a ticket', async () => {
    const res = await readOnly.agent.post(`/api/v1/tickets/${ticket.id}/time`).send({ minutes: 30, description: 'x' });
    expect(res.status).toBe(403);
  });

  it('denies managing ticket watchers', async () => {
    const add = await readOnly.agent.post(`/api/v1/tickets/${ticket.id}/watchers`).send({ userId: manager.user.id });
    expect(add.status).toBe(403);
    const remove = await readOnly.agent.delete(`/api/v1/tickets/${ticket.id}/watchers/${manager.user.id}`);
    expect(remove.status).toBe(403);
  });

  it('denies creating ticket relations', async () => {
    const res = await readOnly.agent.post(`/api/v1/tickets/${ticket.id}/relations`)
      .send({ relatedTicketId: ticket.id, type: 'related' });
    expect(res.status).toBe(403);
  });
});

describe('moderating other users\' ticket comments', () => {
  let managerComment;

  beforeEach(async () => {
    managerComment = await Comment.create({
      ticketId: ticket.id, authorId: manager.user.id, body: 'Internal note from the manager', type: 'reply',
    });
  });

  // The original check was `author || isStaff(user)`, and isStaff() was true
  // for everyone — so a Read Only account could rewrite and then delete an
  // administrator's comment. Verified against a running server before the fix.
  it('does not let a read-only user edit someone else\'s comment', async () => {
    const res = await readOnly.agent
      .patch(`/api/v1/tickets/${ticket.id}/comments/${managerComment.id}`)
      .send({ body: 'tampered' });
    expect(res.status).toBe(403);

    await managerComment.reload();
    expect(managerComment.body).toBe('Internal note from the manager');
  });

  it('does not let a read-only user delete someone else\'s comment', async () => {
    const res = await readOnly.agent
      .delete(`/api/v1/tickets/${ticket.id}/comments/${managerComment.id}`);
    expect(res.status).toBe(403);

    expect(await Comment.findByPk(managerComment.id)).not.toBeNull();
  });

  it('lets a department manager moderate a comment on a ticket in their department', async () => {
    const other = await Comment.create({
      ticketId: ticket.id, authorId: readOnly.user.id, body: 'from the read-only user', type: 'reply',
    });
    const res = await manager.agent.delete(`/api/v1/tickets/${ticket.id}/comments/${other.id}`);
    expect(res.status).toBe(200);
    expect(await Comment.findByPk(other.id)).toBeNull();
  });

  it('lets an author edit their own comment', async () => {
    const own = await Comment.create({
      ticketId: ticket.id, authorId: manager.user.id, body: 'mine', type: 'reply',
    });
    const res = await manager.agent
      .patch(`/api/v1/tickets/${ticket.id}/comments/${own.id}`)
      .send({ body: 'mine, edited' });
    expect(res.status).toBe(200);
  });

  it('does not let a manager moderate a comment on another department\'s ticket', async () => {
    const otherDept = await Department.create({ name: 'Facilities', shortCode: 'FAC' });
    const foreignTicket = await Ticket.create({
      title: 'Door lock', description: 'x', status: 'Open', priority: 'low',
      departmentId: otherDept.id, contactId: contact.id, createdBy: readOnly.user.id,
    });
    const foreignComment = await Comment.create({
      ticketId: foreignTicket.id, authorId: readOnly.user.id, body: 'not yours', type: 'reply',
    });

    const res = await manager.agent
      .delete(`/api/v1/tickets/${foreignTicket.id}/comments/${foreignComment.id}`);
    expect(res.status).toBe(403);
  });
});

describe('internal comments', () => {
  it('denies posting an internal comment without tickets.view_private_comments', async () => {
    const res = await readOnly.agent.post(`/api/v1/tickets/${ticket.id}/comments`)
      .send({ body: 'secret', type: 'comment_private' });
    expect([401, 403]).toContain(res.status);
  });
});
