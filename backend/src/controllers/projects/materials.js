// Project materials: list, add, edit, delete.
const { Project, Task, ProjectMaterial, User, Company } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logProjectActivity } = require('../../services/projectActivity');
const { parsePagination, paginated } = require('../../utils/pagination');
const { resolveVendorFields, hideUnreachableVendors } = require('../../services/companyService');
const { canAccessProject } = require('../../services/permissionService');
const { D, unit, cents } = require('../../services/money/money');
const materials = require('../../services/money/materials');
const {
  SUBLIST_LIMIT, SUBLIST_MAX, userAttrs, resolveProjectTaskId,
  assertCanEditProject,
} = require('./shared');

// ==================== Materials ====================

// A material as the caller may see it (Phase 3). Without a money permission:
// no sell price ever, and no cost on what came from the catalog, the shelf or
// a purchase order; a cost typed in by hand for the project's budget stays.
const fromBooks = (m) => Boolean(m.catalogProductId || m.poLineId || m.fromStock);
function shownMaterial(m, prices) {
  const plain = m.get ? m.get({ plain: true }) : { ...m };
  if (!prices) {
    delete plain.unitPrice;
    if (fromBooks(plain)) { delete plain.unitCost; delete plain.totalCost; }
  }
  return plain;
}

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
  await hideUnreachableVendors(req.user, rows);
  // Costs and prices only with a money permission (Phase 3 rule; technicians
  // hold projects.manage_expenses, so that can't be the test).
  const prices = await materials.canSeePrices(req.user);
  const shown = rows.map((m) => shownMaterial(m, prices));
  const out = { ...paginated('materials', { rows: shown, count }, { page, limit }) };
  const typedOnly = prices ? {} : { catalogProductId: null, poLineId: null, fromStock: false };
  out.totalAmount = Number(await ProjectMaterial.sum('totalCost', { where: { projectId: project.id, ...typedOnly } })) || 0;
  res.json(out);
});

// POST /projects/:id/materials
const createMaterial = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  await assertCanEditProject(req.user, project);

  // Phase 3: from the catalog or the shelf, through the shared materials
  // service (catalog price, stock taken off the shelf).
  if ((req.body || {}).catalogProductId) {
    const prices = await materials.canSeePrices(req.user);
    const body = { ...req.body };
    if (!prices) { delete body.unitCost; delete body.unitPrice; }
    const m = await materials.addMaterial({ kind: 'project', record: project }, body, {
      user: req.user, pricesAllowed: prices, taskId: await resolveProjectTaskId(project, req.body.taskId),
    });
    await writeAudit(req, 'material.create', 'ProjectMaterial', m.id, { projectId: project.id, itemName: m.itemName, fromStock: m.fromStock });
    await logProjectActivity(project.id, req.user.id, 'material_added', { materialId: m.id, itemName: m.itemName });
    const fresh = await ProjectMaterial.findByPk(m.id, { include: materialInclude });
    await hideUnreachableVendors(req.user, fresh);
    return res.status(201).json({ material: shownMaterial(fresh, await materials.canSeePrices(req.user)) });
  }

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
  await writeAudit(req, 'material.create', 'ProjectMaterial', material.id, { projectId: project.id, itemName: material.itemName });
  await logProjectActivity(project.id, req.user.id, 'material_added', { materialId: material.id, itemName: material.itemName });

  const fresh = await ProjectMaterial.findByPk(material.id, { include: materialInclude });
  await hideUnreachableVendors(req.user, fresh);
  res.status(201).json({ material: shownMaterial(fresh, await materials.canSeePrices(req.user)) });
});

// PATCH /projects/:id/materials/:materialId
const updateMaterial = asyncHandler(async (req, res) => {
  const material = await ProjectMaterial.findOne({ where: { id: req.params.materialId, projectId: req.params.id } });
  if (!material) throw new ApiError(404, 'Material not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await assertCanEditProject(req.user, project);

  const allowed = ['itemName', 'vendor', 'modelNumber', 'serialNumber', 'quantity', 'unitCost', 'taskId', 'notes'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  // Edits run the create validation (Q33).
  if (changes.itemName !== undefined) {
    if (typeof changes.itemName !== 'string' || !changes.itemName.trim()) throw new ApiError(400, 'Item name is required', 'VALIDATION_ERROR');
    changes.itemName = changes.itemName.trim();
  }
  // Phase 3: a billed row is locked by its model hook; a shelf item's
  // quantity and cost are the shelf's (remove it and add it again); a catalog
  // item's cost changes only with a money permission.
  if (material.fromStock && (changes.quantity !== undefined || changes.unitCost !== undefined)) {
    throw new ApiError(400, 'Remove a shelf item and add it again to change how much was used', 'VALIDATION_ERROR');
  }
  if (material.catalogProductId && changes.unitCost !== undefined && !(await materials.canSeePrices(req.user))) {
    throw new ApiError(403, 'You need a money permission to change a catalog item\'s cost', 'FORBIDDEN');
  }
  if (changes.quantity !== undefined) changes.quantity = unit(materials.quantity(changes.quantity));
  if (changes.unitCost !== undefined) {
    const raw = String(changes.unitCost ?? '').trim();
    if (!/^\d{1,8}(\.\d{1,4})?$/.test(raw)) throw new ApiError(400, 'Unit cost must be a non-negative number', 'VALIDATION_ERROR');
    changes.unitCost = unit(raw);
  }
  if (Array.isArray(changes.serialNumber)) changes.serialNumber = changes.serialNumber.filter(Boolean);
  if (changes.taskId !== undefined) changes.taskId = await resolveProjectTaskId(project, changes.taskId);
  Object.assign(changes, await resolveVendorFields(req.user, req.body, material, 'vendor'));

  if (changes.quantity !== undefined || changes.unitCost !== undefined) {
    changes.totalCost = cents(D(changes.unitCost ?? material.unitCost ?? 0).times(D(changes.quantity ?? material.quantity)));
  }

  await material.update(changes);
  await writeAudit(req, 'material.update', 'ProjectMaterial', material.id, { projectId: project.id, fields: Object.keys(changes) });
  const fresh = await ProjectMaterial.findByPk(material.id, { include: materialInclude });
  await hideUnreachableVendors(req.user, fresh);
  res.json({ material: shownMaterial(fresh, await materials.canSeePrices(req.user)) });
});

// DELETE /projects/:id/materials/:materialId
const removeMaterial = asyncHandler(async (req, res) => {
  const material = await ProjectMaterial.findOne({ where: { id: req.params.materialId, projectId: req.params.id } });
  if (!material) throw new ApiError(404, 'Material not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await assertCanEditProject(req.user, project);
  await materials.removeMaterial(material, { user: req.user }); // a shelf item goes back on the shelf
  await writeAudit(req, 'material.delete', 'ProjectMaterial', material.id, { projectId: project.id, itemName: material.itemName });
  res.json({ ok: true });
});

module.exports = {
  listMaterials,
  createMaterial,
  updateMaterial,
  removeMaterial,
};
