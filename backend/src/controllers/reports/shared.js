// Helpers shared by the report modules (and by services/customReportEngine).
const { Op } = require('sequelize');
const { toCsv } = require('../../utils/csv');
const { getUserReportScope } = require('../../services/permissionService');
const { andWhere, companyFilterWhere, isEmpty } = require('../../services/recordScope');
const {
  orgTimeZone, zoneDayStart, zoneDayEnd, toDateString,
} = require('../../utils/orgTime');

// ==================== Shared helpers ====================

// Report date ranges are whole days in the organization's time zone (Q36):
// from startDate's local midnight to the last moment of endDate. The date
// strings come along for DATEONLY columns (work dates, due dates).
async function parseDateRange(query) {
  const tz = await orgTimeZone();
  const startDate = toDateString(query.startDate);
  const endDate = toDateString(query.endDate);
  return {
    start: startDate ? zoneDayStart(startDate, tz) : null,
    end: endDate ? zoneDayEnd(endDate, tz) : null,
    startDate,
    endDate,
  };
}

function dateWhere(field, range) {
  const clause = {};
  if (range.start) clause[Op.gte] = range.start;
  if (range.end) clause[Op.lte] = range.end;
  // Op.gte/Op.lte are Symbol keys — Object.keys() can't see them.
  return Object.getOwnPropertySymbols(clause).length ? { [field]: clause } : {};
}

// The same range on a DATEONLY column.
function dateOnlyWhere(field, range) {
  const clause = {};
  if (range.startDate) clause[Op.gte] = range.startDate;
  if (range.endDate) clause[Op.lte] = range.endDate;
  return Object.getOwnPropertySymbols(clause).length ? { [field]: clause } : {};
}

// Time is fenced through its ticket or its project, whichever it's on. The
// query must include both as `ticket` and `project`.
async function ledgerCompanyWhere(user, companyId) {
  const [onTicket, onProject] = await Promise.all([
    companyFilterWhere(user, companyId, '$ticket.companyId$'),
    companyFilterWhere(user, companyId, '$project.companyId$'),
  ]);
  if (isEmpty(onTicket) && isEmpty(onProject)) return {};
  return {
    [Op.or]: [
      andWhere({ ticketId: { [Op.ne]: null } }, onTicket),
      andWhere({ projectId: { [Op.ne]: null } }, onProject),
    ],
  };
}

function parseDepartmentId(query) {
  const id = parseInt(query.departmentId, 10);
  return Number.isFinite(id) ? id : null;
}

// Asset/license/contract reports have no per-record owner (unlike tickets/
// projects/contacts), so "own" and "department" scope both collapse to "my
// department" here. Mirrors contactDeptWhere's scoping rule but resolves to
// a plain departmentId (rather than a where clause) since a couple of these
// reports filter through a nested include instead of the top-level where.
async function resolveReportDeptId(req, requestedDepartmentId) {
  const scope = await getUserReportScope(req.user.id);
  if (scope === 'all') return requestedDepartmentId;
  return req.user.departmentId || -1; // no department on the user -> match nothing, not everything
}

function parseAssigneeId(query) {
  const id = parseInt(query.assigneeId, 10);
  return Number.isFinite(id) ? id : null;
}

// Auto-granularity for time-series charts: daily under a month, weekly under
// ~6 months, monthly beyond that.
function granularityFor(range) {
  if (!range.start || !range.end) return 'day';
  const days = (range.end.getTime() - range.start.getTime()) / 86400000;
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

// Monday-anchored ISO week start, used as the bucket key for 'week' granularity.
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

// Ticket scope, keyed off reports.view_own/department/all (not tickets.*) —
// this module's own permission family, since a report can span domains.
// Each scope helper takes the viewer's company fence last and ANDs it in.
function ticketScopeWhere(where, scope, user, requestedDepartmentId, companyWhere = {}) {
  let scoped;
  if (scope === 'all') {
    scoped = requestedDepartmentId ? { ...where, departmentId: requestedDepartmentId } : where;
  } else if (scope === 'department') {
    scoped = { ...where, [Op.and]: [{ [Op.or]: [{ departmentId: user.departmentId }, { assigneeId: user.id }] }] };
  } else {
    scoped = { ...where, assigneeId: user.id };
  }
  return andWhere(scoped, companyWhere);
}

function projectScopeWhere(where, scope, user, requestedDepartmentId, companyWhere = {}) {
  let scoped;
  if (scope === 'all') {
    scoped = requestedDepartmentId
      ? { ...where, [Op.or]: [{ ownerDepartmentId: requestedDepartmentId }, { forDepartmentId: requestedDepartmentId }] }
      : where;
  } else if (scope === 'department') {
    scoped = { ...where, [Op.or]: [{ ownerDepartmentId: user.departmentId }, { forDepartmentId: user.departmentId }] };
  } else {
    scoped = { ...where, assignedToUserId: user.id };
  }
  return andWhere(scoped, companyWhere);
}

function contactDeptWhere(where, scope, user, requestedDepartmentId, companyWhere = {}) {
  let scoped;
  if (scope === 'all') {
    scoped = requestedDepartmentId ? { ...where, departmentId: requestedDepartmentId } : where;
  } else {
    scoped = { ...where, departmentId: user.departmentId };
  }
  return andWhere(scoped, companyWhere);
}

function sendCsv(res, filename, columns, rows) {
  const csv = toCsv(
    columns.map((c) => c.label),
    rows.map((row) => columns.map((c) => row[c.key]))
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="prism-${filename}.csv"`);
  // Stops a browser from ever rendering an export inline.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(csv);
}

function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

const userAttrs = ['id', 'displayName', 'username'];

module.exports = {
  parseDateRange,
  dateWhere,
  dateOnlyWhere,
  ledgerCompanyWhere,
  parseDepartmentId,
  parseAssigneeId,
  granularityFor,
  bucketKey,
  ticketScopeWhere,
  projectScopeWhere,
  contactDeptWhere,
  sendCsv,
  hoursBetween,
  userAttrs,
  resolveReportDeptId,
};
