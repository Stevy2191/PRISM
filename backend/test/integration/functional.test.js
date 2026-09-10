const {
  createUserAndLogin, resetData, closeDb, ROLE, Department, Contact, Ticket,
} = require('./helpers');

// Tightening authorization is only correct if the people who are supposed to
// do the work still can. These are the counterpart to authorization.test.js:
// the same endpoints, exercised by roles that legitimately hold the
// permission, asserting they succeed.

let dept;
let contact;
let ticket;
let tech;

beforeEach(async () => {
  await resetData();
  dept = await Department.create({ name: 'Service Desk', shortCode: 'SD' });
  contact = await Contact.create({
    firstName: 'Casey', lastName: 'Contact', displayName: 'Casey Contact', email: 'casey@example.com',
  });
  tech = await createUserAndLogin({
    username: 'tech', roleName: ROLE.TECHNICIAN, departmentId: dept.id,
  });
  ticket = await Ticket.create({
    title: 'Printer offline', description: 'Third floor', status: 'Open', priority: 'medium',
    departmentId: dept.id, contactId: contact.id, createdBy: tech.user.id, assigneeId: tech.user.id,
  });
});

afterAll(closeDb);

describe('a System Technician can still do their job', () => {
  it('reads the ticket list', async () => {
    const res = await tech.agent.get('/api/v1/tickets');
    expect(res.status).toBe(200);
  });

  it('opens a ticket', async () => {
    const res = await tech.agent.get(`/api/v1/tickets/${ticket.id}`);
    expect(res.status).toBe(200);
  });

  it('comments on a ticket', async () => {
    const res = await tech.agent.post(`/api/v1/tickets/${ticket.id}/comments`).send({ body: 'On my way' });
    expect(res.status).toBe(201);
  });

  it('adds a ticket task', async () => {
    const res = await tech.agent.post(`/api/v1/tickets/${ticket.id}/tasks`).send({ description: 'Swap toner' });
    expect(res.status).toBe(201);
  });

  it('logs time against a ticket', async () => {
    const res = await tech.agent.post(`/api/v1/tickets/${ticket.id}/time`)
      .send({ minutes: 45, description: 'Replaced fuser' });
    expect([200, 201]).toContain(res.status);
  });

  it('manages watchers', async () => {
    const res = await tech.agent.post(`/api/v1/tickets/${ticket.id}/watchers`).send({ userId: tech.user.id });
    expect([200, 201]).toContain(res.status);
  });

  it('starts and stops the timer', async () => {
    const start = await tech.agent.post('/api/v1/timer/start').send({ type: 'ticket', id: ticket.id, label: 'Working' });
    expect([200, 201]).toContain(start.status);
    const stop = await tech.agent.post('/api/v1/timer/stop').send({});
    expect([200, 201]).toContain(stop.status);
  });

  it('creates a project and a task on it', async () => {
    const project = await tech.agent.post('/api/v1/projects')
      .send({ name: 'Printer refresh', ownerDepartmentId: dept.id });
    expect(project.status).toBe(201);

    const task = await tech.agent.post(`/api/v1/projects/${project.body.project.id}/tasks`)
      .send({ title: 'Audit fleet', description: 'Count printers' });
    expect(task.status).toBe(201);
  });

  it('creates a blueprint', async () => {
    const res = await tech.agent.post('/api/v1/blueprints').send({ name: 'Standard onboarding' });
    expect(res.status).toBe(201);
  });

  it('posts an internal comment', async () => {
    const res = await tech.agent.post(`/api/v1/tickets/${ticket.id}/comments`)
      .send({ body: 'Internal note', type: 'comment_private' });
    expect(res.status).toBe(201);
  });

  it('changes their own password to a compliant one', async () => {
    const res = await tech.agent.post('/api/v1/auth/change-password')
      .send({ currentPassword: 'IntegrationPass!2026', newPassword: 'AnotherSolid!Phrase42' });
    expect(res.status).toBe(200);
  });
});

describe('an administrator retains full access', () => {
  it('reaches admin-only endpoints', async () => {
    const admin = await createUserAndLogin({
      username: 'boss', roleName: ROLE.ADMIN, legacyRole: 'admin', departmentId: dept.id,
    });
    for (const path of ['/api/v1/users', '/api/v1/roles', '/api/v1/settings', '/api/v1/audit-log']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await admin.agent.get(path);
      expect([200, 204]).toContain(res.status);
    }
  });
});
