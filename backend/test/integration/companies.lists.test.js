const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeTicket, makeProject, makeTask, setCompanyAccess,
  freezeClock, unfreezeClock,
} = require('./fixtures');

const { Company, Contact } = models;
const MARK = 'ACME-SECRET';

let w;
let acme;
let fenced; // a System Technician fenced to the internal company
beforeEach(async () => {
  freezeClock('2026-03-11T17:00:00Z');
  await resetData();
  w = await makeWorld();
  acme = await Company.create({ name: `${MARK} Corp`, isClient: true });
  const ann = await Contact.create({ firstName: MARK, displayName: `${MARK} contact`, companyId: acme.id, email: 'ann@acme.test' });
  await makeTicket(w.admin.agent, { title: `${MARK} ticket`, contactId: ann.id, dueDate: '2026-03-12' });
  const p = await makeProject(w.admin.agent, { name: `${MARK} project`, ownerDepartmentId: w.deptA.id, tags: [MARK.toLowerCase()], dueDate: '2026-03-12' });
  await models.Project.update({ companyId: acme.id }, { where: { id: p.id } }); // Task 8 adds companyId to the API
  await makeTask(w.admin.agent, p.id, { title: `${MARK} task`, dueDate: '2026-03-12' });
  await makeTicket(w.admin.agent, { title: 'Home ticket', contactId: w.contact.id });
  fenced = await makeTech('fenced', w.deptA.id);
  const internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const leaks = (body) => JSON.stringify(body).includes(MARK);
const both = async (path) => [
  expectOk(await w.admin.agent.get(`${API}${path}`)),
  expectOk(await fenced.agent.get(`${API}${path}`)),
];

describe('lists are fenced by company', () => {
  it('ticket list', async () => {
    const [admin, fenced0] = await both('/tickets');
    expect(leaks(admin)).toBe(true);
    expect(leaks(fenced0)).toBe(false);
    expect(fenced0.total).toBe(1);
  });

  it('ticket board', async () => {
    const [admin, fenced0] = await both('/tickets/board');
    expect(leaks(admin)).toBe(true);
    expect(leaks(fenced0)).toBe(false);
    expect(fenced0.columns.reduce((n, c) => n + c.total, 0)).toBe(1);
  });

  it('the board still ignores ?status', async () => {
    const { columns } = expectOk(await fenced.agent.get(`${API}/tickets/board?status=Closed`));
    const open = columns.find((c) => c.status.name === 'Open');
    expect(open.tickets.map((t) => t.title)).toEqual(['Home ticket']);
  });

  it('project list', async () => {
    const [admin, fenced0] = await both('/projects');
    expect(leaks(admin)).toBe(true);
    expect(leaks(fenced0)).toBe(false);
  });

  it('project tags', async () => {
    const [admin, fenced0] = await both('/projects/tags');
    expect(admin.tags).toContain('acme-secret');
    expect(fenced0.tags).not.toContain('acme-secret');
  });

  it('contact list', async () => {
    const [admin, fenced0] = await both('/contacts');
    expect(leaks(admin)).toBe(true);
    expect(leaks(fenced0)).toBe(false);
  });

  it('contact A–Z index', async () => {
    // The index returns page numbers, not names, so compare its total.
    const [admin, fenced0] = await both('/contacts/index');
    expect([admin.total, fenced0.total]).toEqual([2, 1]);
  });

  it('S10: contact filters narrow scope, never widen it', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await Contact.create({ firstName: 'Bea', displayName: 'Bea', departmentId: w.deptB.id });
    await Contact.create({ firstName: 'Loose', displayName: 'Loose' });
    for (const query of [`departmentId=${w.deptB.id}`, 'noDept=true']) {
      // eslint-disable-next-line no-await-in-loop
      const body = JSON.stringify(expectOk(await staff.agent.get(`${API}/contacts?${query}`)));
      expect(body).not.toContain('Bea');
      expect(body).not.toContain('Loose');
    }
  });

  it('search', async () => {
    const [admin, fenced0] = await both('/search?q=ACME');
    expect(leaks(admin)).toBe(true);
    expect(leaks(fenced0)).toBe(false);
  });

  it('search by ticket number', async () => {
    const { tickets } = expectOk(await fenced.agent.get(`${API}/search?q=1`));
    expect(tickets.map((t) => t.id)).not.toContain(1);
  });

  it('calendar', async () => {
    const [admin, fenced0] = await both('/calendar/events?startDate=2026-03-01&endDate=2026-03-31&types=tickets,projects,tasks');
    expect(leaks(admin)).toBe(true);
    expect(leaks(fenced0)).toBe(false);
  });

  it('dashboard', async () => {
    const [admin, fenced0] = await both('/dashboard');
    expect(admin.stats.openTickets).toBe(2);
    expect(fenced0.stats.openTickets).toBe(1);
    expect(leaks(fenced0.projectHealth)).toBe(false);
    expect(leaks(fenced0.activity)).toBe(false);
  });

  it('the fence follows the viewer, not the dashboard owner', async () => {
    await models.Ticket.update({ assigneeId: fenced.user.id }, { where: { title: `${MARK} ticket` } });
    const viewed = expectOk(await w.admin.agent.get(`${API}/dashboard?userId=${fenced.user.id}`));
    expect(leaks(viewed.tickets)).toBe(true);
  });
});
