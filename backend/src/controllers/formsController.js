// Forms in Settings (Playbooks, PB, task 4). Every save is a new version;
// ticket forms keep the version they were created from.
const { Form } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const { presentForm, createForm, saveFormVersion } = require('../services/playbooks/admin');

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

module.exports = {
  list, get, create, save, setActive,
};
