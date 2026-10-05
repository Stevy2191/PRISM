// Ticket custom field values: read and update.
const { Ticket, CustomField, TicketFieldValue, sequelize } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { logActivity } = require('../../services/ticketActivity');
const { canAccessTicket } = require('../../services/permissionService');
const { syncCustomFieldValues, buildCustomFieldsObject } = require('./shared');

// ---- Custom field values (admin-defined, Settings -> Layouts & Fields) ----

// GET /tickets/:id/custom-field-values
const getCustomFieldValues = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id, {
    include: [{ model: TicketFieldValue, as: 'fieldValues', include: [{ model: CustomField, as: 'field' }] }],
  });
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  res.json({ customFields: buildCustomFieldsObject(ticket.fieldValues) });
});

// PATCH /tickets/:id/custom-field-values — Body: { values: { fieldKey: value, ... } }
const updateCustomFieldValues = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  const values = req.body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ApiError(400, 'values must be an object of { fieldKey: value }', 'VALIDATION_ERROR');
  }

  await sequelize.transaction((t) => syncCustomFieldValues(ticket.id, values, t));
  await logActivity(ticket.id, req.user.id, 'custom_fields', null, null);

  const fresh = await Ticket.findByPk(ticket.id, {
    include: [{ model: TicketFieldValue, as: 'fieldValues', include: [{ model: CustomField, as: 'field' }] }],
  });
  res.json({ customFields: buildCustomFieldsObject(fresh.fieldValues) });
});

module.exports = {
  getCustomFieldValues,
  updateCustomFieldValues,
};
