// A ticket's materials (Phase 3, step 2): parts and cable used on it, from
// the catalog, the shelf, or typed in. Anyone who may edit the ticket adds
// them; prices are seen and set only with a money permission.
const { ProjectMaterial } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../../services/ticketActivity');
const { findAccessibleTicket, parseRecordId, parseTicketId } = require('../../services/permissionService');
const { findTicketIdByNumber } = require('../../services/tickets/numbers');
const { assertCanEditTicket } = require('./shared');
const materials = require('../../services/money/materials');
const { D, unit, cents } = require('../../services/money/money');

async function loadTicket(req) {
  const id = (await findTicketIdByNumber(req.params.id)) || parseTicketId(req.params.id);
  const ticket = id ? await findAccessibleTicket(req.user, id) : null;
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  return ticket;
}
async function loadMaterial(req, ticket) {
  const m = await ProjectMaterial.findOne({ where: { id: parseRecordId(req.params.materialId) || 0, ticketId: ticket.id } });
  if (!m) throw new ApiError(404, 'Material not found', 'NOT_FOUND');
  return m;
}

// GET /tickets/:id/materials
const list = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  const rows = await ProjectMaterial.findAll({ where: { ticketId: ticket.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  const prices = await materials.canSeePrices(req.user);
  res.json({ materials: rows.map((m) => materials.materialJson(m, { canSeePrices: prices })) });
});

// POST /tickets/:id/materials { catalogProductId? | itemName, quantity, fromStock?, unitPrice?, unitCost?, billable?, serialNumber?, notes? }
const create = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  await assertCanEditTicket(req.user, ticket);
  const prices = await materials.canSeePrices(req.user);
  const m = await materials.addMaterial({ kind: 'ticket', record: ticket }, req.body || {}, { user: req.user, pricesAllowed: prices });
  await writeAudit(req, 'material.create', 'ProjectMaterial', m.id, { ticketId: ticket.id, itemName: m.itemName, quantity: m.quantity });
  await logActivity(ticket.id, req.user.id, 'material_added', null, `${unit(m.quantity).replace(/\.?0+$/, '')} × ${m.itemName}`).catch(() => {});
  res.status(201).json({ material: materials.materialJson(await ProjectMaterial.findByPk(m.id), { canSeePrices: prices }) });
});

// PATCH /tickets/:id/materials/:materialId { notes?, quantity? (not shelf items), unitPrice?/unitCost?/billable? (money permission) }
const update = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  await assertCanEditTicket(req.user, ticket);
  const m = await loadMaterial(req, ticket);
  if (m.billingStatus === 'billed') throw new ApiError(409, 'This material is on an invoice and can\'t be changed or removed', 'MATERIAL_BILLED');
  const body = req.body || {};
  const prices = await materials.canSeePrices(req.user);
  const changes = {};
  if (body.notes !== undefined) changes.notes = body.notes ? String(body.notes).slice(0, 5000) : null;
  if (body.quantity !== undefined) {
    if (m.fromStock) throw new ApiError(400, 'Remove a shelf item and add it again to change how much was used', 'VALIDATION_ERROR');
    changes.quantity = unit(materials.quantity(body.quantity));
  }
  if (['unitPrice', 'unitCost', 'billable'].some((k) => body[k] !== undefined) && !prices) {
    throw new ApiError(403, 'You need a money permission to change prices', 'FORBIDDEN');
  }
  const num = (v, label) => {
    if (v === null || v === '') return null;
    if (!/^\d{1,8}(\.\d{1,4})?$/.test(String(v))) throw new ApiError(400, `${label} must be an amount of 0 or more`, 'VALIDATION_ERROR');
    return String(v);
  };
  if (body.unitPrice !== undefined) changes.unitPrice = num(body.unitPrice, 'Unit price');
  if (body.unitCost !== undefined) changes.unitCost = cents(num(body.unitCost, 'Unit cost') || 0);
  if (body.billable !== undefined) {
    changes.billable = body.billable === true;
    changes.billingStatus = changes.billable ? 'unbilled' : 'non_billable';
  }
  const qty = changes.quantity ?? m.quantity;
  const cost = changes.unitCost ?? m.unitCost;
  changes.totalCost = cents(D(cost || 0).times(D(qty)));
  await m.update(changes);
  res.json({ material: materials.materialJson(m, { canSeePrices: prices }) });
});

// DELETE /tickets/:id/materials/:materialId — a shelf item goes back on the shelf.
const remove = asyncHandler(async (req, res) => {
  const ticket = await loadTicket(req);
  await assertCanEditTicket(req.user, ticket);
  const m = await loadMaterial(req, ticket);
  await materials.removeMaterial(m, { user: req.user });
  await writeAudit(req, 'material.delete', 'ProjectMaterial', m.id, { ticketId: ticket.id, itemName: m.itemName });
  res.json({ ok: true });
});

module.exports = {
  list, create, update, remove,
};
