const {
  TicketStatus, ProjectStatus, Ticket, Project, TicketActivity, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { syncTicketSla } = require('../services/sla/ticketSla');
const { logActivity } = require('../services/ticketActivity');
const { shownStatusName } = require('../services/waitingTime');

// Builds the list/create/update/delete/reorder handlers for one status
// scope (ticket or project) against its StatusModel + the EntityModel whose
// `status` column stores the status's `name`. Tickets and Projects are
// handled identically except for which two models are involved, so this
// factory avoids maintaining two near-duplicate controllers.
function buildStatusController(StatusModel, EntityModel, scopeLabel) {
  // Only ticket statuses have the "on hold" kind (user decision 2026-10-15).
  const KINDS = EntityModel.name === 'Ticket' ? ['open', 'on_hold', 'closed', 'archived'] : ['open', 'closed', 'archived'];
  // SLA clocks run while a ticket's status is open-behaviour; bulk status
  // writes skip the Ticket hooks, so re-sync the tickets they touched.
  const tracksSla = EntityModel.name === 'Ticket';
  const syncSla = async (ticketIds) => {
    // eslint-disable-next-line no-restricted-syntax
    for (const id of ticketIds) await syncTicketSla(id); // eslint-disable-line no-await-in-loop
  };
  // "Counts as waiting on the customer" (user decision 2026-10-15) is a
  // ticket-status switch; Waiting on User always counts.
  const readWaiting = (body, status = null) => {
    if (!tracksSla || body.countsAsWaiting === undefined) return undefined;
    if (typeof body.countsAsWaiting !== 'boolean') {
      throw new ApiError(400, 'countsAsWaiting must be true or false', 'VALIDATION_ERROR');
    }
    if (status && status.systemKey === 'waiting_on_user' && !body.countsAsWaiting) {
      throw new ApiError(400, 'Waiting on User always counts as waiting on the customer', 'VALIDATION_ERROR');
    }
    return body.countsAsWaiting;
  };
  const idsInStatus = async (name) => (tracksSla
    ? (await EntityModel.findAll({ where: { status: name }, attributes: ['id'] })).map((r) => r.id)
    : []);

  const list = asyncHandler(async (req, res) => {
    const statuses = await StatusModel.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] });
    res.json({ statuses });
  });

  const create = asyncHandler(async (req, res) => {
    const { name, color, behaviorType } = req.body || {};
    if (!name || !name.trim()) {
      throw new ApiError(400, 'Status name is required', 'VALIDATION_ERROR');
    }
    if (behaviorType !== undefined && !KINDS.includes(behaviorType)) {
      throw new ApiError(400, 'Invalid behaviorType', 'VALIDATION_ERROR');
    }
    const resolvedBehavior = behaviorType || 'open';
    const countsAsWaiting = readWaiting(req.body || {});
    const maxPosition = await StatusModel.max('position');
    const status = await StatusModel.create({
      name: name.trim(),
      color: color || '#3b82f6',
      behaviorType: resolvedBehavior,
      position: (Number.isFinite(maxPosition) ? maxPosition : -1) + 1,
      ...(countsAsWaiting !== undefined ? { countsAsWaiting } : {}),
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
    const countsAsWaiting = readWaiting(req.body || {}, status);
    if (countsAsWaiting !== undefined) changes.countsAsWaiting = countsAsWaiting;
    if (behaviorType !== undefined) {
      if (!KINDS.includes(behaviorType)) {
        throw new ApiError(400, 'Invalid behaviorType', 'VALIDATION_ERROR');
      }
      // Replies move tickets into the automatic statuses: making one closed
      // would close tickets silently.
      if (status.systemKey && behaviorType !== status.behaviorType) {
        throw new ApiError(400, 'This status is set automatically and keeps its kind', 'VALIDATION_ERROR');
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
        // The waiting-on-customer figure reads status names from the
        // activity log, so the log follows the rename too (written in
        // its display form, as the log stores it).
        if (tracksSla) {
          const [from, to] = [shownStatusName(oldName), shownStatusName(changes.name)];
          await TicketActivity.update({ fromValue: to }, { where: { action: 'status', fromValue: from }, transaction: t });
          await TicketActivity.update({ toValue: to }, { where: { action: 'status', toValue: from }, transaction: t });
        }
      }
    });

    if (changes.behaviorType !== undefined) await syncSla(await idsInStatus(status.name));
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
    const movedIds = await idsInStatus(status.name);

    await sequelize.transaction(async (t) => {
      if (affectedCount > 0) {
        await EntityModel.update(
          { status: defaultStatus.name },
          { where: { status: status.name }, transaction: t }
        );
      }
      await status.destroy({ transaction: t });
    });
    await syncSla(movedIds);
    // eslint-disable-next-line no-restricted-syntax
    for (const id of movedIds) await logActivity(id, req.user.id, 'status', shownStatusName(status.name), shownStatusName(defaultStatus.name)); // eslint-disable-line no-await-in-loop

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
