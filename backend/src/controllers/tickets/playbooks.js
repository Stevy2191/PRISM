// Playbooks on a ticket (Playbooks, PB, task 6): what the Apply dialog
// offers, applying and removing, and the Tasks tab's view.
const {
  Playbook, Form, FormVersion, TicketPlaybookSuggestion,
} = require('../../models');
const { evaluate } = require('../../services/playbooks/formDefinition');
const { deviceContext } = require('../../services/playbooks/resolve');
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

async function contactFor(req, ticket) {
  if (!req.query.contactId) return null;
  const { findAccessibleContact } = require('../../services/permissionService'); // eslint-disable-line global-require
  const c = await findAccessibleContact(req.user, req.query.contactId);
  if (!c || c.companyId !== ticket.companyId) throw new ApiError(400, "Choose a person from the ticket's company", 'VALIDATION_ERROR');
  return c;
}

// The definition's last item, when it checks the device out or in.
const finishAction = (def) => {
  const last = (def.sections || []).flatMap((s) => s.items).slice(-1)[0];
  return last && last.kind === 'action' ? last.action : null;
};
const stepCount = (def) => (def.sections || []).flatMap((s) => s.items).filter((i) => i.kind !== 'text' && i.kind !== 'action').length;

// The active checklists (PB2), each with what it's for, its steps and what
// it does when finished.
async function checklistOptions() {
  const forms = await Form.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
  const versions = new Map((await FormVersion.findAll({ where: { id: forms.map((f) => f.currentVersionId).filter(Boolean) } })).map((v) => [v.id, v]));
  return forms.filter((f) => versions.has(f.currentVersionId)).map((f) => {
    const def = versions.get(f.currentVersionId).definition;
    return {
      id: f.id, name: f.name, description: f.description, usage: f.usage, steps: stepCount(def), finish: finishAction(def),
    };
  });
}

// GET /tickets/:id/playbooks/options?playbookId=&contactId= (or formId=)
// The bundles offered for the ticket's company, the active checklists, the
// people the ticket seems to be about, and, for a chosen bundle and person,
// the person's devices with the checklist each would get. With formId (a
// device checklist), the person's devices with how many of its steps show
// for each.
const options = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const playbooks = (await Playbook.findAll({ where: { isActive: true }, order: [['position', 'ASC'], ['name', 'ASC']] }))
    .filter((p) => offeredFor(p, ticket.companyId))
    .map((p) => ({
      id: p.id, name: p.name, description: p.description, needsPerson: p.needsPerson,
    }));
  const guesses = (await guessPerson(ticket)).map(contactJson);
  // Bundles a rule or the ticket's category suggested, still open (PB2).
  const suggestedIds = new Set((await TicketPlaybookSuggestion.findAll({ where: { ticketId: ticket.id, dismissedAt: null }, attributes: ['playbookId'] })).map((s) => s.playbookId));
  const out = {
    playbooks,
    checklists: await checklistOptions(),
    suggestions: playbooks.filter((p) => suggestedIds.has(p.id)),
    suggestedPlaybookIds: playbooks.filter((p) => suggestedIds.has(p.id)).map((p) => p.id),
    guesses,
    personDevices: [],
    uncovered: [],
    onceForms: [],
  };
  if (req.query.formId) {
    const form = await apply.findChecklist(req.query.formId);
    const contact = await contactFor(req, ticket);
    if (form.usage === 'device') {
      const { definition } = await FormVersion.findByPk(form.currentVersionId);
      const { assignedByAgent } = require('../../services/assets/checkouts'); // eslint-disable-line global-require
      const devices = contact ? await apply.personDevices(contact) : [];
      out.personDevices = await Promise.all(devices.map(async (d) => {
        const state = evaluate(definition, { device: deviceContext(d), person: apply.personContext(contact) });
        const items = state.sections.flatMap((s) => (s.shown ? s.items : []));
        return {
          asset: apply.assetJson(d),
          form: { id: form.id, name: form.name },
          // Steps to work through: not notes, not the finish action.
          steps: { shown: items.filter((i) => i.shown && i.kind !== 'text' && i.kind !== 'action').length, hidden: items.filter((i) => !i.shown).length },
          assignedByAgent: await assignedByAgent(d),
        };
      }));
    }
  } else if (req.query.playbookId) {
    const playbook = await apply.findOffered(ticket, req.query.playbookId);
    const contact = await contactFor(req, ticket);
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

// POST /tickets/:id/checklists { formId, contactId?, assetIds? } (PB2)
const addChecklist = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const added = await apply.addChecklist(req, ticket, req.body || {});
  const viewNow = await apply.ticketPlaybooksView(ticket);
  const ids = new Set(added.map((f) => f.id));
  res.status(201).json({ ...viewNow, added: viewNow.otherForms.filter((f) => ids.has(f.id)) });
});

// DELETE /tickets/:id/checklists/:formId (PB2)
const removeChecklist = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  await apply.removeChecklist(req, ticket, req.params.formId);
  res.json(await apply.ticketPlaybooksView(ticket));
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

// GET /tickets/:id/close-check → { blocking, warnings }: what closing would
// be refused for (unfinished forms), and devices no form covers (a warning
// only), so the Close dialog can say so before trying.
const closeCheck = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req, { edit: false });
  const { checkClose } = require('../../services/playbooks/closeGuard'); // eslint-disable-line global-require
  res.json(await checkClose(ticket));
});

module.exports = {
  view, options, create, addChecklist, removeChecklist, remove, dismissSuggestion, ticketFor, closeCheck,
};
