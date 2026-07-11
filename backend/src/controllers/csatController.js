const { asyncHandler, ApiError } = require('../middleware/error');
const { getUserPerformanceStats, getTeamHappiness, listResponses } = require('../services/csatStatsService');
const { getAllSettings } = require('./settingsController');
const { getUserReportScope } = require('../services/permissionService');

// Same reports.view_own/department/all family already used to gate every
// other report — a technician can always see their own numbers (self-view),
// but seeing anyone else's, or the whole team ranked, needs department/all
// scope. Without this, any authenticated staff member could hit this
// endpoint directly (bypassing the dashboard's own admin-only panel gating)
// and see every other tech's rating.
async function assertCanView(req, targetUserId) {
  if (targetUserId && targetUserId === req.user.id) return;
  const scope = await getUserReportScope(req.user.id);
  if (scope === 'own') {
    throw new ApiError(403, "You don't have permission to view other technicians' performance stats", 'FORBIDDEN');
  }
}

function parseDateRange(query) {
  let start = null;
  let end = null;
  if (query.startDate) {
    const d = new Date(query.startDate);
    if (!Number.isNaN(d.getTime())) start = d;
  }
  if (query.endDate) {
    const d = new Date(query.endDate);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      end = d;
    }
  }
  return { start, end };
}

// GET /csat/stats?userId=&startDate=&endDate= — one tech's performance
// stats, or (no userId) the whole team's, sorted by CSAT score.
const stats = asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query);
  const settings = await getAllSettings();
  const minResponses = Number(settings['csat.minTicketsToShowRating']) || 3;

  if (req.query.userId) {
    const userId = parseInt(req.query.userId, 10);
    if (!Number.isFinite(userId)) throw new ApiError(400, 'Invalid userId', 'INVALID_USER_ID');
    await assertCanView(req, userId);
    const result = await getUserPerformanceStats(userId, range);
    return res.json({ ...result, minTicketsToShowRating: minResponses, showRating: result.responseCount >= minResponses });
  }

  await assertCanView(req, null);
  const team = await getTeamHappiness({ range });
  return res.json({
    minTicketsToShowRating: minResponses,
    team: team.map((t) => ({ ...t, showRating: t.responseCount >= minResponses })),
  });
});

// GET /csat/responses?startDate=&endDate=&userId=
const responses = asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query);
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  await assertCanView(req, userId);
  const rows = await listResponses({ range, userId });
  res.json({
    responses: rows.map((r) => ({
      id: r.id,
      ticketId: r.ticketId,
      ticketNumber: r.ticket ? String(r.ticket.id).padStart(5, '0') : null,
      ticketTitle: r.ticket?.title || '',
      contact: r.contact?.displayName || '',
      tech: r.assignedToUser?.displayName || 'Unassigned',
      rating: r.rating,
      comment: r.comment,
      respondedAt: r.respondedAt,
    })),
  });
});

module.exports = { stats, responses };
