// Read-only lists for task and time forms: task statuses (per scope) and work
// types. Editing them belongs to Settings (plan 3b-2).
const { WorkType } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { listTaskStatuses } = require('../services/tasks/statuses');

// GET /task-statuses?scope=ticket|project
const taskStatuses = asyncHandler(async (req, res) => {
  const { scope } = req.query;
  if (scope !== undefined && !['ticket', 'project'].includes(scope)) {
    throw new ApiError(400, 'scope must be ticket or project', 'VALIDATION_ERROR');
  }
  res.json({ statuses: await listTaskStatuses(scope) });
});

// GET /work-types — inactive ones included, so old entries still show a name.
const workTypes = asyncHandler(async (req, res) => {
  res.json({ workTypes: await WorkType.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] }) });
});

module.exports = { taskStatuses, workTypes };
