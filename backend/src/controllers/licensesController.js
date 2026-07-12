const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  License, LicenseAsset, LicenseContact, LicenseAttachment, LicenseActivity,
  Asset, AssetCategory, Contact, User, Department,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { encryptToken, decryptToken } = require('../utils/tokenCrypto');
const { getAllSettings } = require('./settingsController');
const { UPLOAD_ROOT } = require('../middleware/upload');

const userAttrs = ['id', 'displayName', 'username'];

const licenseInclude = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'creator', attributes: userAttrs },
];

// Fields the client may set on create/update. `licenseKey` is handled
// separately (encrypted before storage); `usedSeats` is derived from
// LicenseContacts, never client-writable.
const WRITABLE_FIELDS = [
  'name', 'vendor', 'licenseType', 'totalSeats', 'purchaseDate', 'expiryDate',
  'renewalDate', 'annualCost', 'autoRenews', 'departmentId', 'notes',
];

async function logLicenseActivity(licenseId, userId, action, detail = null) {
  return LicenseActivity.create({ licenseId, userId: userId || null, action, detail });
}

async function recomputeUsedSeats(licenseId) {
  const usedSeats = await LicenseContact.count({ where: { licenseId } });
  await License.update({ usedSeats }, { where: { id: licenseId } });
  return usedSeats;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// GET /licenses?search=&licenseType=&departmentId=&status=
const list = asyncHandler(async (req, res) => {
  const { search, licenseType, departmentId, status } = req.query;
  const where = {};
  if (licenseType) where.licenseType = licenseType;
  if (departmentId) where.departmentId = departmentId;

  if (search && search.trim()) {
    const term = search.trim();
    where[Op.or] = [{ name: { [Op.like]: `%${term}%` } }, { vendor: { [Op.like]: `%${term}%` } }];
  }

  if (status && status !== 'all') {
    const settings = await getAllSettings();
    const alertDays = Number(settings['licenses.expiryAlertDays']) || 30;
    const todayStr = new Date().toISOString().slice(0, 10);
    const soonStr = new Date(Date.now() + alertDays * 86400000).toISOString().slice(0, 10);
    if (status === 'expired') where.expiryDate = { [Op.ne]: null, [Op.lt]: todayStr };
    else if (status === 'expiring_soon') where.expiryDate = { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: soonStr };
    else if (status === 'active') {
      where[Op.and] = [{ [Op.or]: [{ expiryDate: null }, { expiryDate: { [Op.gt]: soonStr } }] }];
    }
  }

  const licenses = await License.findAll({ where, include: licenseInclude, order: [['name', 'ASC']] });
  res.json({ licenses });
});

// GET /licenses/:id
const get = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id, { include: licenseInclude });
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const [linkedAssetCount, contactCount, attachmentCount] = await Promise.all([
    LicenseAsset.count({ where: { licenseId: license.id } }),
    LicenseContact.count({ where: { licenseId: license.id } }),
    LicenseAttachment.count({ where: { licenseId: license.id } }),
  ]);

  res.json({
    license,
    stats: {
      totalSeats: license.totalSeats,
      usedSeats: license.usedSeats,
      availableSeats: license.totalSeats === null ? null : Math.max(license.totalSeats - license.usedSeats, 0),
      annualCost: license.annualCost,
      linkedAssetCount,
      contactCount,
      attachmentCount,
      daysUntilExpiry: daysUntil(license.expiryDate),
      daysUntilRenewal: daysUntil(license.renewalDate),
    },
  });
});

// POST /licenses
const create = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');

  const values = {};
  WRITABLE_FIELDS.forEach((f) => {
    if (req.body[f] !== undefined) values[f] = req.body[f] === '' ? null : req.body[f];
  });
  if (req.body.licenseKey) values.licenseKey = encryptToken(req.body.licenseKey);

  const license = await License.create({ ...values, createdBy: req.user.id });
  await writeAudit(req, 'license.create', 'License', license.id, { name: license.name });
  await logLicenseActivity(license.id, req.user.id, 'created', { name: license.name });

  const fresh = await License.findByPk(license.id, { include: licenseInclude });
  res.status(201).json({ license: fresh });
});

// PATCH /licenses/:id
const update = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const values = {};
  WRITABLE_FIELDS.forEach((f) => {
    if (req.body[f] !== undefined) values[f] = req.body[f] === '' ? null : req.body[f];
  });
  // Blank string means "leave unchanged" (same convention as settings
  // secrets) — there's no way to clear a key once set except overwriting it
  // with a new one; that's an acceptable tradeoff for a masked secret field.
  if (Object.prototype.hasOwnProperty.call(req.body, 'licenseKey') && req.body.licenseKey) {
    values.licenseKey = encryptToken(req.body.licenseKey);
  }

  await license.update(values);
  await writeAudit(req, 'license.update', 'License', license.id, { changes: Object.keys(values) });
  await logLicenseActivity(license.id, req.user.id, 'updated', { changes: Object.keys(values) });

  const fresh = await License.findByPk(license.id, { include: licenseInclude });
  res.json({ license: fresh });
});

// GET /licenses/:id/reveal-key — gated by assets.view_license_keys at the
// route level. Logged as its own activity entry since revealing a secret is
// a security-relevant action worth a distinct audit trail from a normal edit.
const revealKey = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const licenseKey = decryptToken(license.licenseKey);
  await writeAudit(req, 'license.reveal_key', 'License', license.id, {});
  await logLicenseActivity(license.id, req.user.id, 'license_key_revealed', {});
  res.json({ licenseKey });
});

// DELETE /licenses/:id
const remove = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const attachments = await LicenseAttachment.findAll({ where: { licenseId: license.id } });
  await Promise.all(attachments.map((a) => {
    const filePath = path.join(UPLOAD_ROOT, 'licenses', String(license.id), a.filename);
    return new Promise((resolve) => fs.rm(filePath, { force: true }, () => resolve()));
  }));

  await LicenseAsset.destroy({ where: { licenseId: license.id } });
  await LicenseContact.destroy({ where: { licenseId: license.id } });
  await LicenseAttachment.destroy({ where: { licenseId: license.id } });
  await LicenseActivity.destroy({ where: { licenseId: license.id } });

  await writeAudit(req, 'license.delete', 'License', license.id, { name: license.name });
  await license.destroy();
  res.json({ success: true });
});

// ==================== Linked assets ====================

// GET /licenses/:id/assets
const listAssets = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const links = await LicenseAsset.findAll({
    where: { licenseId: license.id },
    include: [
      { model: Asset, as: 'asset', include: [{ model: AssetCategory, as: 'category' }] },
      { model: User, as: 'assignedByUser', attributes: userAttrs },
    ],
    order: [['assignedAt', 'DESC']],
  });
  res.json({ links: links.filter((l) => l.asset) });
});

// POST /licenses/:id/assets — { assetId }
const linkAsset = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const assetId = parseInt(req.body.assetId, 10);
  if (!Number.isFinite(assetId)) throw new ApiError(400, 'assetId is required', 'VALIDATION_ERROR');
  const asset = await Asset.findByPk(assetId);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const existing = await LicenseAsset.findOne({ where: { licenseId: license.id, assetId } });
  if (existing) return res.json({ link: existing });

  const link = await LicenseAsset.create({ licenseId: license.id, assetId, assignedBy: req.user.id });
  await logLicenseActivity(license.id, req.user.id, 'asset_linked', { assetId, assetTag: asset.assetTag, assetName: asset.name });
  res.status(201).json({ link });
});

// DELETE /licenses/:id/assets/:assetId
const unlinkAsset = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const link = await LicenseAsset.findOne({ where: { licenseId: license.id, assetId: req.params.assetId } });
  if (!link) throw new ApiError(404, 'Link not found', 'NOT_FOUND');
  await link.destroy();
  await logLicenseActivity(license.id, req.user.id, 'asset_unlinked', { assetId: Number(req.params.assetId) });
  res.json({ ok: true });
});

// ==================== Assigned contacts (seats) ====================

// GET /licenses/:id/contacts
const listContacts = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const links = await LicenseContact.findAll({
    where: { licenseId: license.id },
    include: [
      { model: Contact, as: 'contact', attributes: ['id', 'displayName', 'email'] },
      { model: User, as: 'assignedByUser', attributes: userAttrs },
    ],
    order: [['assignedAt', 'DESC']],
  });
  res.json({ links: links.filter((l) => l.contact) });
});

// POST /licenses/:id/contacts — { contactId }
const assignContact = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const contactId = parseInt(req.body.contactId, 10);
  if (!Number.isFinite(contactId)) throw new ApiError(400, 'contactId is required', 'VALIDATION_ERROR');
  const contact = await Contact.findByPk(contactId);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');

  const existing = await LicenseContact.findOne({ where: { licenseId: license.id, contactId } });
  if (!existing) {
    await LicenseContact.create({ licenseId: license.id, contactId, assignedBy: req.user.id });
    await logLicenseActivity(license.id, req.user.id, 'contact_assigned', { contactId, contactName: contact.displayName });
  }
  const usedSeats = await recomputeUsedSeats(license.id);
  res.status(201).json({ ok: true, usedSeats });
});

// DELETE /licenses/:id/contacts/:contactId
const unassignContact = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');

  const link = await LicenseContact.findOne({ where: { licenseId: license.id, contactId: req.params.contactId } });
  if (!link) throw new ApiError(404, 'Assignment not found', 'NOT_FOUND');
  await link.destroy();
  await logLicenseActivity(license.id, req.user.id, 'contact_unassigned', { contactId: Number(req.params.contactId) });
  const usedSeats = await recomputeUsedSeats(license.id);
  res.json({ ok: true, usedSeats });
});

// ==================== Attachments ====================

// GET /licenses/:id/attachments
const listAttachments = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const attachments = await LicenseAttachment.findAll({
    where: { licenseId: license.id },
    include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ attachments });
});

// POST /licenses/:id/attachments — multipart/form-data (field: "file")
const createAttachment = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'License not found', 'NOT_FOUND');
  }
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');

  const attachment = await LicenseAttachment.create({
    filename: req.file.filename, originalName: req.file.originalname,
    mimeType: req.file.mimetype, size: req.file.size,
    licenseId: license.id, uploadedById: req.user.id,
  });
  await writeAudit(req, 'licenseAttachment.create', 'LicenseAttachment', attachment.id, { licenseId: license.id, originalName: attachment.originalName });
  await logLicenseActivity(license.id, req.user.id, 'attachment_added', { originalName: attachment.originalName });

  const fresh = await LicenseAttachment.findByPk(attachment.id, { include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }] });
  res.status(201).json({ attachment: fresh });
});

// GET /licenses/:id/attachments/:attachmentId/download
const downloadAttachment = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const attachment = await LicenseAttachment.findOne({ where: { id: req.params.attachmentId, licenseId: license.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  const filePath = path.join(UPLOAD_ROOT, 'licenses', String(license.id), attachment.filename);
  res.download(filePath, attachment.originalName);
});

// DELETE /licenses/:id/attachments/:attachmentId
const removeAttachment = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const attachment = await LicenseAttachment.findOne({ where: { id: req.params.attachmentId, licenseId: license.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');

  const filePath = path.join(UPLOAD_ROOT, 'licenses', String(license.id), attachment.filename);
  await attachment.destroy();
  fs.rm(filePath, { force: true }, () => {});
  await writeAudit(req, 'licenseAttachment.delete', 'LicenseAttachment', attachment.id, { licenseId: license.id });
  await logLicenseActivity(license.id, req.user.id, 'attachment_removed', { originalName: attachment.originalName });
  res.json({ ok: true });
});

// GET /licenses/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const license = await License.findByPk(req.params.id);
  if (!license) throw new ApiError(404, 'License not found', 'NOT_FOUND');
  const activity = await LicenseActivity.findAll({
    where: { licenseId: license.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity });
});

module.exports = {
  list, get, create, update, remove, revealKey,
  listAssets, linkAsset, unlinkAsset,
  listContacts, assignContact, unassignContact,
  listAttachments, createAttachment, downloadAttachment, removeAttachment,
  listActivity,
};
