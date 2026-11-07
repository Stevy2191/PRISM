// Playbooks in Settings (Playbooks, PB, task 4): forms applied to a ticket
// together, a preview for a person, and export / import.
const { Playbook, Form } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId, findAccessibleContact } = require('../services/permissionService');
const { cleanPlaybook, presentPlaybooks, nextPosition } = require('../services/playbooks/admin');
const { resolvePlaybook, offeredFor } = require('../services/playbooks/resolve');
const { exportFile, importFile } = require('../services/playbooks/transfer');

const ORDER = [['position', 'ASC'], ['name', 'ASC'], ['id', 'ASC']];

async function findPlaybook(req) {
  const playbook = await Playbook.findByPk(parseRecordId(req.params.id) || 0);
  if (!playbook) throw new ApiError(404, 'Bundle not found', 'NOT_FOUND');
  return playbook;
}

// GET /playbooks?active=true
const list = asyncHandler(async (req, res) => {
  const where = req.query.active === 'true' ? { isActive: true } : {};
  res.json({ playbooks: await presentPlaybooks(await Playbook.findAll({ where, order: ORDER })) });
});

// GET /playbooks/:id
const get = asyncHandler(async (req, res) => {
  res.json({ playbook: (await presentPlaybooks([await findPlaybook(req)]))[0] });
});

// POST /playbooks { name, description, needsPerson, companyIds, blocks }
const create = asyncHandler(async (req, res) => {
  const values = await cleanPlaybook(req.body);
  const playbook = await Playbook.create({ ...values, position: await nextPosition(Playbook), createdBy: req.user.id });
  await writeAudit(req, 'playbook.create', 'Playbook', playbook.id, { name: playbook.name });
  res.status(201).json({ playbook: (await presentPlaybooks([playbook]))[0] });
});

// PUT /playbooks/:id: the same fields; those left out stay as they are.
const update = asyncHandler(async (req, res) => {
  const playbook = await findPlaybook(req);
  await playbook.update(await cleanPlaybook(req.body, playbook));
  await writeAudit(req, 'playbook.update', 'Playbook', playbook.id, { name: playbook.name });
  res.json({ playbook: (await presentPlaybooks([playbook]))[0] });
});

// PATCH /playbooks/:id { isActive }
const setActive = asyncHandler(async (req, res) => {
  const playbook = await findPlaybook(req);
  if (typeof (req.body || {}).isActive !== 'boolean') throw new ApiError(400, 'isActive must be true or false', 'VALIDATION_ERROR');
  await playbook.update({ isActive: req.body.isActive });
  await writeAudit(req, 'playbook.update', 'Playbook', playbook.id, { isActive: playbook.isActive });
  res.json({ playbook: (await presentPlaybooks([playbook]))[0] });
});

const { personDevices } = require('../services/playbooks/apply');

const assetSummary = (a) => ({
  id: a.id, assetTag: a.assetTag, name: a.name, categoryId: a.categoryId, isManaged: a.isManaged, mdmId: a.mdmId, hasCellular: a.hasCellular,
});

// POST /playbooks/:id/preview { contactId } → which form each of the
// person's devices would get, and the devices no form covers ("Try it on
// someone"). Ticket devices don't exist yet here.
const preview = asyncHandler(async (req, res) => {
  const playbook = await findPlaybook(req);
  let contact = null;
  if ((req.body || {}).contactId !== undefined && req.body.contactId !== null) {
    contact = await findAccessibleContact(req.user, req.body.contactId);
    if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
    if (!offeredFor(playbook, contact.companyId)) throw new ApiError(400, "This playbook isn't offered for that person's company", 'NOT_OFFERED');
  }
  const devices = contact ? await personDevices(contact) : [];
  const { forms, uncovered } = resolvePlaybook(playbook, { personDevices: devices });
  const formNames = new Map((await Form.findAll({ where: { id: forms.map((f) => f.formId) }, attributes: ['id', 'name'] })).map((f) => [f.id, f.name]));
  const byId = new Map(devices.map((d) => [d.id, d]));
  res.json({
    forms: forms.map((f) => ({ ...f, formName: formNames.get(f.formId) || null, asset: f.assetId ? assetSummary(byId.get(f.assetId)) : null })),
    uncovered: uncovered.map(assetSummary),
  });
});

// POST /playbooks/export { formIds, playbookIds } → the file.
const exportPlaybooks = asyncHandler(async (req, res) => {
  const ids = (raw) => (Array.isArray(raw) ? raw.map(parseRecordId).filter(Boolean) : []);
  const body = req.body || {};
  const file = await exportFile({ formIds: ids(body.formIds), playbookIds: ids(body.playbookIds) });
  await writeAudit(req, 'playbook.export', 'Playbook', null, { forms: file.forms.length, playbooks: file.playbooks.length });
  res.json(file);
});

// POST /playbooks/import { file, mapping?, dryRun? }
const importPlaybooks = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await importFile(req.user, { file: body.file, mapping: body.mapping, dryRun: body.dryRun === true });
  if (result.imported) {
    await writeAudit(req, 'playbook.import', 'Playbook', null, { forms: result.forms.length, playbooks: result.playbooks.length });
  }
  res.status(result.imported ? 201 : 200).json(result);
});

module.exports = {
  list, get, create, update, setActive, preview, exportPlaybooks, importPlaybooks, personDevices,
};
