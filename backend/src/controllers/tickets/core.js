// Tickets: list, board, create, read, update, delete. Create, update and
// delete are thin wrappers over services/tickets/ticketWrite.js.
const { Op } = require('sequelize');
const { Ticket, TimeEntry, CustomField, TicketFieldValue, TicketStatus, sequelize } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { slaFilterWhere, SLA_FILTERS } = require('../../services/sla/slaView');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const { parsePagination, paginated } = require('../../utils/pagination');
const { andWhere, ticketScopeWhere } = require('../../services/recordScope');
const { getUserTicketScope, canAccessTicket, parseRecordId } = require('../../services/permissionService');
const { createTicket, updateTicket, deleteTicket } = require('../../services/tickets/ticketWrite');
const { queueListWhere, queueCount, takeTicket } = require('../../services/tickets/queue');
const {
  ticketInclude, shownTicketFor, ticketAccessFor, ticketDetailFor,
} = require('./shared');

const SORTABLE_COLUMNS = ['id', 'title', 'priority', 'status', 'dueDate', 'createdAt', 'updatedAt'];

// Builds the WHERE clause for a ticket listing from the query string plus the
// caller's scope (recordScope.ticketScopeWhere — company fence and tier).
// Shared by the paginated table listing and the board, so both honour exactly
// the same filters and scope rules. The board passes ignoreStatus: it pins
// each column's status itself.
async function buildTicketListWhere(req, { ignoreStatus = false } = {}) {
  const where = {};
  const {
    status, priority, assignee, project, department, contactId, type, team, source,
    search, myTickets, overdue, unassigned, companyId, sla, queue,
  } = req.query;

  // "Closed" in the UI covers every status whose behaviorType is 'closed',
  // and "On hold" every on-hold status; anything else is a status name.
  const buckets = await getTicketStatusBuckets();
  if (status && !ignoreStatus) {
    if (status === 'closed') where.status = { [Op.in]: buckets.closed };
    else if (status === 'on_hold') where.status = { [Op.in]: buckets.onHold };
    else where.status = status;
  }
  if (priority) where.priority = priority;
  if (type) where.type = type;
  if (source) where.source = source;
  if (assignee) where.assigneeId = assignee;
  if (project) where.projectId = project;
  if (department) where.departmentId = department;
  if (contactId) where.contactId = contactId;
  if (team) where.teamId = team;
  if (companyId) where.companyId = parseRecordId(companyId) || -1;

  if (search && search.trim()) {
    const term = search.trim();
    const or = [
      { title: { [Op.like]: `%${term}%` } },
      { description: { [Op.like]: `%${term}%` } },
    ];
    const numeric = term.replace(/^#/, '').replace(/^0+(?=\d)/, '');
    if (/^\d+$/.test(numeric)) or.push({ id: Number(numeric) });
    where[Op.or] = or;
  }

  if (overdue === 'true') {
    where.dueDate = { [Op.lt]: new Date().toISOString().slice(0, 10) };
    // Only imply "open" when the status dropdown isn't already set — this is
    // an independent quick-filter toggle, not a status override. Archived
    // tickets are excluded here too (an "open" check, not just "not closed").
    if (!status && !ignoreStatus) where.status = { [Op.in]: buckets.open };
  }
  if (unassigned === 'true') where.assigneeId = null;
  if (sla !== undefined && sla !== '') {
    if (!SLA_FILTERS.includes(sla)) throw new ApiError(400, 'sla must be breached or at_risk', 'VALIDATION_ERROR');
    Object.assign(where, slaFilterWhere(sla));
    // Breached / at risk are about work still to do: open tickets, unless a
    // status was asked for explicitly.
    if (!status && !ignoreStatus) where.status = { [Op.in]: buckets.open };
  }

  // "My tickets" pins the view to the logged-in user regardless of any
  // assignee filter that was also passed ('own' scope already does).
  const scope = await getUserTicketScope(req.user.id);
  if (myTickets === 'true' && scope !== 'own') where.assigneeId = req.user.id;

  // A queue view widens the scope by the caller's own teams' unassigned
  // tickets (services/tickets/queue.js); otherwise scope is ANDed, never
  // merged in: a filter can only narrow it.
  if (queue !== undefined && queue !== '' && !ignoreStatus) {
    return andWhere(where, await queueListWhere(req.user, queue, { statusGiven: !!status }));
  }
  return andWhere(where, await ticketScopeWhere(req.user));
}

// Resolves a `?sortBy=cf:<fieldKey>` into the ORDER BY pieces needed to sort
// on a custom field's value. Sorting used to happen in the browser over the
// whole result set; with pagination the browser only ever holds one page, so
// it has to happen in SQL. Returns null for a normal column sort.
async function resolveCustomFieldSort(sortBy) {
  if (typeof sortBy !== 'string' || !sortBy.startsWith('cf:')) return null;
  const fieldKey = sortBy.slice(3);
  const field = await CustomField.findOne({ where: { fieldKey } });
  if (!field) return null;
  // Values live in a single TEXT column, so a number field has to be cast or
  // it sorts lexically ("10" before "9").
  const col = sequelize.col('fieldValues.value');
  return {
    fieldId: field.id,
    orderExpr: field.fieldType === 'number' ? sequelize.cast(col, 'DECIMAL(20,6)') : col,
  };
}

// Resolves one page of ticket ids, then hydrates just those.
//
// This is deliberately two queries. `ticketInclude` pulls in hasMany/belongsToMany
// associations (fieldValues, linkedAssets), and combining those with LIMIT in a
// single findAndCountAll goes wrong twice over: `count` counts joined rows rather
// than tickets, and LIMIT applies to joined rows too. Selecting bare ids first —
// no hasMany joins — keeps both honest, and the second query needs no limit at all
// because it is already constrained to one page of ids.
async function fetchTicketPage(where, {
  limit, offset, sortBy, sortDir, queueOrder = false,
}) {
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const cfSort = await resolveCustomFieldSort(sortBy);

  const idQuery = {
    where,
    attributes: ['id'],
    limit,
    offset,
    distinct: true,
    subQuery: false,
    raw: true,
  };

  if (cfSort) {
    idQuery.include = [{
      model: TicketFieldValue,
      as: 'fieldValues',
      attributes: [],
      required: false,
      where: { fieldId: cfSort.fieldId },
    }];
    // Tickets with no value for the field still appear (LEFT JOIN), they just
    // sort together as NULLs. `id` breaks ties so paging stays stable.
    idQuery.order = [[cfSort.orderExpr, orderDir], ['id', 'DESC']];
  } else if (queueOrder) {
    // Queue order: unassigned first, then the earliest SLA due date (no SLA
    // last), then oldest. Fixed SQL, no request values.
    const due = '(SELECT s.resolutionDueAt FROM TicketSlas s WHERE s.ticketId = Ticket.id)';
    idQuery.order = [
      [sequelize.literal('(Ticket.assigneeId IS NULL)'), 'DESC'],
      [sequelize.literal(`(${due} IS NULL)`), 'ASC'],
      [sequelize.literal(due), 'ASC'],
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ];
  } else {
    const column = SORTABLE_COLUMNS.includes(sortBy) ? sortBy : 'updatedAt';
    idQuery.order = [[column, orderDir], ['id', 'DESC']];
  }

  const { rows: idRows, count } = await Ticket.findAndCountAll(idQuery);
  const ids = idRows.map((r) => r.id);
  if (!ids.length) return { tickets: [], count: Array.isArray(count) ? count.length : count };

  const hydrated = await Ticket.findAll({ where: { id: { [Op.in]: ids } }, include: ticketInclude });
  const byId = new Map(hydrated.map((t) => [t.id, t]));
  return {
    tickets: ids.map((id) => byId.get(id)).filter(Boolean),
    count: Array.isArray(count) ? count.length : count,
  };
}

// Sums logged time per ticket for a page of tickets.
async function timeLoggedByTicket(ticketIds) {
  if (!ticketIds.length) return new Map();
  const totals = await TimeEntry.findAll({
    where: { ticketId: { [Op.in]: ticketIds } },
    attributes: ['ticketId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'total']],
    group: ['ticketId'],
    raw: true,
  });
  return new Map(totals.map((r) => [r.ticketId, Math.round((Number(r.total) || 0) / 60)]));
}

// GET /tickets — with filters, paginated
const list = asyncHandler(async (req, res) => {
  const where = await buildTicketListWhere(req);
  const { page, limit, offset } = parsePagination(req);
  const { tickets, count } = await fetchTicketPage(where, {
    limit, offset, sortBy: req.query.sortBy, sortDir: req.query.sortDir,
    queueOrder: !!req.query.queue && !req.query.sortBy,
  });

  const minutesByTicket = await timeLoggedByTicket(tickets.map((t) => t.id));

  res.json(paginated(
    'tickets',
    {
      rows: await Promise.all(tickets.map(async (t) => ({
        ...(await shownTicketFor(req.user, t)),
        timeLoggedMinutes: minutesByTicket.get(t.id) || 0,
      }))),
      count,
    },
    { page, limit }
  ));
});

// Per-column cap on the board. The board is a whole-pipeline view, so it can't
// be paged the way the table is — instead each column shows its newest N and
// reports its true total so the UI can say "+N more".
const BOARD_COLUMN_LIMIT = 100;

// GET /tickets/board — the same filters as GET /tickets, but grouped into one
// bucket per ticket status and capped per bucket instead of paged.
const board = asyncHandler(async (req, res) => {
  const baseWhere = await buildTicketListWhere(req, { ignoreStatus: true });
  const statuses = await TicketStatus.findAll({
    where: { behaviorType: { [Op.ne]: 'archived' } },
    order: [['position', 'ASC']],
  });

  const columns = await Promise.all(statuses.map(async (s) => {
    // Each column re-applies the shared filters with its own status pinned.
    // `status` from the query string is intentionally overridden: the board
    // shows every column, and the table's status dropdown is hidden in board
    // view.
    const where = andWhere(baseWhere, { status: s.name });
    const { tickets, count } = await fetchTicketPage(where, {
      limit: BOARD_COLUMN_LIMIT,
      offset: 0,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    });
    return { status: s.toJSON(), tickets, total: count };
  }));

  const minutesByTicket = await timeLoggedByTicket(
    columns.flatMap((c) => c.tickets.map((t) => t.id))
  );

  res.json({
    columns: await Promise.all(columns.map(async (c) => ({
      status: c.status,
      total: c.total,
      limit: BOARD_COLUMN_LIMIT,
      tickets: await Promise.all(c.tickets.map(async (t) => ({
        ...(await shownTicketFor(req.user, t)),
        timeLoggedMinutes: minutesByTicket.get(t.id) || 0,
      }))),
    }))),
  });
});

// POST /tickets
const create = asyncHandler(async (req, res) => {
  const ticket = await createTicket(req.user, req.body, { req });
  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.status(201).json({ ticket: { ...(await shownTicketFor(req.user, fresh)), access: await ticketAccessFor(req.user, fresh) } });
});

// GET /tickets/:id
const get = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id, { include: ticketInclude });
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  // requirePermission only checked "has ANY view tier" at the route level;
  // an 'own'/'department'-scoped user could otherwise read any ticket by id.
  if (!(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }
  res.json({ ticket: await ticketDetailFor(req.user, ticket) });
});

// PATCH /tickets/:id
const update = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  await updateTicket(req, ticket, req.body || {});
  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.json({ ticket: { ...(await shownTicketFor(req.user, fresh)), access: await ticketAccessFor(req.user, fresh) } });
});

// DELETE /tickets/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  await deleteTicket(req, ticket);
  res.json({ ok: true });
});

// GET /tickets/queue-count — unassigned open tickets waiting in my teams.
const queueCountHandler = asyncHandler(async (req, res) => {
  res.json({ count: await queueCount(req.user) });
});

// POST /tickets/:id/take
const take = asyncHandler(async (req, res) => {
  const ticket = await takeTicket(req, req.params.id);
  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.json({ ticket: { ...(await shownTicketFor(req.user, fresh)), access: await ticketAccessFor(req.user, fresh) } });
});

module.exports = {
  queueCount: queueCountHandler,
  take,
  list,
  board,
  create,
  get,
  update,
  remove,
};
