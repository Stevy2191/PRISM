const { resetData, closeDb, models } = require('./helpers');
const { loadTicketReportData } = require('../../src/services/ticketReport');
const { loadProjectReportData } = require('../../src/services/projectReport');
const {
  API, expectOk, makeWorld, makeOwnTier, freezeClock, unfreezeClock, LEDGER_NOW, makeLedger,
} = require('./fixtures');

// Baseline for the other readers of time and money: the dashboard, the custom
// report engine and the PDF report data. Ends with the cross-check every
// reader must pass for the ledger merge (sub-project 3).

afterEach(unfreezeClock);
afterAll(closeDb);

let w;
let L;
const custom = async (body) => expectOk(await w.admin.agent.post(`${API}/reports/custom`).send(body));
const sum = (xs, f) => xs.reduce((s, x) => s + Number(f(x) || 0), 0);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('an empty install', () => {
  beforeEach(async () => {
    freezeClock(LEDGER_NOW);
    await resetData();
    w = await makeWorld();
  });

  it('reports zeros', async () => {
    const report = await custom({ dataSource: 'time_entries' });
    expect(report.tableData.rows).toEqual([]);
    expect(report.summary).toEqual({ totalRecords: 0, total_durationHours: 0, total_laborCost: 0 });
    const dash = expectOk(await w.admin.agent.get(`${API}/dashboard?userId=${w.admin.user.id}`));
    expect(dash.hours.total).toBe(0);
  });
});

describe('over the ledger', () => {
  beforeEach(async () => {
    freezeClock(LEDGER_NOW);
    await resetData();
    w = await makeWorld();
    L = await makeLedger(w);
  });

  // The main protection for the ledger merge (sub-project 3): every reader of
  // time and labour must agree on the same ledger.
  it('every reader agrees on the ledger', async () => {
    const a = w.admin.agent;
    const ticketTime = expectOk(await a.get(`${API}/tickets/${L.ticket.id}/time`));
    const ticketList = expectOk(await a.get(`${API}/tickets`)).tickets.find((t) => t.id === L.ticket.id);
    const projectTime = expectOk(await a.get(`${API}/projects/${L.project.id}/time-entries`));
    const projectStats = expectOk(await a.get(`${API}/projects/${L.project.id}/stats`)).stats;
    const billing = expectOk(await a.get(`${API}/reports/time-billing`)).summary;
    const projectsReport = expectOk(await a.get(`${API}/reports/projects`)).tableData.rows[0];
    const customTime = (await custom({ dataSource: 'time_entries' })).summary;
    const customProject = (await custom({ dataSource: 'projects' })).tableData.rows[0];
    const customTicket = (await custom({ dataSource: 'tickets' })).tableData.rows[0];
    const ticketPdf = await loadTicketReportData(L.ticket.id);
    const projectPdf = await loadProjectReportData(L.project.id);

    const ticketHours = [
      ticketTime.totalSeconds / 3600, ticketList.timeLoggedMinutes / 60, customTicket.timeLoggedHours,
      sum(ticketPdf.timeEntries, (e) => e.durationSeconds) / 3600,
    ];
    const projectHours = [
      projectTime.totalSeconds / 3600, projectStats.totalTimeSeconds / 3600, projectsReport.timeLoggedHours,
      customProject.totalTimeLoggedHours, sum(projectPdf.timeEntries, (e) => e.durationSeconds) / 3600,
    ];
    const projectLabour = [
      projectTime.totalLaborCost, customProject.laborCost, sum(projectPdf.timeEntries, (e) => e.laborCost),
    ];
    expect(new Set(ticketHours)).toEqual(new Set([2.5]));
    expect(new Set(projectHours)).toEqual(new Set([2.5]));
    expect(new Set(projectLabour)).toEqual(new Set([37.5]));
    expect(billing.totalHours).toBe(5);
    expect(customTime.total_durationHours).toBe(5);
    expect(billing.totalLaborCost).toBe(112.5);
    expect(customTime.total_laborCost).toBe(112.5);
    const team = expectOk(await a.get(`${API}/reports/team-performance`)).tableData.rows;
    expect(team.find((r) => r.name === 'Test tina').totalHoursLogged).toBe(3.5);
  });

  describe('dashboard', () => {
    const hoursFor = async (userId) => expectOk(await w.admin.agent.get(`${API}/dashboard?userId=${userId}`));
    const week = (byDay = {}) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, hours: byDay[day] || 0 }));

    it('Q12: dashboard hours are all of this week\'s time, by work date', async () => {
      const dash = await hoursFor(L.tina.user.id);
      expect(dash.mode).toBe('admin_filtered');
      // Her 2 h of project time is on Tuesday the 10th; her ticket time is dated the 2nd, last week.
      expect(dash.hours).toEqual({ total: 2, byDay: week({ Tue: 2 }) });
    });

    it('Q12: the weekend counts, and days follow the work date', async () => {
      const url = `${API}/tickets/${L.ticket.id}/time`;
      const sat = expectOk(await L.tina.agent.post(url).send({ durationMinutes: 60 }), 201).entry;
      expectOk(await L.tina.agent.post(url).send({ durationMinutes: 30 }), 201);
      // No endpoint takes a future work date; move one to Saturday directly.
      await models.TimeEntry.update({ entryDate: '2026-03-14' }, { where: { id: sat.id } });
      expect((await hoursFor(L.tina.user.id)).hours).toEqual({ total: 3.5, byDay: week({ Tue: 2, Wed: 0.5, Sat: 1 }) });
    });

    it('own-tier users get the personal dashboard', async () => {
      const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
      const dash = expectOk(await own.agent.get(`${API}/dashboard`));
      expect(dash.mode).toBe('tech');
      expect(dash.hours).toEqual({ total: 0, byDay: week() });
    });

    it('own-tier users can\'t view someone else\'s dashboard', async () => {
      const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
      const res = await own.agent.get(`${API}/dashboard?userId=${L.tina.user.id}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: true, message: "You don't have permission to view another user's dashboard", code: 'FORBIDDEN' });
    });
  });

  describe('custom reports', () => {
    it('time_entries: one row per entry, dated by entryDate', async () => {
      const report = await custom({ dataSource: 'time_entries' });
      const row = (id, date, techName, userType, ticketNumber, projectCode, durationHours, laborCost) => ({
        id, date, techName, userType, ticketNumber, projectCode, description: '', durationHours, laborCost,
      });
      expect(report.tableData.rows).toEqual(expect.arrayContaining([
        // One ledger: rows carry the entry's own id (makeLedger's creation order).
        row(1, '2026-03-02', 'Test tina', 'Internal', '#00001', '', 1.5, null),
        row(2, '2026-03-11', 'Test carl', 'Contractor', '#00001', '', 1, 75),
        row(3, '2026-03-11', 'Test carl', 'Contractor', '', 'SD-P00001', 0.5, 37.5),
        row(4, '2026-03-10', 'Test tina', 'Internal', '', 'SD-P00001', 2, null),
      ]));
      expect(report.tableData.rows).toHaveLength(4);
      expect(report.summary).toEqual({ totalRecords: 4, total_durationHours: 5, total_laborCost: 112.5 });
    });

    it('group by tech', async () => {
      const { chartData } = await custom({ dataSource: 'time_entries', groupBy: 'tech' });
      expect(chartData).toEqual(expect.arrayContaining([
        { name: 'Test tina', count: 2, durationHours: 3.5, laborCost: 0 },
        { name: 'Test carl', count: 2, durationHours: 1.5, laborCost: 112.5 },
      ]));
      expect(chartData).toHaveLength(2);
    });

    it('group by project', async () => {
      const { chartData } = await custom({ dataSource: 'time_entries', groupBy: 'project' });
      expect(chartData).toEqual(expect.arrayContaining([
        { name: '(ticket time)', count: 2, durationHours: 2.5, laborCost: 75 },
        { name: 'SD-P00001', count: 2, durationHours: 2.5, laborCost: 37.5 },
      ]));
      expect(chartData).toHaveLength(2);
    });

    it('group by month uses entryDate', async () => {
      const { chartData } = await custom({ dataSource: 'time_entries', groupBy: 'month' });
      expect(chartData).toEqual([{ name: '2026-03', count: 4, durationHours: 5, laborCost: 112.5 }]);
    });

    it('filters', async () => {
      const ids = async (filters) => (await custom({ dataSource: 'time_entries', filters })).tableData.rows.map((r) => r.id).sort();
      expect(await ids({ userType: 'contractor' })).toEqual([2, 3]);
      expect(await ids({ assigneeId: L.tina.user.id })).toEqual([1, 4]);
    });

    // Likely correct: one definition of total cost everywhere (the projects
    // report and project stats leave labour out). Expected to change in sub-project 3.
    it('the custom projects source counts labour in total cost', async () => {
      const [row] = (await custom({ dataSource: 'projects' })).tableData.rows;
      expect(row).toEqual(expect.objectContaining({
        totalTimeLoggedHours: 2.5, laborCost: 37.5, expensesTotal: 100, materialsTotal: 50, totalCost: 187.5,
        completionPercent: 0, lead: 'Test tina',
      }));
    });

    it('tickets source reports logged hours', async () => {
      const rows = (await custom({ dataSource: 'tickets' })).tableData.rows;
      expect(rows.find((r) => r.id === L.ticket.id).timeLoggedHours).toBe(2.5);
    });

    it('rejects an unknown data source', async () => {
      const res = await w.admin.agent.post(`${API}/reports/custom`).send({ dataSource: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'Invalid dataSource', code: 'VALIDATION_ERROR' });
    });

    it('exports a custom report as CSV', async () => {
      const res = await w.admin.agent.post(`${API}/reports/custom/export-csv`)
        .send({ dataSource: 'time_entries', fields: ['techName', 'durationHours'] });
      const lines = res.text.split('\r\n');
      expect(lines[0]).toBe('Tech name,Duration');
      expect(lines).toHaveLength(5);
    });
  });

  describe('PDF reports', () => {
    it('the ticket PDF is a PDF, behind the ticket\'s scope', async () => {
      const res = await w.admin.agent.get(`${API}/tickets/${L.ticket.id}/report`).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
      const refused = await own.agent.get(`${API}/tickets/${L.ticket.id}/report`);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe('You do not have access to this ticket');
      expect((await w.admin.agent.get(`${API}/tickets/99999/report`)).status).toBe(404);
    });

    it('ticket PDF data leaves out internal comments and orders time by work date', async () => {
      const url = `${API}/tickets/${L.ticket.id}/comments`;
      expectOk(await L.tina.agent.post(url).send({ body: 'reply' }), 201);
      expectOk(await L.tina.agent.post(url).send({ body: 'note', type: 'comment_private' }), 201);
      const data = await loadTicketReportData(L.ticket.id);
      expect(data.comments.map((c) => c.type)).toEqual(['reply']);
      expect(data.timeEntries.map((e) => e.durationSeconds)).toEqual([5400, 3600]);
      expect(data.activity.map((a) => a.action)).toEqual(['created']);
    });

    it('the project PDF is a PDF, behind the project\'s scope', async () => {
      const res = await w.admin.agent.get(`${API}/projects/${L.project.id}/report`).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
      const refused = await own.agent.get(`${API}/projects/${L.project.id}/report`);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe('You do not have access to this project');
    });

    it('project PDF data', async () => {
      const data = await loadProjectReportData(L.project.id);
      expect(data.timeEntries.map((e) => e.durationSeconds)).toEqual([7200, 1800]);
      expect(data.expenses).toHaveLength(1);
      expect(data.materials).toHaveLength(1);
      expect(data.completion.percent).toBe(0);
      expect(data.activity.map((a) => a.action)).toEqual(['project_created']);
    });
  });
});
