const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany,
} = require('./fixtures');
const { executeAction } = require('../../src/services/workflowEngine');

// Sub-project PB, task 9: workflow rules suggest a playbook; they never
// apply one.

let w;
let playbook;
let termination;

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({
    name: 'Account', usage: 'ticket', definition: { sections: [{ key: 's', title: 'S', items: [{ key: 'd', kind: 'step', body: 'Disable', required: true }] }] },
  }), 201).form;
  playbook = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({ name: 'Account termination', blocks: [{ formId: form.id, applies: 'once' }] }), 201).playbook;
  termination = expectOk(await w.admin.agent.post(`${API}/ticket-categories`).send({ name: 'Termination' }), 201).category;
  expectOk(await w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Termination requests',
    triggerEvent: 'ticket_created',
    conditions: [{ field: 'category', operator: 'is', value: String(termination.id) }],
    actions: [{ actionType: 'suggest_playbook', actionValue: { playbookId: playbook.id } }],
  }), 201);
});
afterAll(closeDb);

const newTicket = async (body) => expectOk(await w.admin.agent.post(`${API}/tickets`).send({ contactId: w.contact.id, ...body }), 201).ticket;
const suggestions = async (t) => expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}/playbooks`)).suggestions;

it('a matching rule suggests the playbook, and nothing is applied', async () => {
  const t = await newTicket({ title: 'Termination: Jordan Reyes', categoryId: termination.id });
  // Rules run before the create call returns.
  expect((await suggestions(t)).map((s) => s.playbook.name)).toEqual(['Account termination']);
  expect(await models.TicketPlaybook.count({ where: { ticketId: t.id } })).toBe(0);
  const other = await newTicket({ title: 'Printer jam' });
  expect(await suggestions(other)).toEqual([]);
});

it('a second match does not duplicate; dismissed stays dismissed; applying hides it', async () => {
  const t = await newTicket({ title: 'Termination', categoryId: termination.id });
  const action = { actionType: 'suggest_playbook', actionValue: { playbookId: playbook.id } };
  await executeAction(await models.Ticket.findByPk(t.id), action, null);
  expect(await models.TicketPlaybookSuggestion.count({ where: { ticketId: t.id } })).toBe(1);

  const [s] = await suggestions(t);
  expect(expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/playbook-suggestions/${s.id}/dismiss`)).suggestions).toEqual([]);
  await executeAction(await models.Ticket.findByPk(t.id), action, null);
  expect(await suggestions(t)).toEqual([]);

  const t2 = await newTicket({ title: 'Termination 2', categoryId: termination.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${t2.id}/playbooks`).send({ playbookId: playbook.id }), 201);
  expect(await suggestions(t2)).toEqual([]);
});

it('not suggested for a company the playbook is not offered for', async () => {
  const other = await makeCompany(w.admin, { name: 'Elsewhere' });
  expectOk(await w.admin.agent.put(`${API}/playbooks/${playbook.id}`).send({ companyIds: [other.id] }));
  const t = await newTicket({ title: 'Termination', categoryId: termination.id });
  expect(await suggestions(t)).toEqual([]);
});

it('a rule must name an active playbook', async () => {
  const bad = await w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Bad', triggerEvent: 'ticket_created', conditions: [], actions: [{ actionType: 'suggest_playbook', actionValue: { playbookId: 999999 } }],
  });
  expect(bad.status).toBe(400);
  expectOk(await w.admin.agent.patch(`${API}/playbooks/${playbook.id}`).send({ isActive: false }));
  const off = await w.admin.agent.post(`${API}/workflow-rules`).send({
    name: 'Off', triggerEvent: 'ticket_created', conditions: [], actions: [{ actionType: 'suggest_playbook', actionValue: { playbookId: playbook.id } }],
  });
  expect(off.status).toBe(400);
});
