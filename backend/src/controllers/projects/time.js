// Project time: thin wrappers over services/time (the one ledger).
const { Project } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { parsePagination, paginated } = require('../../utils/pagination');
const { canAccessProject } = require('../../services/permissionService');
const { projectParent } = require('../../services/tasks');
const time = require('../../services/time');
const { SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

async function projectFor(req) {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  return projectParent(project);
}

async function entryFor(parent, rawId) {
  const entry = await time.findEntry(parent, rawId);
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  return entry;
}

// GET /projects/:id/time-entries
const listTimeEntries = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count, totalSeconds, totalLaborCost } = await time.listEntries(parent, { limit, offset });
  res.json({ ...paginated('entries', { rows, count }, { page, limit }), totalSeconds, totalLaborCost });
});

// POST /projects/:id/time-entries — { durationMinutes | startTime+endTime, entryDate?, note?, taskId?, workTypeId?, billable?, userId? }
const createTimeEntry = asyncHandler(async (req, res) => {
  res.status(201).json({ entry: await time.createEntry(req, await projectFor(req), req.body) });
});

// PATCH /projects/:id/time-entries/:entryId
const updateTimeEntry = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ entry: await time.updateEntry(req, parent, await entryFor(parent, req.params.entryId), req.body) });
});

// DELETE /projects/:id/time-entries/:entryId
const removeTimeEntry = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  await time.deleteEntry(req, parent, await entryFor(parent, req.params.entryId));
  res.json({ ok: true });
});

module.exports = {
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  removeTimeEntry,
};
