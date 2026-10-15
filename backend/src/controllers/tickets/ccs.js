// Ticket CC list (spec 5a): addresses that get every public reply. Anyone
// who can see the ticket sees the list; anyone who can edit it manages it.
const { TicketCc, Contact } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const {
  findAccessibleTicket, canEditTicket, canAccessContact, parseRecordId,
} = require('../../services/permissionService');
const { isEmail } = require('../../services/email/recipients');

const MAX_CCS = 20;

const notFound = () => new ApiError(404, 'Ticket not found', 'NOT_FOUND');

async function ticketFor(req, { edit = false } = {}) {
  const ticket = await findAccessibleTicket(req.user, req.params.id);
  if (!ticket) throw notFound();
  if (edit && !(await canEditTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have permission to edit this ticket', 'FORBIDDEN');
  }
  return ticket;
}

// Only a contact the viewer may see is named; an address alone says nothing.
async function shape(cc, user) {
  const contact = cc.contactId ? await Contact.findByPk(cc.contactId) : null;
  const visible = contact && (await canAccessContact(user, contact));
  return {
    id: cc.id,
    email: cc.email,
    contact: visible ? { id: contact.id, name: contact.displayName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') } : null,
  };
}

// GET /tickets/:id/ccs
const listCcs = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const rows = await TicketCc.findAll({ where: { ticketId: ticket.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  const ccs = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const row of rows) ccs.push(await shape(row, req.user)); // eslint-disable-line no-await-in-loop
  res.json({ ccs });
});

// POST /tickets/:id/ccs { email }
const addCc = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req, { edit: true });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!isEmail(email)) throw new ApiError(400, 'A valid email address is required', 'VALIDATION_ERROR');
  if (await TicketCc.findOne({ where: { ticketId: ticket.id, email } })) {
    throw new ApiError(409, 'That address is already on the CC list', 'DUPLICATE');
  }
  if ((await TicketCc.count({ where: { ticketId: ticket.id } })) >= MAX_CCS) {
    throw new ApiError(400, `A ticket can have at most ${MAX_CCS} CC addresses`, 'VALIDATION_ERROR');
  }
  // Linked only to a contact the user can see.
  let contactId = null;
  // eslint-disable-next-line no-restricted-syntax
  for (const contact of await Contact.findAll({ where: { email }, order: [['id', 'ASC']] })) {
    // eslint-disable-next-line no-await-in-loop
    if (await canAccessContact(req.user, contact)) { contactId = contact.id; break; }
  }
  let cc;
  try {
    cc = await TicketCc.create({
      ticketId: ticket.id, email, contactId, addedById: req.user.id,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw new ApiError(409, 'That address is already on the CC list', 'DUPLICATE');
    throw err;
  }
  await writeAudit(req, 'ticketCc.add', 'Ticket', ticket.id, { email });
  res.status(201).json({ cc: await shape(cc, req.user) });
});

// DELETE /tickets/:id/ccs/:ccId
const removeCc = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req, { edit: true });
  const ccId = parseRecordId(req.params.ccId);
  const cc = ccId ? await TicketCc.findOne({ where: { id: ccId, ticketId: ticket.id } }) : null;
  if (!cc) throw new ApiError(404, 'CC address not found', 'NOT_FOUND');
  await cc.destroy();
  await writeAudit(req, 'ticketCc.remove', 'Ticket', ticket.id, { email: cc.email });
  res.json({ ok: true });
});

module.exports = { listCcs, addCc, removeCc };
