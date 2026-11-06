// Exporting and importing forms and playbooks (Playbooks, PB, task 4), so
// organizations can share processes without anything built in.
//
// Ids mean nothing in another install, so an export names what conditions
// and limits refer to: a condition's value { $ref: 'mdm'|'category'|
// 'company'|'department', name }, a playbook limit's MDMs and device types
// by name. Importing matches those names in this install; whatever doesn't
// match is reported, and the importer maps it to something here or drops
// it. Imported forms and playbooks arrive inactive, to be reviewed first.
// Which companies a playbook is offered for isn't exported.
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const {
  Form, FormVersion, Playbook, Mdm, AssetCategory, Company, Department,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { validateDefinition } = require('./formDefinition');
const { createForm, nextPosition, cleanName } = require('./admin');
const { APPLIES } = require('./resolve');
const { getUserCompanyIds } = require('../permissionService');

const FORMAT = 'prism-playbooks';
const LIMITS = { forms: 200, playbooks: 100 };
const KINDS = ['mdm', 'category', 'company', 'department'];
const bad = (message, details) => new ApiError(400, message, 'IMPORT_INVALID', details);

// Which condition fields hold an id of what.
function refKind(cond) {
  if (cond.on === 'device') return { mdmId: 'mdm', categoryId: 'category', carrierCompanyId: 'company', companyId: 'company' }[cond.field] || null;
  if (cond.on === 'person') return { companyId: 'company', departmentId: 'department' }[cond.field] || null;
  return null;
}

// Calls fn(condition) for every condition in a definition; fn returns the
// condition to keep, or null to drop it.
function mapConditions(def, fnc) {
  const mapList = (list) => {
    if (!Array.isArray(list)) return list;
    const out = list.map(fnc).filter(Boolean);
    return out.length ? out : undefined;
  };
  return {
    sections: (def.sections || []).map((s) => {
      // Malformed parts are passed on as they are, for validateDefinition to refuse.
      if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
      const items = Array.isArray(s.items) ? s.items.map((i) => {
        if (!i || typeof i !== 'object' || Array.isArray(i)) return i;
        const item = { ...i, showWhen: mapList(i.showWhen) };
        if (!item.showWhen) delete item.showWhen;
        return item;
      }) : s.items;
      const section = { ...s, items };
      section.showWhen = mapList(s.showWhen);
      if (!section.showWhen) delete section.showWhen;
      return section;
    }),
  };
}

// ---- Export -------------------------------------------------------------------

async function namesById() {
  const [mdms, categories, companies, departments] = await Promise.all([
    Mdm.findAll({ attributes: ['id', 'name'] }),
    AssetCategory.findAll({ attributes: ['id', 'name'] }),
    Company.findAll({ attributes: ['id', 'name'] }),
    Department.findAll({ attributes: ['id', 'name'] }),
  ]);
  const map = (rows) => new Map(rows.map((r) => [r.id, r.name]));
  return {
    mdm: map(mdms), category: map(categories), company: map(companies), department: map(departments),
  };
}

async function exportFile({ formIds = [], playbookIds = [] }) {
  const playbooks = await Playbook.findAll({ where: { id: playbookIds }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const wanted = new Set([...formIds.map(Number), ...playbooks.flatMap((p) => p.blocks.map((b) => b.formId))]);
  const forms = await Form.findAll({ where: { id: [...wanted] }, order: [['name', 'ASC']] });
  const names = await namesById();
  const named = (kind, id) => ({ $ref: kind, name: names[kind].get(Number(id)) || `#${id}` });
  const exportCondition = (c) => {
    const kind = refKind(c);
    if (!kind || c.value === undefined || c.value === null) return c;
    return { ...c, value: Array.isArray(c.value) ? c.value.map((v) => named(kind, v)) : named(kind, c.value) };
  };
  const outForms = [];
  for (const form of forms) {
    // eslint-disable-next-line no-await-in-loop
    const version = await FormVersion.findByPk(form.currentVersionId);
    outForms.push({
      ref: `form-${form.id}`, name: form.name, description: form.description, usage: form.usage,
      definition: mapConditions(version ? version.definition : { sections: [] }, exportCondition),
    });
  }
  const outPlaybooks = playbooks.map((p) => ({
    name: p.name,
    description: p.description,
    needsPerson: p.needsPerson,
    blocks: p.blocks.map((b) => {
      const l = b.limits || {};
      const limits = {};
      if (l.categoryIds) limits.categories = l.categoryIds.map((id) => names.category.get(id) || `#${id}`);
      if (l.mdmIds) limits.mdms = l.mdmIds.map((id) => names.mdm.get(id) || `#${id}`);
      for (const k of ['managed', 'hasCellular', 'hasAgent']) if (typeof l[k] === 'boolean') limits[k] = l[k];
      return { form: `form-${b.formId}`, applies: b.applies, limits };
    }),
  }));
  return {
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(), forms: outForms, playbooks: outPlaybooks,
  };
}

// ---- Import -------------------------------------------------------------------

const isRef = (v) => v && typeof v === 'object' && !Array.isArray(v) && KINDS.includes(v.$ref) && typeof v.name === 'string';
const key = (kind, name) => `${kind}\u0000${name.trim().toLowerCase()}`;

function parseFile(file) {
  if (!file || typeof file !== 'object' || file.format !== FORMAT || file.version !== 1) {
    throw bad("This isn't a PRISM forms and playbooks file");
  }
  if (!Array.isArray(file.forms) || !Array.isArray(file.playbooks)) throw bad('The file has no forms or playbooks list');
  if (file.forms.length > LIMITS.forms || file.playbooks.length > LIMITS.playbooks) throw bad('The file has too many forms or playbooks');
  const refs = new Set();
  file.forms.forEach((f, i) => {
    if (!f || typeof f !== 'object' || typeof f.ref !== 'string') throw bad(`Form ${i + 1} in the file is not valid`);
    if (refs.has(f.ref)) throw bad(`Two forms in the file share the reference "${f.ref}"`);
    refs.add(f.ref);
  });
  file.playbooks.forEach((p, i) => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.blocks)) throw bad(`Playbook ${i + 1} in the file is not valid`);
    p.blocks.forEach((b) => {
      if (!b || !refs.has(b.form)) throw bad(`Playbook ${i + 1} in the file uses a form the file doesn't have`);
      if (!APPLIES.includes(b.applies)) throw bad(`Playbook ${i + 1} in the file has a form that applies neither once nor per device`);
    });
  });
  return file;
}

// Every name the file refers to: [{ kind, name }].
function collectNames(file) {
  const seen = new Map();
  const note = (kind, name) => { if (typeof name === 'string' && name.trim()) seen.set(key(kind, name), { kind, name: name.trim() }); };
  file.forms.forEach((f) => {
    const def = f.definition && typeof f.definition === 'object' ? f.definition : {};
    mapConditions({ sections: Array.isArray(def.sections) ? def.sections : [] }, (c) => {
      if (c && typeof c === 'object') [].concat(c.value).filter(isRef).forEach((r) => note(r.$ref, r.name));
      return c;
    });
  });
  file.playbooks.forEach((p) => p.blocks.forEach((b) => {
    const l = b.limits || {};
    (Array.isArray(l.categories) ? l.categories : []).forEach((n) => note('category', n));
    (Array.isArray(l.mdms) ? l.mdms : []).forEach((n) => note('mdm', n));
  }));
  return [...seen.values()];
}

async function matchByName(user, kind, name) {
  const byName = { [Op.and]: [sqlWhere(fn('LOWER', col('name')), name.toLowerCase())] };
  if (kind === 'mdm') return (await Mdm.findOne({ where: byName })) || null;
  if (kind === 'category') return (await AssetCategory.findOne({ where: byName })) || null;
  const reachable = await getUserCompanyIds(user);
  const fence = reachable === null ? {} : { [kind === 'company' ? 'id' : 'companyId']: reachable };
  const Model = kind === 'company' ? Company : Department;
  const rows = await Model.findAll({ where: { ...byName, ...fence } });
  return rows.length === 1 ? rows[0] : null; // two departments of that name: ask
}

async function mappedIdOk(user, kind, id) {
  if (kind === 'mdm') return !!(await Mdm.findByPk(id));
  if (kind === 'category') return !!(await AssetCategory.findByPk(id));
  const reachable = await getUserCompanyIds(user);
  if (kind === 'company') return !!(await Company.findByPk(id)) && (reachable === null || reachable.includes(id));
  const dept = await Department.findByPk(id);
  return !!dept && (reachable === null || reachable.includes(dept.companyId));
}

// → Map(key → id | null). Throws when a mapping names something unusable.
async function resolveNames(user, names, mapping) {
  const out = new Map();
  const needs = [];
  for (const { kind, name } of names) {
    const given = mapping && mapping[kind] && Object.prototype.hasOwnProperty.call(mapping[kind], name) ? mapping[kind][name] : undefined;
    // eslint-disable-next-line no-await-in-loop
    const match = await matchByName(user, kind, name);
    if (given === null) {
      out.set(key(kind, name), null);
    } else if (given !== undefined) {
      const id = Number(given);
      // eslint-disable-next-line no-await-in-loop
      if (!Number.isInteger(id) || !(await mappedIdOk(user, kind, id))) throw bad(`"${name}" is mapped to something that doesn't exist here`);
      out.set(key(kind, name), id);
    } else if (match) {
      out.set(key(kind, name), match.id);
    }
    needs.push({
      kind, name, matchId: match ? match.id : null, resolved: out.has(key(kind, name)),
    });
  }
  return { ids: out, needs };
}

// POST /playbooks/import { file, mapping?, dryRun? }
// dryRun, or anything unmatched: → { imported: false, needs, forms, playbooks }.
// Else everything is checked first, then saved inactive:
// → { imported: true, forms: [{ id, name }], playbooks: [{ id, name }] }.
async function importFile(user, { file, mapping, dryRun }) {
  const parsed = parseFile(file);
  const { ids, needs } = await resolveNames(user, collectNames(parsed), mapping);
  const counts = { forms: parsed.forms.length, playbooks: parsed.playbooks.length };
  const unresolved = needs.filter((n) => !n.resolved);
  if (dryRun || unresolved.length) {
    if (!dryRun) throw new ApiError(409, 'Some names in the file need mapping first', 'IMPORT_NEEDS_MAPPING', { needs });
    return { imported: false, needs, ...counts };
  }

  const toId = (r) => ids.get(key(r.$ref, r.name));
  const importCondition = (c) => {
    if (!c || typeof c !== 'object') return c;
    if (Array.isArray(c.value)) {
      const values = c.value.map((v) => (isRef(v) ? toId(v) : v)).filter((v) => v !== null && v !== undefined);
      return values.length ? { ...c, value: values } : null;
    }
    if (isRef(c.value)) {
      const id = toId(c.value);
      return id === null || id === undefined ? null : { ...c, value: id };
    }
    return c;
  };

  // Check every form before saving any, so a bad file saves nothing.
  const forms = parsed.forms.map((f, i) => {
    if (!['ticket', 'device'].includes(f.usage)) throw bad(`Form ${i + 1} in the file is used neither once per ticket nor per device`);
    const raw = f.definition && typeof f.definition === 'object' && Array.isArray(f.definition.sections) ? f.definition : null;
    if (!raw) throw bad(`Form ${i + 1} in the file has no sections`);
    const definition = mapConditions(raw, importCondition);
    validateDefinition(definition, { usage: f.usage });
    return {
      ref: f.ref, name: cleanName(f.name, 'form'), description: f.description, usage: f.usage, definition,
    };
  });
  const usageByRef = new Map(forms.map((f) => [f.ref, f.usage]));
  const playbooks = parsed.playbooks.map((p, i) => {
    const needsPerson = p.needsPerson === true;
    const blocks = p.blocks.map((b) => {
      const usage = usageByRef.get(b.form);
      if ((b.applies === 'once') !== (usage === 'ticket')) throw bad(`Playbook ${i + 1} in the file applies a form the wrong way`);
      if (b.applies === 'person_devices' && !needsPerson) throw bad(`Playbook ${i + 1} in the file uses the person's devices without a person`);
      const l = b.limits || {};
      const limits = {};
      const categoryIds = (Array.isArray(l.categories) ? l.categories : []).map((n) => ids.get(key('category', n))).filter(Boolean);
      const mdmIds = (Array.isArray(l.mdms) ? l.mdms : []).map((n) => ids.get(key('mdm', n))).filter(Boolean);
      if (categoryIds.length) limits.categoryIds = categoryIds;
      if (mdmIds.length) limits.mdmIds = mdmIds;
      for (const k of ['managed', 'hasCellular', 'hasAgent']) if (typeof l[k] === 'boolean') limits[k] = l[k];
      return { formRef: b.form, applies: b.applies, limits: b.applies === 'once' ? {} : limits };
    });
    return {
      name: cleanName(p.name, 'playbook'), description: typeof p.description === 'string' ? p.description.slice(0, 2000) : null, needsPerson, blocks,
    };
  });

  const newIds = new Map();
  const savedForms = [];
  for (const f of forms) {
    // eslint-disable-next-line no-await-in-loop
    const form = await createForm({ ...f, isActive: false }, user.id);
    newIds.set(f.ref, form.id);
    savedForms.push({ id: form.id, name: form.name });
  }
  const savedPlaybooks = [];
  for (const p of playbooks) {
    // eslint-disable-next-line no-await-in-loop
    const playbook = await Playbook.create({
      name: p.name,
      description: p.description,
      needsPerson: p.needsPerson,
      companyIds: null,
      blocks: p.blocks.map((b) => ({ formId: newIds.get(b.formRef), applies: b.applies, limits: b.limits })),
      isActive: false,
      position: await nextPosition(Playbook), // eslint-disable-line no-await-in-loop
      createdBy: user.id,
    });
    savedPlaybooks.push({ id: playbook.id, name: playbook.name });
  }
  return { imported: true, forms: savedForms, playbooks: savedPlaybooks };
}

module.exports = { exportFile, importFile, FORMAT };
