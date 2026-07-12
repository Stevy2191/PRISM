const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  Asset, AssetCategory, AssetTicket, AssetActivity, AssetCategoryField, AssetFieldValue,
  AssetCheckout, AssetAttachment, License, Contract,
  Ticket, Contact, User, Department,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { logAssetActivity } = require('../services/assetActivity');
const { suggestNextAssetTag } = require('../services/assetTagService');
const { getTicketStatusBuckets } = require('../services/statusBehavior');
const { generateCheckoutFormPdf } = require('../services/assetCheckoutPdf');
const { getSubscriptionRenewals } = require('../services/assetSubscriptionService');
const { sendMail } = require('../services/emailSender');
const { getAllSettings } = require('./settingsController');
const { UPLOAD_ROOT } = require('../middleware/upload');

const userAttrs = ['id', 'displayName', 'username'];

const checkoutInclude = [
  { model: Contact, as: 'contact', attributes: ['id', 'displayName', 'email'] },
  { model: User, as: 'checkedOutByUser', attributes: userAttrs },
  { model: User, as: 'checkedInByUser', attributes: userAttrs },
];

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
  'firmwareVersion', 'notes', 'deployedDate',
];

// Syncs an asset's values for its category's dynamic fields. `values` is
// { [fieldId]: rawValue } — mirrors syncCustomFieldValues in
// ticketsController.js (find+create/update, delete-on-empty rather than
// storing an empty string). Only touches fields that actually belong to the
// asset's category (a stray fieldId from a stale form is silently ignored
// rather than erroring, since categories can change).
async function syncFieldValues(assetId, categoryId, values) {
  if (!values || typeof values !== 'object') return;
  const validFields = await AssetCategoryField.findAll({ where: { categoryId }, attributes: ['id'] });
  const validIds = new Set(validFields.map((f) => f.id));

  // eslint-disable-next-line no-restricted-syntax
  for (const [fieldIdStr, raw] of Object.entries(values)) {
    const fieldId = Number(fieldIdStr);
    if (!validIds.has(fieldId)) continue; // eslint-disable-line no-continue
    const value = raw === undefined || raw === null ? '' : String(raw);
    if (value === '') {
      // eslint-disable-next-line no-await-in-loop
      await AssetFieldValue.destroy({ where: { assetId, fieldId } });
    } else {
      // eslint-disable-next-line no-await-in-loop
      const existing = await AssetFieldValue.findOne({ where: { assetId, fieldId } });
      // eslint-disable-next-line no-await-in-loop
      if (existing) await existing.update({ value });
      // eslint-disable-next-line no-await-in-loop
      else await AssetFieldValue.create({ assetId, fieldId, value });
    }
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// Checkout/check-in dates may be backdated arbitrarily (entering existing
// deployed equipment, correcting historical records) but never postdated —
// compared against end-of-today so "today" itself is always valid regardless
// of what time of day the request arrives.
function assertNotFutureDate(value, label) {
  if (!value) return;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} is not a valid date`, 'VALIDATION_ERROR');
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (d.getTime() > endOfToday.getTime()) {
    throw new ApiError(400, `${label} cannot be in the future`, 'FUTURE_DATE_NOT_ALLOWED');
  }
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

// GET /assets/categories — includes a live "next tag" suggestion + the
// category's dynamic field definitions, so the asset form can render the
// right "Device Details" section as soon as a category is picked without a
// second round-trip.
const listCategories = asyncHandler(async (req, res) => {
  const categories = await AssetCategory.findAll({
    include: [{ model: AssetCategoryField, as: 'fields' }],
    order: [['id', 'ASC']],
  });
  const withSuggestions = await Promise.all(
    categories.map(async (c) => ({
      ...c.toJSON(),
      fields: [...c.fields].sort((a, b) => a.position - b.position),
      nextTagSuggestion: await suggestNextAssetTag(c),
    }))
  );
  res.json({ categories: withSuggestions });
});

// GET /assets/stats — dashboard summary.
const stats = asyncHandler(async (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const in90Str = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const [dueForReplacement, expiredWarranty, totalActive, renewingSoon] = await Promise.all([
    Asset.count({ where: { replacementPlanDate: { [Op.ne]: null, [Op.lte]: in90Str } } }),
    Asset.count({ where: { warrantyExpiryDate: { [Op.ne]: null, [Op.lt]: todayStr } } }),
    Asset.count({ where: { status: 'active' } }),
    getSubscriptionRenewals({ withinDays: 30 }),
  ]);

  res.json({ dueForReplacement, expiredWarranty, totalActive, subscriptionsRenewingSoon: renewingSoon.length });
});

// GET /assets/expiry-summary — combined counts across all three Assets
// sub-sections (hardware assets, licenses, contracts), for the admin
// dashboard's Assets panel. Each threshold reads its own configurable
// Settings -> Asset Alerts value rather than a shared hardcoded window.
const expirySummary = asyncHandler(async (req, res) => {
  const settings = await getAllSettings();
  const warrantyDays = Number(settings['assets.warrantyAlertDays']) || 90;
  const replacementDays = Number(settings['assets.replacementAlertDays']) || 90;
  const subscriptionDays = Number(settings['assets.subscriptionAlertDays']) || 30;
  const licenseDays = Number(settings['licenses.expiryAlertDays']) || 30;
  const contractDays = Number(settings['contracts.renewalAlertDays']) || 60;

  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoff = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  const [
    dueForReplacement, expiredWarranty, warrantyExpiringSoon, subscriptionsRenewingSoon,
    licensesExpiringSoon, licensesExpired,
    contractsRenewingSoon, contractsExpired,
  ] = await Promise.all([
    Asset.count({ where: { replacementPlanDate: { [Op.ne]: null, [Op.lte]: cutoff(replacementDays) } } }),
    Asset.count({ where: { warrantyExpiryDate: { [Op.ne]: null, [Op.lt]: todayStr } } }),
    Asset.count({ where: { warrantyExpiryDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: cutoff(warrantyDays) } } }),
    getSubscriptionRenewals({ withinDays: subscriptionDays }),
    License.count({ where: { expiryDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: cutoff(licenseDays) } } }),
    License.count({ where: { expiryDate: { [Op.ne]: null, [Op.lt]: todayStr } } }),
    Contract.count({
      where: {
        [Op.or]: [
          { renewalDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: cutoff(contractDays) } },
          { renewalDate: null, endDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: cutoff(contractDays) } },
        ],
      },
    }),
    Contract.count({
      where: {
        [Op.or]: [
          { renewalDate: { [Op.ne]: null, [Op.lt]: todayStr } },
          { renewalDate: null, endDate: { [Op.ne]: null, [Op.lt]: todayStr } },
        ],
      },
    }),
  ]);

  res.json({
    assets: { dueForReplacement, expiredWarranty, warrantyExpiringSoon, subscriptionsRenewingSoon: subscriptionsRenewingSoon.length },
    licenses: { expiringSoon: licensesExpiringSoon, expired: licensesExpired },
    contracts: { renewingSoon: contractsRenewingSoon, expired: contractsExpired },
  });
});

// GET /assets/:id
const get = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id, {
    include: [...assetInclude, { model: AssetFieldValue, as: 'fieldValues', include: [{ model: AssetCategoryField, as: 'field' }] }],
  });
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
  if (body.fieldValues) await syncFieldValues(asset.id, asset.categoryId, body.fieldValues);
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
  if (body.fieldValues) await syncFieldValues(asset.id, changes.categoryId || asset.categoryId, body.fieldValues);
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

// ==================== Checkout / check-in ====================

// GET /assets/:id/checkouts — history, most recent first. The frontend
// treats the first row with no checkedInAt as "currently checked out."
const listCheckouts = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const checkouts = await AssetCheckout.findAll({
    where: { assetId: asset.id },
    include: checkoutInclude,
    order: [['checkedOutAt', 'DESC']],
  });
  res.json({ checkouts });
});

// POST /assets/:id/checkouts — { contactId, checkedOutAt, notes, generateForm }
// Also (re)assigns the asset to that contact, mirroring what "Check out"
// means in practice — clears any user-assignment since assigned-to is
// mutually exclusive contact/user.
const createCheckout = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id, { include: assetInclude });
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const contactId = parseInt(req.body.contactId, 10);
  if (!Number.isFinite(contactId)) throw new ApiError(400, 'contactId is required', 'VALIDATION_ERROR');
  const contact = await Contact.findByPk(contactId, { include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }] });
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');

  assertNotFutureDate(req.body.checkedOutAt, 'Checkout date');
  const checkedOutAt = req.body.checkedOutAt ? new Date(req.body.checkedOutAt) : new Date();
  const checkout = await AssetCheckout.create({
    assetId: asset.id,
    contactId,
    checkedOutBy: req.user.id,
    checkedOutAt,
    notes: req.body.notes || null,
  });

  if (asset.assignedToContactId !== contactId || asset.assignedToUserId) {
    await asset.update({ assignedToContactId: contactId, assignedToUserId: null });
    await logAssetActivity(asset.id, req.user.id, 'assignment_changed', { assignedToContactId: contactId, assignedToUserId: null });
  }
  await logAssetActivity(asset.id, req.user.id, 'checked_out', { contactId, contactName: contact.displayName, checkedOutAt });

  let attachment = null;
  if (req.body.generateForm) {
    const { filename, size } = await generateCheckoutFormPdf({
      asset,
      contact,
      checkoutDate: checkedOutAt.toISOString().slice(0, 10),
    });
    attachment = await AssetAttachment.create({
      assetId: asset.id,
      filename,
      originalName: `Checkout Form - ${asset.assetTag}.pdf`,
      mimeType: 'application/pdf',
      size,
      uploadedById: req.user.id,
    });
    await logAssetActivity(asset.id, req.user.id, 'checkout_form_generated', { attachmentId: attachment.id });
  }

  const fresh = await AssetCheckout.findByPk(checkout.id, { include: checkoutInclude });
  res.status(201).json({ checkout: fresh, attachment });
});

// POST /assets/:id/checkouts/:checkoutId/check-in — { checkedInAt } optional,
// defaults to now; may be backdated (e.g. entering a return that actually
// happened last week) but never postdated, and never before the checkout's
// own checkedOutAt.
const checkInCheckout = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');
  const checkout = await AssetCheckout.findOne({ where: { id: req.params.checkoutId, assetId: asset.id } });
  if (!checkout) throw new ApiError(404, 'Checkout not found', 'NOT_FOUND');
  if (checkout.checkedInAt) throw new ApiError(400, 'This checkout has already been checked in', 'ALREADY_CHECKED_IN');

  assertNotFutureDate(req.body.checkedInAt, 'Check-in date');
  const checkedInAt = req.body.checkedInAt ? new Date(req.body.checkedInAt) : new Date();
  if (checkedInAt.getTime() < new Date(checkout.checkedOutAt).getTime()) {
    throw new ApiError(400, 'Check-in date cannot be before the checkout date', 'VALIDATION_ERROR');
  }

  await checkout.update({ checkedInAt, checkedInBy: req.user.id });

  if (asset.assignedToContactId === checkout.contactId) {
    await asset.update({ assignedToContactId: null });
    await logAssetActivity(asset.id, req.user.id, 'assignment_changed', { assignedToContactId: null, assignedToUserId: asset.assignedToUserId });
  }
  await logAssetActivity(asset.id, req.user.id, 'checked_in', { contactId: checkout.contactId });

  const fresh = await AssetCheckout.findByPk(checkout.id, { include: checkoutInclude });
  res.json({ checkout: fresh });
});

// POST /assets/:id/checkouts/:checkoutId/send-form — { attachmentId }
// Emails the previously-generated checkout PDF to the contact, using the
// configured SMTP settings (emailSender.js — same as CSAT surveys /
// inbound-email replies).
const sendCheckoutForm = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');
  const checkout = await AssetCheckout.findOne({ where: { id: req.params.checkoutId, assetId: asset.id }, include: checkoutInclude });
  if (!checkout) throw new ApiError(404, 'Checkout not found', 'NOT_FOUND');

  const attachmentId = parseInt(req.body.attachmentId, 10);
  const attachment = await AssetAttachment.findOne({ where: { id: attachmentId, assetId: asset.id } });
  if (!attachment) throw new ApiError(404, 'Checkout form attachment not found', 'NOT_FOUND');

  const to = req.body.to || checkout.contact?.email;
  if (!to) throw new ApiError(400, 'No recipient email address', 'VALIDATION_ERROR');
  const subject = req.body.subject || `Equipment Checkout Form — ${asset.assetTag} ${asset.name}`;
  const body = req.body.body || 'Please find attached your equipment checkout form. Please sign and return to the IT department.';
  const filePath = path.join(UPLOAD_ROOT, 'assets', String(asset.id), attachment.filename);

  await sendMail({
    to,
    subject,
    text: body,
    html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
    attachments: [{ filename: attachment.originalName, path: filePath }],
  });

  await checkout.update({ checkoutFormSentAt: new Date() });
  await logAssetActivity(asset.id, req.user.id, 'checkout_form_sent', { checkoutId: checkout.id, to });

  const fresh = await AssetCheckout.findByPk(checkout.id, { include: checkoutInclude });
  res.json({ checkout: fresh });
});

// PATCH /assets/:id/checkouts/:checkoutId — { formReceived: true } marks the
// signed form as returned. Also supports editing a checkout record directly
// ({ contactId, checkedOutAt, checkedInAt, notes }) so historical/incorrect
// entries can be corrected — checkedInAt may be sent as `null` to reopen a
// checkout as the asset's current/active one.
const updateCheckout = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');
  const checkout = await AssetCheckout.findOne({ where: { id: req.params.checkoutId, assetId: asset.id } });
  if (!checkout) throw new ApiError(404, 'Checkout not found', 'NOT_FOUND');

  if (req.body.formReceived) {
    await checkout.update({ checkoutFormReturnedAt: new Date() });
    await logAssetActivity(asset.id, req.user.id, 'checkout_form_received', { checkoutId: checkout.id });
  }

  const hasContactId = Object.prototype.hasOwnProperty.call(req.body, 'contactId');
  const hasCheckedOutAt = Object.prototype.hasOwnProperty.call(req.body, 'checkedOutAt');
  const hasCheckedInAt = Object.prototype.hasOwnProperty.call(req.body, 'checkedInAt');
  const hasNotes = Object.prototype.hasOwnProperty.call(req.body, 'notes');

  if (hasContactId || hasCheckedOutAt || hasCheckedInAt || hasNotes) {
    const updates = {};

    if (hasContactId) {
      if (!req.body.contactId) throw new ApiError(400, 'Contact is required', 'VALIDATION_ERROR');
      const contact = await Contact.findByPk(req.body.contactId);
      if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
      updates.contactId = contact.id;
    }

    if (hasCheckedOutAt) {
      assertNotFutureDate(req.body.checkedOutAt, 'Checkout date');
      updates.checkedOutAt = new Date(req.body.checkedOutAt);
    }

    if (hasCheckedInAt) {
      assertNotFutureDate(req.body.checkedInAt, 'Check-in date');
      updates.checkedInAt = req.body.checkedInAt ? new Date(req.body.checkedInAt) : null;
    }

    if (hasNotes) {
      updates.notes = req.body.notes || null;
    }

    const resolvedCheckedOutAt = hasCheckedOutAt ? updates.checkedOutAt : checkout.checkedOutAt;
    const resolvedCheckedInAt = hasCheckedInAt ? updates.checkedInAt : checkout.checkedInAt;
    if (resolvedCheckedInAt && resolvedCheckedInAt.getTime() < new Date(resolvedCheckedOutAt).getTime()) {
      throw new ApiError(400, 'Check-in date cannot be before the checkout date', 'VALIDATION_ERROR');
    }

    const wasActive = !checkout.checkedInAt;
    const willBeActive = !resolvedCheckedInAt;
    const originalContactId = checkout.contactId;

    if (willBeActive && !wasActive) {
      const otherActive = await AssetCheckout.findOne({
        where: { assetId: asset.id, checkedInAt: null, id: { [Op.ne]: checkout.id } },
      });
      if (otherActive) {
        throw new ApiError(400, 'This asset already has an active checkout — check it in before reopening another one', 'VALIDATION_ERROR');
      }
    }

    if (hasCheckedInAt) {
      if (willBeActive && !wasActive) {
        updates.checkedInBy = null;
      } else if (!willBeActive && wasActive) {
        updates.checkedInBy = req.user.id;
      }
    }

    await checkout.update(updates);

    if (willBeActive) {
      const activeContactId = hasContactId ? updates.contactId : originalContactId;
      if (asset.assignedToContactId !== activeContactId) {
        await asset.update({ assignedToContactId: activeContactId, assignedToUserId: null });
      }
    } else if (wasActive && asset.assignedToContactId === originalContactId) {
      await asset.update({ assignedToContactId: null });
    }

    await logAssetActivity(asset.id, req.user.id, 'checkout_edited', { checkoutId: checkout.id, changes: Object.keys(updates) });
  }

  const fresh = await AssetCheckout.findByPk(checkout.id, { include: checkoutInclude });
  res.json({ checkout: fresh });
});

// ==================== Attachments ====================
// Separate AssetAttachment model/table (not the ticket-only Attachment) —
// see the model file's comment. Same multipart/upload middleware wiring as
// ticketsController.js's attachment handlers (assetUpload.single('file') +
// enforceMaxAttachmentSize applied at the route).

// GET /assets/:id/attachments
const listAttachments = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const attachments = await AssetAttachment.findAll({
    where: { assetId: asset.id },
    include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ attachments });
});

// POST /assets/:id/attachments — multipart/form-data (field: "file")
const createAttachment = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Asset not found', 'NOT_FOUND');
  }
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');

  const attachment = await AssetAttachment.create({
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    assetId: asset.id,
    uploadedById: req.user.id,
  });
  await writeAudit(req, 'assetAttachment.create', 'AssetAttachment', attachment.id, { assetId: asset.id, originalName: attachment.originalName });
  await logAssetActivity(asset.id, req.user.id, 'attachment_added', { originalName: attachment.originalName });
  const fresh = await AssetAttachment.findByPk(attachment.id, { include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }] });
  res.status(201).json({ attachment: fresh });
});

// GET /assets/:id/attachments/:attachmentId/download
const downloadAttachment = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const attachment = await AssetAttachment.findOne({ where: { id: req.params.attachmentId, assetId: asset.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');

  const filePath = path.join(UPLOAD_ROOT, 'assets', String(asset.id), attachment.filename);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'File missing from storage', 'FILE_MISSING');
  res.download(filePath, attachment.originalName);
});

// DELETE /assets/:id/attachments/:attachmentId
const removeAttachment = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const attachment = await AssetAttachment.findOne({ where: { id: req.params.attachmentId, assetId: asset.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');

  const filePath = path.join(UPLOAD_ROOT, 'assets', String(asset.id), attachment.filename);
  await attachment.destroy();
  fs.rm(filePath, { force: true }, () => {});
  await writeAudit(req, 'assetAttachment.delete', 'AssetAttachment', attachment.id, { assetId: asset.id });
  await logAssetActivity(asset.id, req.user.id, 'attachment_removed', { originalName: attachment.originalName });
  res.json({ ok: true });
});

module.exports = {
  list, listCategories, stats, expirySummary, get, create, update, remove,
  listTickets, linkTicket, unlinkTicket, listActivity,
  listCheckouts, createCheckout, checkInCheckout, sendCheckoutForm, updateCheckout,
  listAttachments, createAttachment, downloadAttachment, removeAttachment,
  assetInclude,
};
