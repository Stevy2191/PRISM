// Tickets: list, board, create, read, update, delete.
const fs = require('fs');
const path = require('path');
const {
  Ticket,
  TimeEntry,
  TicketRelation,
  TicketWatcher,
  AssetTicket,
  Asset,
  CustomField,
  TicketFieldValue,
  Contact,
  TicketStatus,
  sequelize,
} = require('../../models');
const { Op } = require('sequelize');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { notifyAssigned, notifyWatchers } = require('../../services/notifications');
const { logActivity, resolveDisplayValue } = require('../../services/ticketActivity');
const {
  getTicketStatusBuckets,
  getTicketStatusBehaviorMap,
} = require('../../services/statusBehavior');
const { getAllSettings } = require('../settingsController');
const { matchAssignmentRule } = require('../assignmentRulesController');
const { canWorkCompany, assertCanWorkTicket } = require('../../services/ticketPeople');
const { parsePagination, paginated } = require('../../utils/pagination');
const { andWhere, ticketScopeWhere } = require('../../services/recordScope');
const { findDepartmentInCompany } = require('../../services/companyService');
const {
  getUserTicketScope,
  canAccessTicket,
  findAccessibleTicket,
  parseTicketId,
  parseRecordId,
  findAccessibleProject,
  findAccessibleContact,
  canAccessCompany,
} = require('../../services/permissionService');
const { evaluateRules } = require('../../services/workflowEngine');
const {
  syncTicketToExternalCalendars,
  removeTicketFromExternalCalendars,
} = require('../../services/calendarPush');
const { maybeCreateCsatSurvey } = require('../../services/csatService');
const { logAssetActivity } = require('../../services/assetActivity');
const { ticketInclude, syncCustomFieldValues, withCustomFields } = require('./shared');

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
    search, myTickets, overdue, unassigned, companyId,
  } = req.query;

  // "Closed" in the UI covers every status whose behaviorType is 'closed';
  // everything else maps to the matching column value directly.
  const buckets = await getTicketStatusBuckets();
  if (status && !ignoreStatus) where.status = status === 'closed' ? { [Op.in]: buckets.closed } : status;
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

  // "My tickets" pins the view to the logged-in user regardless of any
  // assignee filter that was also passed ('own' scope already does).
  const scope = await getUserTicketScope(req.user.id);
  if (myTickets === 'true' && scope !== 'own') where.assigneeId = req.user.id;

  // Scope is ANDed, never merged in: a filter can only narrow it.
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
async function fetchTicketPage(where, { limit, offset, sortBy, sortDir }) {
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
    attributes: ['ticketId', [sequelize.fn('SUM', sequelize.col('minutes')), 'total']],
    group: ['ticketId'],
    raw: true,
  });
  return new Map(totals.map((r) => [r.ticketId, Number(r.total) || 0]));
}

// GET /tickets — with filters, paginated
const list = asyncHandler(async (req, res) => {
  const where = await buildTicketListWhere(req);
  const { page, limit, offset } = parsePagination(req);
  const { tickets, count } = await fetchTicketPage(where, {
    limit, offset, sortBy: req.query.sortBy, sortDir: req.query.sortDir,
  });

  const minutesByTicket = await timeLoggedByTicket(tickets.map((t) => t.id));

  res.json(paginated(
    'tickets',
    {
      rows: tickets.map((t) => ({
        ...withCustomFields(t),
        timeLoggedMinutes: minutesByTicket.get(t.id) || 0,
      })),
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
    columns: columns.map((c) => ({
      status: c.status,
      total: c.total,
      limit: BOARD_COLUMN_LIMIT,
      tickets: c.tickets.map((t) => ({
        ...withCustomFields(t),
        timeLoggedMinutes: minutesByTicket.get(t.id) || 0,
      })),
    })),
  });
});

// POST /tickets
const create = asyncHandler(async (req, res) => {
  const {
    title, description, priority, type, status, projectId, departmentId, dueDate, dueTime,
    blueprintId, customFields, teamId, tags, watcherIds, parentTicketId, childTicketIds, relatedTicketIds,
    assigneeId, contactId, source, assetIds,
  } = req.body || {};
  if (!title || !title.trim()) {
    throw new ApiError(400, 'Ticket title is required', 'VALIDATION_ERROR');
  }
  if (!contactId) {
    throw new ApiError(400, 'A contact is required', 'VALIDATION_ERROR');
  }
  // 'email'/'portal' are system-set only (inbound email processing / future
  // customer portal, both create tickets internally rather than through
  // this HTTP endpoint) — a caller of this API can only pick manual/phone,
  // same restriction the create-ticket form's dropdown itself enforces.
  const resolvedSource = ['manual', 'phone'].includes(source) ? source : 'manual';

  // Linked ticket ids must be plain integers: a value parseInt would read as
  // a different number than the one supplied is refused, not truncated.
  const parseLinked = (raw) => {
    const id = parseTicketId(raw);
    if (!id) throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
    return id;
  };
  const childIdList = Array.isArray(childTicketIds) ? [...new Set(childTicketIds.map(parseLinked))] : [];
  const relatedIdList = Array.isArray(relatedTicketIds) ? [...new Set(relatedTicketIds.map(parseLinked))] : [];
  const parentId = parentTicketId ? parseLinked(parentTicketId) : null;
  // Every ticket this one links to must be one the caller can see. Missing
  // and out-of-scope get the same answer, so the links can't probe ids.
  // (They must also share the new ticket's company — checked below, once the
  // contact is known.)
  const linkedIds = [...new Set([parentId, ...childIdList, ...relatedIdList].filter(Boolean))];
  const linkedTickets = [];
  for (const linkedId of linkedIds) {
    // eslint-disable-next-line no-await-in-loop
    const linked = await findAccessibleTicket(req.user, linkedId);
    if (!linked) throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
    linkedTickets.push(linked);
  }
  const rawAssetIds = Array.isArray(assetIds) ? assetIds : [];

  // The contact and project must be ones the caller can see (S7, S6): the
  // response carries the contact's email/phone and the project's name.
  // Missing and out-of-scope get the same answer, and the checked record's
  // own id is what gets stored.
  const contact = await findAccessibleContact(req.user, contactId);
  if (!contact) throw new ApiError(400, 'Contact not found', 'VALIDATION_ERROR');
  // Links stay inside one company: the new ticket's is its contact's.
  if (linkedTickets.some((t) => t.companyId !== contact.companyId)) {
    throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
  }
  // Linked assets must be in the ticket's company, which is the contact's
  // (one the caller can see, so the company is reachable). Missing and
  // foreign get the same answer; the checked asset's own id is stored.
  const assetIdSet = new Set();
  for (const rawId of rawAssetIds) {
    // eslint-disable-next-line no-await-in-loop
    const asset = await Asset.findByPk(parseRecordId(rawId) || 0, { attributes: ['id', 'companyId'] });
    if (!asset || asset.companyId !== contact.companyId) throw new ApiError(400, 'Asset not found', 'VALIDATION_ERROR');
    assetIdSet.add(asset.id);
  }
  const assetIdList = [...assetIdSet];
  let resolvedProjectId = null;
  if (projectId) {
    const project = await findAccessibleProject(req.user, projectId);
    if (!project || project.companyId !== contact.companyId) throw new ApiError(400, 'Project not found', 'VALIDATION_ERROR');
    resolvedProjectId = project.id;
  }
  // The ticket's company is its contact's, and its department must belong to
  // that company (client companies, sub-project 2).
  let resolvedDepartmentId = null;
  if (departmentId) {
    const dept = await findDepartmentInCompany(departmentId, contact.companyId);
    if (!dept) throw new ApiError(400, 'Department not found', 'VALIDATION_ERROR');
    resolvedDepartmentId = dept.id;
  }
  // Spec: the department defaults to the contact's (which belongs to the
  // contact's company by the contact integrity rule).
  if (!departmentId && contact.departmentId) resolvedDepartmentId = contact.departmentId;

  // Watchers and the assignee must reach the ticket's company (plan 2b).
  // De-duplicated and capped before any are checked: each check is a few
  // queries, and the list comes straight from the request body.
  const rawWatcherIds = Array.isArray(watcherIds) ? [...new Set(watcherIds.map((id) => String(id)))] : [];
  if (rawWatcherIds.length > 100) throw new ApiError(400, 'A ticket can have at most 100 watchers', 'VALIDATION_ERROR');
  const watcherIdList = [];
  for (const raw of rawWatcherIds) {
    // eslint-disable-next-line no-await-in-loop
    const id = await assertCanWorkTicket(raw, contact.companyId, 'Watcher');
    if (!watcherIdList.includes(id)) watcherIdList.push(id);
  }

  // Simple auto-assignment (Settings -> Assignment Rules) only kicks in when
  // the caller didn't already pick an assignee/team explicitly — an
  // explicit choice on the new-ticket form always wins.
  let ruleAssigneeId = null;
  let ruleTeamId = null;
  if (!assigneeId && !teamId) {
    const matched = await matchAssignmentRule({
      type: type || 'request',
      departmentId: resolvedDepartmentId,
      priority: priority || 'medium',
    });
    if (matched) {
      ruleAssigneeId = matched.assigneeId;
      ruleTeamId = matched.teamId;
    }
  }
  let resolvedAssigneeId = null;
  if (assigneeId) {
    resolvedAssigneeId = await assertCanWorkTicket(assigneeId, contact.companyId, 'Assignee');
  } else if (ruleAssigneeId && (await canWorkCompany(ruleAssigneeId, contact.companyId))) {
    // A rule's assignee who can't reach this company is skipped, not refused.
    resolvedAssigneeId = ruleAssigneeId;
  }

  const ticket = await sequelize.transaction(async (t) => {
    const created = await Ticket.create({
      title: title.trim(),
      description: description || null,
      status: status || 'Open',
      priority: priority || 'medium',
      type: type || 'request',
      source: resolvedSource,
      assigneeId: resolvedAssigneeId,
      teamId: teamId || ruleTeamId || null,
      contactId: contact.id,
      projectId: resolvedProjectId,
      departmentId: resolvedDepartmentId,
      dueDate: dueDate || null,
      dueTime: dueDate ? (dueTime || null) : null,
      blueprintId: blueprintId || null,
      customFields: Array.isArray(customFields) && customFields.length ? customFields : null,
      tags: Array.isArray(tags) && tags.length ? tags : null,
      createdBy: req.user.id,
    }, { transaction: t });

    if (req.body.customFieldValues) {
      await syncCustomFieldValues(created.id, req.body.customFieldValues, t);
    }

    if (parentId) {
      await TicketRelation.create(
        { ticketId: created.id, relatedTicketId: parentId, relationType: 'parent' },
        { transaction: t }
      );
    }
    for (const childId of childIdList) {
      // eslint-disable-next-line no-await-in-loop
      await TicketRelation.create(
        { ticketId: childId, relatedTicketId: created.id, relationType: 'parent' },
        { transaction: t }
      );
    }
    for (const relId of relatedIdList) {
      // eslint-disable-next-line no-await-in-loop
      await TicketRelation.create(
        { ticketId: created.id, relatedTicketId: relId, relationType: 'related' },
        { transaction: t }
      );
    }
    for (const userId of watcherIdList) {
      // eslint-disable-next-line no-await-in-loop
      await TicketWatcher.create({ ticketId: created.id, userId }, { transaction: t });
    }
    for (const assetId of assetIdList) {
      // eslint-disable-next-line no-await-in-loop
      await AssetTicket.create({ assetId, ticketId: created.id, linkedBy: req.user.id }, { transaction: t });
    }

    return created;
  });
  await writeAudit(req, 'ticket.create', 'Ticket', ticket.id, { title: ticket.title });
  await logActivity(ticket.id, req.user.id, 'created', null, null);
  if (assetIdList.length) {
    const ticketNumber = String(ticket.id).padStart(5, '0');
    for (const assetId of assetIdList) {
      // eslint-disable-next-line no-await-in-loop
      await logAssetActivity(assetId, req.user.id, 'ticket_linked', { ticketId: ticket.id, ticketNumber, ticketTitle: ticket.title });
    }
  }
  await notifyAssigned(ticket, req.user.id);
  if (watcherIdList.length) {
    await notifyWatchers(ticket, `Ticket created: ${ticket.title}`, [req.user.id]);
  }
  await evaluateRules(ticket.id, 'ticket_created');
  // Fire-and-forget — never throws, never awaited on the response path (see
  // calendarPush.js's module comment).
  syncTicketToExternalCalendars(ticket.id);

  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.status(201).json({ ticket: withCustomFields(fresh) });
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
  res.json({ ticket: withCustomFields(ticket) });
});

// PATCH /tickets/:id
const update = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  // editMin only checked "has ANY edit tier" at the route level — same gap
  // as get() (see comment there) but for writes: without this, an
  // 'own'/'department'-scoped user could edit any ticket by id.
  if (!(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }

  // Every PRISM user is staff now (the requester tier moved to Contacts,
  // who don't call this API), so there's one edit surface — resolution
  // stays customer-visible read-only, editable here by staff only.
  const allowed = [
    'title',
    'description',
    'status',
    'priority',
    'type',
    'assigneeId',
    'teamId',
    'contactId',
    'projectId',
    'departmentId',
    'dueDate',
    'dueTime',
    'customFields',
    'tags',
    'resolution',
  ];

  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  // Same rules as create for the contact and project (S7, S6). Re-sending the
  // ticket's current value unchanged (a client PATCHing the whole ticket
  // back) reveals nothing new, so it isn't re-checked.
  if (changes.contactId !== undefined && parseRecordId(changes.contactId) !== ticket.contactId) {
    const contact = await findAccessibleContact(req.user, changes.contactId);
    if (!contact) throw new ApiError(400, 'Contact not found', 'VALIDATION_ERROR');
    changes.contactId = contact.id;
  } else if (changes.contactId !== undefined) {
    changes.contactId = ticket.contactId;
  }
  // The department stays inside the ticket's company, which is its contact's
  // (the model hook moves companyId with the contact). A contact change with
  // no department given keeps the current one if it fits, else takes the new
  // contact's.
  const contactChanged = changes.contactId !== undefined && changes.contactId !== ticket.contactId;
  const companyContact = contactChanged ? await Contact.findByPk(changes.contactId) : null;
  const targetCompanyId = companyContact ? companyContact.companyId : ticket.companyId;
  if (changes.assigneeId && Number(changes.assigneeId) !== ticket.assigneeId) {
    changes.assigneeId = await assertCanWorkTicket(changes.assigneeId, targetCompanyId, 'Assignee');
  }
  if (changes.departmentId) {
    const dept = await findDepartmentInCompany(changes.departmentId, targetCompanyId);
    if (!dept) throw new ApiError(400, 'Department not found', 'VALIDATION_ERROR');
    changes.departmentId = dept.id;
  } else if (changes.departmentId !== undefined) {
    changes.departmentId = null;
  } else if (contactChanged && ticket.departmentId) {
    const current = await findDepartmentInCompany(ticket.departmentId, targetCompanyId);
    if (!current) changes.departmentId = companyContact.departmentId || null;
  } else if (contactChanged) {
    changes.departmentId = companyContact.departmentId || null;
  }
  if (changes.projectId !== undefined) {
    if (!changes.projectId) {
      changes.projectId = null;
    } else if (parseRecordId(changes.projectId) === ticket.projectId) {
      changes.projectId = ticket.projectId;
    } else {
      const project = await findAccessibleProject(req.user, changes.projectId);
      if (!project || project.companyId !== targetCompanyId) throw new ApiError(400, 'Project not found', 'VALIDATION_ERROR');
      changes.projectId = project.id;
    }
  }
  // A dueTime with no dueDate is meaningless — clearing the date always
  // clears any time set alongside it, even if the caller didn't say so.
  if (changes.dueDate === null && changes.dueTime === undefined) {
    changes.dueTime = null;
  }
  if (changes.resolution !== undefined) {
    changes.resolutionUpdatedBy = req.user.id;
    changes.resolutionUpdatedAt = new Date();
  }
  const TRACKED_ACTIVITY_FIELDS = ['status', 'priority', 'type', 'assigneeId', 'teamId', 'departmentId', 'dueDate', 'dueTime'];
  const before = {};
  TRACKED_ACTIVITY_FIELDS.forEach((f) => { before[f] = ticket[f]; });
  const previousAssigneeId = ticket.assigneeId;
  const previousStatus = ticket.status;

  // System-wide "require time logged before close" (Settings -> Time
  // Tracking) — only fires on a genuine transition INTO a closed-behavior
  // status, not on every save of an already-closed ticket.
  if (changes.status !== undefined && changes.status !== previousStatus) {
    const behaviorByName = await getTicketStatusBehaviorMap();
    const closingNow = behaviorByName.get(changes.status) === 'closed' && behaviorByName.get(previousStatus) !== 'closed';
    if (closingNow) {
      const settings = await getAllSettings();
      if (settings['timeTracking.requireBeforeClose'] === 'true') {
        const loggedCount = await TimeEntry.count({ where: { ticketId: ticket.id } });
        if (!loggedCount) {
          throw new ApiError(400, 'Log time on this ticket before closing it', 'TIME_REQUIRED_BEFORE_CLOSE');
        }
      }
    }
  }

  await sequelize.transaction(async (t) => {
    await ticket.update(changes, { transaction: t });
    if (req.body.customFieldValues) {
      await syncCustomFieldValues(ticket.id, req.body.customFieldValues, t);
    }
  });
  await writeAudit(req, 'ticket.update', 'Ticket', ticket.id, changes);

  // eslint-disable-next-line no-restricted-syntax
  for (const field of TRACKED_ACTIVITY_FIELDS) {
    if (changes[field] === undefined) continue; // eslint-disable-line no-continue
    const beforeVal = before[field];
    const afterVal = ticket[field];
    if (String(beforeVal ?? '') === String(afterVal ?? '')) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const fromDisplay = await resolveDisplayValue(field, beforeVal);
    // eslint-disable-next-line no-await-in-loop
    const toDisplay = await resolveDisplayValue(field, afterVal);
    // eslint-disable-next-line no-await-in-loop
    await logActivity(ticket.id, req.user.id, field, fromDisplay, toDisplay);
  }

  if (changes.assigneeId !== undefined && ticket.assigneeId && ticket.assigneeId !== previousAssigneeId) {
    await notifyAssigned(ticket, req.user.id);
  }
  if (changes.status !== undefined && ticket.status !== previousStatus) {
    await notifyWatchers(
      ticket,
      `Status changed to "${ticket.status.replace(/_/g, ' ')}" on ticket: ${ticket.title}`,
      [req.user.id, ticket.assigneeId]
    );
  }

  if (Object.keys(changes).length) {
    await evaluateRules(ticket.id, 'ticket_updated', Object.keys(changes));
  }
  if (changes.status !== undefined && ticket.status !== previousStatus) {
    await evaluateRules(ticket.id, 'ticket_status_changed');
    const behaviorByName = await getTicketStatusBehaviorMap();
    const wasClosed = behaviorByName.get(previousStatus) === 'closed';
    const isClosed = behaviorByName.get(ticket.status) === 'closed';
    if (isClosed && !wasClosed) {
      await evaluateRules(ticket.id, 'ticket_closed');
      await maybeCreateCsatSurvey(ticket);
    }
  }
  if (changes.priority !== undefined && ticket.priority !== before.priority) {
    await evaluateRules(ticket.id, 'ticket_priority_changed');
  }
  if (changes.assigneeId !== undefined && ticket.assigneeId !== previousAssigneeId) {
    await evaluateRules(ticket.id, 'ticket_assigned');
  }
  if (changes.dueDate !== undefined || changes.dueTime !== undefined || changes.assigneeId !== undefined) {
    if (previousAssigneeId && previousAssigneeId !== ticket.assigneeId) {
      // Reassigned — drop the pushed event from the old assignee's calendar
      // before (re-)pushing to the new one, otherwise it'd be orphaned there.
      removeTicketFromExternalCalendars(ticket.id, previousAssigneeId);
    }
    syncTicketToExternalCalendars(ticket.id);
  }

  const fresh = await Ticket.findByPk(ticket.id, { include: ticketInclude });
  res.json({ ticket: withCustomFields(fresh) });
});

// DELETE /tickets/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  // The company fence applies to every write, deletes included. (The tier
  // re-check is still missing here: quirk Q28, pinned until sub-project 3.)
  if (!(await canAccessCompany(req.user, ticket.companyId))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');

  await sequelize.transaction(async (t) => {
    await ticket.destroy({ transaction: t });
    await writeAudit(req, 'ticket.delete', 'Ticket', ticket.id, { title: ticket.title }, { transaction: t });
  });

  // Remove attachment files from disk (best-effort).
  const dir = path.join(UPLOAD_ROOT, String(ticket.id));
  fs.rm(dir, { recursive: true, force: true }, () => {});
  removeTicketFromExternalCalendars(ticket.id, ticket.assigneeId);

  res.json({ ok: true });
});

module.exports = {
  list,
  board,
  create,
  get,
  update,
  remove,
};
