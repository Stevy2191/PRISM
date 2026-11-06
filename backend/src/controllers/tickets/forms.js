// Ticket forms (Playbooks, PB, task 7): read, answer, record and reveal
// secure values, skip, run the device action, and the PDF.
const { asyncHandler } = require('../../middleware/error');
const forms = require('../../services/playbooks/ticketForms');
const { streamFormPdf } = require('../../services/playbooks/formPdf');
const { ticketFor } = require('./playbooks');

// GET /tickets/:id/forms/:formId
const get = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req, { edit: false });
  res.json({ form: await forms.formView(await forms.loadTicketForm(ticket, req.params.formId)) });
});

// PATCH /tickets/:id/forms/:formId { answers }
const answer = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  res.json({ form: await forms.saveAnswers(req, ticket, req.params.formId, (req.body || {}).answers) });
});

// PUT /tickets/:id/forms/:formId/secrets/:key { value }
const setSecret = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  res.json({ form: await forms.setSecret(req, ticket, req.params.formId, req.params.key, (req.body || {}).value) });
});

// POST /tickets/:id/forms/:formId/secrets/:key/reveal
const reveal = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req, { edit: false });
  res.set('Cache-Control', 'no-store');
  res.json(await forms.revealSecret(req, ticket, req.params.formId, req.params.key));
});

// POST /tickets/:id/forms/:formId/skip { reason, notReturned?, markLost? }
const skip = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  res.json({ form: await forms.skip(req, ticket, req.params.formId, req.body || {}) });
});

// POST /tickets/:id/forms/:formId/action { contactId?, status?, holdReason?, revokeAgent?, generateForm? }
const action = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  res.json({ form: await forms.runAction(req, ticket, req.params.formId, req.body || {}) });
});

// GET /tickets/:id/forms/:formId/pdf
const pdf = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req, { edit: false });
  await streamFormPdf(res, ticket, await forms.loadTicketForm(ticket, req.params.formId));
});

module.exports = {
  get, answer, setSecret, reveal, skip, action, pdf,
};
