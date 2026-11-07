// Forms in Settings (Playbooks, PB, task 4). Every save is a new version;
// ticket forms keep the version they were created from.
const { Form } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const { presentForm, createForm, saveFormVersion } = require('../services/playbooks/admin');
const { validateDefinition, evaluate } = require('../services/playbooks/formDefinition');

async function findForm(req) {
  const form = await Form.findByPk(parseRecordId(req.params.id) || 0);
  if (!form) throw new ApiError(404, 'Form not found', 'NOT_FOUND');
  return form;
}

// GET /forms?active=true
const list = asyncHandler(async (req, res) => {
  const where = req.query.active === 'true' ? { isActive: true } : {};
  const forms = await Form.findAll({ where, order: [['name', 'ASC'], ['id', 'ASC']] });
  res.json({ forms: await Promise.all(forms.map((f) => presentForm(f, { withDefinition: false }))) });
});

// GET /forms/:id → the current definition.
const get = asyncHandler(async (req, res) => {
  res.json({ form: await presentForm(await findForm(req)) });
});

// POST /forms { name, description, usage, definition }
const create = asyncHandler(async (req, res) => {
  const form = await createForm(req.body || {}, req.user.id);
  await writeAudit(req, 'form.create', 'Form', form.id, { name: form.name });
  res.status(201).json({ form: await presentForm(form) });
});

// PUT /forms/:id { name?, description?, definition } → a new version.
const save = asyncHandler(async (req, res) => {
  const form = await findForm(req);
  const body = req.body || {};
  await saveFormVersion(form, body, req.user.id);
  const out = await presentForm(form);
  await writeAudit(req, 'form.update', 'Form', form.id, { version: out.version });
  res.json({ form: out });
});

// PATCH /forms/:id { isActive }
const setActive = asyncHandler(async (req, res) => {
  const form = await findForm(req);
  if (typeof (req.body || {}).isActive !== 'boolean') throw new ApiError(400, 'isActive must be true or false', 'VALIDATION_ERROR');
  await form.update({ isActive: req.body.isActive });
  await writeAudit(req, 'form.update', 'Form', form.id, { isActive: form.isActive });
  res.json({ form: await presentForm(form) });
});

// POST /forms/try { usage, definition, device: { categoryId, mdm } } (PB2)
// The editor's Try it: which lines show for that device. Nothing is saved.
const tryIt = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const def = validateDefinition(body.definition, { usage: body.usage });
  const d = body.device && typeof body.device === 'object' ? body.device : {};
  const mdm = d.mdm === 'none' || d.mdm === null || d.mdm === undefined ? 'none' : parseRecordId(d.mdm);
  if (mdm === null) throw new ApiError(400, 'Choose an MDM, or not managed', 'VALIDATION_ERROR');
  const device = body.usage === 'device' ? {
    categoryId: parseRecordId(d.categoryId),
    mdm,
    isManaged: mdm !== 'none',
    mdmId: mdm === 'none' ? null : mdm,
    hasCellular: d.hasCellular === true,
    carrierCompanyId: null,
    hasAgent: d.hasAgent === true,
    companyId: null,
  } : null;
  const state = evaluate(def, { device, person: null });
  const all = state.sections.flatMap((s) => s.items.map((i) => ({ ...i, shown: s.shown && i.shown })));
  const lines = all.filter((i) => i.kind !== 'action');
  res.json({
    evaluation: state,
    shown: lines.filter((i) => i.shown && i.kind !== 'text').length,
    hidden: lines.filter((i) => !i.shown).length,
  });
});

module.exports = {
  list, get, create, save, setActive, tryIt,
};
