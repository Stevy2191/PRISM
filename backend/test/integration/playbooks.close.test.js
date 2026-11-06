const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTicket, makeTech,
} = require('./fixtures');
const { invalidateAllPermissions } = require('../../src/services/permissionService');

// Sub-project PB, task 8: no closing with unfinished forms; the override;
// merge carries forms over; uncovered devices only warn.

let w;
let company;
let jordan;
let ticket;
let closed;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'County' });
  jordan = await makeContact(w.admin, { companyId: company.id, firstName: 'Jordan', lastName: 'Reyes' });
  ticket = await makeTicket(w.admin.agent, { title: 'Termination: Jordan Reyes', contactId: jordan.id });
  closed = (await models.TicketStatus.findOne({ where: { behaviorType: 'closed' } })).name;
});
afterAll(closeDb);

async function applyChecklist(t = ticket) {
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Account', usage: 'ticket', definition: { sections: [{ key: 's', title: 'S', items: [{ key: 'disable', kind: 'step', body: 'Disable', required: true }] }] },
  }), 201).form;
  const playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({ name: 'Leaving', blocks: [{ formId: form.id, applies: 'once' }] }), 201).playbook;
  return expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/playbooks`).send({ playbookId: playbook.id }), 201).added.forms[0];
}
const setStatus = (agent, t, body) => agent.patch(`${API}/tickets/${t.id}`).send(body);

it('refuses to close from the ticket page and lists what is left', async () => {
  const tf = await applyChecklist();
  const res = await setStatus(w.admin.agent, ticket, { status: closed });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('FORMS_UNFINISHED');
  expect(res.body.blocking).toEqual([expect.objectContaining({ id: tf.id, formName: 'Account' })]);
  expect((await models.Ticket.findByPk(ticket.id)).status).not.toBe(closed);
});

it('closes once every form is finished or skipped', async () => {
  const tf = await applyChecklist();
  expectOk(await w.admin.agent.patch(`${API}/tickets/${ticket.id}/forms/${tf.id}`).send({ answers: { disable: true } }));
  expectOk(await setStatus(w.admin.agent, ticket, { status: closed }));
  // Saving the closed ticket again is fine.
  expectOk(await setStatus(w.admin.agent, ticket, { status: closed, priority: 'low' }));
});

it('bulk close is refused for that ticket too', async () => {
  await applyChecklist();
  const res = await w.admin.agent.post(`${API}/tickets/bulk`).send({ ids: [ticket.id], action: 'close' });
  expect((await models.Ticket.findByPk(ticket.id)).status).not.toBe(closed);
  expect(JSON.stringify(res.body)).toMatch(/unfinished form/);
});

it('a workflow rule cannot close it either; the rule log says why', async () => {
  await applyChecklist();
  expectOk(await w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Auto close', triggerEvent: 'ticket_updated', conditions: [], actions: [{ actionType: 'set_status', actionValue: { status: closed } }],
  }), 201);
  await setStatus(w.admin.agent, ticket, { priority: 'high' });
  expect((await models.Ticket.findByPk(ticket.id)).status).not.toBe(closed);
  const log = await models.WorkflowRuleLog.findOne({ order: [['id', 'DESC']] });
  expect(JSON.stringify(log)).toMatch(/unfinished form/);
});

it('close anyway: needs the permission and a reason, and is logged', async () => {
  await applyChecklist();
  const tech = await makeTech('tech1', w.deptA.id);
  await w.admin.agent.patch(`${API}/tickets/${ticket.id}`).send({ assigneeId: tech.user.id });
  expect((await setStatus(tech.agent, ticket, { status: closed, closeOverride: { reason: 'Done by phone' } })).status).toBe(403);
  expect((await setStatus(w.admin.agent, ticket, { status: closed, closeOverride: { reason: '  ' } })).status).toBe(409);
  expectOk(await setStatus(w.admin.agent, ticket, { status: closed, closeOverride: { reason: 'Done by phone' } }));
  const row = await models.TicketActivity.findOne({ where: { ticketId: ticket.id, action: 'close_override' } });
  expect(row.toValue).toBe('Done by phone');
  // The override permission can be granted to anyone.
  const other = await makeTicket(w.admin.agent, { title: 'Second', contactId: jordan.id });
  await applyChecklist(other);
  await w.admin.agent.patch(`${API}/tickets/${other.id}`).send({ assigneeId: tech.user.id });
  await models.UserPermissionOverride.create({ userId: tech.user.id, permissionKey: 'tickets.override_checklist', granted: true });
  invalidateAllPermissions();
  expectOk(await setStatus(tech.agent, other, { status: closed, closeOverride: { reason: 'Approved' } }));
});

it('a device no form covers only warns', async () => {
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Mac check-in', usage: 'device', definition: { sections: [{ key: 's', title: 'S', items: [{ key: 'w', kind: 'step', body: 'Wipe', required: true }] }] },
  }), 201).form;
  const macs = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  const playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'P', needsPerson: true, blocks: [{ formId: form.id, applies: 'person_devices', limits: { managed: true } }],
  }), 201).playbook;
  await models.Asset.create({ assetTag: 'U-1', name: 'Tablet', categoryId: macs.id, companyId: company.id, assignedToContactId: jordan.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/playbooks`).send({ playbookId: playbook.id, contactId: jordan.id }), 201);
  const check = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/close-check`));
  expect(check.blocking).toEqual([]);
  expect(check.warnings.map((d) => d.name)).toEqual(['Tablet']);
  expectOk(await setStatus(w.admin.agent, ticket, { status: closed }));
});

it('merge carries the forms to the target, so the sources still close', async () => {
  const source = await makeTicket(w.admin.agent, { title: 'Duplicate request', contactId: jordan.id });
  const tf = await applyChecklist(source);
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/merge`).send({ sourceIds: [source.id] }));
  const sourceStatus = (await models.Ticket.findByPk(source.id)).status;
  expect((await models.TicketStatus.findOne({ where: { name: sourceStatus } })).behaviorType).toBe('closed');
  const moved = await models.TicketForm.findByPk(tf.id);
  expect(moved.ticketId).toBe(ticket.id);
  expect((await models.Task.findByPk(moved.taskId)).ticketId).toBe(ticket.id);
  expect((await setStatus(w.admin.agent, ticket, { status: closed })).status).toBe(409);
});
