const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeContact, makeTicket,
  makeProject, makeTeam, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Baseline for the ticket desk's core endpoints: what create, get, update,
// delete, list and board do today. Tests named [quirk] pin behaviour that is
// probably wrong; see the quirk table in the test-baseline spec.

let w;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
});
afterEach(unfreezeClock);
afterAll(closeDb);

const base = () => ({ title: 'Printer offline', contactId: w.contact.id });
const activityOf = async (agent, id) => expectOk(await agent.get(`${API}/tickets/${id}/activity`))
  .activity.map((a) => [a.action, a.fromValue, a.toValue]);
const grantOverride = async (userId, permissionKey, granted) => expectOk(
  await w.admin.agent.post(`${API}/users/${userId}/overrides`).send({ permissionKey, granted }), 201
);

describe('POST /tickets', () => {
  it('applies defaults', async () => {
    const t = await makeTicket(tech.agent, { ...base(), title: '  Printer offline  ' });
    // The department defaults to the contact's (spec; plan 2b task 8).
    expect(t).toEqual(expect.objectContaining({
      title: 'Printer offline', description: null, status: 'Open', priority: 'medium', type: 'request',
      source: 'manual', assigneeId: null, teamId: null, departmentId: w.deptA.id, projectId: null,
      dueDate: null, dueTime: null, tags: null, resolvedAt: null, resolution: null,
      createdBy: tech.user.id, contactId: w.contact.id, customFields: {}, ticketNumber: '00001',
    }));
    expect(expectOk(await tech.agent.get(`${API}/tickets/${t.id}`)).ticket)
      .toEqual(expect.objectContaining({ title: 'Printer offline', status: 'Open' }));
  });

  it('keeps every explicit field', async () => {
    const fields = {
      description: 'd', priority: 'high', type: 'incident', status: 'Waiting on User', departmentId: w.deptA.id,
      assigneeId: tech.user.id, dueDate: '2026-12-01', dueTime: '14:30:00', tags: ['vpn', 'urgent'],
    };
    const t = await makeTicket(tech.agent, { ...base(), ...fields });
    expect(t).toEqual(expect.objectContaining(fields));
    expect(expectOk(await tech.agent.get(`${API}/tickets/${t.id}`)).ticket).toEqual(expect.objectContaining(fields));
  });

  it('drops dueTime when there is no dueDate', async () => {
    const t = await makeTicket(tech.agent, { ...base(), dueTime: '09:00:00' });
    expect(t.dueTime).toBeNull();
  });

  it('requires a title', async () => {
    for (const title of [undefined, '   ']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(`${API}/tickets`).send({ contactId: w.contact.id, title });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: true, message: 'Ticket title is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('requires a contact', async () => {
    const res = await tech.agent.post(`${API}/tickets`).send({ title: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'A contact is required', code: 'VALIDATION_ERROR' });
  });

  it('lets callers pick only manual or phone as the source', async () => {
    const stored = [];
    for (const source of ['phone', 'email', 'portal', 'bogus']) {
      // eslint-disable-next-line no-await-in-loop
      stored.push((await makeTicket(tech.agent, { ...base(), source })).source);
    }
    expect(stored).toEqual(['phone', 'manual', 'manual', 'manual']);
  });

  it('stamps resolvedAt when created closed', async () => {
    const t = await makeTicket(tech.agent, { ...base(), status: 'Request completed' });
    expect(typeof t.resolvedAt).toBe('string');
  });

  it('Q25: refuses a status no TicketStatus row has', async () => {
    const res = await tech.agent.post(`${API}/tickets`).send({ ...base(), status: 'Bogus' });
    expect(res.body).toEqual({ error: true, message: 'Unknown ticket status', code: 'VALIDATION_ERROR' });
    const t = await makeTicket(tech.agent, base());
    expect((await tech.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Bogus' })).body)
      .toEqual({ error: true, message: 'Unknown ticket status', code: 'VALIDATION_ERROR' });
  });

  // Automatic assignment is a workflow rule now: settings.cleanup.test.js.

  it('logs a created activity entry', async () => {
    const t = await makeTicket(tech.agent, base());
    expect(await activityOf(tech.agent, t.id)).toEqual([['created', null, null]]);
  });
});

describe('GET /tickets/:id and scope', () => {
  it('returns the ticket with its related records', async () => {
    const t = await makeTicket(w.admin.agent, { ...base(), assigneeId: tech.user.id, departmentId: w.deptA.id });
    const { ticket } = expectOk(await tech.agent.get(`${API}/tickets/${t.id}`));
    expect(ticket.assignee).toEqual({ id: tech.user.id, displayName: 'Test tech', username: 'tech', email: null });
    expect(ticket.department).toEqual({ id: w.deptA.id, name: 'Service Desk' });
    expect(ticket.contact.id).toBe(w.contact.id);
  });

  it('GET a missing ticket', async () => {
    const res = await tech.agent.get(`${API}/tickets/99999`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Ticket not found', code: 'NOT_FOUND' });
  });

  it('GET with a non-numeric id is a 404, not a 500', async () => {
    expect((await tech.agent.get(`${API}/tickets/abc`)).status).toBe(404);
  });

  it('own-tier sees and edits only tickets assigned to them', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptA.id, assigneeId: own.user.id });
    const theirs = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptA.id, assigneeId: tech.user.id });
    expect((await own.agent.get(`${API}/tickets/${mine.id}`)).status).toBe(200);
    expect((await own.agent.patch(`${API}/tickets/${mine.id}`).send({ priority: 'low' })).status).toBe(200);
    for (const res of [
      await own.agent.get(`${API}/tickets/${theirs.id}`),
      await own.agent.patch(`${API}/tickets/${theirs.id}`).send({ priority: 'low' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: true, message: 'You do not have access to this ticket', code: 'FORBIDDEN' });
    }
  });

  it('department-tier sees their department plus anything assigned to them', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const inA = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptA.id });
    const inB = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptB.id });
    const inBMine = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptB.id, assigneeId: staff.user.id });
    expect((await staff.agent.get(`${API}/tickets/${inA.id}`)).status).toBe(200);
    expect((await staff.agent.get(`${API}/tickets/${inB.id}`)).status).toBe(403);
    expect((await staff.agent.get(`${API}/tickets/${inBMine.id}`)).status).toBe(200);
  });

  it('Q26: edit access follows the edit tier', async () => {
    const staff = await makeStaff('staff', w.deptA.id); // tickets view_department + edit_own
    const t = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptA.id });
    expect((await staff.agent.get(`${API}/tickets/${t.id}`)).status).toBe(200);
    const res = await staff.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'low' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have permission to edit this ticket', code: 'FORBIDDEN' });
  });
});

describe('PATCH /tickets/:id', () => {
  it('updates every allowed field', async () => {
    const team = await makeTeam(w.admin, 'Desk team', [{ userId: tech.user.id, isLead: false }]);
    const contact2 = await makeContact(w.admin, { firstName: 'Second' });
    const project = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const t = await makeTicket(tech.agent, base());
    const changes = {
      title: 'Renamed', description: 'New text', status: 'On Hold', priority: 'critical', type: 'change',
      assigneeId: tech.user.id, teamId: team.id, contactId: contact2.id, projectId: project.id,
      departmentId: w.deptB.id, dueDate: '2026-11-02', dueTime: '08:15:00', tags: ['x'], resolution: 'Swapped toner',
    };
    const { ticket } = expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send(changes));
    expect(ticket).toEqual(expect.objectContaining(changes));
    expect(expectOk(await tech.agent.get(`${API}/tickets/${t.id}`)).ticket).toEqual(expect.objectContaining(changes));
  });

  it('Q38: update refuses a blank or whitespace title, and trims a real one', async () => {
    const t = await makeTicket(tech.agent, base());
    for (const title of ['', '   ', null]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.patch(`${API}/tickets/${t.id}`).send({ title })).body)
        .toEqual({ error: true, message: 'Ticket title is required', code: 'VALIDATION_ERROR' });
    }
    expect(expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ title: '  New  ' })).ticket.title).toBe('New');
  });

  it('ignores fields that are not editable', async () => {
    const t = await makeTicket(tech.agent, base());
    const { ticket } = expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({
      createdBy: 999, resolvedAt: '2020-01-01T00:00:00Z', source: 'email', ticketNumber: '9',
    }));
    expect(ticket).toEqual(expect.objectContaining({
      createdBy: tech.user.id, resolvedAt: null, source: 'manual', ticketNumber: '00001',
    }));
  });

  it('clearing dueDate clears dueTime', async () => {
    const t = await makeTicket(tech.agent, { ...base(), dueDate: '2026-12-01', dueTime: '09:00:00' });
    const { ticket } = expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ dueDate: null }));
    expect(ticket).toEqual(expect.objectContaining({ dueDate: null, dueTime: null }));
    expect(await activityOf(tech.agent, t.id)).toEqual(expect.arrayContaining([['dueTime', '09:00:00', null]]));
  });

  it('Q27: clearing dueDate clears dueTime even when one is sent', async () => {
    const t = await makeTicket(tech.agent, { ...base(), dueDate: '2026-12-01', dueTime: '09:00:00' });
    const { ticket } = expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ dueDate: null, dueTime: '10:00:00' }));
    expect(ticket).toEqual(expect.objectContaining({ dueDate: null, dueTime: null }));
  });

  it('stamps who set the resolution and when', async () => {
    const t = await makeTicket(tech.agent, base());
    const { ticket } = expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ resolution: 'Fixed' }));
    expect(ticket.resolution).toBe('Fixed');
    expect(ticket.resolutionUpdatedBy).toBe(tech.user.id);
    expect(typeof ticket.resolutionUpdatedAt).toBe('string');
    expect(ticket.resolutionUpdatedByUser.id).toBe(tech.user.id);
  });

  it('keeps resolvedAt through closed→closed and clears it on reopen', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const t = await makeTicket(tech.agent, base());
    const patch = async (status) => expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ status })).ticket;
    expect((await patch('Request completed')).resolvedAt).toBe('2026-03-11T17:00:00.000Z');
    advanceClock(60 * 1000);
    expect((await patch('Closed')).resolvedAt).toBe('2026-03-11T17:00:00.000Z');
    expect((await patch('Open')).resolvedAt).toBeNull();
  });

  it('logs one entry per tracked field that really changed, with display values', async () => {
    const team = await makeTeam(w.admin, 'Desk team', [{ userId: tech.user.id, isLead: false }]);
    const t = await makeTicket(tech.agent, base());
    expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({
      status: 'Waiting on User', priority: 'high', type: 'incident', assigneeId: tech.user.id, teamId: team.id,
      // The ticket starts in the contact's department (A), so move it to B.
      departmentId: w.deptB.id, dueDate: '2026-12-01', dueTime: '09:00:00', title: 'Renamed',
    }));
    const activity = await activityOf(tech.agent, t.id);
    expect(activity).toEqual(expect.arrayContaining([
      ['created', null, null],
      ['status', 'Open', 'Waiting on User'],
      ['priority', 'medium', 'high'],
      ['type', 'request', 'incident'],
      ['assigneeId', null, 'Test tech'],
      ['teamId', null, 'Desk team'],
      ['departmentId', 'Service Desk', 'Facilities'],
      ['dueDate', null, '2026-12-01'],
      ['dueTime', null, '09:00:00'],
    ]));
    expect(activity).toHaveLength(9); // title is not a tracked field
  });

  it('writes no activity when a field is set to its current value', async () => {
    const t = await makeTicket(tech.agent, base());
    expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'medium' }));
    expect(await activityOf(tech.agent, t.id)).toEqual([['created', null, null]]);
  });

  it('PATCH a missing or non-numeric ticket', async () => {
    expect((await tech.agent.patch(`${API}/tickets/99999`).send({ priority: 'low' })).status).toBe(404);
    expect((await tech.agent.patch(`${API}/tickets/abc`).send({ priority: 'low' })).status).toBe(404);
  });
});

describe('DELETE /tickets/:id', () => {
  it('admin deletes a ticket and its time with it', async () => {
    const t = await makeTicket(w.admin.agent, base());
    expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/time`).send({ durationMinutes: 30 }), 201);
    expect(expectOk(await w.admin.agent.delete(`${API}/tickets/${t.id}`))).toEqual({ ok: true });
    expect((await w.admin.agent.get(`${API}/tickets/${t.id}`)).status).toBe(404);
    expect((await w.admin.agent.get(`${API}/tickets/${t.id}/time`)).status).toBe(404);
  });

  it('delete a missing ticket', async () => {
    const res = await w.admin.agent.delete(`${API}/tickets/99999`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Ticket not found');
  });

  it('Q28: delete re-checks access and the edit tier', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    await grantOverride(staff.user.id, 'tickets.delete', true);
    const hidden = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptB.id });
    expect((await staff.agent.delete(`${API}/tickets/${hidden.id}`)).body)
      .toEqual({ error: true, message: 'You do not have access to this ticket', code: 'FORBIDDEN' });
    const seen = await makeTicket(w.admin.agent, { ...base(), departmentId: w.deptA.id });
    expect((await staff.agent.delete(`${API}/tickets/${seen.id}`)).body)
      .toEqual({ error: true, message: 'You do not have permission to edit this ticket', code: 'FORBIDDEN' });
    expect((await w.admin.agent.get(`${API}/tickets/${seen.id}`)).status).toBe(200);
  });
});

describe('GET /tickets', () => {
  it('lists with the standard paginated shape, newest update first', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    for (const title of ['One', 'Two', 'Three']) {
      // eslint-disable-next-line no-await-in-loop
      await makeTicket(tech.agent, { ...base(), title });
      advanceClock(1000);
    }
    const body = expectOk(await tech.agent.get(`${API}/tickets`));
    expect(body).toEqual(expect.objectContaining({ page: 1, limit: 50, total: 3, totalPages: 1 }));
    expect(body.tickets.map((t) => t.title)).toEqual(['Three', 'Two', 'One']);
    body.tickets.forEach((t) => expect(t.timeLoggedMinutes).toBe(0));
  });

  describe('filters', () => {
    let ids;
    beforeEach(async () => {
      freezeClock('2026-03-11T17:00:00Z');
      const team = await makeTeam(w.admin, 'Desk team', [{ userId: tech.user.id, isLead: false }]);
      const contact2 = await makeContact(w.admin, { firstName: 'Second' });
      const project = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
      const a = w.admin.agent;
      const alpha = await makeTicket(a, {
        ...base(), title: 'Alpha', priority: 'high', type: 'incident', departmentId: w.deptA.id,
        assigneeId: tech.user.id, dueDate: '2026-03-10',
      });
      const bravo = await makeTicket(a, {
        ...base(), title: 'Bravo', priority: 'low', source: 'phone', departmentId: w.deptB.id, description: 'printer jam',
      });
      const charlie = await makeTicket(a, { ...base(), title: 'Charlie', projectId: project.id, dueDate: '2026-03-01' });
      expectOk(await a.patch(`${API}/tickets/${charlie.id}`).send({ status: 'Request completed' }));
      const delta = await makeTicket(a, { ...base(), title: 'Delta', teamId: team.id, contactId: contact2.id, dueDate: '2026-03-11' });
      ids = { tech: tech.user.id, project: project.id, deptB: w.deptB.id, contact2: contact2.id, team: team.id };
      expect([alpha.id, bravo.id, charlie.id, delta.id]).toEqual([1, 2, 3, 4]);
    });

    const cases = [
      ['status=Open', () => 'status=Open', ['Alpha', 'Bravo', 'Delta']],
      ['status=closed', () => 'status=closed', ['Charlie']],
      ['priority=high', () => 'priority=high', ['Alpha']],
      ['type=incident', () => 'type=incident', ['Alpha']],
      ['source=phone', () => 'source=phone', ['Bravo']],
      ['assignee', () => `assignee=${ids.tech}`, ['Alpha']],
      ['project', () => `project=${ids.project}`, ['Charlie']],
      ['department', () => `department=${ids.deptB}`, ['Bravo']],
      ['contactId', () => `contactId=${ids.contact2}`, ['Delta']],
      ['team', () => `team=${ids.team}`, ['Delta']],
      ['unassigned=true', () => 'unassigned=true', ['Bravo', 'Charlie', 'Delta']],
      ['overdue=true', () => 'overdue=true', ['Alpha']],
      ['overdue=true&status=Request completed', () => 'overdue=true&status=Request%20completed', ['Charlie']],
      ['search=jam', () => 'search=jam', ['Bravo']],
      ['search=#00002', () => 'search=%2300002', ['Bravo']],
      ['search=0002', () => 'search=0002', ['Bravo']],
    ];
    it.each(cases)('%s', async (_label, query, titles) => {
      const { tickets } = expectOk(await w.admin.agent.get(`${API}/tickets?${query()}`));
      expect(tickets.map((t) => t.title).sort()).toEqual(titles);
    });
  });

  it('myTickets pins the list to the caller', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    await makeTicket(w.admin.agent, { ...base(), title: 'Mine', assigneeId: tech.user.id });
    await makeTicket(w.admin.agent, { ...base(), title: 'Theirs', assigneeId: mgr.user.id });
    const { tickets } = expectOk(await tech.agent.get(`${API}/tickets?myTickets=true&assignee=${mgr.user.id}`));
    expect(tickets.map((t) => t.title)).toEqual(['Mine']);
  });

  it('sorts by column and direction', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    for (const title of ['Bravo', 'Charlie', 'Alpha']) {
      // eslint-disable-next-line no-await-in-loop
      await makeTicket(tech.agent, { ...base(), title });
      advanceClock(1000);
    }
    const byTitle = expectOk(await tech.agent.get(`${API}/tickets?sortBy=title&sortDir=asc`)).tickets;
    expect(byTitle.map((t) => t.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const fallback = expectOk(await tech.agent.get(`${API}/tickets?sortBy=nope`)).tickets;
    expect(fallback.map((t) => t.title)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('sorts by a number custom field numerically', async () => {
    expectOk(await w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Rank', fieldKey: 'rank', fieldType: 'number' }), 201);
    await makeTicket(tech.agent, { ...base(), title: 'Ten', customFieldValues: { rank: '10' } });
    await makeTicket(tech.agent, { ...base(), title: 'Nine', customFieldValues: { rank: '9' } });
    const { tickets } = expectOk(await tech.agent.get(`${API}/tickets?sortBy=cf:rank&sortDir=asc`));
    expect(tickets.map((t) => t.title)).toEqual(['Nine', 'Ten']);
  });

  it('scopes the list to the caller\'s tier', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    const staff = await makeStaff('staff', w.deptA.id);
    const a = w.admin.agent;
    await makeTicket(a, { ...base(), title: 'A unassigned', departmentId: w.deptA.id });
    await makeTicket(a, { ...base(), title: 'A own', departmentId: w.deptA.id, assigneeId: own.user.id });
    await makeTicket(a, { ...base(), title: 'B unassigned', departmentId: w.deptB.id });
    await makeTicket(a, { ...base(), title: 'B staff', departmentId: w.deptB.id, assigneeId: staff.user.id });
    const titles = async (u) => expectOk(await u.agent.get(`${API}/tickets`)).tickets.map((t) => t.title).sort();
    expect(await titles(own)).toEqual(['A own']);
    expect(await titles(staff)).toEqual(['A own', 'A unassigned', 'B staff']);
    expect(await titles(tech)).toEqual(['A own', 'A unassigned', 'B staff', 'B unassigned']);
  });
});

describe('GET /tickets/board', () => {
  it('has one column per non-archived status, in order', async () => {
    const { columns } = expectOk(await tech.agent.get(`${API}/tickets/board`));
    expect(columns.map((c) => c.status.name)).toEqual(['Open', 'Waiting on User', 'User responded', 'On Hold', 'Postponed', 'Request completed', 'Request cancelled', 'Closed']);
    columns.forEach((c) => expect(c).toEqual({ status: expect.any(Object), total: 0, limit: 100, tickets: [] }));
  });

  it('applies the list\'s filters and scope, ignoring status', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const a = w.admin.agent;
    await makeTicket(a, { ...base(), title: 'A high', departmentId: w.deptA.id, priority: 'high' });
    await makeTicket(a, { ...base(), title: 'A low', departmentId: w.deptA.id, priority: 'low' });
    await makeTicket(a, { ...base(), title: 'B high', departmentId: w.deptB.id, priority: 'high' });
    const { columns } = expectOk(await staff.agent.get(`${API}/tickets/board?priority=high&status=Closed`));
    const byStatus = Object.fromEntries(columns.map((c) => [c.status.name, c.tickets.map((t) => t.title)]));
    expect(byStatus.Open).toEqual(['A high']);
    expect(columns.reduce((n, c) => n + c.total, 0)).toBe(1);
  });
});
