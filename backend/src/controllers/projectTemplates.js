// Project templates (sub-project 6): list and read for anyone who can create
// projects; create, replace, delete and save-from-project need
// projects.manage_templates. The rules live in services/projects/.
const { fn, col } = require('sequelize');
const {
  Project, ProjectTemplate, ProjectTemplatePhase, ProjectTemplateTask, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId, canAccessProject } = require('../services/permissionService');
const {
  cleanTemplateFields, cleanStructure, saveTemplate, loadStructure,
} = require('../services/projects/templateStructure');
const { snapshotProject, planFromTemplate } = require('../services/projects/templates');

const validDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

async function findTemplate(rawId) {
  const id = parseRecordId(rawId);
  const template = id && await ProjectTemplate.findByPk(id);
  if (!template) throw new ApiError(404, 'Template not found', 'NOT_FOUND');
  return template;
}

const plain = (t) => ({
  id: t.id, name: t.name, description: t.description, hourBudgetMinutes: t.hourBudgetMinutes, tags: t.tags || [], sourceProjectId: t.sourceProjectId,
});

// The counts per template for a list of ids: { phases, tasks, used } maps.
async function countsFor(ids) {
  const group = async (Model, key, where) => new Map((await Model.findAll({
    where, attributes: [key, [fn('COUNT', col('id')), 'n']], group: [key], raw: true,
  })).map((r) => [r[key], Number(r.n)]));
  return {
    phases: await group(ProjectTemplatePhase, 'templateId', { templateId: ids }),
    tasks: await group(ProjectTemplateTask, 'templateId', { templateId: ids }),
    used: await group(Project, 'templateId', { templateId: ids }),
  };
}

// GET /project-templates
const list = asyncHandler(async (req, res) => {
  const rows = await ProjectTemplate.findAll({ order: [['name', 'ASC'], ['id', 'ASC']] });
  const counts = await countsFor(rows.map((r) => r.id));
  res.json({
    templates: rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      phaseCount: counts.phases.get(t.id) || 0,
      taskCount: counts.tasks.get(t.id) || 0,
      hourBudgetMinutes: t.hourBudgetMinutes,
      usedCount: counts.used.get(t.id) || 0,
    })),
  });
});

// GET /project-templates/:id
const get = asyncHandler(async (req, res) => {
  const template = await findTemplate(req.params.id);
  const counts = await countsFor([template.id]);
  res.json({ template: { ...plain(template), ...(await loadStructure(template.id)), usedCount: counts.used.get(template.id) || 0 } });
});

// GET /project-templates/:id/preview?startDate&finishDate
const preview = asyncHandler(async (req, res) => {
  const template = await findTemplate(req.params.id);
  const { startDate, finishDate } = req.query;
  if (!validDay(startDate)) throw bad('startDate must be a date like 2026-03-02');
  if (finishDate !== undefined && finishDate !== '' && (!validDay(finishDate) || finishDate < startDate)) throw bad('finishDate must be a date on or after startDate');
  res.json(planFromTemplate(await loadStructure(template.id), { startDate, finishDate: finishDate || undefined }));
});

const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

// POST /project-templates
const create = asyncHandler(async (req, res) => {
  const fields = cleanTemplateFields(body(req));
  const structure = cleanStructure(body(req));
  const template = await sequelize.transaction((transaction) => saveTemplate(null, fields, structure, { createdBy: req.user.id, transaction }));
  await writeAudit(req, 'projectTemplate.create', 'ProjectTemplate', template.id, { name: template.name, tasks: structure.tasks.length });
  res.status(201).json({ template: { ...plain(template), ...(await loadStructure(template.id)), usedCount: 0 } });
});

// PUT /project-templates/:id — replaces fields and the whole structure.
const update = asyncHandler(async (req, res) => {
  const template = await findTemplate(req.params.id);
  const fields = cleanTemplateFields(body(req));
  const structure = cleanStructure(body(req));
  await sequelize.transaction((transaction) => saveTemplate(template, fields, structure, { createdBy: req.user.id, transaction }));
  await writeAudit(req, 'projectTemplate.update', 'ProjectTemplate', template.id, { name: fields.name, tasks: structure.tasks.length });
  const counts = await countsFor([template.id]);
  res.json({ template: { ...plain(await template.reload()), ...(await loadStructure(template.id)), usedCount: counts.used.get(template.id) || 0 } });
});

// DELETE /project-templates/:id — projects made from it keep everything.
const remove = asyncHandler(async (req, res) => {
  const template = await findTemplate(req.params.id);
  await template.destroy();
  await writeAudit(req, 'projectTemplate.delete', 'ProjectTemplate', template.id, { name: template.name });
  res.json({ ok: true });
});

// POST /projects/:id/save-as-template { name, description? } — projects.manage_templates
// on the route; the caller must also be able to see the project (else 404,
// so a project's existence isn't revealed).
const saveFromProject = asyncHandler(async (req, res) => {
  const id = parseRecordId(req.params.id);
  const project = id && await Project.findByPk(id);
  if (!project || !(await canAccessProject(req.user, project))) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  const shape = await snapshotProject(project.id);
  const fields = cleanTemplateFields({
    name: body(req).name,
    description: body(req).description !== undefined ? body(req).description : project.description,
    hourBudgetMinutes: shape.hourBudgetMinutes,
    tags: shape.tags,
  });
  const structure = cleanStructure(shape);
  const template = await sequelize.transaction((transaction) => saveTemplate(null, fields, structure, {
    createdBy: req.user.id, sourceProjectId: project.id, transaction,
  }));
  await writeAudit(req, 'projectTemplate.saveFromProject', 'ProjectTemplate', template.id, { name: template.name, projectId: project.id });
  res.status(201).json({ template: { ...plain(template), ...(await loadStructure(template.id)), usedCount: 0 } });
});

module.exports = {
  list, get, preview, create, update, remove, saveFromProject,
};
