// Project template storage (sub-project 6): checking a structure sent by a
// client, saving it (full replace in one transaction) and reading it back.
// A structure uses the same ids on the way in and out: phases, tasks and
// dependencies point at each other by the `id` the item carries in the same
// payload (any whole number or short string; saving assigns the real ids).
const { ApiError } = require('../../middleware/error');
const {
  ProjectTemplate, ProjectTemplatePhase, ProjectTemplateTask, ProjectTemplateDependency,
} = require('../../models');
const { cleanBudgetMinutes } = require('./budget');
const { wouldCycle } = require('./schedule');
const { MAX_DAYS } = require('./templatePlan');

const LIMITS = {
  tasks: 500, phases: 50, dependencies: 1000, tags: 20, tagLength: 50, name: 150, phaseName: 100, title: 500, text: 10000, days: MAX_DAYS,
};
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const bad = (message, code = 'VALIDATION_ERROR') => new ApiError(400, message, code);
const given = (v) => v !== undefined && v !== null && v !== '';
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function cleanString(value, label, max, { required = false } = {}) {
  if (!given(value)) {
    if (required) throw bad(`${label} is required`);
    return null;
  }
  if (typeof value !== 'string') throw bad(`${label} must be text`);
  const text = value.trim();
  if (!text) {
    if (required) throw bad(`${label} is required`);
    return null;
  }
  if (text.length > max) throw bad(`${label} is too long (at most ${max} characters)`);
  return text;
}

function cleanInt(value, label, min, max, fallback) {
  if (!given(value)) return fallback;
  const n = typeof value === 'number' || (typeof value === 'string' && /^\d{1,9}$/.test(value.trim())) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number from ${min} to ${max}`);
  return n;
}

// An item's own id as sent: a whole number or a short string, kept as text.
function ref(value, label) {
  const ok = (typeof value === 'number' && Number.isInteger(value) && value >= 0) || (typeof value === 'string' && value.trim() && value.length <= 40);
  if (!ok) throw bad(`Every ${label} needs an id`);
  return String(value);
}

function cleanTags(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > LIMITS.tags) throw bad(`Tags must be a list of at most ${LIMITS.tags}`);
  const tags = value.map((t) => cleanString(t, 'A tag', LIMITS.tagLength)).filter(Boolean);
  return tags.length ? [...new Set(tags)] : null;
}

// The template's own fields: name, description, hour budget and tags.
function cleanTemplateFields(body) {
  return {
    name: cleanString(body.name, 'Template name', LIMITS.name, { required: true }),
    description: cleanString(body.description, 'Description', LIMITS.text),
    hourBudgetMinutes: cleanBudgetMinutes(given(body.hourBudgetMinutes) ? body.hourBudgetMinutes : null),
    tags: cleanTags(body.tags),
  };
}

// phases / tasks / dependencies, checked as one structure (all ids are the
// payload's own). Throws 400 on anything that points outside the structure.
function cleanStructure(body) {
  const rawPhases = body.phases === undefined ? [] : body.phases;
  const rawTasks = body.tasks === undefined ? [] : body.tasks;
  const rawDeps = body.dependencies === undefined ? [] : body.dependencies;
  for (const [list, key] of [[rawPhases, 'phases'], [rawTasks, 'tasks'], [rawDeps, 'dependencies']]) {
    if (!Array.isArray(list)) throw bad(`${key} must be a list`);
    if (list.length > LIMITS[key]) throw bad(`A template can have at most ${LIMITS[key]} ${key}`);
    if (list.some((x) => !isObject(x))) throw bad(`Every item in ${key} must be an object`);
  }

  const phases = rawPhases.map((p) => ({
    id: ref(p.id, 'phase'),
    name: cleanString(p.name, 'Phase name', LIMITS.phaseName, { required: true }),
    hourBudgetMinutes: cleanBudgetMinutes(given(p.hourBudgetMinutes) ? p.hourBudgetMinutes : null),
  }));
  const phaseIds = new Set(phases.map((p) => p.id));
  if (phaseIds.size !== phases.length) throw bad('Phase ids must be different');

  const taskIds = new Set();
  const parentOf = new Map();
  const tasks = rawTasks.map((t) => {
    const id = ref(t.id, 'task');
    if (taskIds.has(id)) throw bad('Task ids must be different');
    taskIds.add(id);
    const parentId = given(t.parentId) ? ref(t.parentId, 'parent') : null;
    const phaseId = given(t.phaseId) ? ref(t.phaseId, 'phase') : null;
    if (phaseId && !phaseIds.has(phaseId)) throw bad('A task names a phase that is not in the template');
    if (given(t.isMilestone) && typeof t.isMilestone !== 'boolean') throw bad('isMilestone must be true or false');
    const isMilestone = t.isMilestone === true;
    const priority = given(t.priority) ? t.priority : 'medium';
    if (!PRIORITIES.includes(priority)) throw bad('Invalid priority');
    const lengthDays = cleanInt(t.lengthDays, 'Length', 0, LIMITS.days, isMilestone ? 0 : 1);
    if (isMilestone && lengthDays !== 0) throw bad('A milestone has a length of 0 days');
    if (!isMilestone && lengthDays < 1) throw bad('A task is at least 1 day long; only a milestone has 0');
    parentOf.set(id, parentId);
    return {
      id,
      parentId,
      phaseId: parentId ? null : phaseId, // a subtask follows its parent's phase
      title: cleanString(t.title, 'Task title', LIMITS.title, { required: true }),
      description: cleanString(t.description, 'Task description', LIMITS.text),
      startDay: cleanInt(t.startDay, 'Start day', 1, LIMITS.days, 1),
      lengthDays,
      estimateMinutes: isMilestone ? null : cleanInt(t.estimateMinutes, 'Estimate', 0, 6000000, null),
      priority,
      isMilestone,
    };
  });
  const milestones = new Set(tasks.filter((t) => t.isMilestone).map((t) => t.id));
  for (const t of tasks) {
    if (!t.parentId) continue; // eslint-disable-line no-continue
    if (!taskIds.has(t.parentId)) throw bad('A subtask names a parent that is not in the template');
    if (parentOf.get(t.parentId)) throw bad("Subtasks can't have subtasks");
    if (t.isMilestone) throw bad("A subtask can't be a milestone");
    if (milestones.has(t.parentId)) throw bad("A milestone can't have subtasks");
  }

  const deps = [];
  for (const d of rawDeps) {
    const predecessorId = ref(d.predecessorId, 'dependency end');
    const successorId = ref(d.successorId, 'dependency end');
    if (!taskIds.has(predecessorId) || !taskIds.has(successorId)) throw bad('A dependency links two tasks that are in the template');
    if (parentOf.get(predecessorId) || parentOf.get(successorId)) throw bad('A dependency links tasks or milestones, not subtasks');
    if (deps.some((x) => x.predecessorId === predecessorId && x.successorId === successorId)) throw bad('Two tasks are linked more than once');
    if (wouldCycle(deps, predecessorId, successorId)) throw bad("A task can't wait on itself, directly or through other tasks", 'DEPENDENCY_CYCLE');
    deps.push({ predecessorId, successorId });
  }
  return { phases, tasks, dependencies: deps };
}

// Writes the structure under `template`; returns nothing. Phases first, then
// tasks parents-before-children, then the links.
async function writeStructure(template, structure, transaction) {
  const phaseIds = new Map();
  for (const [i, p] of structure.phases.entries()) {
    const row = await ProjectTemplatePhase.create({ templateId: template.id, name: p.name, position: i + 1, hourBudgetMinutes: p.hourBudgetMinutes }, { transaction }); // eslint-disable-line no-await-in-loop
    phaseIds.set(p.id, row.id);
  }
  const taskIds = new Map();
  const ordered = [...structure.tasks.filter((t) => !t.parentId), ...structure.tasks.filter((t) => t.parentId)];
  const positions = new Map();
  for (const t of ordered) {
    const key = t.parentId || '';
    positions.set(key, (positions.get(key) || 0) + 1);
    const row = await ProjectTemplateTask.create({ // eslint-disable-line no-await-in-loop
      templateId: template.id,
      templatePhaseId: t.phaseId ? phaseIds.get(t.phaseId) : null,
      parentId: t.parentId ? taskIds.get(t.parentId) : null,
      title: t.title,
      description: t.description,
      startDay: t.startDay,
      lengthDays: t.lengthDays,
      estimateMinutes: t.estimateMinutes,
      priority: t.priority,
      isMilestone: t.isMilestone,
      position: positions.get(key),
    }, { transaction });
    taskIds.set(t.id, row.id);
  }
  if (structure.dependencies.length) {
    await ProjectTemplateDependency.bulkCreate(
      structure.dependencies.map((d) => ({ predecessorId: taskIds.get(d.predecessorId), successorId: taskIds.get(d.successorId) })),
      { transaction }
    );
  }
}

// Creates (template null) or replaces a template: its fields and the whole
// structure, in the caller's transaction. A taken name is a 409.
async function saveTemplate(template, fields, structure, { createdBy, sourceProjectId = null, transaction }) {
  const clash = await ProjectTemplate.findOne({ where: { name: fields.name }, transaction });
  if (clash && (!template || clash.id !== template.id)) throw new ApiError(409, 'A template with that name already exists', 'TEMPLATE_NAME_TAKEN');
  let row = template;
  if (row) {
    await row.update(fields, { transaction });
    await ProjectTemplateTask.destroy({ where: { templateId: row.id }, transaction });
    await ProjectTemplatePhase.destroy({ where: { templateId: row.id }, transaction });
  } else {
    row = await ProjectTemplate.create({ ...fields, createdBy, sourceProjectId }, { transaction });
  }
  await writeStructure(row, structure, transaction);
  return row;
}

// The stored structure in the shape cleanStructure accepts (ids are the real
// ones, as numbers).
async function loadStructure(templateId) {
  const order = [['position', 'ASC'], ['id', 'ASC']];
  const phases = await ProjectTemplatePhase.findAll({ where: { templateId }, order });
  const rows = await ProjectTemplateTask.findAll({ where: { templateId }, order });
  const top = rows.filter((t) => !t.parentId);
  const sub = rows.filter((t) => t.parentId);
  const deps = rows.length ? await ProjectTemplateDependency.findAll({ where: { predecessorId: rows.map((t) => t.id) }, order: [['id', 'ASC']] }) : [];
  return {
    phases: phases.map((p) => ({ id: p.id, name: p.name, hourBudgetMinutes: p.hourBudgetMinutes })),
    tasks: [...top, ...sub].map((t) => ({
      id: t.id,
      parentId: t.parentId,
      phaseId: t.templatePhaseId,
      title: t.title,
      description: t.description,
      startDay: t.startDay,
      lengthDays: t.lengthDays,
      estimateMinutes: t.estimateMinutes,
      priority: t.priority,
      isMilestone: t.isMilestone,
    })),
    dependencies: deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId })),
  };
}

module.exports = {
  LIMITS, cleanTemplateFields, cleanStructure, saveTemplate, loadStructure, cleanString,
};
