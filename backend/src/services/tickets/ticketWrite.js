// Ticket create / update / delete as services. The HTTP handlers, bulk,
// take-it, merge, split and the recurring scheduler all go through these, so
// every path gets the same access checks, activity log, workflow rules,
// SLA hooks, notifications and calendar pushes as a single edit.
const fs = require('fs');
const path = require('path');
const {
  Ticket, TimeEntry, Task, TicketRelation, TicketWatcher, AssetTicket, Asset, Contact, TicketStatus, TicketSla, Team, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const { notifyAssigned, notifyWatchers, notifyNewInQueue } = require('../notifications');
const { logActivity, resolveDisplayValue } = require('../ticketActivity');
const { getTicketStatusBehaviorMap } = require('../statusBehavior');
const { getAllSettings } = require('../../controllers/settingsController');
const { assertCanWorkTicket } = require('../ticketPeople');
const { findDepartmentInCompany } = require('../companyService');
const {
  canAccessTicket, findAccessibleTicket, parseTicketId, parseRecordId, findAccessibleProject, findAccessibleContact,
} = require('../permissionService');
const { evaluateRules } = require('../workflowEngine');
const { syncTicketToExternalCalendars, removeTicketFromExternalCalendars } = require('../calendarPush');
const { maybeCreateCsatSurvey } = require('../csatService');
const { queueContactEmail } = require('../email/ticketMail');
const { logAssetActivity } = require('../assetActivity');
const { syncCustomFieldValues, assertCanEditTicket } = require('../../controllers/tickets/shared');
const { resolveCategoryForSave } = require('./categories');


// A status must be one of the configured ticket statuses (Q25). Returns its
// real name: the database matches names in any letter case, the behaviour
// map does not, so a ticket always stores the configured spelling.
// User responded is set only by the system, when a customer replies (user
// decision 2026-10-15); a ticket already in it may keep it.
async function ticketStatusName(name, current = null) {
  const row = typeof name === 'string' ? await TicketStatus.findOne({ where: { name } }) : null;
  if (!row) throw new ApiError(400, 'Unknown ticket status', 'VALIDATION_ERROR');
  if (row.systemKey === 'user_responded' && row.name !== current) {
    throw new ApiError(400, `"${row.name}" is set automatically when the customer replies`, 'VALIDATION_ERROR');
  }
  return row.name;
}

// A team id from a request must be a real team (null/empty clears it).
async function assertTeamExists(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = parseRecordId(raw);
  const team = id ? await Team.findByPk(id, { attributes: ['id'] }) : null;
  if (!team) throw new ApiError(400, 'Team not found', 'VALIDATION_ERROR');
  return team.id;
}

// Creates a ticket. `actor` is whose access the references are checked
// against; `createdById` is who the ticket, its activity and its notices are
// credited to (the same person, except for the recurring scheduler, which
// runs as a user's access but is created by the system actor). `systemSource`
// forces the source ('recurring'). `req` only supplies the audit trail.
async function createTicket(actor, input, {
  req, createdById = actor.id, source: systemSource = null, requireCategory = false,
} = {}) {
  const {
    title, description, priority, type, status, projectId, departmentId, dueDate, dueTime,
    blueprintId, customFields, teamId, tags, watcherIds, parentTicketId, childTicketIds, relatedTicketIds,
    assigneeId, contactId, source, assetIds, categoryId,
  } = input || {};
  if (!title || !title.trim()) {
    throw new ApiError(400, 'Ticket title is required', 'VALIDATION_ERROR');
  }
  if (!contactId) {
    throw new ApiError(400, 'A contact is required', 'VALIDATION_ERROR');
  }
  // 'portal' and 'recurring' are system-set only (the future customer portal
  // and the recurring scheduler, which pass `systemSource`); a person logging
  // a ticket by hand picks manual, phone or email (user decision 2026-10-15).
  const resolvedSource = systemSource || (['manual', 'phone', 'email'].includes(source) ? source : 'manual');
  const resolvedStatus = status ? await ticketStatusName(status) : 'Open';
  // Q35: creating a ticket already closed obeys "require time before close";
  // a new ticket has no time yet.
  if ((await getTicketStatusBehaviorMap()).get(resolvedStatus) === 'closed') {
    const settings = await getAllSettings();
    if (settings['timeTracking.requireBeforeClose'] === 'true') {
      throw new ApiError(400, 'Log time on this ticket before closing it', 'TIME_REQUIRED_BEFORE_CLOSE');
    }
  }

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
  // Two tickets are linked once (Q24): one ticket can't be parent, child and
  // related at the same time.
  const allLinked = [parentId, ...childIdList, ...relatedIdList].filter(Boolean);
  if (new Set(allLinked).size !== allLinked.length) {
    throw new ApiError(400, 'A ticket can be linked only once', 'VALIDATION_ERROR');
  }
  // Every ticket this one links to must be one the caller can see. Missing
  // and out-of-scope get the same answer, so the links can't probe ids.
  // (They must also share the new ticket's company — checked below, once the
  // contact is known.)
  const linkedIds = [...new Set([parentId, ...childIdList, ...relatedIdList].filter(Boolean))];
  const linkedTickets = [];
  for (const linkedId of linkedIds) {
    // eslint-disable-next-line no-await-in-loop
    const linked = await findAccessibleTicket(actor, linkedId);
    if (!linked) throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
    linkedTickets.push(linked);
  }
  const rawAssetIds = Array.isArray(assetIds) ? assetIds : [];

  // The contact and project must be ones the caller can see (S7, S6): the
  // response carries the contact's email/phone and the project's name.
  // Missing and out-of-scope get the same answer, and the checked record's
  // own id is what gets stored.
  const contact = await findAccessibleContact(actor, contactId);
  if (!contact) throw new ApiError(400, 'Contact not found', 'VALIDATION_ERROR');
  const resolvedTeamId = await assertTeamExists(teamId);
  const resolvedCategoryId = await resolveCategoryForSave(categoryId ?? null, { required: requireCategory });
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
    const project = await findAccessibleProject(actor, projectId);
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
  // Automatic assignment is a workflow rule on ticket_created (assignment
  // rules were folded into workflow rules, user decision 2026-10-12).
  let resolvedAssigneeId = null;
  if (assigneeId) {
    resolvedAssigneeId = await assertCanWorkTicket(assigneeId, contact.companyId, 'Assignee');
  }

  const ticket = await sequelize.transaction(async (t) => {
    const created = await Ticket.create({
      title: title.trim(),
      description: description || null,
      status: resolvedStatus,
      priority: priority || 'medium',
      type: type || 'request',
      source: resolvedSource,
      assigneeId: resolvedAssigneeId,
      teamId: resolvedTeamId,
      categoryId: resolvedCategoryId,
      contactId: contact.id,
      projectId: resolvedProjectId,
      departmentId: resolvedDepartmentId,
      dueDate: dueDate || null,
      dueTime: dueDate ? (dueTime || null) : null,
      blueprintId: blueprintId || null,
      customFields: Array.isArray(customFields) && customFields.length ? customFields : null,
      tags: Array.isArray(tags) && tags.length ? tags : null,
      createdBy: createdById,
    }, { transaction: t });

    if (input.customFieldValues) {
      await syncCustomFieldValues(created.id, input.customFieldValues, t, { categoryId: resolvedCategoryId });
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
      await AssetTicket.create({ assetId, ticketId: created.id, linkedBy: createdById }, { transaction: t });
    }

    return created;
  });
  await writeAudit(req, 'ticket.create', 'Ticket', ticket.id, { title: ticket.title });
  await logActivity(ticket.id, createdById, 'created', null, null);
  if (assetIdList.length) {
    const ticketNumber = String(ticket.id).padStart(5, '0');
    for (const assetId of assetIdList) {
      // eslint-disable-next-line no-await-in-loop
      await logAssetActivity(assetId, createdById, 'ticket_linked', { ticketId: ticket.id, ticketNumber, ticketTitle: ticket.title });
    }
  }
  await notifyAssigned(ticket, createdById);
  if (watcherIdList.length) {
    await notifyWatchers(ticket, `Ticket created: ${ticket.title}`, [createdById]);
  }
  await evaluateRules(ticket.id, 'ticket_created');
  // After the rules, which may have assigned it: only an unassigned ticket
  // is waiting in its team's queue.
  await notifyNewInQueue(await Ticket.findByPk(ticket.id), createdById);
  // Fire-and-forget — never throws, never awaited on the response path (see
  // calendarPush.js's module comment).
  syncTicketToExternalCalendars(ticket.id);
  return ticket;
}

// Validates a PATCH body against the ticket and returns what to write. Throws
// ApiError for anything refused. Does not write.
async function prepareTicketUpdate(req, ticket, body) {
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
    'categoryId',
  ];

  const changes = {};
  for (const key of allowed) {
    if (body[key] !== undefined) changes[key] = body[key];
  }
  if (changes.teamId !== undefined) changes.teamId = await assertTeamExists(changes.teamId);
  if (changes.categoryId !== undefined) changes.categoryId = await resolveCategoryForSave(changes.categoryId, { current: ticket.categoryId });
  if (changes.title !== undefined) {
    if (typeof changes.title !== 'string' || !changes.title.trim()) {
      throw new ApiError(400, 'Ticket title is required', 'VALIDATION_ERROR');
    }
    changes.title = changes.title.trim();
  }
  if (changes.status !== undefined && changes.status !== ticket.status) changes.status = await ticketStatusName(changes.status, ticket.status);
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
  // On a ticket with an SLA due date the due date is the SLA's: it moves
  // only through POST /tickets/:id/due-date (extend with a reason).
  if (changes.dueDate !== undefined || changes.dueTime !== undefined) {
    const sla = await TicketSla.findOne({ where: { ticketId: ticket.id }, attributes: ['resolutionDueAt'] });
    if (sla && sla.resolutionDueAt) {
      throw new ApiError(400, "This ticket's due date comes from its SLA. Use Extend due date to change it.", 'VALIDATION_ERROR');
    }
  }
  // A dueTime with no dueDate is meaningless — clearing the date always
  // clears the time, whatever the caller sent alongside it (Q27).
  if (changes.dueDate === null || changes.dueDate === '') {
    changes.dueDate = null;
    changes.dueTime = null;
  }
  if (changes.resolution !== undefined) {
    changes.resolutionUpdatedBy = req.user.id;
    changes.resolutionUpdatedAt = new Date();
  }
  const TRACKED_ACTIVITY_FIELDS = ['status', 'priority', 'type', 'assigneeId', 'teamId', 'departmentId', 'dueDate', 'dueTime', 'categoryId'];
  const before = {};
  TRACKED_ACTIVITY_FIELDS.forEach((f) => { before[f] = ticket[f]; });
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
  return { changes, before };
}

// The side effects of an update that has been saved: activity rows,
// notifications, workflow rules, CSAT, the resolved email and the calendar.
// `quiet` is for a ticket closed because it was merged away.
async function runTicketUpdateEffects(req, ticket, before, changes, { quiet = false } = {}) {
  const previousAssigneeId = before.assigneeId;
  const previousStatus = before.status;
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
    // A quiet close (a merged-away source) tells nobody and fires no
    // closing rules: its customers keep talking to the ticket it moved into.
    if (isClosed && !wasClosed && !quiet) {
      await evaluateRules(ticket.id, 'ticket_closed');
      await maybeCreateCsatSurvey(ticket);
      // Off by default; any move into a closed status (user decision 2026-10-15).
      queueContactEmail('contact_resolved', ticket);
    }
  }
  if (changes.priority !== undefined && ticket.priority !== before.priority) {
    await evaluateRules(ticket.id, 'ticket_priority_changed');
  }
  if (changes.assigneeId !== undefined && ticket.assigneeId !== previousAssigneeId) {
    await evaluateRules(ticket.id, 'ticket_assigned');
  }
  if (changes.teamId !== undefined && ticket.teamId && ticket.teamId !== before.teamId) {
    await notifyNewInQueue(await Ticket.findByPk(ticket.id), req.user.id);
  }
  if (changes.dueDate !== undefined || changes.dueTime !== undefined || changes.assigneeId !== undefined) {
    if (previousAssigneeId && previousAssigneeId !== ticket.assigneeId) {
      // Reassigned — drop the pushed event from the old assignee's calendar
      // before (re-)pushing to the new one, otherwise it'd be orphaned there.
      removeTicketFromExternalCalendars(ticket.id, previousAssigneeId);
    }
    syncTicketToExternalCalendars(ticket.id);
  }
}

const TRACKED_ACTIVITY_FIELDS = ['status', 'priority', 'type', 'assigneeId', 'teamId', 'departmentId', 'dueDate', 'dueTime', 'categoryId'];
const snapshotBefore = (ticket) => Object.fromEntries(TRACKED_ACTIVITY_FIELDS.map((f) => [f, ticket[f]]));

// Edits a ticket: access + edit-tier checks, validation, save, side effects.
async function updateTicket(req, ticket, body, { quiet = false } = {}) {
  // editMin only checked "has ANY edit tier" at the route level — same gap
  // as get() (see comment there) but for writes: without this, an
  // 'own'/'department'-scoped user could edit any ticket by id.
  if (!(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }
  await assertCanEditTicket(req.user, ticket);
  const { changes, before } = await prepareTicketUpdate(req, ticket, body);
  await sequelize.transaction(async (t) => {
    await ticket.update(changes, { transaction: t });
    if (body.customFieldValues) {
      await syncCustomFieldValues(ticket.id, body.customFieldValues, t, { categoryId: ticket.categoryId });
    }
  });
  await writeAudit(req, 'ticket.update', 'Ticket', ticket.id, changes);
  await runTicketUpdateEffects(req, ticket, before, changes, { quiet });
  return ticket;
}

// Deletes a ticket: needs the edit tier on the record (Q28) as well as the
// delete permission the route checks, and the company fence inside canAccess.
async function deleteTicket(req, ticket) {
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  await assertCanEditTicket(req.user, ticket);

  await sequelize.transaction(async (t) => {
    // The ledger and tasks have no database cascade (sub-project 3): a
    // ticket's time and tasks go with it, as the old foreign keys did.
    await TimeEntry.destroy({ where: { ticketId: ticket.id }, transaction: t });
    await Task.destroy({ where: { ticketId: ticket.id }, transaction: t });
    await ticket.destroy({ transaction: t });
    await writeAudit(req, 'ticket.delete', 'Ticket', ticket.id, { title: ticket.title }, { transaction: t });
  });

  // Remove attachment files from disk (best-effort).
  const dir = path.join(UPLOAD_ROOT, String(ticket.id));
  fs.rm(dir, { recursive: true, force: true }, () => {});
  removeTicketFromExternalCalendars(ticket.id, ticket.assigneeId);
}

// Adds a watcher (the person must reach the ticket's company).
async function addTicketWatcher(req, ticket, rawUserId) {
  if (!rawUserId) throw new ApiError(400, 'userId is required', 'VALIDATION_ERROR');
  const userId = await assertCanWorkTicket(rawUserId, ticket.companyId, 'Watcher');
  const [watcher, created] = await TicketWatcher.findOrCreate({ where: { ticketId: ticket.id, userId } });
  if (created) await writeAudit(req, 'watcher.add', 'Ticket', ticket.id, { userId });
  return { watcher, created };
}

module.exports = {
  ticketStatusName,
  assertTeamExists,
  createTicket,
  prepareTicketUpdate,
  runTicketUpdateEffects,
  snapshotBefore,
  updateTicket,
  deleteTicket,
  addTicketWatcher,
  TRACKED_ACTIVITY_FIELDS,
};
