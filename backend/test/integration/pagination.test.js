const {
  createUserAndLogin, resetData, closeDb, ROLE, models,
  Department, Contact, Ticket, Comment,
} = require('./helpers');

const { CustomField, TicketFieldValue, Asset, AssetCategory, Project } = models;

const API = '/api/v1';

let dept;
let contact;
let admin;

beforeEach(async () => {
  await resetData();
  dept = await Department.create({ name: 'Service Desk', shortCode: 'SD' });
  contact = await Contact.create({
    firstName: 'Casey', lastName: 'Contact', displayName: 'Casey Contact',
    email: 'casey@example.com', departmentId: dept.id,
  });
  admin = await createUserAndLogin({ username: 'pgadmin', roleName: ROLE.ADMIN, departmentId: dept.id });

  // resetData() truncates the ticket/project/contact tables but not these, and
  // this suite seeds unique-keyed rows into all of them.
  await models.AssetTicket.destroy({ where: {} });
  await models.TicketFieldValue.destroy({ where: {} });
  await models.CustomField.destroy({ where: {} });
  await models.Asset.destroy({ where: {} });
  await AssetCategory.destroy({ where: { name: 'PagingLaptops' } });
});

afterAll(closeDb);

async function makeTickets(n, overrides = {}) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      title: `Ticket ${String(i).padStart(3, '0')}`,
      description: 'seeded',
      status: 'Open',
      priority: 'medium',
      contactId: contact.id,
      departmentId: dept.id,
      ...overrides,
    });
  }
  return Ticket.bulkCreate(rows);
}

describe('GET /tickets pagination', () => {
  test('returns the first page and a true total when no page is given', async () => {
    await makeTickets(60);
    const res = await admin.agent.get(`${API}/tickets`);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(50);
    expect(res.body.total).toBe(60);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
    expect(res.body.totalPages).toBe(2);
  });

  test('page 2 returns the remainder and does not repeat page 1', async () => {
    await makeTickets(60);
    const p1 = await admin.agent.get(`${API}/tickets`).query({ limit: 25, page: 1 });
    const p2 = await admin.agent.get(`${API}/tickets`).query({ limit: 25, page: 2 });
    const p3 = await admin.agent.get(`${API}/tickets`).query({ limit: 25, page: 3 });
    expect(p1.body.tickets).toHaveLength(25);
    expect(p2.body.tickets).toHaveLength(25);
    expect(p3.body.tickets).toHaveLength(10);

    const ids = [...p1.body.tickets, ...p2.body.tickets, ...p3.body.tickets].map((t) => t.id);
    expect(new Set(ids).size).toBe(60);
  });

  // The regression this whole change is most likely to introduce: ticketInclude
  // pulls in hasMany/belongsToMany associations, and a naive findAndCountAll
  // would count joined rows instead of tickets.
  test('total counts tickets, not joined association rows', async () => {
    const [t] = await makeTickets(1);
    const f1 = await CustomField.create({ fieldKey: 'cf_one', label: 'One', fieldType: 'text', isActive: true });
    const f2 = await CustomField.create({ fieldKey: 'cf_two', label: 'Two', fieldType: 'text', isActive: true });
    await TicketFieldValue.create({ ticketId: t.id, fieldId: f1.id, value: 'a' });
    await TicketFieldValue.create({ ticketId: t.id, fieldId: f2.id, value: 'b' });

    const res = await admin.agent.get(`${API}/tickets`);
    expect(res.body.total).toBe(1);
    expect(res.body.tickets).toHaveLength(1);
  });

  test('a page is not truncated by a ticket having several custom field values', async () => {
    const tickets = await makeTickets(5);
    const field = await CustomField.create({ fieldKey: 'cf_x', label: 'X', fieldType: 'text', isActive: true });
    await Promise.all(tickets.map((t) => TicketFieldValue.create({ ticketId: t.id, fieldId: field.id, value: 'v' })));

    const res = await admin.agent.get(`${API}/tickets`).query({ limit: 5 });
    expect(res.body.tickets).toHaveLength(5);
    expect(res.body.total).toBe(5);
  });

  test('clamps limit to the maximum', async () => {
    await makeTickets(3);
    const res = await admin.agent.get(`${API}/tickets`).query({ limit: 99999 });
    expect(res.body.limit).toBe(200);
  });

  test('limit=all returns everything in one page', async () => {
    await makeTickets(60);
    const res = await admin.agent.get(`${API}/tickets`).query({ limit: 'all' });
    expect(res.body.tickets).toHaveLength(60);
    expect(res.body.totalPages).toBe(1);
  });

  test('filters are applied before paging, not after', async () => {
    await makeTickets(30, { priority: 'low' });
    await makeTickets(10, { priority: 'high' });
    const res = await admin.agent.get(`${API}/tickets`).query({ priority: 'high' });
    expect(res.body.total).toBe(10);
    expect(res.body.tickets.every((t) => t.priority === 'high')).toBe(true);
  });

  test('sorts across the whole result set, not just within a page', async () => {
    await makeTickets(60);
    const res = await admin.agent.get(`${API}/tickets`).query({ sortBy: 'title', sortDir: 'asc', limit: 10 });
    expect(res.body.tickets[0].title).toBe('Ticket 000');
    const last = await admin.agent.get(`${API}/tickets`).query({ sortBy: 'title', sortDir: 'asc', limit: 10, page: 6 });
    expect(last.body.tickets.at(-1).title).toBe('Ticket 059');
  });
});

describe('GET /tickets custom field sort', () => {
  test('sorts a number custom field numerically across pages', async () => {
    const tickets = await makeTickets(12);
    const field = await CustomField.create({ fieldKey: 'cf_num', label: 'Num', fieldType: 'number', isActive: true });
    // 1..12 — a lexical sort would put "10" before "9".
    await Promise.all(tickets.map((t, i) => TicketFieldValue.create({
      ticketId: t.id, fieldId: field.id, value: String(i + 1),
    })));

    const res = await admin.agent.get(`${API}/tickets`).query({ sortBy: 'cf:cf_num', sortDir: 'asc', limit: 5 });
    expect(res.body.total).toBe(12);
    expect(res.body.tickets.map((t) => t.customFields.cf_num)).toEqual(['1', '2', '3', '4', '5']);

    const p3 = await admin.agent.get(`${API}/tickets`).query({ sortBy: 'cf:cf_num', sortDir: 'asc', limit: 5, page: 3 });
    expect(p3.body.tickets.map((t) => t.customFields.cf_num)).toEqual(['11', '12']);
  });

  test('tickets with no value for the sorted field are still returned', async () => {
    const tickets = await makeTickets(4);
    const field = await CustomField.create({ fieldKey: 'cf_sparse', label: 'Sparse', fieldType: 'text', isActive: true });
    await TicketFieldValue.create({ ticketId: tickets[0].id, fieldId: field.id, value: 'zz' });

    const res = await admin.agent.get(`${API}/tickets`).query({ sortBy: 'cf:cf_sparse', sortDir: 'asc' });
    expect(res.body.total).toBe(4);
    expect(res.body.tickets).toHaveLength(4);
  });

  test('an unknown custom field key falls back to the default sort', async () => {
    await makeTickets(3);
    const res = await admin.agent.get(`${API}/tickets`).query({ sortBy: 'cf:does_not_exist' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });
});

describe('GET /tickets/board', () => {
  test('groups into one column per status with a per-column total', async () => {
    await makeTickets(3, { status: 'Open' });
    await makeTickets(2, { status: 'Closed' });

    const res = await admin.agent.get(`${API}/tickets/board`);
    expect(res.status).toBe(200);
    const open = res.body.columns.find((c) => c.status.name === 'Open');
    const closed = res.body.columns.find((c) => c.status.name === 'Closed');
    expect(open.total).toBe(3);
    expect(open.tickets).toHaveLength(3);
    expect(closed.total).toBe(2);
  });

  test('honours the same filters as the list', async () => {
    await makeTickets(4, { status: 'Open', priority: 'high' });
    await makeTickets(6, { status: 'Open', priority: 'low' });

    const res = await admin.agent.get(`${API}/tickets/board`).query({ priority: 'high' });
    const open = res.body.columns.find((c) => c.status.name === 'Open');
    expect(open.total).toBe(4);
  });

  test('is not shadowed by the GET /tickets/:id route', async () => {
    const res = await admin.agent.get(`${API}/tickets/board`);
    expect(res.status).toBe(200);
    expect(res.body.columns).toBeDefined();
  });
});

describe('ticket sub-list pagination', () => {
  test('comments return the newest page first, in reading order', async () => {
    const [t] = await makeTickets(1);
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Comment.create({
        ticketId: t.id, authorId: admin.user.id, body: `c${String(i).padStart(2, '0')}`, type: 'comment_public',
      });
    }

    const p1 = await admin.agent.get(`${API}/tickets/${t.id}/comments`);
    expect(p1.body.total).toBe(30);
    expect(p1.body.comments).toHaveLength(25);
    // Newest 25 (c05..c29), oldest-first within the page.
    expect(p1.body.comments[0].body).toBe('c05');
    expect(p1.body.comments.at(-1).body).toBe('c29');

    const p2 = await admin.agent.get(`${API}/tickets/${t.id}/comments`).query({ page: 2 });
    expect(p2.body.comments).toHaveLength(5);
    expect(p2.body.comments[0].body).toBe('c00');
    expect(p2.body.comments.at(-1).body).toBe('c04');
  });

  test('time entry totalMinutes covers the ticket, not just the page', async () => {
    const [t] = await makeTickets(1);
    const { TimeEntry } = models;
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await TimeEntry.create({
        ticketId: t.id, userId: admin.user.id, loggedById: admin.user.id,
        minutes: 10, loggedAt: new Date(),
      });
    }
    const res = await admin.agent.get(`${API}/tickets/${t.id}/time`);
    expect(res.body.entries).toHaveLength(25);
    expect(res.body.total).toBe(30);
    expect(res.body.totalMinutes).toBe(300);
  });
});

// Regression guard: these endpoints already returned a `total` meaning a
// money sum before pagination existed. The paginated envelope also carries a
// `total` (the row count), and spreading them in the wrong order silently
// replaced one with the other.
describe('sub-list totals do not collide with the row count', () => {
  test('project expenses report both a row count and a money total', async () => {
    const project = await Project.create({
      name: 'Budgeted', status: 'Planning', ownerDepartmentId: dept.id, createdBy: admin.user.id,
    });
    const { ProjectExpense } = models;
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ProjectExpense.create({
        projectId: project.id, description: `e${i}`, category: 'other',
        amount: 10, entryDate: '2026-01-01', loggedBy: admin.user.id,
      });
    }
    const res = await admin.agent.get(`${API}/projects/${project.id}/expenses`);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(25);
    expect(res.body.total).toBe(30);        // rows
    expect(res.body.totalAmount).toBe(300); // money, across all 30
  });

  test('project time entries report labour cost across every entry, not the page', async () => {
    const project = await Project.create({
      name: 'Contracted', status: 'Planning', ownerDepartmentId: dept.id, createdBy: admin.user.id,
    });
    const { ProjectTimeEntry } = models;
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ProjectTimeEntry.create({
        projectId: project.id, userId: admin.user.id, loggedBy: admin.user.id, loggedForUserId: admin.user.id,
        entryDate: '2026-01-01', durationSeconds: 60, laborCost: 5,
      });
    }
    const res = await admin.agent.get(`${API}/projects/${project.id}/time-entries`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(25);
    expect(res.body.total).toBe(30);
    expect(res.body.totalSeconds).toBe(1800);
    expect(res.body.totalLaborCost).toBe(150);
  });
});

describe('other list endpoints', () => {
  test('GET /contacts pages and reports a true total', async () => {
    const rows = [];
    for (let i = 0; i < 60; i += 1) {
      rows.push({
        firstName: 'C', lastName: `Person${String(i).padStart(3, '0')}`,
        displayName: `C Person${String(i).padStart(3, '0')}`, departmentId: dept.id,
      });
    }
    await Contact.bulkCreate(rows);
    const res = await admin.agent.get(`${API}/contacts`);
    expect(res.body.contacts).toHaveLength(50);
    expect(res.body.total).toBe(61); // 60 + the shared fixture contact
  });

  test('GET /contacts/index maps letters to page numbers for the current page size', async () => {
    await Contact.destroy({ where: {} });
    const rows = [];
    // 30 A-surnames then 30 B-surnames, sorted by lastName.
    for (let i = 0; i < 30; i += 1) rows.push({ firstName: 'X', lastName: `Aaa${i}`, displayName: `X Aaa${i}`, departmentId: dept.id });
    for (let i = 0; i < 30; i += 1) rows.push({ firstName: 'X', lastName: `Bbb${i}`, displayName: `X Bbb${i}`, departmentId: dept.id });
    await Contact.bulkCreate(rows);

    const res = await admin.agent.get(`${API}/contacts/index`).query({ limit: 25 });
    expect(res.status).toBe(200);
    expect(res.body.index.A).toBe(1);
    // 30 A's fill page 1 and spill into page 2, so the first B is on page 2.
    expect(res.body.index.B).toBe(2);
    expect(res.body.total).toBe(60);
  });

  test('GET /projects pages without members inflating the total', async () => {
    const projects = [];
    for (let i = 0; i < 12; i += 1) {
      projects.push({ name: `Project ${i}`, status: 'Planning', ownerDepartmentId: dept.id, createdBy: admin.user.id });
    }
    const created = await Project.bulkCreate(projects);
    const { ProjectMember } = models;
    // Several members on one project — the count must stay 12, not 14.
    await ProjectMember.create({ projectId: created[0].id, userId: admin.user.id, role: 'member' });

    const res = await admin.agent.get(`${API}/projects`).query({ limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
    expect(res.body.projects).toHaveLength(5);
  });

  test('GET /projects/tags lists tags from every page, not just the first', async () => {
    const projects = [];
    for (let i = 0; i < 60; i += 1) {
      projects.push({
        name: `Tagged ${i}`, status: 'Planning', ownerDepartmentId: dept.id,
        createdBy: admin.user.id, tags: [`tag${i}`],
      });
    }
    await Project.bulkCreate(projects);
    const res = await admin.agent.get(`${API}/projects/tags`);
    expect(res.status).toBe(200);
    // tag59 only exists beyond the first page of projects.
    expect(res.body.tags).toContain('tag59');
    expect(res.body.tags).toHaveLength(60);
  });

  test('GET /assets applies the replacement quick filter in SQL', async () => {
    const category = await AssetCategory.create({ name: 'PagingLaptops', prefix: 'PLT' });
    const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 900 * 86400000).toISOString().slice(0, 10);
    const rows = [];
    for (let i = 0; i < 60; i += 1) {
      rows.push({
        assetTag: `PLT-${String(i).padStart(4, '0')}`, name: `Laptop ${i}`,
        categoryId: category.id, status: 'active',
        // Only the last few are due, so they fall outside page 1 by tag order.
        replacementPlanDate: i >= 57 ? soon : later,
      });
    }
    await Asset.bulkCreate(rows);

    const res = await admin.agent.get(`${API}/assets`).query({ quickFilter: 'dueForReplacement' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.assets).toHaveLength(3);
  });

  test('GET /users pages, while the picker endpoints stay complete', async () => {
    for (let i = 0; i < 60; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await models.User.create({
        username: `bulk${i}`, displayName: `Bulk ${String(i).padStart(3, '0')}`,
        role: 'technician', isLocalAccount: true, isActive: true, passwordHash: 'x',
        departmentId: dept.id,
      });
    }
    const paged = await admin.agent.get(`${API}/users`);
    expect(paged.body.users).toHaveLength(50);
    expect(paged.body.total).toBe(61); // 60 + the admin

    // Pickers must not be truncated — a missing option is invisible to the user.
    const assignable = await admin.agent.get(`${API}/users/assignable`);
    expect(assignable.body.users.length).toBe(61);
    const directory = await admin.agent.get(`${API}/users/directory`);
    expect(directory.body.users.length).toBe(61);
  });
});
