const { Op, fn, col, literal } = require('sequelize');
const { Ticket, TimeEntry, User, Project, Department, sequelize } = require('../models');
const { asyncHandler } = require('../middleware/error');

// Build a createdAt/loggedAt date-range filter from ?from & ?to query params.
function dateRange(field, query) {
  const range = {};
  if (query.from) range[Op.gte] = new Date(query.from);
  if (query.to) {
    const to = new Date(query.to);
    to.setHours(23, 59, 59, 999);
    range[Op.lte] = to;
  }
  return Object.getOwnPropertySymbols(range).length ? { [field]: range } : {};
}

// GET /reports/tickets — counts by status, priority, assignee, department
const tickets = asyncHandler(async (req, res) => {
  const where = dateRange('createdAt', req.query);

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

// GET /reports/time — time logged by user, ticket, project
const time = asyncHandler(async (req, res) => {
  const where = dateRange('loggedAt', req.query);

  const byUser = await TimeEntry.findAll({
    where,
    attributes: ['userId', [fn('SUM', col('minutes')), 'minutes']],
    include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username'] }],
    group: ['userId', 'user.id'],
    raw: true,
    nest: true,
  });

  const byTicket = await TimeEntry.findAll({
    where,
    attributes: ['ticketId', [fn('SUM', col('minutes')), 'minutes']],
    include: [{ model: Ticket, as: 'ticket', attributes: ['id', 'title', 'projectId'] }],
    group: ['ticketId', 'ticket.id'],
    raw: true,
    nest: true,
  });

  // Time by project: join TimeEntry -> Ticket -> Project, summed per project.
  const byProject = await TimeEntry.findAll({
    where,
    attributes: [[fn('SUM', col('minutes')), 'minutes']],
    include: [
      {
        model: Ticket,
        as: 'ticket',
        attributes: ['projectId'],
        include: [{ model: Project, as: 'project', attributes: ['id', 'name'] }],
      },
    ],
    group: ['ticket.projectId', 'ticket->project.id', 'ticket->project.name'],
    raw: true,
    nest: true,
  });

  const totalMinutes = (await TimeEntry.sum('minutes', { where })) || 0;

  res.json({
    range: { from: req.query.from || null, to: req.query.to || null },
    totalMinutes,
    byUser,
    byTicket,
    byProject,
  });
});

module.exports = { tickets, time };
