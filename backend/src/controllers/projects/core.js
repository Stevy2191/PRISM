// Projects: list, tags, create, read, update, delete, stats.
const { Op, Transaction, cast, col: sqlCol, where: sqlWhere } = require('sequelize');
const fs = require('fs');
const path = require('path');
const {
  Project,
  ProjectMember,
  ProjectContact,
  Contact,
  Company,
  Department,
  ProjectExpense,
  ProjectMaterial,
  ProjectStatus,
  ProjectFile,
  ProjectActivity,
  ProjectTemplate,
  ActiveTimer,
  Task,
  TimeEntry,
  User,
  sequelize,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { formatProjectCode, previousCodeWhere } = require('../../services/projects/numbers');
const { writeAudit } = require('../../middleware/audit');
const { logProjectActivity } = require('../../services/projectActivity');
const {
  syncProjectToExternalCalendars,
  removeProjectFromExternalCalendars,
} = require('../../services/calendarPush');
const { parsePagination, paginated } = require('../../utils/pagination');
const { andWhere, projectScopeWhere } = require('../../services/recordScope');
const {
  getInternalCompanyId,
  findDepartmentInCompany,
  resolveRecordCompany,
  isCompanyChange,
} = require('../../services/companyService');
const {
  getProjectStatusBuckets,
  getFirstProjectStatusByBehavior,
} = require('../../services/statusBehavior');
const { computeProjectCompletion } = require('../../services/projectCompletion');
const { UPLOAD_ROOT } = require('../../middleware/upload');
const {
  canAccessProject,
  parseRecordId,
} = require('../../services/permissionService');
const { attentionClause, attentionCounts, rowFigures, todayFrom, validDay } = require('../../services/projects/listing');
const { cleanBudgetMinutes, budgetSummary, rearmBudgetAlerts } = require('../../services/projects/budget');
const templates = require('../../services/projects/templates');
const { loadStructure } = require('../../services/projects/templateStructure');
const {
  userAttrs, projectInclude, buildProjectStats, getProjectWithDetail, assertCanEditProject,
  assertCanWorkProject, assertCanManageMembers, syncLeadMembership, projectAccessFor,
} = require('./shared');
const { orgToday } = require('../../utils/orgTime');

// ==================== Projects ====================

// GET /projects — filters: status, state (open|closed), ownerDept, forDept,
// assignee, myProjects, mine (lead|member), attention (over_budget|
// milestones_7d|unassigned, with today), myDepartment, overdue, search, tag.
// Builds the WHERE clause for a project listing from the query string plus
// the caller's permission scope. Returns `{ where, empty }` — `empty` means
// the scope resolved to no projects at all, so the caller should short-circuit
// rather than run a query with an impossible clause.
async function buildProjectListWhere(req) {
  const where = {};
  const {
    status, state, ownerDept, forDept, assignee, myProjects, mine, attention, myDepartment, overdue, search, tag, companyId,
  } = req.query;
  // Query values can arrive as qs objects/arrays: ids go through
  // parseRecordId (a junk id narrows to nothing), status must be a string.
  const id = (v) => parseRecordId(v) || -1;
  if (status !== undefined && typeof status !== 'string') throw new ApiError(400, 'status must be a single value', 'VALIDATION_ERROR');
  if (companyId) where.companyId = id(companyId);

  // Scope (company fence and tier) comes from recordScope and is ANDed in at
  // the end, so these filters can only narrow it.
  if (ownerDept) where.ownerDepartmentId = id(ownerDept);
  if (forDept) where.forDepartmentId = id(forDept);

  // "My department" quick filter — narrows to the caller's own department
  // regardless of scope tier (meaningful for 'all'/'department' scopes; a
  // 'department'-scope caller may otherwise also see cross-department
  // projects they're personally a member of via the scope OR above).
  if (myDepartment === 'true' && req.user.departmentId) {
    const deptClause = { [Op.or]: [{ ownerDepartmentId: req.user.departmentId }, { forDepartmentId: req.user.departmentId }] };
    where[Op.and] = where[Op.and] ? [...where[Op.and], deptClause] : [deptClause];
  }

  const buckets = (status === 'closed' || overdue === 'true') ? await getProjectStatusBuckets() : null;
  if (status) where.status = status === 'closed' ? { [Op.in]: buckets.closed } : status;
  if (assignee) where.assignedToUserId = id(assignee);
  if (overdue === 'true') {
    where.dueDate = { [Op.lt]: await orgToday() };
    if (!status) where.status = { [Op.in]: buckets.open };
  }
  // `tags` is a JSON-typed column — Sequelize JSON-serializes the RHS of a
  // plain `{ tags: { [Op.like]: ... } }` comparison (turning `%foo%` into the
  // literal string `"%foo%"`), which breaks LIKE wildcard matching. Casting
  // the column to CHAR via sequelize.where/cast bypasses that serialization
  // so LIKE matches the raw JSON text, e.g. `["migration","urgent"]`.
  const tagsLike = (pattern) => sqlWhere(cast(sqlCol('Project.tags'), 'CHAR'), { [Op.like]: pattern });

  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { description: { [Op.like]: `%${search}%` } },
      { projectCode: { [Op.like]: `%${search}%` } },
      tagsLike(`%${search}%`),
    ];
    // CN: a code it had before.
    const byOldCode = previousCodeWhere(search);
    if (byOldCode) where[Op.or].push(byOldCode);
  }
  // Tag filter dropdown — exact tag match. Matching the quoted element is
  // precise enough for this app's simple freeform tags (mirrors the
  // LIKE-based `search` above).
  if (tag) {
    const tagClause = tagsLike(`%"${tag}"%`);
    where[Op.and] = where[Op.and] ? [...where[Op.and], tagClause] : [tagClause];
  }

  if (myProjects === 'true') {
    const memberships = await ProjectMember.findAll({
      where: { userId: req.user.id },
      attributes: ['projectId'],
      raw: true,
    });
    const ids = memberships.map((m) => m.projectId);
    if (ids.length === 0) return { where, empty: true };
    where.id = { [Op.in]: ids };
  }

  // "I'm on" is any membership (lead, member or helper); "I lead" is the
  // lead field or a lead membership (Q30 keeps the two together).
  if (mine !== undefined) {
    const rows = await ProjectMember.findAll({
      where: mine === 'lead' ? { userId: req.user.id, role: 'lead' } : { userId: req.user.id },
      attributes: ['projectId'],
      raw: true,
    });
    const ids = rows.map((m) => m.projectId);
    const clause = mine === 'lead'
      ? { [Op.or]: [{ assignedToUserId: req.user.id }, { id: { [Op.in]: ids } }] }
      : mine === 'member' ? { id: { [Op.in]: ids } } : { id: -1 };
    if (mine === 'member' && !ids.length) return { where, empty: true };
    where[Op.and] = [...(where[Op.and] || []), clause];
  }
  if (state === 'open' || state === 'closed') {
    const stateBuckets = await getProjectStatusBuckets();
    where[Op.and] = [...(where[Op.and] || []), { status: { [Op.in]: stateBuckets[state] } }];
  }
  if (attention !== undefined) {
    where[Op.and] = [...(where[Op.and] || []), await attentionClause(attention, todayFrom(req.query))];
  }

  return { where: andWhere(where, await projectScopeWhere(req.user)), empty: false };
}

// GET /projects/attention — the tile numbers, for the projects this viewer can see.
const attentionTiles = asyncHandler(async (req, res) => {
  res.json(await attentionCounts(req.user, req.query));
});

// GET /projects — paginated
const list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const { where, empty } = await buildProjectListWhere(req);
  if (empty) return res.json(paginated('projects', { rows: [], count: 0 }, { page, limit }));

  // Two queries on purpose: the `members` include is a hasMany, so pairing it
  // with LIMIT in one findAndCountAll would both inflate `count` (one row per
  // member) and let LIMIT cut a project's members in half. Page the bare ids
  // first, then hydrate exactly those.
  const { rows: idRows, count } = await Project.findAndCountAll({
    where,
    attributes: ['id'],
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
    distinct: true,
    subQuery: false,
    raw: true,
  });
  const ids = idRows.map((r) => r.id);
  if (!ids.length) return res.json(paginated('projects', { rows: [], count }, { page, limit }));

  const found = await Project.findAll({
    where: { id: { [Op.in]: ids } },
    include: [
      ...projectInclude,
      { model: ProjectMember, as: 'members', include: [{ model: User, as: 'user', attributes: userAttrs }] },
    ],
  });
  const byId = new Map(found.map((pr) => [pr.id, pr]));
  const projects = ids.map((id) => byId.get(id)).filter(Boolean);

  const statusRows = await ProjectStatus.findAll({ attributes: ['name', 'color'] });
  const colorByName = new Map(statusRows.map((st) => [st.name, st.color]));

  const figures = await rowFigures(ids);

  // Three extra queries per project. That was 3×N over the whole table before
  // paging; it is now bounded by the page size.
  const withStats = await Promise.all(
    projects.map(async (project) => {
      const [completion, expenseSum, materialSum] = await Promise.all([
        computeProjectCompletion(project.id),
        ProjectExpense.sum('amount', { where: { projectId: project.id } }),
        ProjectMaterial.sum('totalCost', { where: { projectId: project.id } }),
      ]);
      const json = project.toJSON();
      json.statusColor = colorByName.get(project.status) || null;
      json.completion = { percent: completion.percent, totalTasks: completion.totalTasks, closedTasks: completion.closedTasks };
      json.totalCost = Number(expenseSum || 0) + Number(materialSum || 0);
      Object.assign(json, figures.get(project.id));
      return json;
    })
  );

  return res.json(paginated('projects', { rows: withStats, count }, { page, limit }));
});

// GET /projects/tags — every distinct tag across the projects this caller can
// see. The tag filter dropdown used to derive its options from the loaded
// project list; once that list is one page long it would only ever offer the
// tags on that page, so the options come from their own query.
const listTags = asyncHandler(async (req, res) => {
  const { where, empty } = await buildProjectListWhere({ ...req, query: {} });
  if (empty) return res.json({ tags: [] });

  const rows = await Project.findAll({ where, attributes: ['tags'], raw: true });
  const tags = new Set();
  for (const row of rows) {
    // `tags` is JSON — already an array when the driver parses it, still a
    // string when it doesn't.
    let value = row.tags;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = null; }
    }
    if (Array.isArray(value)) value.forEach((t) => { if (t) tags.add(String(t)); });
  }
  return res.json({ tags: [...tags].sort((a, b) => a.localeCompare(b)) });
});

// POST /projects — Admin/Technician
// A status must be one of the configured project statuses (Q25). Returns its
// real name (the database matches names in any letter case).
async function projectStatusName(name) {
  const row = typeof name === 'string' ? await ProjectStatus.findOne({ where: { name } }) : null;
  if (!row) throw new ApiError(400, 'Unknown project status', 'VALIDATION_ERROR');
  return row.name;
}

// What a new project starts from: nothing (null), a template, or a copy of a
// project the caller can see. Returns { shape, templateId, kind, sourceId }.
// A template or project that is missing, or that the caller can't see, is the
// same 404 (don't reveal that a project exists).
async function startingPoint(req) {
  const { templateId, copyFromProjectId } = req.body;
  const given = (v) => v !== undefined && v !== null && v !== '';
  if (given(templateId) && given(copyFromProjectId)) throw bad('Start from a template or copy a project, not both');
  if (given(templateId)) {
    const id = parseRecordId(templateId);
    const template = id && await ProjectTemplate.findByPk(id);
    if (!template) throw new ApiError(404, 'Template not found', 'NOT_FOUND');
    const shape = await loadStructure(template.id);
    return {
      shape: { ...shape, hourBudgetMinutes: template.hourBudgetMinutes, tags: template.tags }, templateId: template.id, kind: 'template', sourceId: template.id,
    };
  }
  if (given(copyFromProjectId)) {
    const id = parseRecordId(copyFromProjectId);
    const source = id && await Project.findByPk(id);
    if (!source || !(await canAccessProject(req.user, source))) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
    return { shape: await templates.snapshotProject(source.id), templateId: null, kind: 'copy', sourceId: source.id };
  }
  return null;
}

const create = asyncHandler(async (req, res) => {
  const {
    name, description, status, ownerDepartmentId, forDepartmentId,
    assignedToUserId, teamId, dueDate, memberIds, tags, companyId, startDate, finishDate,
    contactIds, showInPortal,
  } = req.body || {};

  if (!name || !name.trim()) throw new ApiError(400, 'Project name is required', 'VALIDATION_ERROR');
  if (!ownerDepartmentId) throw new ApiError(400, 'Owned by department is required', 'VALIDATION_ERROR');
  const start = startDate === '' ? null : startDate;
  if (start !== undefined && start !== null && !validDay(start)) throw bad('Start date must be a date like 2026-03-02');
  const finish = finishDate === '' ? null : finishDate;
  if (finish !== undefined && finish !== null && !validDay(finish)) throw bad('Finish date must be a date like 2026-03-02');
  const budget = req.body.hourBudgetMinutes === undefined ? undefined : cleanBudgetMinutes(req.body.hourBudgetMinutes);
  const origin = await startingPoint(req);
  if (origin && !start) throw bad('A start date is required');
  if (finish && !origin) throw bad('A finish date only applies when starting from a template or a copy');
  if (finish && finish < start) throw bad('Finish date can\'t be before the start date');
  if (start && validDay(dueDate) && start > dueDate) throw bad('Start date can\'t be after the due date');

  // "Done by" (ownerDepartmentId) is one of the organization's own (internal)
  // departments. "For" is the project's company as a whole (null) or one of
  // its departments, whose code is in the project's number (CN:
  // WC-HR-P0007, WC-P0006).
  const internalCompanyId = await getInternalCompanyId();
  const projectCompanyId = (await resolveRecordCompany(req.user, companyId)).id;
  const ownerDept = await findDepartmentInCompany(ownerDepartmentId, internalCompanyId);
  if (!ownerDept) throw new ApiError(400, 'Owned-by department does not exist', 'VALIDATION_ERROR');
  let forDept = null;
  if (forDepartmentId) {
    forDept = await findDepartmentInCompany(forDepartmentId, projectCompanyId);
    if (!forDept) throw new ApiError(400, 'For-department does not exist', 'VALIDATION_ERROR');
  }

  const contactList = await projectContactIds(contactIds, projectCompanyId);
  if (showInPortal !== undefined && typeof showInPortal !== 'boolean') throw bad('Show in the portal must be true or false');

  const leadId = assignedToUserId ? await assertCanWorkProject(assignedToUserId, projectCompanyId, 'Lead') : null;
  const memberSet = new Set();
  for (const raw of Array.isArray(memberIds) ? memberIds : []) {
    memberSet.add(await assertCanWorkProject(raw, projectCompanyId, 'Member')); // eslint-disable-line no-await-in-loop
  }
  if (leadId) memberSet.add(leadId);
  if ([...memberSet].some((id) => id !== req.user.id)) await assertCanManageMembers(req.user, 'Naming the lead or members');

  let resolvedStatus = status;
  if (resolvedStatus) resolvedStatus = await projectStatusName(resolvedStatus);
  if (!resolvedStatus) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    resolvedStatus = firstOpen ? firstOpen.name : 'Active';
  }

  // READ COMMITTED: the company's project counter (services/projects/
  // numbers.js) is locked until commit, so two concurrent creates queue.
  const isolationLevel = Transaction.ISOLATION_LEVELS.READ_COMMITTED;
  const project = await sequelize.transaction({ isolationLevel }, async (t) => {
    const values = {
      name: name.trim(),
      description: description || null,
      tags: Array.isArray(tags) && tags.length ? tags : null,
      status: resolvedStatus,
      companyId: projectCompanyId,
      ownerDepartmentId: ownerDept.id,
      // Not said (older callers): an internal project is for the department
      // doing it. null: for the whole company.
      forDepartmentId: forDept ? forDept.id : (forDepartmentId === undefined && projectCompanyId === internalCompanyId ? ownerDept.id : null),
      // Customer projects show in their portal unless told not to; yours never.
      showInPortal: projectCompanyId === internalCompanyId ? false : showInPortal !== false,
      assignedToUserId: leadId,
      teamId: teamId || null,
      dueDate: dueDate || null,
      createdBy: req.user.id,
    };
    if (budget !== undefined) values.hourBudgetMinutes = budget;
    let created;
    if (origin) {
      created = await templates.instantiate(req, origin.shape, {
        values, startDate: start, finishDate: finish, templateId: origin.templateId, tagsGiven: Array.isArray(tags),
      }, t);
    } else {
      created = await Project.create({ ...values, startDate: start || null }, { transaction: t });
    }
    for (const userId of memberSet) {
      await ProjectMember.create({ projectId: created.id, userId, role: userId === leadId ? 'lead' : 'member' }, { transaction: t }); // eslint-disable-line no-await-in-loop
    }
    if (contactList.length) {
      await ProjectContact.bulkCreate(contactList.map((contactId) => ({ projectId: created.id, contactId })), { transaction: t });
    }
    return created;
  });

  await writeAudit(req, 'project.create', 'Project', project.id, { name: project.name, projectCode: project.projectCode });
  if (origin) {
    await writeAudit(req, origin.kind === 'template' ? 'project.createFromTemplate' : 'project.copy', 'Project', project.id, {
      [origin.kind === 'template' ? 'templateId' : 'sourceProjectId']: origin.sourceId,
    });
  }
  await logProjectActivity(project.id, req.user.id, 'project_created', { name: project.name, projectCode: project.projectCode });
  // Fire-and-forget — never throws (see calendarPush.js's module comment).
  syncProjectToExternalCalendars(project.id);

  res.status(201).json({ project: await getProjectWithDetail(project.id) });
});

// GET /projects/:id — full detail with stats, members, task counts
const get = asyncHandler(async (req, res) => {
  const project = await getProjectWithDetail(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  // viewMin only checked "has ANY view tier" at the route level; an
  // 'own'/'department'-scoped user could otherwise read any project by id.
  if (!(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  res.json({ project: { ...project, access: await projectAccessFor(req.user, project) } });
});

// Audited as project.budget; startDate is checked alongside them but is a
// plain project.update change.
const BUDGET_FIELDS = ['hourBudgetMinutes', 'budgetAlert80', 'budgetAlert100'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

// Checks the budget fields of a PATCH in place: minutes (or null), two
// booleans, and a real 'YYYY-MM-DD' start date no later than the due date.
function cleanBudgetFields(project, changes) {
  if (changes.hourBudgetMinutes !== undefined) changes.hourBudgetMinutes = cleanBudgetMinutes(changes.hourBudgetMinutes);
  for (const key of ['budgetAlert80', 'budgetAlert100']) {
    if (changes[key] !== undefined && typeof changes[key] !== 'boolean') throw bad(`${key} must be true or false`);
  }
  if (changes.startDate === '') changes.startDate = null;
  if (changes.startDate !== undefined && changes.startDate !== null && !validDay(changes.startDate)) {
    throw bad('Start date must be a date like 2026-03-02');
  }
  const start = changes.startDate !== undefined ? changes.startDate : project.startDate;
  const due = changes.dueDate !== undefined ? changes.dueDate : project.dueDate;
  if (start && due && validDay(due) && start > due) throw bad('Start date can\'t be after the due date');
}

// PATCH /projects/:id — Admin/Technician. Updates any field.
const update = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  // editMin only checked "has ANY edit tier" at the route level — same gap
  // as get() (see comment there) but for writes.
  if (!(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await assertCanEditProject(req.user, project);

  const allowed = [
    'name', 'description', 'status', 'ownerDepartmentId', 'forDepartmentId',
    'assignedToUserId', 'teamId', 'dueDate', 'startDate', 'tags', 'showInPortal', ...BUDGET_FIELDS,
  ];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  cleanBudgetFields(project, changes);
  if (changes.showInPortal !== undefined && typeof changes.showInPortal !== 'boolean') throw bad('Show in the portal must be true or false');
  if (changes.name !== undefined) {
    if (typeof changes.name !== 'string' || !changes.name.trim()) {
      throw new ApiError(400, 'Project name is required', 'VALIDATION_ERROR');
    }
    changes.name = changes.name.trim();
  }
  if (changes.status !== undefined && changes.status !== project.status) changes.status = await projectStatusName(changes.status);
  if (changes.tags !== undefined) {
    changes.tags = Array.isArray(changes.tags) && changes.tags.length ? changes.tags : null;
  }
  if (changes.ownerDepartmentId !== undefined) {
    const ownerDept = await findDepartmentInCompany(changes.ownerDepartmentId, await getInternalCompanyId());
    if (!ownerDept) throw new ApiError(400, 'Owned-by department does not exist', 'VALIDATION_ERROR');
    changes.ownerDepartmentId = ownerDept.id;
  }
  // Moving a project to another company: the destination must be usable and
  // reachable (canAccessProject above covered the current one), and the
  // resulting "for" department must belong to it.
  const rawCompanyId = (req.body || {}).companyId;
  let targetCompanyId = project.companyId;
  if (isCompanyChange(rawCompanyId, project.companyId)) {
    targetCompanyId = (await resolveRecordCompany(req.user, rawCompanyId)).id;
    changes.companyId = targetCompanyId;
  }
  if (changes.forDepartmentId) {
    const forDept = await findDepartmentInCompany(changes.forDepartmentId, targetCompanyId);
    if (!forDept) throw new ApiError(400, 'For-department does not exist', 'VALIDATION_ERROR');
    changes.forDepartmentId = forDept.id;
  } else if (changes.forDepartmentId !== undefined) {
    changes.forDepartmentId = null;
  } else if (changes.companyId !== undefined && project.forDepartmentId
    && !(await findDepartmentInCompany(project.forDepartmentId, targetCompanyId))) {
    throw new ApiError(400, 'For-department does not exist', 'VALIDATION_ERROR');
  }
  if (changes.assignedToUserId !== undefined) {
    // Re-sending the current lead (a client PATCHing the whole project back)
    // changes nothing, so it isn't re-checked: a lead who has since left
    // doesn't block other edits.
    const raw = changes.assignedToUserId;
    const rawId = raw ? parseRecordId(raw) : null;
    const sameLead = raw ? rawId !== null && rawId === project.assignedToUserId : project.assignedToUserId === null;
    if (sameLead) {
      delete changes.assignedToUserId;
    } else {
      await assertCanManageMembers(req.user, 'Changing the lead');
      changes.assignedToUserId = raw ? await assertCanWorkProject(raw, targetCompanyId, 'Lead') : null;
    }
  }
  const statusChanged = changes.status !== undefined && changes.status !== project.status;
  const previousStatus = project.status;
  const previousLeadId = project.assignedToUserId;

  await project.update(changes);
  await syncLeadMembership(project, previousLeadId);
  const budgetChanges = Object.fromEntries(Object.entries(changes).filter(([k]) => BUDGET_FIELDS.includes(k)));
  const otherChanges = Object.fromEntries(Object.entries(changes).filter(([k]) => !BUDGET_FIELDS.includes(k)));
  if (!Object.keys(budgetChanges).length || Object.keys(otherChanges).length) {
    await writeAudit(req, 'project.update', 'Project', project.id, otherChanges);
  }
  if (Object.keys(budgetChanges).length) {
    await writeAudit(req, 'project.budget', 'Project', project.id, budgetChanges);
    // A new budget re-arms the alert levels; it never notifies.
    try { await rearmBudgetAlerts(project.id); } catch (err) { console.error('[budget] re-arm failed:', err.message); }
  }
  if (statusChanged) {
    await logProjectActivity(project.id, req.user.id, 'status_changed', { from: previousStatus, to: changes.status });
  }
  if (changes.dueDate !== undefined || changes.assignedToUserId !== undefined) {
    if (previousLeadId && previousLeadId !== project.assignedToUserId) {
      removeProjectFromExternalCalendars(project.id, previousLeadId);
    }
    syncProjectToExternalCalendars(project.id);
  }

  res.json({ project: { ...(await getProjectWithDetail(project.id)), access: await projectAccessFor(req.user, project) } });
});

// DELETE /projects/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  // Deletes need the edit tier on the record (Q28) as well as the delete
  // permission the route checks, and the company fence inside canAccess.
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  await assertCanEditProject(req.user, project);

  const where = { projectId: project.id };
  const files = await ProjectFile.findAll({ where, attributes: ['filepath'] });
  const counts = {};
  await sequelize.transaction(async (transaction) => {
    // No database cascades (Q13): everything that belongs to the project goes
    // with it, and timers running on it stop (their time has nowhere to go).
    for (const [label, M] of [['tasks', Task], ['timeEntries', TimeEntry], ['expenses', ProjectExpense],
      ['materials', ProjectMaterial], ['files', ProjectFile], ['members', ProjectMember], ['activity', ProjectActivity]]) {
      counts[label] = await M.destroy({ where, transaction }); // eslint-disable-line no-await-in-loop
    }
    counts.timers = await ActiveTimer.destroy({ where: { entityType: 'project', entityId: project.id }, transaction });
    await project.destroy({ transaction });
    await writeAudit(req, 'project.delete', 'Project', project.id, { name: project.name, ...counts }, { transaction });
  });
  // The disk after the rows commit: a failed delete leaves the files with their rows.
  for (const file of files) fs.rm(file.filepath, { force: true }, () => {});
  fs.rm(path.join(UPLOAD_ROOT, 'projects', String(project.id)), { recursive: true, force: true }, () => {});
  removeProjectFromExternalCalendars(project.id, project.assignedToUserId);
  res.json({ ok: true });
});

// GET /projects/:id/stats
const getStats = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  res.json({ stats: await buildProjectStats(project) });
});

// GET /projects/:id/budget — hours used against the budget, by phase and person.
const getBudget = asyncHandler(async (req, res) => {
  const id = parseRecordId(req.params.id);
  const project = id && await Project.findByPk(id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  res.json({ budget: await budgetSummary(project.id) });
});

// CN: customer contacts named on a project: active contacts of its own
// company, and only for a customer project.
async function projectContactIds(raw, companyId) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 200) throw bad('Customer contacts must be a list');
  const ids = [...new Set(raw.map((v) => parseRecordId(v)))];
  if (ids.some((v) => !v)) throw bad('Customer contacts must be a list of contacts');
  if (!ids.length) return [];
  const company = await Company.findByPk(companyId, { attributes: ['id', 'isInternal'] });
  if (!company || company.isInternal) throw bad('Customer contacts are for a customer\'s project');
  const found = await Contact.count({ where: { id: ids, companyId, status: 'active' } });
  if (found !== ids.length) throw bad('Customer contacts must be active contacts of the project\'s company');
  return ids;
}

const contactView = (c) => ({ id: c.id, displayName: c.displayName, email: c.email });

// GET /projects/:id/contacts — the customer contacts named on it.
const listContacts = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id, { attributes: ['id', 'companyId', 'ownerDepartmentId', 'forDepartmentId', 'assignedToUserId', 'createdBy'] });
  if (!project || !(await canAccessProject(req.user, project))) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  const rows = await ProjectContact.findAll({ where: { projectId: project.id }, attributes: ['contactId'] });
  const contacts = rows.length ? await Contact.findAll({ where: { id: rows.map((r) => r.contactId) }, attributes: ['id', 'displayName', 'email'], order: [['displayName', 'ASC']] }) : [];
  res.json({ contacts: contacts.map(contactView) });
});

// PUT /projects/:id/contacts { contactIds } — replaces the list.
const setContacts = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  await assertCanEditProject(req.user, project);
  const ids = await projectContactIds((req.body || {}).contactIds || [], project.companyId);
  await sequelize.transaction(async (t) => {
    await ProjectContact.destroy({ where: { projectId: project.id }, transaction: t });
    if (ids.length) await ProjectContact.bulkCreate(ids.map((contactId) => ({ projectId: project.id, contactId })), { transaction: t });
  });
  const contacts = ids.length ? await Contact.findAll({ where: { id: ids }, attributes: ['id', 'displayName', 'email'], order: [['displayName', 'ASC']] }) : [];
  res.json({ contacts: contacts.map(contactView) });
});

// GET /projects/next-number?companyId&forDepartmentId — the number a new
// project would get now (CN; taken only when it's created).
const nextNumber = asyncHandler(async (req, res) => {
  const companyId = (await resolveRecordCompany(req.user, req.query.companyId || undefined)).id;
  const company = await Company.findByPk(companyId, { attributes: ['id', 'code'] });
  const forId = parseRecordId(req.query.forDepartmentId);
  const dept = forId ? await Department.findOne({ where: { id: forId, companyId }, attributes: ['shortCode'] }) : null;
  const [row] = await sequelize.query(
    "SELECT seq FROM CompanyCounters WHERE companyId = ? AND kind = 'project'",
    { replacements: [companyId], type: sequelize.QueryTypes.SELECT },
  );
  res.json({ code: formatProjectCode(company.code, dept && dept.shortCode, (row ? row.seq : 0) + 1) });
});

module.exports = {
  listContacts,
  setContacts,
  nextNumber,
  getBudget,
  attentionTiles,
  list,
  listTags,
  create,
  get,
  update,
  remove,
  getStats,
};
