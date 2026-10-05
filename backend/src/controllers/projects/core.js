// Projects: list, tags, create, read, update, delete, stats.
const { Op, Transaction, cast, col: sqlCol, where: sqlWhere } = require('sequelize');
const fs = require('fs');
const path = require('path');
const {
  Project,
  ProjectMember,
  ProjectExpense,
  ProjectMaterial,
  ProjectStatus,
  User,
  sequelize,
} = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
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
  canAccessCompany,
} = require('../../services/permissionService');
const { generateProjectCode } = require('../../services/projectCodeService');
const { userAttrs, projectInclude, buildProjectStats, getProjectWithDetail } = require('./shared');

// ==================== Projects ====================

// GET /projects — filters: status, ownerDept, forDept, assignee, myProjects,
// myDepartment, overdue, search, tag.
// Builds the WHERE clause for a project listing from the query string plus
// the caller's permission scope. Returns `{ where, empty }` — `empty` means
// the scope resolved to no projects at all, so the caller should short-circuit
// rather than run a query with an impossible clause.
async function buildProjectListWhere(req) {
  const where = {};
  const {
    status, ownerDept, forDept, assignee, myProjects, myDepartment, overdue, search, tag, companyId,
  } = req.query;
  if (companyId) where.companyId = parseRecordId(companyId) || -1;

  // Scope (company fence and tier) comes from recordScope and is ANDed in at
  // the end, so these filters can only narrow it.
  if (ownerDept) where.ownerDepartmentId = ownerDept;
  if (forDept) where.forDepartmentId = forDept;

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
  if (assignee) where.assignedToUserId = assignee;
  if (overdue === 'true') {
    where.dueDate = { [Op.lt]: new Date().toISOString().slice(0, 10) };
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

  return { where: andWhere(where, await projectScopeWhere(req.user)), empty: false };
}

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
const create = asyncHandler(async (req, res) => {
  const {
    name, description, status, ownerDepartmentId, forDepartmentId,
    assignedToUserId, teamId, dueDate, memberIds, tags, companyId,
  } = req.body || {};

  if (!name || !name.trim()) throw new ApiError(400, 'Project name is required', 'VALIDATION_ERROR');
  if (!ownerDepartmentId) throw new ApiError(400, 'Owned by department is required', 'VALIDATION_ERROR');

  // "Owned by" is one of the organization's own (internal) departments: that
  // is who does the work, and its short code numbers the project. "For"
  // belongs to the project's company (client companies, sub-project 2).
  const internalCompanyId = await getInternalCompanyId();
  const projectCompanyId = (await resolveRecordCompany(req.user, companyId)).id;
  const ownerDept = await findDepartmentInCompany(ownerDepartmentId, internalCompanyId);
  if (!ownerDept) throw new ApiError(400, 'Owned-by department does not exist', 'VALIDATION_ERROR');
  let forDept = null;
  if (forDepartmentId) {
    forDept = await findDepartmentInCompany(forDepartmentId, projectCompanyId);
    if (!forDept) throw new ApiError(400, 'For-department does not exist', 'VALIDATION_ERROR');
  }

  let resolvedStatus = status;
  if (!resolvedStatus) {
    const firstOpen = await getFirstProjectStatusByBehavior('open');
    resolvedStatus = firstOpen ? firstOpen.name : 'Active';
  }

  // READ COMMITTED, as nextProjectSequence requires: its row lock makes two
  // concurrent creates queue rather than collide or fail.
  const isolationLevel = Transaction.ISOLATION_LEVELS.READ_COMMITTED;
  const project = await sequelize.transaction({ isolationLevel }, async (t) => {
    // Generated inside the transaction — nextProjectSequence row-locks the
    // department's counter so two concurrent creates never collide.
    const projectCode = await generateProjectCode(ownerDept.id, t);
    return Project.create({
      name: name.trim(),
      projectCode,
      description: description || null,
      tags: Array.isArray(tags) && tags.length ? tags : null,
      status: resolvedStatus,
      companyId: projectCompanyId,
      ownerDepartmentId: ownerDept.id,
      // An internal project is "for" its owner unless told otherwise; a
      // client project's "for" is a client department or nobody.
      forDepartmentId: forDept ? forDept.id : (projectCompanyId === internalCompanyId ? ownerDept.id : null),
      assignedToUserId: assignedToUserId || null,
      teamId: teamId || null,
      dueDate: dueDate || null,
      createdBy: req.user.id,
    }, { transaction: t });
  });

  const memberSet = new Set((Array.isArray(memberIds) ? memberIds : []).map(Number));
  if (assignedToUserId) memberSet.add(Number(assignedToUserId));
  await Promise.all(
    [...memberSet].map((userId) =>
      ProjectMember.create({
        projectId: project.id,
        userId,
        role: Number(userId) === Number(assignedToUserId) ? 'lead' : 'member',
      })
    )
  );

  await writeAudit(req, 'project.create', 'Project', project.id, { name: project.name, projectCode: project.projectCode });
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
  res.json({ project });
});

// PATCH /projects/:id — Admin/Technician. Updates any field.
const update = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  // editMin only checked "has ANY edit tier" at the route level — same gap
  // as get() (see comment there) but for writes.
  if (!(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }

  const allowed = [
    'name', 'description', 'status', 'ownerDepartmentId', 'forDepartmentId',
    'assignedToUserId', 'teamId', 'dueDate', 'tags',
  ];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
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
  const statusChanged = changes.status !== undefined && changes.status !== project.status;
  const previousStatus = project.status;
  const previousLeadId = project.assignedToUserId;

  await project.update(changes);
  await writeAudit(req, 'project.update', 'Project', project.id, changes);
  if (statusChanged) {
    await logProjectActivity(project.id, req.user.id, 'status_changed', { from: previousStatus, to: changes.status });
  }
  if (changes.dueDate !== undefined || changes.assignedToUserId !== undefined) {
    if (previousLeadId && previousLeadId !== project.assignedToUserId) {
      removeProjectFromExternalCalendars(project.id, previousLeadId);
    }
    syncProjectToExternalCalendars(project.id);
  }

  res.json({ project: await getProjectWithDetail(project.id) });
});

// DELETE /projects/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  // The company fence applies to every write, deletes included. (The tier
  // re-check is still missing here: quirk Q28, pinned until sub-project 3.)
  if (!(await canAccessCompany(req.user, project.companyId))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const filesDir = path.join(UPLOAD_ROOT, 'projects', String(project.id));
  await project.destroy();
  fs.rm(filesDir, { recursive: true, force: true }, () => {});
  await writeAudit(req, 'project.delete', 'Project', project.id, { name: project.name });
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

module.exports = {
  list,
  listTags,
  create,
  get,
  update,
  remove,
  getStats,
};
