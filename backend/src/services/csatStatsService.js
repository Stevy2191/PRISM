// Shared CSAT/performance aggregation — used by the protected /csat/*
// endpoints, the Customer Happiness report, the dashboard's "My Ratings"/
// "Team Happiness" panels, and UserDetail's Performance tab. Centralized
// here so all four surfaces agree on the same numbers instead of each
// re-deriving avg-resolution/avg-first-response math slightly differently.
//
// Small date/bucketing helpers are duplicated from reportsController.js
// rather than imported from it — importing back from a controller here
// would create a require cycle (reportsController will require this file
// for the new customer-happiness report), and these are a handful of pure
// one-liners, not worth the fragility.
const { Op, fn, col } = require('sequelize');
const { CsatSurvey, Ticket, Comment, User, Department, Contact } = require('../models');

function dateWhere(field, range) {
  const clause = {};
  if (range?.start) clause[Op.gte] = range.start;
  if (range?.end) clause[Op.lte] = range.end;
  return Object.getOwnPropertySymbols(clause).length ? { [field]: clause } : {};
}

function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

function granularityFor(range) {
  if (!range?.start || !range?.end) return 'day';
  const days = (range.end.getTime() - range.start.getTime()) / 86400000;
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function bucketKey(date, granularity) {
  const d = new Date(date);
  if (granularity === 'month') return d.toISOString().slice(0, 7);
  if (granularity === 'week') return weekStart(d).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

// Avg first-response-hours and avg-resolution-hours for one or more tech
// user ids, optionally scoped to a date range (applied to createdAt for
// "assigned" tickets and resolvedAt for "closed" ones, same as
// reportsController.js's team-performance report).
async function responseAndResolutionStats(userIds, range) {
  if (!userIds.length) return new Map();

  const [assignedTickets, closedTickets] = await Promise.all([
    Ticket.findAll({
      where: { assigneeId: { [Op.in]: userIds }, ...dateWhere('createdAt', range) },
      attributes: ['id', 'assigneeId', 'createdAt'],
      raw: true,
    }),
    Ticket.findAll({
      where: { assigneeId: { [Op.in]: userIds }, resolvedAt: { [Op.ne]: null }, ...dateWhere('resolvedAt', range) },
      attributes: ['id', 'assigneeId', 'createdAt', 'resolvedAt'],
      raw: true,
    }),
  ]);

  const ticketIds = assignedTickets.map((t) => t.id);
  const firstReplies = ticketIds.length
    ? await Comment.findAll({
        where: { ticketId: { [Op.in]: ticketIds }, type: 'reply' },
        attributes: ['ticketId', [fn('MIN', col('createdAt')), 'firstReplyAt']],
        group: ['ticketId'],
        raw: true,
      })
    : [];
  const firstReplyByTicket = new Map(firstReplies.map((r) => [r.ticketId, r.firstReplyAt]));

  const byUser = new Map(userIds.map((id) => [id, {
    resolutionSumHours: 0, resolutionCount: 0, responseSumHours: 0, responseCount: 0,
  }]));

  closedTickets.forEach((t) => {
    const cur = byUser.get(t.assigneeId);
    if (!cur) return;
    cur.resolutionSumHours += hoursBetween(t.createdAt, t.resolvedAt);
    cur.resolutionCount += 1;
  });
  assignedTickets.forEach((t) => {
    const replyAt = firstReplyByTicket.get(t.id);
    if (!replyAt) return;
    const cur = byUser.get(t.assigneeId);
    if (!cur) return;
    cur.responseSumHours += hoursBetween(t.createdAt, replyAt);
    cur.responseCount += 1;
  });

  const result = new Map();
  byUser.forEach((v, userId) => {
    result.set(userId, {
      avgResolutionHours: v.resolutionCount ? round1(v.resolutionSumHours / v.resolutionCount) : null,
      avgFirstResponseHours: v.responseCount ? round1(v.responseSumHours / v.responseCount) : null,
    });
  });
  return result;
}

async function ticketsClosedCounts(userId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const [thisMonth, thisYear] = await Promise.all([
    Ticket.count({ where: { assigneeId: userId, resolvedAt: { [Op.gte]: monthStart } } }),
    Ticket.count({ where: { assigneeId: userId, resolvedAt: { [Op.gte]: yearStart } } }),
  ]);
  return { ticketsClosedThisMonth: thisMonth, ticketsClosedThisYear: thisYear };
}

// Full performance stat block for one tech — CSAT + response/resolution
// time + closed-ticket counts. Used by UserDetail's Performance tab and the
// dashboard's "My Ratings" panel.
async function getUserPerformanceStats(userId, range = {}) {
  const [ratingRows, resolutionMap, closedCounts] = await Promise.all([
    CsatSurvey.findAll({
      where: { assignedToUserId: userId, status: 'responded', ...dateWhere('respondedAt', range) },
      attributes: ['rating'],
      raw: true,
    }),
    responseAndResolutionStats([userId], range),
    ticketsClosedCounts(userId),
  ]);

  const responseCount = ratingRows.length;
  const avgRating = responseCount
    ? round1(ratingRows.reduce((sum, r) => sum + r.rating, 0) / responseCount)
    : null;
  const resolution = resolutionMap.get(userId) || { avgResolutionHours: null, avgFirstResponseHours: null };

  return { avgRating, responseCount, ...resolution, ...closedCounts };
}

// Per-tech CSAT + resolution-time breakdown for all active techs — used by
// the admin dashboard's "Team Happiness" panel and the Customer Happiness
// report's "score by tech" chart/table.
async function getTeamHappiness({ range, departmentId } = {}) {
  const userWhere = { role: { [Op.in]: ['admin', 'technician'] }, isActive: true };
  if (departmentId) userWhere.departmentId = departmentId;
  const techs = await User.findAll({ where: userWhere, attributes: ['id', 'displayName', 'departmentId'] });
  if (!techs.length) return [];
  const techIds = techs.map((t) => t.id);

  const [ratingRows, resolutionMap] = await Promise.all([
    CsatSurvey.findAll({
      where: { assignedToUserId: { [Op.in]: techIds }, status: 'responded', ...dateWhere('respondedAt', range) },
      attributes: ['assignedToUserId', 'rating'],
      raw: true,
    }),
    responseAndResolutionStats(techIds, range),
  ]);

  const byUser = new Map(techIds.map((id) => [id, { sum: 0, count: 0 }]));
  ratingRows.forEach((r) => {
    const cur = byUser.get(r.assignedToUserId);
    if (!cur) return;
    cur.sum += r.rating;
    cur.count += 1;
  });

  return techs
    .map((t) => {
      const rating = byUser.get(t.id);
      const resolution = resolutionMap.get(t.id) || { avgResolutionHours: null };
      return {
        userId: t.id,
        name: t.displayName,
        avgRating: rating.count ? round1(rating.sum / rating.count) : null,
        responseCount: rating.count,
        avgResolutionHours: resolution.avgResolutionHours,
      };
    })
    .sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1));
}

// System-wide overview (or scoped to a single user/department) — overall
// score, response rate, trend over time, score by tech, score by
// department, recent comments, and the raw response list. Feeds both
// GET /csat/stats + GET /reports/customer-happiness.
async function getOverview({ range, userId, departmentId } = {}) {
  const where = { status: 'responded', ...dateWhere('respondedAt', range) };
  if (userId) where.assignedToUserId = userId;

  const responses = await CsatSurvey.findAll({
    where,
    include: [
      { model: Ticket, as: 'ticket', attributes: ['id', 'title', 'departmentId'], include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }] },
      { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'displayName'] },
      { model: User, as: 'assignedToUser', attributes: ['id', 'displayName'] },
    ],
    order: [['respondedAt', 'DESC']],
  });

  const filtered = departmentId
    ? responses.filter((r) => r.ticket?.departmentId === departmentId)
    : responses;

  const overallCount = filtered.length;
  const overallScore = overallCount
    ? round1(filtered.reduce((sum, r) => sum + r.rating, 0) / overallCount)
    : null;

  const sentWhere = { sentAt: { [Op.ne]: null }, ...dateWhere('sentAt', range) };
  if (userId) sentWhere.assignedToUserId = userId;
  const sentCount = await CsatSurvey.count({ where: sentWhere });
  const responseRate = sentCount ? Math.round((100 * overallCount) / sentCount) : null;

  const granularity = granularityFor(range);
  const trendMap = new Map();
  filtered.forEach((r) => {
    const key = bucketKey(r.respondedAt, granularity);
    const cur = trendMap.get(key) || { date: key, sum: 0, count: 0 };
    cur.sum += r.rating;
    cur.count += 1;
    trendMap.set(key, cur);
  });
  const scoreTrend = [...trendMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, score: round1(r.sum / r.count) }));

  const byDeptMap = new Map();
  filtered.forEach((r) => {
    const dept = r.ticket?.department;
    const key = dept ? dept.id : 'none';
    const cur = byDeptMap.get(key) || { name: dept ? dept.name : 'No department', sum: 0, count: 0 };
    cur.sum += r.rating;
    cur.count += 1;
    byDeptMap.set(key, cur);
  });
  const scoreByDepartment = [...byDeptMap.values()]
    .map((d) => ({ name: d.name, score: round1(d.sum / d.count), count: d.count }))
    .sort((a, b) => b.count - a.count);

  const recentComments = filtered
    .filter((r) => r.comment && r.comment.trim())
    .slice(0, 20)
    .map((r) => ({
      ticketNumber: String(r.ticket?.id || 0).padStart(5, '0'),
      contact: r.contact?.displayName || '',
      tech: r.assignedToUser?.displayName || 'Unassigned',
      rating: r.rating,
      comment: r.comment,
      date: r.respondedAt,
    }));

  const tableRows = filtered.map((r) => ({
    ticketNumber: String(r.ticket?.id || 0).padStart(5, '0'),
    ticketTitle: r.ticket?.title || '',
    contact: r.contact?.displayName || '',
    tech: r.assignedToUser?.displayName || 'Unassigned',
    rating: r.rating,
    comment: r.comment || '',
    date: r.respondedAt,
  }));

  return {
    overallScore,
    responseCount: overallCount,
    sentCount,
    responseRate,
    scoreTrend,
    recentComments,
    tableRows,
  };
}

async function listResponses({ range, userId }) {
  const where = { status: 'responded', ...dateWhere('respondedAt', range) };
  if (userId) where.assignedToUserId = userId;
  return CsatSurvey.findAll({
    where,
    include: [
      { model: Ticket, as: 'ticket', attributes: ['id', 'title'] },
      { model: Contact, as: 'contact', attributes: ['id', 'displayName'] },
      { model: User, as: 'assignedToUser', attributes: ['id', 'displayName'] },
    ],
    order: [['respondedAt', 'DESC']],
  });
}

module.exports = {
  dateWhere, granularityFor, bucketKey,
  getUserPerformanceStats, getTeamHappiness, getOverview, listResponses,
};
