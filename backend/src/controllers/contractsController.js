const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  Contract, ContractAsset, ContractAttachment, ContractActivity,
  Asset, AssetCategory, User, Department,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { getAllSettings } = require('./settingsController');
const { UPLOAD_ROOT } = require('../middleware/upload');

const userAttrs = ['id', 'displayName', 'username'];

const contractInclude = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'creator', attributes: userAttrs },
];

const WRITABLE_FIELDS = [
  'name', 'vendor', 'contractType', 'startDate', 'endDate', 'renewalDate',
  'autoRenews', 'annualCost', 'totalValue', 'contactPerson', 'contactEmail',
  'contactPhone', 'departmentId', 'notes',
];

async function logContractActivity(contractId, userId, action, detail = null) {
  return ContractActivity.create({ contractId, userId: userId || null, action, detail });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// GET /contracts?search=&contractType=&departmentId=&status=
const list = asyncHandler(async (req, res) => {
  const { search, contractType, departmentId, status } = req.query;
  const where = {};
  if (contractType) where.contractType = contractType;
  if (departmentId) where.departmentId = departmentId;

  if (search && search.trim()) {
    const term = search.trim();
    where[Op.or] = [{ name: { [Op.like]: `%${term}%` } }, { vendor: { [Op.like]: `%${term}%` } }];
  }

  if (status && status !== 'all') {
    const settings = await getAllSettings();
    const alertDays = Number(settings['contracts.renewalAlertDays']) || 60;
    const todayStr = new Date().toISOString().slice(0, 10);
    const soonStr = new Date(Date.now() + alertDays * 86400000).toISOString().slice(0, 10);
    // "Renewal/end date" for status purposes: whichever of renewalDate/endDate
    // is set (renewalDate takes precedence — it's the date that actually
    // determines whether the contract keeps going).
    const dateField = { [Op.or]: [{ renewalDate: { [Op.ne]: null } }, { endDate: { [Op.ne]: null } }] };
    if (status === 'expired') {
      where[Op.and] = [dateField, {
        [Op.or]: [
          { renewalDate: { [Op.ne]: null, [Op.lt]: todayStr } },
          { renewalDate: null, endDate: { [Op.ne]: null, [Op.lt]: todayStr } },
        ],
      }];
    } else if (status === 'expiring_soon') {
      where[Op.and] = [dateField, {
        [Op.or]: [
          { renewalDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: soonStr } },
          { renewalDate: null, endDate: { [Op.ne]: null, [Op.gte]: todayStr, [Op.lte]: soonStr } },
        ],
      }];
    } else if (status === 'active') {
      where[Op.and] = [{
        [Op.or]: [
          { renewalDate: null, endDate: null },
          { renewalDate: { [Op.ne]: null, [Op.gt]: soonStr } },
          { renewalDate: null, endDate: { [Op.gt]: soonStr } },
        ],
      }];
    }
  }

  const contracts = await Contract.findAll({ where, include: contractInclude, order: [['name', 'ASC']] });
  const assetCounts = await ContractAsset.findAll({
    where: { contractId: { [Op.in]: contracts.map((c) => c.id) } },
    attributes: ['contractId'],
  });
  const countByContract = new Map();
  assetCounts.forEach((r) => countByContract.set(r.contractId, (countByContract.get(r.contractId) || 0) + 1));

  res.json({
    contracts: contracts.map((c) => ({ ...c.toJSON(), assetsCoveredCount: countByContract.get(c.id) || 0 })),
  });
});

// GET /contracts/:id
const get = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id, { include: contractInclude });
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');

  const [assetsCoveredCount, attachmentCount] = await Promise.all([
    ContractAsset.count({ where: { contractId: contract.id } }),
    ContractAttachment.count({ where: { contractId: contract.id } }),
  ]);

  res.json({
    contract,
    stats: {
      assetsCoveredCount,
      attachmentCount,
      annualCost: contract.annualCost,
      totalValue: contract.totalValue,
      daysUntilRenewal: daysUntil(contract.renewalDate || contract.endDate),
    },
  });
});

// POST /contracts
const create = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.name.trim()) throw new ApiError(400, 'Name is required', 'VALIDATION_ERROR');
  if (!req.body.vendor || !req.body.vendor.trim()) throw new ApiError(400, 'Vendor is required', 'VALIDATION_ERROR');

  const values = {};
  WRITABLE_FIELDS.forEach((f) => {
    if (req.body[f] !== undefined) values[f] = req.body[f] === '' ? null : req.body[f];
  });

  const contract = await Contract.create({ ...values, createdBy: req.user.id });
  await writeAudit(req, 'contract.create', 'Contract', contract.id, { name: contract.name });
  await logContractActivity(contract.id, req.user.id, 'created', { name: contract.name });

  const fresh = await Contract.findByPk(contract.id, { include: contractInclude });
  res.status(201).json({ contract: fresh });
});

// PATCH /contracts/:id
const update = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');

  const values = {};
  WRITABLE_FIELDS.forEach((f) => {
    if (req.body[f] !== undefined) values[f] = req.body[f] === '' ? null : req.body[f];
  });

  await contract.update(values);
  await writeAudit(req, 'contract.update', 'Contract', contract.id, { changes: Object.keys(values) });
  await logContractActivity(contract.id, req.user.id, 'updated', { changes: Object.keys(values) });

  const fresh = await Contract.findByPk(contract.id, { include: contractInclude });
  res.json({ contract: fresh });
});

// DELETE /contracts/:id
const remove = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');

  const attachments = await ContractAttachment.findAll({ where: { contractId: contract.id } });
  await Promise.all(attachments.map((a) => {
    const filePath = path.join(UPLOAD_ROOT, 'contracts', String(contract.id), a.filename);
    return new Promise((resolve) => fs.rm(filePath, { force: true }, () => resolve()));
  }));

  await ContractAsset.destroy({ where: { contractId: contract.id } });
  await ContractAttachment.destroy({ where: { contractId: contract.id } });
  await ContractActivity.destroy({ where: { contractId: contract.id } });

  await writeAudit(req, 'contract.delete', 'Contract', contract.id, { name: contract.name });
  await contract.destroy();
  res.json({ success: true });
});

// ==================== Linked assets ====================

// GET /contracts/:id/assets
const listAssets = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');

  const links = await ContractAsset.findAll({
    where: { contractId: contract.id },
    include: [
      { model: Asset, as: 'asset', include: [{ model: AssetCategory, as: 'category' }] },
      { model: User, as: 'linkedByUser', attributes: userAttrs },
    ],
    order: [['linkedAt', 'DESC']],
  });
  res.json({ links: links.filter((l) => l.asset) });
});

// POST /contracts/:id/assets — { assetId }
const linkAsset = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');
  const assetId = parseInt(req.body.assetId, 10);
  if (!Number.isFinite(assetId)) throw new ApiError(400, 'assetId is required', 'VALIDATION_ERROR');
  const asset = await Asset.findByPk(assetId);
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');

  const existing = await ContractAsset.findOne({ where: { contractId: contract.id, assetId } });
  if (existing) return res.json({ link: existing });

  const link = await ContractAsset.create({ contractId: contract.id, assetId, linkedBy: req.user.id });
  await logContractActivity(contract.id, req.user.id, 'asset_linked', { assetId, assetTag: asset.assetTag, assetName: asset.name });
  res.status(201).json({ link });
});

// DELETE /contracts/:id/assets/:assetId
const unlinkAsset = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');

  const link = await ContractAsset.findOne({ where: { contractId: contract.id, assetId: req.params.assetId } });
  if (!link) throw new ApiError(404, 'Link not found', 'NOT_FOUND');
  await link.destroy();
  await logContractActivity(contract.id, req.user.id, 'asset_unlinked', { assetId: Number(req.params.assetId) });
  res.json({ ok: true });
});

// ==================== Attachments ====================

// GET /contracts/:id/attachments
const listAttachments = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');
  const attachments = await ContractAttachment.findAll({
    where: { contractId: contract.id },
    include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ attachments });
});

// POST /contracts/:id/attachments — multipart/form-data (field: "file")
const createAttachment = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Contract not found', 'NOT_FOUND');
  }
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');

  const attachment = await ContractAttachment.create({
    filename: req.file.filename, originalName: req.file.originalname,
    mimeType: req.file.mimetype, size: req.file.size,
    contractId: contract.id, uploadedById: req.user.id,
  });
  await writeAudit(req, 'contractAttachment.create', 'ContractAttachment', attachment.id, { contractId: contract.id, originalName: attachment.originalName });
  await logContractActivity(contract.id, req.user.id, 'attachment_added', { originalName: attachment.originalName });

  const fresh = await ContractAttachment.findByPk(attachment.id, { include: [{ model: User, as: 'uploadedBy', attributes: userAttrs }] });
  res.status(201).json({ attachment: fresh });
});

// GET /contracts/:id/attachments/:attachmentId/download
const downloadAttachment = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');
  const attachment = await ContractAttachment.findOne({ where: { id: req.params.attachmentId, contractId: contract.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');
  const filePath = path.join(UPLOAD_ROOT, 'contracts', String(contract.id), attachment.filename);
  res.download(filePath, attachment.originalName);
});

// DELETE /contracts/:id/attachments/:attachmentId
const removeAttachment = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');
  const attachment = await ContractAttachment.findOne({ where: { id: req.params.attachmentId, contractId: contract.id } });
  if (!attachment) throw new ApiError(404, 'Attachment not found', 'NOT_FOUND');

  const filePath = path.join(UPLOAD_ROOT, 'contracts', String(contract.id), attachment.filename);
  await attachment.destroy();
  fs.rm(filePath, { force: true }, () => {});
  await writeAudit(req, 'contractAttachment.delete', 'ContractAttachment', attachment.id, { contractId: contract.id });
  await logContractActivity(contract.id, req.user.id, 'attachment_removed', { originalName: attachment.originalName });
  res.json({ ok: true });
});

// GET /contracts/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id);
  if (!contract) throw new ApiError(404, 'Contract not found', 'NOT_FOUND');
  const activity = await ContractActivity.findAll({
    where: { contractId: contract.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity });
});

module.exports = {
  list, get, create, update, remove,
  listAssets, linkAsset, unlinkAsset,
  listAttachments, createAttachment, downloadAttachment, removeAttachment,
  listActivity,
};
