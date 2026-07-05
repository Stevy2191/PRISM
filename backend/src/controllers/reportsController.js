const { Op, fn, col, literal } = require('sequelize');
const { Ticket, TimeEntry, ProjectTimeEntry, User, Project, Department, CsatResponse, sequelize } = require('../models');
const { asyncHandler } = require('../middleware/error');
const { getUserTicketScope } = require('../services/permissionService');

// Narrows a report's base `where` to the caller's ticket scope. 'all' (the
// reports.view_all tier) applies no filter; 'department'/'own' mirror the
// same scoping rules used for the ticket list endpoint.
function applyTicketScope(where, scope, user) {
  if (scope === 'all') return where;
  if (scope === 'department') {
    return { ...where, [Op.and]: [{ [Op.or]: [{ departmentId: user.departmentId }, { assigneeId: user.id }] }] };
  }
  return { ...where, [Op.and]: [{ [Op.or]: [{ assigneeId: user.id }, { requesterId: user.id }] }] };
}

// Build a createdAt/loggedAt date-range filter from ?from & ?to query params.
function dateRange(field, query) {
  const range = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!isNaN(d)) range[Op.gte] = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!isNaN(d)) {
      d.setHours(23, 59, 59, 999);
      range[Op.lte] = d;
    }
  }
  return Object.getOwnPropertySymbols(range).length ? { [field]: range } : {};
}

// GET /reports/tickets — counts by status, priority, assignee, department
const tickets = asyncHandler(async (req, res) => {
  const scope = await getUserTicketScope(req.user.id);
  const where = applyTicketScope(dateRange('createdAt', req.query), scope, req.user);

  const groupCount = async (column) =>
    Ticket.findAll({
      where,
      attributes: [column, [fn('COUNT', col('id')), 'count']],
      group: [column],
      raw: true,
    });

  const [byStatus, byPriority, byType] = await Promise.all([
    groupCount('status'),
    groupCount('priority'),
    groupCount('type'),
  ]);

  const byAssignee = await Ticket.findAll({
    where,
    attributes: [
      'assigneeId',
      [fn('COUNT', col('Ticket.id')), 'count'],
    ],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'displayName', 'username'] }],
    group: ['assigneeId', 'assignee.id'],
    raw: true,
    nest: true,
  });

  const byDepartment = await Ticket.findAll({
    where,
    attributes: [
      'departmentId',
      [fn('COUNT', col('Ticket.id')), 'count'],
    ],
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
    group: ['departmentId', 'department.id'],
    raw: true,
    nest: true,
  });

  const total = await Ticket.count({ where });

  res.json({
    range: { from: req.query.from || null, to: req.query.to || null },
    total,
    byStatus,
    byPriority,
    byType,
    byAssignee,
    byDepartment,
  });
});

// GET /reports/time — time logged by user, by project, by department.
// Supports date range (from/to) and CSV export (?format=csv).
// Aggregated in JS so it correctly handles both ticket time entries and
// project time entries — two separate tables (ProjectTimeEntry has its own
// dedicated table now; see migration 19) unioned into one shape here.
const time = asyncHandler(async (req, res) => {
  const scope = await getUserTicketScope(req.user.id);
  let ticketWhere = dateRange('loggedAt', req.query);
  let projectWhere = dateRange('createdAt', req.query);
  if (scope === 'department') {
    ticketWhere = { ...ticketWhere, '$ticket.departmentId$': req.user.departmentId };
    projectWhere = { ...projectWhere, '$project.ownerDepartmentId$': req.user.departmentId };
  } else if (scope === 'own') {
    ticketWhere = { ...ticketWhere, userId: req.user.id };
    projectWhere = { ...projectWhere, loggedForUserId: req.user.id };
  }

  const [ticketEntries, projectEntries] = await Promise.all([
    TimeEntry.findAll({
      where: ticketWhere,
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username'] },
        {
          model: Ticket,
          as: 'ticket',
          attributes: ['id', 'title', 'projectId', 'departmentId'],
          include: [
            { model: Project, as: 'project', attributes: ['id', 'name'] },
            { model: Department, as: 'department', attributes: ['id', 'name'] },
          ],
        },
      ],
      order: [['loggedAt', 'DESC']],
    }),
    ProjectTimeEntry.findAll({
      where: projectWhere,
      include: [
        { model: User, as: 'loggedFor', attributes: ['id', 'displayName', 'username'] },
        {
          model: Project,
          as: 'project',
          attributes: ['id', 'name'],
          include: [{ model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
    }),
  ]);

  // Normalize both entry types to one shape: { date, user, minutes, ticket, project, department, note }
  const normalized = [
    ...ticketEntries.map((e) => ({
      date: e.loggedAt,
      user: e.user,
      minutes: e.minutes,
      isProject: false,
      ticket: e.ticket,
      project: e.ticket?.project || null,
      department: e.ticket?.department || null,
      note: e.note,
    })),
    ...projectEntries.map((e) => ({
      date: e.createdAt,
      user: e.loggedFor,
      minutes: Math.max(1, Math.round((e.durationSeconds || 0) / 60)),
      isProject: true,
      ticket: null,
      project: e.project,
      department: e.project?.ownerDepartment || null,
      note: e.description,
    })),
  ];

  const byUser = new Map();
  const byProject = new Map();
  const byDepartment = new Map();
  let totalMinutes = 0;

  const bump = (map, key, label, minutes, extra = {}) => {
    const cur = map.get(key) || { key, label, minutes: 0, ...extra };
    cur.minutes += minutes;
    map.set(key, cur);
  };

  for (const e of normalized) {
    totalMinutes += e.minutes;

    const u = e.user;
    bump(byUser, u ? u.id : 'unknown', u ? u.displayName : 'Unknown', e.minutes);
    bump(byProject, e.project ? e.project.id : 'none', e.project ? e.project.name : 'No project', e.minutes);
    bump(byDepartment, e.department ? e.department.id : 'none', e.department ? e.department.name : 'Unassigned', e.minutes);
  }

  const toSorted = (map) => [...map.values()].sort((a, b) => b.minutes - a.minutes);

  // CSV export: flat per-entry detail so the data can be pivoted downstream.
  if ((req.query.format || '').toLowerCase() === 'csv') {
    const rows = [['Date', 'User', 'Minutes', 'Hours', 'Type', 'Reference', 'Department', 'Note']];
    for (const e of normalized) {
      rows.push([
        e.date ? new Date(e.date).toISOString().slice(0, 10) : '',
        e.user ? e.user.displayName : '',
        e.minutes,
        (e.minutes / 60).toFixed(2),
        e.isProject ? 'project' : 'ticket',
        e.isProject ? (e.project ? `Project: ${e.project.name}` : 'Project') : `#${e.ticket?.id} ${e.ticket?.title || ''}`,
        e.department ? e.department.name : 'Unassigned',
        e.note || '',
      ]);
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prism-time-report.csv"');
    return res.send(csv);
  }

  return res.json({
    range: { from: req.query.from || null, to: req.query.to || null },
    totalMinutes,
    byUser: toSorted(byUser),
    byProject: toSorted(byProject),
    byDepartment: toSorted(byDepartment),
  });
});

// Quote a CSV cell if it contains a comma, quote, or newline.
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// GET /reports/csat — customer happiness: overall score + breakdown by technician
// and department. Score = % of "happy" ratings (neutral counts as half).
const csat = asyncHandler(async (req, res) => {
  const scope = await getUserTicketScope(req.user.id);
  let where = dateRange('respondedAt', req.query);
  if (scope === 'department') {
    where = { ...where, '$ticket.departmentId$': req.user.departmentId };
  } else if (scope === 'own') {
    where = { ...where, '$ticket.assigneeId$': req.user.id };
  }

  const responses = await CsatResponse.findAll({
    where,
    include: [
      {
        model: Ticket,
        as: 'ticket',
        attributes: ['id', 'assigneeId', 'departmentId'],
        include: [
          { model: User, as: 'assignee', attributes: ['id', 'displayName'] },
          { model: Department, as: 'department', attributes: ['id', 'name'] },
        ],
      },
    ],
  });

  const blank = () => ({ happy: 0, neutral: 0, unhappy: 0, total: 0 });
  const score = (b) => (b.total ? Math.round((100 * (b.happy + 0.5 * b.neutral)) / b.total) : null);

  const overall = blank();
  const byTech = new Map();
  const byDept = new Map();

  const add = (map, key, label, rating) => {
    const cur = map.get(key) || { key, label, ...blank() };
    cur[rating] += 1;
    cur.total += 1;
    map.set(key, cur);
  };

  for (const r of responses) {
    overall[r.rating] += 1;
    overall.total += 1;
    const tech = r.ticket?.assignee;
    add(byTech, tech ? tech.id : 'unassigned', tech ? tech.displayName : 'Unassigned', r.rating);
    const dept = r.ticket?.department;
    add(byDept, dept ? dept.id : 'none', dept ? dept.name : 'Unassigned', r.rating);
  }

  const withScore = (map) =>
    [...map.values()].map((b) => ({ ...b, score: score(b) })).sort((a, b) => b.total - a.total);

  res.json({
    range: { from: req.query.from || null, to: req.query.to || null },
    overall: { ...overall, score: score(overall) },
    byTechnician: withScore(byTech),
    byDepartment: withScore(byDept),
  });
});

module.exports = { tickets, time, csat };
