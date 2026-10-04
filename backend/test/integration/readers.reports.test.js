const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeManager, makeTicket, makeProject, makeTech,
  freezeClock, advanceClock, unfreezeClock, LEDGER_NOW, makeLedger,
} = require('./fixtures');

// Baseline for the reports that read time and money: time-billing, team
// performance and the projects report. Most cases run over the shared ledger
// (see makeLedger in fixtures.js) so the expected figures are exact.

afterEach(unfreezeClock);
afterAll(closeDb);

const get = async (agent, path) => expectOk(await agent.get(`${API}/reports/${path}`));

describe('an empty install', () => {
  it('reports zeros', async () => {
    await resetData();
    const w = await makeWorld();
    const billing = await get(w.admin.agent, 'time-billing');
    expect(billing.summary).toEqual({
      totalHours: 0, avgHoursPerTicket: 0, entryCount: 0, internalHours: 0, contractorHours: 0, totalLaborCost: 0,
    });
    expect(billing.tableData.rows).toEqual([]);
    expect((await get(w.admin.agent, 'team-performance')).summary)
      .toEqual({ techCount: 1, totalClosed: 0, avgResolutionHours: null });
    expect((await get(w.admin.agent, 'projects')).summary).toEqual({
      totalActive: 0, totalCompletedInPeriod: 0, avgCompletion: 0, totalMaterialsCost: 0, totalExpensesCost: 0,
    });
  });
});

describe('over the ledger', () => {
  let w;
  let L;
  beforeEach(async () => {
    // Every request below runs under the frozen clock, which is why it is
    // frozen before the reset and the logins.
    freezeClock(LEDGER_NOW);
    await resetData();
    w = await makeWorld();
    L = await makeLedger(w);
  });
  const boiler = async () => {
    const t = await makeTicket(w.admin.agent, { title: 'Boiler', contactId: w.contact.id, departmentId: w.deptB.id });
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/time`).send({ minutes: 30 }), 201);
  };

  describe('time-billing', () => {
    it('summarises every entry, ticket and project', async () => {
      const { summary, chartData } = await get(w.admin.agent, 'time-billing');
      expect(summary).toEqual({
        totalHours: 5, avgHoursPerTicket: 2.5, entryCount: 4,
        internalHours: 3.5, contractorHours: 1.5, totalLaborCost: 112.5,
      });
      expect(chartData.byTech).toEqual([{ name: 'Test tina', hours: 3.5 }, { name: 'Test carl', hours: 1.5 }]);
      expect(chartData.byType).toEqual([{ name: 'request', hours: 2.5 }, { name: 'Project work', hours: 2.5 }]);
      expect(chartData.byDepartment).toEqual([{ name: 'Service Desk', hours: 5 }]);
      expect(chartData.overTime).toEqual([{ date: '2026-03-11', hours: 5 }]);
      expect(chartData.granularity).toBe('day');
    });

    it('one row per entry', async () => {
      const { rows } = (await get(w.admin.agent, 'time-billing')).tableData;
      const row = (techName, reference, hours, laborCost) => ({ techName, reference, note: '', date: '2026-03-11', hours, laborCost });
      expect(rows.map(({ id, ...rest }) => rest)).toEqual(expect.arrayContaining([
        row('Test tina', '#00001 Printer', 1.5, ''),
        row('Test carl', '#00001 Printer', 1, 75),
        row('Test carl', 'Project: Refresh', 0.5, 37.5),
        row('Test tina', 'Project: Refresh', 2, ''),
      ]));
      expect(rows).toHaveLength(4);
    });

    // Likely correct: dates and date filters use entryDate, the work date. Expected to change in sub-project 3.
    it('[quirk] Q9: dates and date filters use when time was recorded, not the work date', async () => {
      // Tina's ticket entry has entryDate 2026-03-02, but was recorded on 2026-03-11.
      const { summary } = await get(w.admin.agent, 'time-billing?startDate=2026-03-01&endDate=2026-03-05');
      expect(summary.entryCount).toBe(0);
    });

    // Likely correct: an endDate covers the whole of that date. Expected to change in sub-project 3.
    it('[quirk] Q36: an endDate means the end of the previous local day west of UTC', async () => {
      expect((await get(w.admin.agent, 'time-billing?startDate=2026-03-11&endDate=2026-03-11')).summary.entryCount).toBe(0);
      expect((await get(w.admin.agent, 'time-billing?startDate=2026-03-11&endDate=2026-03-12')).summary.entryCount).toBe(4);
    });

    it('filters by the person the time is for', async () => {
      const { summary } = await get(w.admin.agent, `time-billing?assigneeId=${L.carl.user.id}`);
      expect(summary).toEqual(expect.objectContaining({ entryCount: 2, totalLaborCost: 112.5 }));
    });

    it('filters by department', async () => {
      await boiler();
      const { summary } = await get(w.admin.agent, `time-billing?departmentId=${w.deptB.id}`);
      expect(summary).toEqual(expect.objectContaining({ entryCount: 1, totalHours: 0.5 }));
    });

    it('reports.view_own sees only their own time', async () => {
      const staff = await makeStaff('staff', w.deptA.id);
      expectOk(await staff.agent.post(`${API}/tickets/${L.ticket.id}/time`).send({ minutes: 30 }), 201);
      const { summary } = await get(staff.agent, 'time-billing');
      expect(summary).toEqual(expect.objectContaining({ entryCount: 1, totalHours: 0.5 }));
    });

    it('reports.view_department sees their department\'s tickets and projects', async () => {
      await boiler();
      const mgr = await makeManager('mgr', w.deptA.id);
      expect((await get(mgr.agent, 'time-billing')).summary.entryCount).toBe(4);
    });

    it('exports the rows as CSV', async () => {
      const res = await w.admin.agent.get(`${API}/reports/time-billing/export`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="prism-time-billing.csv"');
      const lines = res.text.split('\r\n');
      expect(lines[0]).toBe('Tech,Ticket/Project,Description,Date,Hours,Labor cost');
      expect(lines).toHaveLength(5);
      expect(lines).toContain('Test carl,#00001 Printer,,2026-03-11,1,75');
    });
  });

  describe('team performance', () => {
    const rowFor = (body, name) => body.tableData.rows.find((r) => r.name === name);

    // Likely correct: time logged counts project time too. Expected to change in sub-project 3.
    it('[quirk] Q10: team performance counts ticket time only', async () => {
      const body = await get(w.admin.agent, 'team-performance');
      expect(rowFor(body, 'Test tina').totalHoursLogged).toBe(1.5); // her 2 h of project time is missing
      expect(rowFor(body, 'Test carl').totalHoursLogged).toBe(1);
    });

    it('one row per technician', async () => {
      const body = await get(w.admin.agent, 'team-performance');
      expect(rowFor(body, 'Test tina')).toEqual(expect.objectContaining({
        name: 'Test tina', department: 'Service Desk', assigned: 1, closed: 0, overdue: 0, workload: 1,
        avgResolutionHours: null, avgFirstResponseHours: null,
      }));
    });

    it('team performance scope', async () => {
      const mgr = await makeManager('mgr', w.deptA.id);
      await makeTech('elsewhere', w.deptB.id);
      const names = (await get(mgr.agent, 'team-performance')).tableData.rows.map((r) => r.name).sort();
      expect(names).toEqual(['Test carl', 'Test mgr', 'Test tina']);
    });

    it('exports team performance as CSV', async () => {
      const res = await w.admin.agent.get(`${API}/reports/team-performance/export`);
      expect(res.text.split('\r\n')[0])
        .toBe('Name,Department,Assigned,Closed,Overdue,Avg resolution (hrs),Time logged (hrs),Avg first response (hrs)');
    });
  });

  describe('projects report', () => {
    // Likely correct: one definition of total cost everywhere (the custom
    // report includes labour; this doesn't). Expected to change in sub-project 3.
    it('[quirk] Q11: the projects report\'s total cost leaves out labour', async () => {
      const [row] = (await get(w.admin.agent, 'projects')).tableData.rows;
      expect(row).toEqual({
        id: L.project.id, projectCode: 'SD-P00001', name: 'Refresh', ownedBy: 'Service Desk', forDept: 'Service Desk',
        status: 'Active', completion: 0, dueDate: '', timeLoggedHours: 2.5, materialsCost: 50, expensesCost: 100, totalCost: 150,
      });
    });

    it('projects report summary', async () => {
      expect((await get(w.admin.agent, 'projects')).summary).toEqual({
        totalActive: 1, totalCompletedInPeriod: 0, avgCompletion: 0, totalMaterialsCost: 50, totalExpensesCost: 100,
      });
    });

    it('counts projects closed in the period', async () => {
      expectOk(await w.admin.agent.patch(`${API}/projects/${L.project.id}`).send({ status: 'Completed' }));
      expect((await get(w.admin.agent, 'projects')).summary.totalCompletedInPeriod).toBe(1);
      expect((await get(w.admin.agent, 'projects?startDate=2026-03-12')).summary.totalCompletedInPeriod).toBe(0);
    });

    it('projects report scope', async () => {
      await makeProject(w.admin.agent, { name: 'Boiler room', ownerDepartmentId: w.deptB.id });
      const mgr = await makeManager('mgr', w.deptA.id);
      const staff = await makeStaff('staff', w.deptA.id);
      expect((await get(mgr.agent, 'projects')).tableData.rows.map((r) => r.name)).toEqual(['Refresh']);
      expect((await get(staff.agent, 'projects')).tableData.rows).toEqual([]);
    });

    it('exports the projects report as CSV', async () => {
      const res = await w.admin.agent.get(`${API}/reports/projects/export`);
      expect(res.text.split('\r\n')[0]).toBe(
        'Project,Name,Owned by,For dept,Status,Completion %,Due date,Time logged (hrs),Materials cost,Expenses cost,Total cost'
      );
    });
  });
});

describe('team performance timings', () => {
  it('resolution and first-response hours', async () => {
    freezeClock('2026-03-11T12:00:00Z');
    await resetData();
    const w = await makeWorld();
    const tina = await makeTech('tina', w.deptA.id);
    const t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, assigneeId: tina.user.id });
    const comment = (body) => tina.agent.post(`${API}/tickets/${t.id}/comments`).send(body);
    advanceClock(30 * 60 * 1000);
    expectOk(await comment({ body: 'internal', type: 'comment_private' }), 201);
    advanceClock(30 * 60 * 1000);
    expectOk(await comment({ body: 'On my way' }), 201);
    advanceClock(2 * 60 * 60 * 1000);
    expectOk(await tina.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Resolved' }));
    await makeTicket(w.admin.agent, { title: 'Late', contactId: w.contact.id, assigneeId: tina.user.id, dueDate: '2026-03-10' });

    const body = await get(w.admin.agent, 'team-performance');
    expect(body.tableData.rows.find((r) => r.name === 'Test tina')).toEqual(expect.objectContaining({
      assigned: 2, closed: 1, overdue: 1, workload: 1, avgResolutionHours: 3, avgFirstResponseHours: 1,
    }));
    expect(body.summary.totalClosed).toBe(1);
  });
});
