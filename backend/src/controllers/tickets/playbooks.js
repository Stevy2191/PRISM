// Playbooks on a ticket (Playbooks, PB, task 6): what the Apply dialog
// offers, applying and removing, and the Tasks tab's view.
const { Playbook, Form, TicketPlaybookSuggestion } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessTicket } = require('../../services/permissionService');
const { assertCanEditTicket } = require('./shared');
const apply = require('../../services/playbooks/apply');
const { resolvePlaybook, offeredFor } = require('../../services/playbooks/resolve');
const { guessPerson } = require('../../services/playbooks/personGuess');
const { Ticket } = require('../../models');

async function ticketFor(req, { edit = true } = {}) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  if (edit) await assertCanEditTicket(req.user, ticket);
  return ticket;
}

const contactJson = (c) => ({
  id: c.id, displayName: c.displayName, email: c.email, departmentId: c.departmentId, status: c.status,
});

// GET /tickets/:id/playbooks → the ticket's applied playbooks, their forms
// with progress, its devices, the ones no form covers, and suggestions.
const view = asyncHandler(async (req, res) => {
  res.json(await apply.ticketPlaybooksView(await ticketFor(req, { edit: false })));
});

// GET /tickets/:id/playbooks/options?playbookId=&contactId=
// The playbooks offered for the ticket's company, the people the ticket
// seems to be about, and, for a chosen playbook and person, the person's
// devices with the form each would get.
const options = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const playbooks = (await Playbook.findAll({ where: { isActive: true }, order: [['position', 'ASC'], ['name', 'ASC']] }))
    .filter((p) => offeredFor(p, ticket.companyId))
    .map((p) => ({
      id: p.id, name: p.name, description: p.description, needsPerson: p.needsPerson,
    }));
  const guesses = (await guessPerson(ticket)).map(contactJson);
  const out = {
    playbooks, guesses, personDevices: [], uncovered: [], onceForms: [],
  };
  if (req.query.playbookId) {
    const playbook = await apply.findOffered(ticket, req.query.playbookId);
    const contact = req.query.contactId ? await (async () => {
      const { findAccessibleContact } = require('../../services/permissionService'); // eslint-disable-line global-require
      const c = await findAccessibleContact(req.user, req.query.contactId);
      if (!c || c.companyId !== ticket.companyId) throw new ApiError(400, "Choose a person from the ticket's company", 'VALIDATION_ERROR');
      return c;
    })() : null;
    const devices = contact ? await apply.personDevices(contact) : [];
    const { forms, uncovered } = resolvePlaybook(playbook, { personDevices: devices, ticketDevices: await apply.ticketDevices(ticket) });
    const names = new Map((await Form.findAll({ where: { id: forms.map((f) => f.formId) }, attributes: ['id', 'name'] })).map((f) => [f.id, f.name]));
    const formFor = new Map(forms.filter((f) => f.assetId).map((f) => [f.assetId, f]));
    const { assignedByAgent } = require('../../services/assets/checkouts'); // eslint-disable-line global-require
    out.personDevices = await Promise.all(devices.map(async (d) => ({
      asset: apply.assetJson(d),
      form: formFor.has(d.id) ? { id: formFor.get(d.id).formId, name: names.get(formFor.get(d.id).formId) } : null,
      assignedByAgent: await assignedByAgent(d),
    })));
    out.uncovered = uncovered.map(apply.assetJson);
    out.onceForms = forms.filter((f) => !f.assetId).map((f) => ({ id: f.formId, name: names.get(f.formId) }));
    out.ticketDeviceForms = forms.filter((f) => f.assetId && !devices.some((d) => d.id === f.assetId))
      .map((f) => ({ assetId: f.assetId, form: { id: f.formId, name: names.get(f.formId) } }));
  }
  res.json(out);
});

// POST /tickets/:id/playbooks { playbookId, contactId?, assetIds? }
const create = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const applied = await apply.applyPlaybook(req, ticket, req.body || {});
  const viewNow = await apply.ticketPlaybooksView(ticket);
  res.status(201).json({ ...viewNow, added: viewNow.applied.find((a) => a.id === applied.id) });
});

// DELETE /tickets/:id/playbooks/:tpId
const remove = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  await apply.removeApplied(req, ticket, req.params.tpId);
  res.json(await apply.ticketPlaybooksView(ticket));
});

// POST /tickets/:id/playbook-suggestions/:suggestionId/dismiss
const dismissSuggestion = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const s = await TicketPlaybookSuggestion.findOne({ where: { id: Number(req.params.suggestionId) || 0, ticketId: ticket.id } });
  if (!s) throw new ApiError(404, 'Suggestion not found', 'NOT_FOUND');
  if (!s.dismissedAt) await s.update({ dismissedAt: new Date() });
  res.json(await apply.ticketPlaybooksView(ticket));
});

module.exports = {
  view, options, create, remove, dismissSuggestion, ticketFor,
};
