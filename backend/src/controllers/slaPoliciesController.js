const { SlaPolicy } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const PRIORITIES = ['critical', 'high', 'medium', 'low'];

// GET /sla-policies — always returns exactly one row per priority (seeded
// by migration 20260101000036); ordered by priority urgency, not insertion.
const list = asyncHandler(async (req, res) => {
  const rows = await SlaPolicy.findAll();
  const byPriority = new Map(rows.map((r) => [r.priority, r]));
  const policies = PRIORITIES.map((p) => byPriority.get(p)).filter(Boolean);
  res.json({ policies });
});

// PATCH /sla-policies/:priority — Body: { firstResponseHours, resolutionHours, useBusinessHours }
const update = asyncHandler(async (req, res) => {
  const { priority } = req.params;
  if (!PRIORITIES.includes(priority)) throw new ApiError(400, 'Invalid priority', 'VALIDATION_ERROR');

  const policy = await SlaPolicy.findOne({ where: { priority } });
  if (!policy) throw new ApiError(404, 'SLA policy not found', 'NOT_FOUND');

  const { firstResponseHours, resolutionHours, useBusinessHours } = req.body || {};
  const changes = {};
  if (firstResponseHours !== undefined) {
    const v = Number(firstResponseHours);
    if (!(v > 0)) throw new ApiError(400, 'First response time must be a positive number of hours', 'VALIDATION_ERROR');
    changes.firstResponseHours = v;
  }
  if (resolutionHours !== undefined) {
    const v = Number(resolutionHours);
    if (!(v > 0)) throw new ApiError(400, 'Resolution time must be a positive number of hours', 'VALIDATION_ERROR');
    changes.resolutionHours = v;
  }
  if (useBusinessHours !== undefined) changes.useBusinessHours = !!useBusinessHours;

  await policy.update(changes);
  await writeAudit(req, 'slaPolicy.update', 'SlaPolicy', policy.id, { priority, ...changes });
  res.json({ policy });
});

module.exports = { list, update };
