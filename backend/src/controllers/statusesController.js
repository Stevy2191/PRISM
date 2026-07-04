const { TicketStatus, ProjectStatus, Ticket, Project, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

// Builds the list/create/update/delete/reorder handlers for one status
// scope (ticket or project) against its StatusModel + the EntityModel whose
// `status` column stores the status's `name`. Tickets and Projects are
// handled identically except for which two models are involved, so this
// factory avoids maintaining two near-duplicate controllers.
function buildStatusController(StatusModel, EntityModel, scopeLabel) {
  const list = asyncHandler(async (req, res) => {
    const statuses = await StatusModel.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] });
    res.json({ statuses });
  });

  const create = asyncHandler(async (req, res) => {
    const { name, color, behaviorType } = req.body || {};
    if (!name || !name.trim()) {
      throw new ApiError(400, 'Status name is required', 'VALIDATION_ERROR');
    }
    const allowedBehaviors = ['open', 'closed', 'archived'];
    const resolvedBehavior = allowedBehaviors.includes(behaviorType) ? behaviorType : 'open';
    const maxPosition = await StatusModel.max('position');
    const status = await StatusModel.create({
      name: name.trim(),
      color: color || '#3b82f6',
      behaviorType: resolvedBehavior,
      position: (Number.isFinite(maxPosition) ? maxPosition : -1) + 1,
    });
    await writeAudit(req, `${scopeLabel}Status.create`, StatusModel.name, status.id, { name: status.name });
    res.status(201).json({ status });
  });

  const update = asyncHandler(async (req, res) => {
    const status = await StatusModel.findByPk(req.params.id);
    if (!status) throw new ApiError(404, 'Status not found', 'NOT_FOUND');

    const { name, color, behaviorType } = req.body || {};
    const changes = {};
    if (color !== undefined) changes.color = color;
    if (behaviorType !== undefined) {
      if (!['open', 'closed', 'archived'].includes(behaviorType)) {
        throw new ApiError(400, 'Invalid behaviorType', 'VALIDATION_ERROR');
      }
      changes.behaviorType = behaviorType;
    }

    const oldName = status.name;
    if (name !== undefined && name.trim() && name.trim() !== oldName) {
      changes.name = name.trim();
    }

    await sequelize.transaction(async (t) => {
      await status.update(changes, { transaction: t });
      // Renaming a status is only meaningful if every entity currently
      // using the old name follows along, since the entity's `status`
      // column stores the display name directly (no separate FK/key).
      if (changes.name) {
        await EntityModel.update(
          { status: changes.name },
          { where: { status: oldName }, transaction: t }
        );
      }
    });

    await writeAudit(req, `${scopeLabel}Status.update`, StatusModel.name, status.id, changes);
    res.json({ status });
  });

  const remove = asyncHandler(async (req, res) => {
    const status = await StatusModel.findByPk(req.params.id);
    if (!status) throw new ApiError(404, 'Status not found', 'NOT_FOUND');
    if (status.isProtected) {
      throw new ApiError(400, 'This status is protected and cannot be deleted', 'PROTECTED_STATUS');
    }

    const defaultStatus = await StatusModel.findOne({ where: { isDefault: true } });
    if (!defaultStatus) {
      throw new ApiError(500, 'No default status configured to reassign affected records to', 'NO_DEFAULT_STATUS');
    }

    const affectedCount = await EntityModel.count({ where: { status: status.name } });

    await sequelize.transaction(async (t) => {
      if (affectedCount > 0) {
        await EntityModel.update(
          { status: defaultStatus.name },
          { where: { status: status.name }, transaction: t }
        );
      }
      await status.destroy({ transaction: t });
    });

    await writeAudit(req, `${scopeLabel}Status.delete`, StatusModel.name, req.params.id, {
      name: status.name,
      reassignedCount: affectedCount,
      reassignedTo: defaultStatus.name,
    });
    res.json({ ok: true, reassignedCount: affectedCount, reassignedTo: defaultStatus.name });
  });

  // PUT /.../reorder — body: { order: [id, id, id, ...] } in the new order.
  const reorder = asyncHandler(async (req, res) => {
    const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length) {
      throw new ApiError(400, 'order must be a non-empty array of status ids', 'VALIDATION_ERROR');
    }
    await sequelize.transaction(async (t) => {
      // eslint-disable-next-line no-restricted-syntax
      for (let i = 0; i < order.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await StatusModel.update({ position: i }, { where: { id: order[i] }, transaction: t });
      }
    });
    const statuses = await StatusModel.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] });
    res.json({ statuses });
  });

  return { list, create, update, remove, reorder };
}

const ticketStatuses = buildStatusController(TicketStatus, Ticket, 'ticket');
const projectStatuses = buildStatusController(ProjectStatus, Project, 'project');

module.exports = { ticketStatuses, projectStatuses };
