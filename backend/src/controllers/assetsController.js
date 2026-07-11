const { Op } = require('sequelize');
const {
  Asset, AssetCategory, AssetTicket, AssetActivity, Ticket, Contact, User, Department,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { logAssetActivity } = require('../services/assetActivity');
const { suggestNextAssetTag } = require('../services/assetTagService');
const { getTicketStatusBuckets } = require('../services/statusBehavior');

const userAttrs = ['id', 'displayName', 'username'];

const assetInclude = [
  { model: AssetCategory, as: 'category' },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: Contact, as: 'assignedToContact', attributes: ['id', 'displayName', 'email'] },
  { model: User, as: 'assignedToUser', attributes: userAttrs },
];

// Fields the client may set on create/update — everything except id and the
// auto-managed createdBy/createdAt/updatedAt.
const WRITABLE_FIELDS = [
  'assetTag', 'name', 'categoryId', 'make', 'model', 'serialNumber', 'departmentId',
  'assignedToContactId', 'assignedToUserId', 'locationBuilding', 'locationFloor', 'locationRoom',
  'status', 'purchaseDate', 'purchasePrice', 'vendorName', 'warrantyExpiryDate', 'replacementPlanDate',
  'ipAddress', 'macAddress', 'operatingSystem', 'osVersion', 'processor', 'ram', 'storage',
  'firmwareVersion', 'notes',
];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// GET /assets?search=&categoryId=&departmentId=&status=&assignedTo=
const list = asyncHandler(async (req, res) => {
  const { search, categoryId, departmentId, status, assignedTo } = req.query;
  const where = {};
  if (categoryId) where.categoryId = categoryId;
  if (departmentId) where.departmentId = departmentId;
  if (status) where.status = status;

  const andConditions = [];
  if (assignedTo === 'assigned') {
    andConditions.push({ [Op.or]: [{ assignedToContactId: { [Op.ne]: null } }, { assignedToUserId: { [Op.ne]: null } }] });
  } else if (assignedTo === 'unassigned') {
    andConditions.push({ assignedToContactId: null, assignedToUserId: null });
  }
  if (search && search.trim()) {
    const term = search.trim();
    andConditions.push({
      [Op.or]: [
        { assetTag: { [Op.like]: `%${term}%` } },
        { name: { [Op.like]: `%${term}%` } },
        { serialNumber: { [Op.like]: `%${term}%` } },
        { make: { [Op.like]: `%${term}%` } },
        { model: { [Op.like]: `%${term}%` } },
      ],
    });
  }
  if (andConditions.length) where[Op.and] = andConditions;

  const assets = await Asset.findAll({ where, include: assetInclude, order: [['assetTag', 'ASC']] });
  res.json({ assets });
});

// GET /assets/categories — includes a live "next tag" suggestion per category.
const listCategories = asyncHandler(async (req, res) => {
  const categories = await AssetCategory.findAll({ order: [['id', 'ASC']] });
  const withSuggestions = await Promise.all(
    categories.map(async (c) => ({ ...c.toJSON(), nextTagSuggestion: await suggestNextAssetTag(c) }))
  );
  res.json({ categories: withSuggestions });
});

// GET /assets/stats — dashboard summary.
const stats = asyncHandler(async (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const in90Str = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const [dueForReplacement, expiredWarranty, totalActive] = await Promise.all([
    Asset.count({ where: { replacementPlanDate: { [Op.ne]: null, [Op.lte]: in90Str } } }),
    Asset.count({ where: { warrantyExpiryDate: { [Op.ne]: null, [Op.lt]: todayStr } } }),
    Asset.count({ where: { status: 'active' } }),
  ]);

  res.json({ dueForReplacement, expiredWarranty, totalActive });
});

// GET /assets/:id
const get = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id, { include: assetInclude });
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const buckets = await getTicketStatusBuckets();
  const [totalTickets, openTickets] = await Promise.all([
    AssetTicket.count({ where: { assetId: asset.id } }),
    AssetTicket.count({ where: { assetId: asset.id }, include: [{ model: Ticket, as: 'ticket', where: { status: { [Op.in]: buckets.open } }, attributes: [] }] }),
  ]);

  res.json({
    asset,
    stats: {
      totalTicketsLinked: totalTickets,
      openTicketsLinked: openTickets,
      daysUntilWarrantyExpiry: daysUntil(asset.warrantyExpiryDate),
      daysUntilReplacement: daysUntil(asset.replacementPlanDate),
    },
  });
});

async function assertUniqueTag(assetTag, excludeId) {
  const where = { assetTag };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await Asset.findOne({ where });
  if (existing) throw new ApiError(409, `Asset tag "${assetTag}" is already in use`, 'DUPLICATE_ASSET_TAG');
}

// POST /assets
const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
  if (!body.categoryId) throw new ApiError(400, 'Category is required', 'VALIDATION_ERROR');

  const category = await AssetCategory.findByPk(body.categoryId);
  if (!category) throw new ApiError(400, 'Invalid category', 'VALIDATION_ERROR');

  let assetTag = body.assetTag && body.assetTag.trim();
  if (!assetTag) assetTag = await suggestNextAssetTag(category);
  await assertUniqueTag(assetTag);

  const values = { assetTag };
  WRITABLE_FIELDS.forEach((f) => {
    if (f === 'assetTag') return;
    if (body[f] !== undefined) values[f] = body[f];
  });
  values.createdBy = req.user.id;

  const asset = await Asset.create(values);
  await logAssetActivity(asset.id, req.user.id, 'created', { assetTag: asset.assetTag, name: asset.name });
  await writeAudit(req, 'asset.create', 'Asset', asset.id, { assetTag: asset.assetTag });

  const fresh = await Asset.findByPk(asset.id, { include: assetInclude });
  res.status(201).json({ asset: fresh });
});

// PATCH /assets/:id
const update = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const body = req.body || {};
  const changes = {};
  WRITABLE_FIELDS.forEach((f) => {
    if (body[f] !== undefined) changes[f] = body[f];
  });

  if (changes.assetTag !== undefined && changes.assetTag !== asset.assetTag) {
    if (!changes.assetTag.trim()) throw new ApiError(400, 'Asset tag cannot be blank', 'VALIDATION_ERROR');
    await assertUniqueTag(changes.assetTag, asset.id);
  }

  const before = {
    status: asset.status,
    assignedToContactId: asset.assignedToContactId,
    assignedToUserId: asset.assignedToUserId,
  };

  await asset.update(changes);
  await writeAudit(req, 'asset.update', 'Asset', asset.id, changes);

  // Separate, clearly-labeled timeline entries for the two changes callers
  // most care about — everything else bundles into one generic "updated".
  if (changes.status !== undefined && changes.status !== before.status) {
    await logAssetActivity(asset.id, req.user.id, 'status_changed', { from: before.status, to: changes.status });
  }
  const assignmentChanged = (changes.assignedToContactId !== undefined && changes.assignedToContactId !== before.assignedToContactId)
    || (changes.assignedToUserId !== undefined && changes.assignedToUserId !== before.assignedToUserId);
  if (assignmentChanged) {
    await logAssetActivity(asset.id, req.user.id, 'assignment_changed', {
      assignedToContactId: asset.assignedToContactId,
      assignedToUserId: asset.assignedToUserId,
    });
  }
  const otherChangedFields = Object.keys(changes).filter((f) => f !== 'status' && f !== 'assignedToContactId' && f !== 'assignedToUserId');
  if (otherChangedFields.length) {
    await logAssetActivity(asset.id, req.user.id, 'updated', { fields: otherChangedFields });
  }

  const fresh = await Asset.findByPk(asset.id, { include: assetInclude });
  res.json({ asset: fresh });
});

// DELETE /assets/:id — warns (via a 409 the client can re-confirm past,
// using ?force=true) if the asset has linked tickets, rather than silently
// deleting ticket history along with it.
const remove = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const linkedTicketCount = await AssetTicket.count({ where: { assetId: asset.id } });
  if (linkedTicketCount > 0 && req.query.force !== 'true') {
    return res.status(409).json({
      error: true,
      message: `This asset has ${linkedTicketCount} linked ticket${linkedTicketCount === 1 ? '' : 's'}. Delete anyway?`,
      code: 'HAS_LINKED_TICKETS',
      linkedTicketCount,
    });
  }

  await writeAudit(req, 'asset.delete', 'Asset', asset.id, { assetTag: asset.assetTag });
  await asset.destroy();
  return res.json({ success: true });
});

// GET /assets/:id/tickets
const listTickets = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const links = await AssetTicket.findAll({
    where: { assetId: asset.id },
    include: [{
      model: Ticket,
      as: 'ticket',
      include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    }],
    order: [['linkedAt', 'DESC']],
  });

  res.json({
    tickets: links.filter((l) => l.ticket).map((l) => ({
      linkId: l.id,
      linkedAt: l.linkedAt,
      id: l.ticket.id,
      ticketNumber: String(l.ticket.id).padStart(5, '0'),
      title: l.ticket.title,
      status: l.ticket.status,
      priority: l.ticket.priority,
      assignee: l.ticket.assignee ? { id: l.ticket.assignee.id, displayName: l.ticket.assignee.displayName } : null,
      createdAt: l.ticket.createdAt,
    })),
  });
});

// POST /assets/:id/tickets — { ticketId }
const linkTicket = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const ticketId = parseInt(req.body.ticketId, 10);
  if (!Number.isFinite(ticketId)) throw new ApiError(400, 'ticketId is required', 'VALIDATION_ERROR');
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');

  const existing = await AssetTicket.findOne({ where: { assetId: asset.id, ticketId } });
  if (existing) return res.json({ link: existing });

  const link = await AssetTicket.create({ assetId: asset.id, ticketId, linkedBy: req.user.id });
  await logAssetActivity(asset.id, req.user.id, 'ticket_linked', {
    ticketId, ticketNumber: String(ticket.id).padStart(5, '0'), ticketTitle: ticket.title,
  });
  res.status(201).json({ link });
});

// DELETE /assets/:id/tickets/:ticketId
const unlinkTicket = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const ticketId = parseInt(req.params.ticketId, 10);
  const link = await AssetTicket.findOne({ where: { assetId: asset.id, ticketId } });
  if (!link) throw new ApiError(404, 'Link not found', 'NOT_FOUND');

  const ticket = await Ticket.findByPk(ticketId, { attributes: ['id', 'title'] });
  await link.destroy();
  await logAssetActivity(asset.id, req.user.id, 'ticket_unlinked', {
    ticketId, ticketNumber: String(ticketId).padStart(5, '0'), ticketTitle: ticket?.title || '',
  });
  res.json({ success: true });
});

// GET /assets/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const rows = await AssetActivity.findAll({
    where: { assetId: asset.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity: rows });
});

module.exports = {
  list, listCategories, stats, get, create, update, remove,
  listTickets, linkTicket, unlinkTicket, listActivity,
  assetInclude,
};
