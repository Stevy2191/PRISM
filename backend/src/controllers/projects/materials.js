// Project materials: list, add, edit, delete.
const { Project, Task, ProjectMaterial, User, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { logProjectActivity } = require('../../services/projectActivity');
const { parsePagination, paginated } = require('../../utils/pagination');
const { resolveVendorFields, hideUnreachableVendors } = require('../../services/companyService');
const { canAccessProject } = require('../../services/permissionService');
const {
  SUBLIST_LIMIT, SUBLIST_MAX, userAttrs, resolveProjectTaskId,
} = require('./shared');

// ==================== Materials ====================

const materialInclude = [
  { model: User, as: 'addedByUser', attributes: userAttrs },
  { model: Company, as: 'vendorCompany', attributes: ['id', 'name'] },
  { model: Task, as: 'task', attributes: ['id', 'title', 'code'] },
];

// GET /projects/:id/materials
const listMaterials = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await ProjectMaterial.findAndCountAll({
    where: { projectId: project.id },
    include: materialInclude,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  // Named `totalAmount`, not `total` — `total` is the row count that every
  // paginated response carries, and the money sum would otherwise clobber it.
  const totalAmount = Number(await ProjectMaterial.sum('totalCost', { where: { projectId: project.id } })) || 0;
  await hideUnreachableVendors(req.user, rows);
  res.json({ ...paginated('materials', { rows, count }, { page, limit }), totalAmount });
});

// POST /projects/:id/materials
const createMaterial = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const { itemName, vendor, modelNumber, serialNumber, quantity, unitCost, taskId, notes } = req.body || {};
  if (!itemName || !itemName.trim()) throw new ApiError(400, 'Item name is required', 'VALIDATION_ERROR');

  const qty = quantity !== undefined ? Number(quantity) : 1;
  const cost = unitCost !== undefined ? Number(unitCost) : 0;
  if (!Number.isFinite(qty) || qty < 1) throw new ApiError(400, 'Quantity must be a positive number', 'VALIDATION_ERROR');
  if (!Number.isFinite(cost) || cost < 0) throw new ApiError(400, 'Unit cost must be a non-negative number', 'VALIDATION_ERROR');

  const serials = Array.isArray(serialNumber)
    ? serialNumber.filter(Boolean)
    : (serialNumber ? [String(serialNumber)] : []);

  const material = await ProjectMaterial.create({
    projectId: project.id,
    taskId: await resolveProjectTaskId(project, taskId),
    itemName: itemName.trim(),
    vendor: vendor || null,
    modelNumber: modelNumber || null,
    serialNumber: serials,
    quantity: qty,
    unitCost: cost,
    totalCost: Math.round(qty * cost * 100) / 100,
    notes: notes || null,
    addedBy: req.user.id,
    ...(await resolveVendorFields(req.user, req.body, null, 'vendor')),
  });
  await logProjectActivity(project.id, req.user.id, 'material_added', { materialId: material.id, itemName: material.itemName });

  const fresh = await ProjectMaterial.findByPk(material.id, { include: materialInclude });
  await hideUnreachableVendors(req.user, fresh);
  res.status(201).json({ material: fresh });
});

// PATCH /projects/:id/materials/:materialId
const updateMaterial = asyncHandler(async (req, res) => {
  const material = await ProjectMaterial.findOne({ where: { id: req.params.materialId, projectId: req.params.id } });
  if (!material) throw new ApiError(404, 'Material not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const allowed = ['itemName', 'vendor', 'modelNumber', 'serialNumber', 'quantity', 'unitCost', 'taskId', 'notes'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (Array.isArray(changes.serialNumber)) changes.serialNumber = changes.serialNumber.filter(Boolean);
  if (changes.taskId !== undefined) changes.taskId = await resolveProjectTaskId(project, changes.taskId);
  Object.assign(changes, await resolveVendorFields(req.user, req.body, material, 'vendor'));

  const qty = changes.quantity !== undefined ? Number(changes.quantity) : Number(material.quantity);
  const cost = changes.unitCost !== undefined ? Number(changes.unitCost) : Number(material.unitCost);
  if (changes.quantity !== undefined || changes.unitCost !== undefined) {
    changes.totalCost = Math.round(qty * cost * 100) / 100;
  }

  await material.update(changes);
  const fresh = await ProjectMaterial.findByPk(material.id, { include: materialInclude });
  await hideUnreachableVendors(req.user, fresh);
  res.json({ material: fresh });
});

// DELETE /projects/:id/materials/:materialId
const removeMaterial = asyncHandler(async (req, res) => {
  const material = await ProjectMaterial.findOne({ where: { id: req.params.materialId, projectId: req.params.id } });
  if (!material) throw new ApiError(404, 'Material not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await material.destroy();
  res.json({ ok: true });
});

module.exports = {
  listMaterials,
  createMaterial,
  updateMaterial,
  removeMaterial,
};
