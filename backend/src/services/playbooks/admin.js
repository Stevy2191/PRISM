// Saving forms and playbooks (Playbooks, PB, task 4). Shared by the Settings
// endpoints and the import, so an imported file goes through exactly the
// checks a form saved in Settings does.
const {
  sequelize, Form, FormVersion, Playbook, Mdm, AssetCategory, Company, TicketForm, TicketCategory,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { validateDefinition } = require('./formDefinition');
const { APPLIES } = require('./resolve');

const MAX_BLOCKS = 30;
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

function cleanName(raw, what) {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw bad(`Give the ${what} a name`);
  if (name.length > 150) throw bad(`The ${what}'s name is longer than 150 characters`);
  return name;
}
const cleanDescription = (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 2000) : null);
const idList = (raw) => (Array.isArray(raw) ? [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);

// ---- Forms --------------------------------------------------------------------

// → the form with its current definition, version number and how many open
// ticket forms are on an older or the current version.
async function presentForm(form, { withDefinition = true } = {}) {
  const current = form.currentVersionId ? await FormVersion.findByPk(form.currentVersionId) : null;
  const inUse = await TicketForm.count({
    where: { state: 'open' },
    include: [{ model: FormVersion, as: 'formVersion', where: { formId: form.id }, attributes: [] }],
  });
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    usage: form.usage,
    isActive: form.isActive,
    version: current ? current.version : null,
    versionId: current ? current.id : null,
    inUse,
    updatedAt: form.updatedAt,
    ...(withDefinition ? { definition: current ? current.definition : { sections: [] } } : {}),
  };
}

async function createForm({
  name, description, usage, definition, isActive = true,
}, userId, { transaction } = {}) {
  if (!['ticket', 'device'].includes(usage)) throw bad('A form is used once per ticket or per device');
  const clean = validateDefinition(definition, { usage });
  const run = async (t) => {
    const form = await Form.create({
      name: cleanName(name, 'form'), description: cleanDescription(description), usage, isActive, createdBy: userId,
    }, { transaction: t });
    const version = await FormVersion.create({ formId: form.id, version: 1, definition: clean, createdBy: userId }, { transaction: t });
    await form.update({ currentVersionId: version.id }, { transaction: t });
    return form;
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

// A new version every save; ticket forms keep the version they started on.
async function saveFormVersion(form, { name, description, definition }, userId) {
  const clean = validateDefinition(definition, { usage: form.usage });
  return sequelize.transaction(async (transaction) => {
    const last = (await FormVersion.max('version', { where: { formId: form.id }, transaction })) || 0;
    const version = await FormVersion.create({
      formId: form.id, version: last + 1, definition: clean, createdBy: userId,
    }, { transaction });
    const changes = { currentVersionId: version.id };
    if (name !== undefined) changes.name = cleanName(name, 'form');
    if (description !== undefined) changes.description = cleanDescription(description);
    await form.update(changes, { transaction });
    return form;
  });
}

// ---- Playbooks ----------------------------------------------------------------

async function cleanLimits(raw) {
  const l = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  const categoryIds = idList(l.categoryIds);
  if (categoryIds.length) {
    if ((await AssetCategory.count({ where: { id: categoryIds } })) !== categoryIds.length) throw bad('A playbook limit names an unknown device type');
    out.categoryIds = categoryIds;
  }
  const mdmIds = idList(l.mdmIds);
  if (mdmIds.length) {
    if ((await Mdm.count({ where: { id: mdmIds } })) !== mdmIds.length) throw bad('A playbook limit names an unknown MDM');
    out.mdmIds = mdmIds;
  }
  for (const key of ['managed', 'hasCellular', 'hasAgent']) {
    if (typeof l[key] === 'boolean') out[key] = l[key];
  }
  return out;
}

// → the blocks as stored. Each form exists; a once-block uses a form used
// once per ticket and a per-device block one used per device; only a playbook
// that needs a person can work on the person's devices.
async function cleanBlocks(raw, { needsPerson }) {
  if (!Array.isArray(raw)) throw bad('A playbook is a list of forms');
  if (raw.length > MAX_BLOCKS) throw bad(`A playbook has at most ${MAX_BLOCKS} forms`);
  const formIds = idList(raw.map((b) => b && b.formId));
  const forms = new Map((await Form.findAll({ where: { id: formIds } })).map((f) => [f.id, f]));
  const out = [];
  for (const [i, b] of raw.entries()) {
    const where = `Form ${i + 1} of the playbook`;
    if (!b || typeof b !== 'object') throw bad(`${where} is not valid`);
    const form = forms.get(Number(b.formId));
    if (!form) throw bad(`${where} is not a form`);
    if (!APPLIES.includes(b.applies)) throw bad(`${where} must apply once or per device`);
    if (b.applies === 'once' && form.usage !== 'ticket') throw bad(`${where} is used per device, so it can't apply once`);
    if (b.applies !== 'once' && form.usage !== 'device') throw bad(`${where} is used once per ticket, so it can't apply per device`);
    if (b.applies === 'person_devices' && !needsPerson) throw bad("Only a playbook that's for a person can use the person's devices");
    // eslint-disable-next-line no-await-in-loop
    const block = { formId: form.id, applies: b.applies, limits: b.applies === 'once' ? {} : await cleanLimits(b.limits) };
    out.push(block);
  }
  return out;
}

async function cleanCompanyIds(raw) {
  if (raw === null || raw === undefined) return null;
  const ids = idList(raw);
  if (!ids.length) return null;
  if ((await Company.count({ where: { id: ids } })) !== ids.length) throw bad('A playbook is offered for an unknown company');
  return ids;
}

// The ticket categories a bundle suggests itself on (PB2).
async function cleanSuggestCategoryIds(raw) {
  if (raw === null || raw === undefined) return null;
  const ids = idList(raw);
  if (!ids.length) return null;
  if ((await TicketCategory.count({ where: { id: ids } })) !== ids.length) throw bad('A bundle suggests itself on an unknown ticket category');
  return ids;
}

async function cleanPlaybook(body, current = null) {
  const b = body || {};
  const needsPerson = b.needsPerson !== undefined ? b.needsPerson === true : !!(current && current.needsPerson);
  return {
    name: b.name !== undefined || !current ? cleanName(b.name, 'playbook') : current.name,
    description: b.description !== undefined ? cleanDescription(b.description) : (current ? current.description : null),
    needsPerson,
    companyIds: b.companyIds !== undefined ? await cleanCompanyIds(b.companyIds) : (current ? current.companyIds : null),
    blocks: await cleanBlocks(b.blocks !== undefined ? b.blocks : (current ? current.blocks : []), { needsPerson }),
    suggestCategoryIds: b.suggestCategoryIds !== undefined ? await cleanSuggestCategoryIds(b.suggestCategoryIds) : (current ? current.suggestCategoryIds : null),
    ...(b.isActive !== undefined ? { isActive: b.isActive === true } : {}),
  };
}

async function nextPosition(Model) {
  return ((await Model.max('position')) || 0) + 1;
}

// Forms named in each playbook, for lists.
async function presentPlaybooks(playbooks) {
  const formIds = [...new Set(playbooks.flatMap((p) => (p.blocks || []).map((b) => b.formId)))];
  const forms = new Map((await Form.findAll({ where: { id: formIds }, attributes: ['id', 'name', 'usage', 'isActive'] })).map((f) => [f.id, f]));
  return playbooks.map((p) => ({
    ...p.toJSON(),
    blocks: (p.blocks || []).map((b) => ({ ...b, form: forms.get(b.formId) || null })),
  }));
}

module.exports = {
  presentForm, createForm, saveFormVersion, cleanPlaybook, presentPlaybooks, nextPosition, cleanName,
  cleanLimits,
};
