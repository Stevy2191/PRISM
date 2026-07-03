const { User, Ticket, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

// PATCH /customers/:id/department { departmentId }
// Sets the customer's own department and retroactively updates every
// existing ticket they requested to match, so their history stays consistent.
const updateDepartment = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = await User.findByPk(id);
  if (!customer) throw new ApiError(404, 'Customer not found', 'NOT_FOUND');

  const { departmentId } = req.body || {};
  if (!departmentId) {
    throw new ApiError(400, 'departmentId is required', 'VALIDATION_ERROR');
  }

  const ticketCount = await sequelize.transaction(async (t) => {
    await customer.update({ departmentId }, { transaction: t });
    const [affected] = await Ticket.update(
      { departmentId },
      { where: { requesterId: id }, transaction: t }
    );
    return affected;
  });

  await writeAudit(req, 'customer.assign_department', 'User', customer.id, { departmentId, ticketCount });

  res.json({ user: customer, ticketsUpdated: ticketCount });
});

module.exports = { updateDepartment };
