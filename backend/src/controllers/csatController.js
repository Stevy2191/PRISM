const { asyncHandler, ApiError } = require('../middleware/error');
const { getUserPerformanceStats, getTeamHappiness, listResponses } = require('../services/csatStatsService');
const { getAllSettings } = require('./settingsController');
const { getUserReportScope } = require('../services/permissionService');
const { User } = require('../models');
const { companyFilterWhere } = require('../services/recordScope');

// Same reports.view_own/department/all family already used to gate every
// other report — a technician can always see their own numbers (self-view),
// but seeing anyone else's, or the whole team ranked, needs department/all
// scope. Without this, any authenticated staff member could hit this
// endpoint directly (bypassing the dashboard's own admin-only panel gating)
// and see every other tech's rating.
//
// Department scope reaches only the reader's own department (S15): another
// department's technician is refused, and the team and response lists are
// narrowed. Returns the department to narrow by, or null for no narrowing.
const CANT_VIEW = "You don't have permission to view other technicians' performance stats";
async function assertCanView(req, targetUserId) {
  if (targetUserId && targetUserId === req.user.id) return null;
  const scope = await getUserReportScope(req.user.id);
  if (scope === 'own') throw new ApiError(403, CANT_VIEW, 'FORBIDDEN');
  if (scope === 'all') return null;
  const departmentId = req.user.departmentId || -1; // no department -> match nothing
  if (targetUserId) {
    const target = await User.findByPk(targetUserId, { attributes: ['id', 'departmentId'] });
    if (!target || target.departmentId !== departmentId) throw new ApiError(403, CANT_VIEW, 'FORBIDDEN');
  }
  return departmentId;
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
    const result = await getUserPerformanceStats(userId, range, await companyFilterWhere(req.user, req.query.companyId));
    return res.json({ ...result, minTicketsToShowRating: minResponses, showRating: result.responseCount >= minResponses });
  }

  const departmentId = await assertCanView(req, null);
  const team = await getTeamHappiness({ range, departmentId, companyWhere: await companyFilterWhere(req.user, req.query.companyId) });
  return res.json({
    minTicketsToShowRating: minResponses,
    team: team.map((t) => ({ ...t, showRating: t.responseCount >= minResponses })),
  });
});

// GET /csat/responses?startDate=&endDate=&userId=
const responses = asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query);
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  const departmentId = await assertCanView(req, userId);
  // One technician's list is theirs to see whole once they're reachable; the
  // all-responses list narrows to the reader's department's tickets.
  const rows = await listResponses({
    range, userId, departmentId: userId ? null : departmentId, companyWhere: await companyFilterWhere(req.user, req.query.companyId),
  });
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
