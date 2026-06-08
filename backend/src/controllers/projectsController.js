const { Op } = require('sequelize');
const { Project, Milestone, Department, User, Ticket, TimeEntry } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const projectInclude = [
  { model: Department, as: 'department' },
  { model: User, as: 'owner', attributes: ['id', 'displayName', 'username'] },
];

// GET /projects
// Admin/Technician see all; Requesters see projects in their own department (read-only).
const list = asyncHandler(async (req, res) => {
  const where = {};
  if (req.user.role === 'requester') {
    where.departmentId = req.user.departmentId || -1;
  }
  if (req.query.status) where.status = req.query.status;
  if (req.query.department) where.departmentId = req.query.department;

  const projects = await Project.findAll({
    where,
    include: projectInclude,
    order: [['updatedAt', 'DESC']],
  });
  res.json({ projects });
});

// POST /projects — Admin/Technician
const create = asyncHandler(async (req, res) => {
  const { name, description, status, departmentId, ownerId, dueDate } = req.body || {};
  if (!name || !name.trim()) {
    throw new ApiError(400, 'Project name is required', 'VALIDATION_ERROR');
  }
  const project = await Project.create({
    name: name.trim(),
    description: description || null,
    status: status || 'active',
    departmentId: departmentId || null,
    ownerId: ownerId || req.user.id,
    dueDate: dueDate || null,
  });
  await writeAudit(req, 'project.create', 'Project', project.id, { name: project.name });

  const fresh = await Project.findByPk(project.id, { include: projectInclude });
  res.status(201).json({ project: fresh });
});

// GET /projects/:id
const get = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id, {
    include: [
      ...projectInclude,
      { model: Milestone, as: 'milestones', separate: true, order: [['dueDate', 'ASC']] },
    ],
  });
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  res.json({ project });
});

// PATCH /projects/:id — Admin/Technician
const update = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const allowed = ['name', 'description', 'status', 'departmentId', 'ownerId', 'dueDate'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  await project.update(changes);
  await writeAudit(req, 'project.update', 'Project', project.id, changes);

  const fresh = await Project.findByPk(project.id, { include: projectInclude });
  res.json({ project: fresh });
});

// DELETE /projects/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  await project.destroy();
  await writeAudit(req, 'project.delete', 'Project', project.id, { name: project.name });
  res.json({ ok: true });
});

// GET /projects/:id/milestones
const listMilestones = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  const milestones = await Milestone.findAll({
    where: { projectId: project.id },
    order: [['dueDate', 'ASC']],
  });
  res.json({ milestones });
});

// POST /projects/:id/milestones — Admin/Technician
const createMilestone = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const { title, dueDate, completed } = req.body || {};
  if (!title || !title.trim()) {
    throw new ApiError(400, 'Milestone title is required', 'VALIDATION_ERROR');
  }
  const milestone = await Milestone.create({
    projectId: project.id,
    title: title.trim(),
    dueDate: dueDate || null,
    completed: !!completed,
  });
  await writeAudit(req, 'milestone.create', 'Milestone', milestone.id, { projectId: project.id });
  res.status(201).json({ milestone });
});

// PATCH /projects/:id/milestones/:milestoneId — Admin/Technician
const updateMilestone = asyncHandler(async (req, res) => {
  const milestone = await Milestone.findOne({
    where: { id: req.params.milestoneId, projectId: req.params.id },
  });
  if (!milestone) throw new ApiError(404, 'Milestone not found', 'NOT_FOUND');

  const allowed = ['title', 'dueDate', 'completed'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  await milestone.update(changes);
  await writeAudit(req, 'milestone.update', 'Milestone', milestone.id, changes);
  res.json({ milestone });
});

// DELETE /projects/:id/milestones/:milestoneId — Admin/Technician
const removeMilestone = asyncHandler(async (req, res) => {
  const milestone = await Milestone.findOne({
    where: { id: req.params.milestoneId, projectId: req.params.id },
  });
  if (!milestone) throw new ApiError(404, 'Milestone not found', 'NOT_FOUND');
  await milestone.destroy();
  await writeAudit(req, 'milestone.delete', 'Milestone', milestone.id, { projectId: req.params.id });
  res.json({ ok: true });
});

// ---- Project time ----
const timeUserAttrs = ['id', 'displayName', 'username'];

// GET /projects/:id/time
// All time across the project: project-level entries + entries on linked tickets.
const listTime = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const ticketIds = (
    await Ticket.findAll({ where: { projectId: project.id }, attributes: ['id'], raw: true })
  ).map((t) => t.id);

  const where = ticketIds.length
    ? { [Op.or]: [{ projectId: project.id }, { ticketId: { [Op.in]: ticketIds } }] }
    : { projectId: project.id };

  const entries = await TimeEntry.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: timeUserAttrs },
      { model: Ticket, as: 'ticket', attributes: ['id', 'title'] },
    ],
    order: [['loggedAt', 'DESC']],
  });
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  res.json({ entries, totalMinutes });
});

// POST /projects/:id/time — Admin/Technician. Logs project-level time.
const createTime = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');

  const { minutes, note, loggedAt } = req.body || {};
  const mins = parseInt(minutes, 10);
  if (!mins || mins < 1) {
    throw new ApiError(400, 'minutes must be a positive integer', 'VALIDATION_ERROR');
  }
  const entry = await TimeEntry.create({
    projectId: project.id,
    ticketId: null,
    userId: req.user.id,
    minutes: mins,
    note: note || null,
    loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
  });
  await writeAudit(req, 'time.create', 'TimeEntry', entry.id, { projectId: project.id, minutes: mins });

  const fresh = await TimeEntry.findByPk(entry.id, {
    include: [{ model: User, as: 'user', attributes: timeUserAttrs }],
  });
  res.status(201).json({ entry: fresh });
});

// DELETE /projects/:id/time/:entryId — owner or admin. Project-level entries only.
const removeTime = asyncHandler(async (req, res) => {
  const entry = await TimeEntry.findOne({
    where: { id: req.params.entryId, projectId: req.params.id },
  });
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  if (entry.userId !== req.user.id && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only remove your own time entries', 'FORBIDDEN');
  }
  await entry.destroy();
  await writeAudit(req, 'time.delete', 'TimeEntry', entry.id, { projectId: req.params.id });
  res.json({ ok: true });
});

module.exports = {
  list,
  create,
  get,
  update,
  remove,
  listMilestones,
  createMilestone,
  updateMilestone,
  removeMilestone,
  listTime,
  createTime,
  removeTime,
};
