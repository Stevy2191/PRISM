const { Op } = require('sequelize');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeContact, makeTicket, makeProject, makeTask,
  makeSubtask, setSettings, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Baseline for what ticket and project actions cause beyond their own
// record: audit rows, notifications, workflow-rule runs, CSAT surveys, and
// the "log time before closing" rule.

let w;
let tech;
let t;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

// No endpoint reads AuditLogs (GET /audit-log reads SystemAuditLogs), so
// these read the model directly.
const lastAudit = (action) => models.AuditLog.findOne({ where: { action }, order: [['id', 'DESC']], raw: true });
const auditCount = () => models.AuditLog.count({ where: { action: { [Op.ne]: 'auth.login' } } });
const tUrl = (path = '', ticket = t) => `${API}/tickets/${ticket.id}${path}`;
const ok = async (req, status = 200) => expectOk(await req, status);

describe('audit rows', () => {
  const project = () => makeProject(tech.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  const comment = () => ok(tech.agent.post(tUrl('/comments')).send({ body: 'hi' }), 201).then((b) => b.comment);
  const attachment = () => ok(tech.agent.post(tUrl('/attachments')).attach('file', Buffer.from('hello'), 'notes.txt'), 201)
    .then((b) => b.attachment);
  const ticketTime = () => ok(tech.agent.post(tUrl('/time')).send({ minutes: 45 }), 201).then((b) => b.entry);
  const projectTime = (p) => ok(tech.agent.post(`${API}/projects/${p.id}/time-entries`)
    .send({ startTime: '2026-01-05T09:00:00Z', endTime: '2026-01-05T10:00:00Z' }), 201).then((b) => b.entry);

  // Each row: [action, perform → { actor, entityType, entityId, meta }].
  const rows = [
    ['ticket.create', async () => {
      const n = await makeTicket(w.admin.agent, { title: 'New', contactId: w.contact.id });
      return { actor: w.admin, entityType: 'Ticket', entityId: n.id, meta: { title: 'New' } };
    }],
    ['ticket.update', async () => {
      await ok(tech.agent.patch(tUrl()).send({ priority: 'high' }));
      return { actor: tech, entityType: 'Ticket', entityId: t.id, meta: { priority: 'high' } };
    }],
    ['ticket.delete', async () => {
      await ok(w.admin.agent.delete(tUrl()));
      return { actor: w.admin, entityType: 'Ticket', entityId: t.id, meta: { title: 'Printer' } };
    }],
    ['comment.create', async () => {
      const c = await comment();
      return { actor: tech, entityType: 'Comment', entityId: c.id, meta: { ticketId: t.id, type: 'reply' } };
    }],
    ['comment.update', async () => {
      const c = await comment();
      await ok(tech.agent.patch(tUrl(`/comments/${c.id}`)).send({ body: 'edited' }));
      return { actor: tech, entityType: 'Comment', entityId: c.id, meta: { ticketId: t.id } };
    }],
    ['comment.delete', async () => {
      const c = await comment();
      await ok(tech.agent.delete(tUrl(`/comments/${c.id}`)));
      return { actor: tech, entityType: 'Comment', entityId: c.id, meta: { ticketId: t.id } };
    }],
    ['attachment.create', async () => {
      const a = await attachment();
      return { actor: tech, entityType: 'Attachment', entityId: a.id, meta: { ticketId: t.id, originalName: 'notes.txt' } };
    }],
    ['attachment.delete', async () => {
      const a = await attachment();
      await ok(tech.agent.delete(tUrl(`/attachments/${a.id}`)));
      return { actor: tech, entityType: 'Attachment', entityId: a.id, meta: { ticketId: t.id } };
    }],
    ['time.create', async () => {
      const e = await ticketTime();
      return { actor: tech, entityType: 'TimeEntry', entityId: e.id, meta: { ticketId: t.id, minutes: 45 } };
    }],
    ['time.delete', async () => {
      const e = await ticketTime();
      await ok(tech.agent.delete(tUrl(`/time/${e.id}`)));
      // The route parameter, so a string.
      return { actor: tech, entityType: 'TimeEntry', entityId: e.id, meta: { ticketId: String(t.id) } };
    }],
    ['relation.create', async () => {
      const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
      const { relation } = await ok(tech.agent.post(tUrl('/relations')).send({ relatedTicketId: t2.id }), 201);
      return {
        actor: tech, entityType: 'TicketRelation', entityId: relation.id,
        meta: { ticketId: t.id, relatedTicketId: t2.id, relationType: 'related' },
      };
    }],
    ['relation.delete', async () => {
      const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
      const { relation } = await ok(tech.agent.post(tUrl('/relations')).send({ relatedTicketId: t2.id }), 201);
      await ok(tech.agent.delete(tUrl(`/relations/${relation.id}`)));
      return { actor: tech, entityType: 'TicketRelation', entityId: relation.id, meta: { ticketId: String(t.id) } };
    }],
    ['csat.submit', async () => {
      await ok(tech.agent.patch(tUrl()).send({ status: 'Resolved' }));
      await ok(tech.agent.post(tUrl('/csat')).send({ rating: 'happy' }), 201);
      return { actor: tech, entityType: 'CsatResponse', entityId: t.id, meta: { rating: 'happy' } };
    }],
    ['timer.log', async () => {
      await ok(tech.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: t.id }), 201);
      const { entry } = await ok(tech.agent.post(`${API}/timer/stop`).send({}));
      return { actor: tech, entityType: 'TimeEntry', entityId: entry.id, meta: { ticketId: t.id, minutes: 1 } };
    }],
    ['project.create', async () => {
      const p = await project();
      return { actor: tech, entityType: 'Project', entityId: p.id, meta: { name: 'Refresh', projectCode: 'SD-P00001' } };
    }],
    ['project.update', async () => {
      const p = await project();
      await ok(tech.agent.patch(`${API}/projects/${p.id}`).send({ name: 'Renamed' }));
      return { actor: tech, entityType: 'Project', entityId: p.id, meta: { name: 'Renamed' } };
    }],
    ['project.delete', async () => {
      const p = await project();
      await ok(w.admin.agent.delete(`${API}/projects/${p.id}`));
      return { actor: w.admin, entityType: 'Project', entityId: p.id, meta: { name: 'Refresh' } };
    }],
    ['project_time.create', async () => {
      const p = await project();
      const e = await projectTime(p);
      return { actor: tech, entityType: 'ProjectTimeEntry', entityId: e.id, meta: { projectId: p.id, durationSeconds: 3600 } };
    }],
    ['project_time.delete', async () => {
      const p = await project();
      const e = await projectTime(p);
      await ok(tech.agent.delete(`${API}/projects/${p.id}/time-entries/${e.id}`));
      return { actor: tech, entityType: 'ProjectTimeEntry', entityId: e.id, meta: { projectId: String(p.id) } };
    }],
  ];

  it.each(rows)('%s', async (action, perform) => {
    const { actor, entityType, entityId, meta } = await perform();
    expect(await lastAudit(action)).toEqual(expect.objectContaining({
      userId: actor.user.id, entityType, entityId, meta,
    }));
  });

  // Each row: [mutation, setup → perform]. The audit count is read between
  // setup (which may audit, e.g. creating the project) and the one request.
  const proj = () => makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  const pUrl = (p, path) => `${API}/projects/${p.id}/${path}`;
  const unaudited = [
    ['watcher add', async () => () => ok(tech.agent.post(tUrl('/watchers')).send({ userId: tech.user.id }), 201)],
    ['watcher remove', async () => {
      await ok(tech.agent.post(tUrl('/watchers')).send({ userId: tech.user.id }), 201);
      return () => ok(tech.agent.delete(tUrl(`/watchers/${tech.user.id}`)));
    }],
    ['custom field values', async () => {
      await ok(w.admin.agent.post(`${API}/custom-fields`).send({ label: 'Tag', fieldKey: 'tag', fieldType: 'text' }), 201);
      return () => ok(tech.agent.patch(tUrl('/custom-field-values')).send({ values: { tag: 'x' } }));
    }],
    ['project task create', async () => { const p = await proj(); return () => makeTask(w.admin.agent, p.id); }],
    ['project task update', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id);
      return () => ok(w.admin.agent.patch(pUrl(p, `tasks/${k.id}`)).send({ title: 'x' }));
    }],
    ['project task delete', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id);
      return () => ok(w.admin.agent.delete(pUrl(p, `tasks/${k.id}`)));
    }],
    ['project task reorder', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id);
      return () => ok(w.admin.agent.patch(pUrl(p, 'tasks/reorder')).send({ order: [k.id] }));
    }],
    ['project task renumber', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id);
      return () => ok(w.admin.agent.patch(pUrl(p, `tasks/${k.id}/code`)).send({ number: 5 }));
    }],
    ['subtask create', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id);
      return () => makeSubtask(w.admin.agent, p.id, k.id);
    }],
    ['subtask update', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id); const s = await makeSubtask(w.admin.agent, p.id, k.id);
      return () => ok(w.admin.agent.patch(pUrl(p, `tasks/${k.id}/subtasks/${s.id}`)).send({ title: 'x' }));
    }],
    ['subtask delete', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id); const s = await makeSubtask(w.admin.agent, p.id, k.id);
      return () => ok(w.admin.agent.delete(pUrl(p, `tasks/${k.id}/subtasks/${s.id}`)));
    }],
    ['subtask renumber', async () => {
      const p = await proj(); const k = await makeTask(w.admin.agent, p.id); const s = await makeSubtask(w.admin.agent, p.id, k.id);
      return () => ok(w.admin.agent.patch(pUrl(p, `tasks/${k.id}/subtasks/${s.id}/code`)).send({ number: 5 }));
    }],
    ['expense create', async () => {
      const p = await proj();
      return () => ok(w.admin.agent.post(pUrl(p, 'expenses')).send({ description: 'x', amount: 1 }), 201);
    }],
    ['expense update', async () => {
      const p = await proj();
      const { expense } = await ok(w.admin.agent.post(pUrl(p, 'expenses')).send({ description: 'x', amount: 1 }), 201);
      return () => ok(w.admin.agent.patch(pUrl(p, `expenses/${expense.id}`)).send({ amount: 2 }));
    }],
    ['expense delete', async () => {
      const p = await proj();
      const { expense } = await ok(w.admin.agent.post(pUrl(p, 'expenses')).send({ description: 'x', amount: 1 }), 201);
      return () => ok(w.admin.agent.delete(pUrl(p, `expenses/${expense.id}`)));
    }],
    ['material create', async () => {
      const p = await proj();
      return () => ok(w.admin.agent.post(pUrl(p, 'materials')).send({ itemName: 'x' }), 201);
    }],
    ['material update', async () => {
      const p = await proj();
      const { material } = await ok(w.admin.agent.post(pUrl(p, 'materials')).send({ itemName: 'x' }), 201);
      return () => ok(w.admin.agent.patch(pUrl(p, `materials/${material.id}`)).send({ quantity: 2 }));
    }],
    ['material delete', async () => {
      const p = await proj();
      const { material } = await ok(w.admin.agent.post(pUrl(p, 'materials')).send({ itemName: 'x' }), 201);
      return () => ok(w.admin.agent.delete(pUrl(p, `materials/${material.id}`)));
    }],
    ['member add', async () => {
      const p = await proj();
      return () => ok(w.admin.agent.post(pUrl(p, 'members')).send({ userId: tech.user.id }), 201);
    }],
    ['member remove', async () => {
      const p = await proj();
      await ok(w.admin.agent.post(pUrl(p, 'members')).send({ userId: tech.user.id }), 201);
      return () => ok(w.admin.agent.delete(pUrl(p, `members/${tech.user.id}`)));
    }],
    ['project file upload', async () => {
      const p = await proj();
      return () => ok(w.admin.agent.post(pUrl(p, 'files')).attach('file', Buffer.from('hello'), 'notes.txt'), 201);
    }],
    ['project file delete', async () => {
      const p = await proj();
      const { file } = await ok(w.admin.agent.post(pUrl(p, 'files')).attach('file', Buffer.from('hello'), 'notes.txt'), 201);
      return () => ok(w.admin.agent.delete(pUrl(p, `files/${file.id}`)));
    }],
  ];

  // Likely correct: every mutating endpoint is audited (roadmap rule 6). Expected to change in sub-project 3.
  it.each(unaudited)('[quirk] Q23: %s writes no audit row', async (_label, setup) => {
    const perform = await setup();
    const before = await auditCount();
    await perform();
    expect(await auditCount()).toBe(before);
  });
});

describe('notifications', () => {
  const inbox = async (u) => expectOk(await u.agent.get(`${API}/notifications`)).notifications.map((n) => [n.type, n.message]);
  const watch = (u) => ok(w.admin.agent.post(tUrl('/watchers')).send({ userId: u.user.id }), 201);

  it('notifies the assignee of a new ticket, not someone assigning themselves', async () => {
    await makeTicket(tech.agent, { title: 'Self', contactId: w.contact.id, assigneeId: tech.user.id });
    expect(await inbox(tech)).toEqual([['assigned', 'Ticket assigned to you: Printer']]);
  });

  it('notifies the new assignee on reassignment, once', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    await ok(w.admin.agent.patch(tUrl()).send({ assigneeId: mgr.user.id }));
    await ok(w.admin.agent.patch(tUrl()).send({ assigneeId: mgr.user.id }));
    expect(await inbox(mgr)).toEqual([['assigned', 'Ticket assigned to you: Printer']]);
  });

  it('notifies watchers of a new ticket, never the creator', async () => {
    const watcher = await makeTech('watcher', w.deptA.id);
    await makeTicket(w.admin.agent, { title: 'Watched', contactId: w.contact.id, watcherIds: [watcher.user.id, w.admin.user.id] });
    expect(await inbox(watcher)).toEqual([['watcher_update', 'Ticket created: Watched']]);
    expect(await inbox(w.admin)).toEqual([]);
  });

  it('notifies watchers of a status change, but not the actor or assignee', async () => {
    const watcher = await makeTech('watcher', w.deptA.id);
    await watch(watcher);
    await watch(tech);
    await ok(w.admin.agent.patch(tUrl()).send({ status: 'In Progress' }));
    expect(await inbox(watcher)).toEqual([['watcher_update', 'Status changed to "In Progress" on ticket: Printer']]);
    expect(await inbox(tech)).toEqual([['assigned', 'Ticket assigned to you: Printer']]);
  });

  it('notifies the assignee and watchers of a comment', async () => {
    const watcher = await makeTech('watcher', w.deptA.id);
    await watch(watcher);
    await ok(w.admin.agent.post(tUrl('/comments')).send({ body: 'x'.repeat(100) }), 201);
    expect(await inbox(tech)).toContainEqual(['comment', `Someone commented on ticket: ${'x'.repeat(80)}…`]);
    expect(await inbox(watcher)).toEqual([['watcher_update', "Someone commented on ticket you're watching: Printer"]]);
  });

  it('an internal comment reaches the assignee only', async () => {
    const watcher = await makeTech('watcher', w.deptA.id);
    await watch(watcher);
    await ok(w.admin.agent.post(tUrl('/comments')).send({ body: 'note', type: 'comment_private' }), 201);
    expect(await inbox(tech)).toContainEqual(['reply', 'Internal comment added to ticket: Printer']);
    expect(await inbox(watcher)).toEqual([]);
  });

  it('the enabled-types setting silences other types', async () => {
    await setSettings(w.admin, { 'notifications.enabledTypes': JSON.stringify(['comment']) });
    const quiet = await makeTicket(w.admin.agent, { title: 'Quiet', contactId: w.contact.id, assigneeId: tech.user.id });
    await ok(w.admin.agent.post(tUrl('/comments', quiet)).send({ body: 'hello' }), 201);
    const got = await inbox(tech);
    expect(got).not.toContainEqual(['assigned', 'Ticket assigned to you: Quiet']);
    expect(got).toContainEqual(['comment', 'Someone commented on ticket: hello']);
    expect(got).toContainEqual(['assigned', 'Ticket assigned to you: Printer']);
  });

  it('derives an overdue notification once', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const late = await makeTech('late', w.deptA.id);
    await makeTicket(w.admin.agent, { title: 'Late', contactId: w.contact.id, assigneeId: late.user.id, dueDate: '2026-03-10' });
    await inbox(late);
    const overdue = (await inbox(late)).filter(([type]) => type === 'overdue');
    expect(overdue).toEqual([['overdue', 'Ticket is now overdue: Late']]);
  });

  it('derives due-soon only for tickets on a project', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const soon = await makeTech('soon', w.deptA.id);
    const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    await makeTicket(w.admin.agent, { title: 'On project', contactId: w.contact.id, assigneeId: soon.user.id, dueDate: '2026-03-12', projectId: p.id });
    await makeTicket(w.admin.agent, { title: 'Loose', contactId: w.contact.id, assigneeId: soon.user.id, dueDate: '2026-03-12' });
    const dueSoon = (await inbox(soon)).filter(([type]) => type === 'due_soon');
    expect(dueSoon).toEqual([['due_soon', 'Task due date approaching: On project']]);
  });

  it('read-all empties the unread list', async () => {
    expect(await inbox(tech)).toHaveLength(1);
    await ok(tech.agent.patch(`${API}/notifications/read-all`));
    expect(await inbox(tech)).toEqual([]);
  });
});

describe('workflow rules', () => {
  const makeRule = async (body) => (await ok(w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Rule', actions: [{ actionType: 'add_tag', actionValue: { tag: 'wf' } }], ...body,
  }), 201)).rule;
  const logsOf = async (rule) => (await ok(w.admin.agent.get(`${API}/workflow-rules/${rule.id}/logs`))).logs;
  const tagsOf = async (ticket) => (await ok(w.admin.agent.get(tUrl('', ticket)))).ticket.tags;

  const triggers = [
    ['ticket_created', async () => makeTicket(w.admin.agent, { title: 'WF', contactId: w.contact.id }), null],
    ['ticket_updated', async () => { await ok(tech.agent.patch(tUrl()).send({ priority: 'high' })); return t; }, 'changed: priority'],
    ['ticket_status_changed', async () => { await ok(tech.agent.patch(tUrl()).send({ status: 'In Progress' })); return t; }, null],
    ['ticket_priority_changed', async () => { await ok(tech.agent.patch(tUrl()).send({ priority: 'high' })); return t; }, null],
    ['ticket_assigned', async () => { await ok(tech.agent.patch(tUrl()).send({ assigneeId: w.admin.user.id })); return t; }, null],
    ['ticket_comment_added', async () => { await ok(tech.agent.post(tUrl('/comments')).send({ body: 'hi' }), 201); return t; }, null],
    ['ticket_closed', async () => { await ok(tech.agent.patch(tUrl()).send({ status: 'Resolved' })); return t; }, null],
  ];

  it.each(triggers)('%s runs its rules', async (triggerEvent, perform, notes) => {
    const rule = await makeRule({ triggerEvent });
    const target = await perform();
    expect(await tagsOf(target)).toContain('wf');
    const logs = await logsOf(rule);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(expect.objectContaining({ conditionsMet: true, actionsExecuted: ['add_tag'], notes }));
  });

  it('ticket_closed fires on entering a closed status only', async () => {
    const rule = await makeRule({ triggerEvent: 'ticket_closed' });
    await ok(tech.agent.patch(tUrl()).send({ status: 'Resolved' }));
    await ok(tech.agent.patch(tUrl()).send({ status: 'Closed' }));
    expect(await logsOf(rule)).toHaveLength(1);
  });

  it('an unmet condition is logged but does nothing', async () => {
    const rule = await makeRule({
      triggerEvent: 'ticket_updated', conditions: [{ field: 'priority', operator: 'equals', value: 'high' }],
    });
    await ok(tech.agent.patch(tUrl()).send({ title: 'x' }));
    expect(await logsOf(rule)).toEqual([expect.objectContaining({ conditionsMet: false, actionsExecuted: null })]);
    expect(await tagsOf(t)).toBeNull();
  });

  it('an inactive rule never runs', async () => {
    const rule = await makeRule({ triggerEvent: 'ticket_updated', isActive: false });
    await ok(tech.agent.patch(tUrl()).send({ priority: 'high' }));
    expect(await logsOf(rule)).toEqual([]);
  });

  // Likely correct: the ticket is escalated (ticket priorities have no
  // "urgent", so the whole update fails). Expected to change in sub-project 3.
  it('[quirk] Q16: escalate_to_user always fails', async () => {
    const rule = await makeRule({
      triggerEvent: 'ticket_created', actions: [{ actionType: 'escalate_to_user', actionValue: { userId: tech.user.id } }],
    });
    const n = await makeTicket(w.admin.agent, { title: 'Escalate me', contactId: w.contact.id });
    expect(n).toEqual(expect.objectContaining({ assigneeId: null, priority: 'medium' }));
    const [log] = await logsOf(rule);
    expect(log).toEqual(expect.objectContaining({ conditionsMet: true, actionsExecuted: null }));
    expect(log.notes).toContain("Data truncated for column 'priority'");
  });
});

describe('CSAT surveys', () => {
  const surveyOf = async (ticket = t) => (await ok(w.admin.agent.get(tUrl('', ticket)))).ticket.csatSurvey;
  const setStatus = (status, ticket = t) => ok(w.admin.agent.patch(tUrl('', ticket)).send({ status }));

  it('no survey while surveys are off', async () => {
    await setStatus('Resolved');
    expect(await surveyOf()).toBeNull();
  });

  it('closing creates one pending survey, token hidden', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    await setSettings(w.admin, { 'csat.enabled': 'true', 'csat.sendDelayHours': '2' });
    await setStatus('Resolved');
    const survey = await surveyOf();
    expect(survey).toEqual(expect.objectContaining({
      status: 'pending', contactId: w.contact.id, assignedToUserId: tech.user.id, dueToSendAt: '2026-03-11T19:00:00.000Z',
    }));
    expect(survey).not.toHaveProperty('surveyToken');
  });

  it('reopening and re-closing doesn\'t make a second survey', async () => {
    await setSettings(w.admin, { 'csat.enabled': 'true' });
    await setStatus('Resolved');
    const first = await surveyOf();
    await setStatus('Open');
    await setStatus('Closed');
    expect((await surveyOf()).id).toBe(first.id);
  });

  it('no survey for a contact without email', async () => {
    await setSettings(w.admin, { 'csat.enabled': 'true' });
    const quiet = await makeContact(w.admin, { firstName: 'Quiet', email: null });
    const q = await makeTicket(w.admin.agent, { title: 'Quiet', contactId: quiet.id });
    await setStatus('Resolved', q);
    expect(await surveyOf(q)).toBeNull();
  });
});

describe('time before close', () => {
  const requireTime = () => setSettings(w.admin, { 'timeTracking.requireBeforeClose': 'true' });

  it('requireBeforeClose blocks closing with no time', async () => {
    await requireTime();
    const res = await tech.agent.patch(tUrl()).send({ status: 'Resolved' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: true, message: 'Log time on this ticket before closing it', code: 'TIME_REQUIRED_BEFORE_CLOSE' });
    expect((await ok(tech.agent.get(tUrl()))).ticket.status).toBe('Open');
  });

  it('requireBeforeClose allows closing once time is logged', async () => {
    await requireTime();
    await ok(tech.agent.post(tUrl('/time')).send({ minutes: 5 }), 201);
    expect((await tech.agent.patch(tUrl()).send({ status: 'Resolved' })).status).toBe(200);
  });

  it('requireBeforeClose ignores closed→closed and non-status edits', async () => {
    await requireTime();
    const x = await makeTicket(tech.agent, { title: 'X', contactId: w.contact.id, status: 'Resolved' });
    expect((await tech.agent.patch(tUrl('', x)).send({ status: 'Closed' })).status).toBe(200);
    expect((await tech.agent.patch(tUrl()).send({ priority: 'low' })).status).toBe(200);
  });

  // Likely correct: 400 TIME_REQUIRED_BEFORE_CLOSE, as on update. Expected to change in sub-project 3.
  it('[quirk] Q35: creating a ticket already closed bypasses requireBeforeClose', async () => {
    await requireTime();
    const res = await tech.agent.post(`${API}/tickets`).send({ title: 'Closed', contactId: w.contact.id, status: 'Closed' });
    expect(res.status).toBe(201);
  });

  it('with the setting off, tickets close freely', async () => {
    expect((await tech.agent.patch(tUrl()).send({ status: 'Resolved' })).status).toBe(200);
  });
});
