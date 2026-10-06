// Aggregates ticket/project/project-task due dates into one unified event
// feed for the Calendar page. Scoping mirrors ticketsController.list and
// projectsController.list *exactly* (same tickets.view_*/projects.view_*
// permissions and 'own'/'department'/'all' semantics a user already sees on
// the Tickets/Projects pages) rather than the separate reports.* scope
// helpers in reportsController.js, which use a different permission family
// and a simpler "own" definition.
const { Op } = require('sequelize');
const {
  Ticket, Project, Task, ProjectMember, ProjectStatus, TaskStatus, TicketStatus, User,
  License, Contract,
} = require('../models');
const { asyncHandler } = require('../middleware/error');
const { andWhere, ticketScopeWhere, projectScopeWhere } = require('../services/recordScope');
const { getTicketStatusBuckets, getProjectStatusBuckets } = require('../services/statusBehavior');
const { taskStatusBehaviorMap } = require('../services/tasks/statuses');
const { getSubscriptionRenewals } = require('../services/assetSubscriptionService');
const { companyScopeWhere } = require('../services/permissionService');

const userAttrs = ['id', 'displayName'];

function parseTypes(raw) {
  const all = ['tickets', 'projects', 'tasks', 'subscriptions', 'license_expiry', 'contract_renewal'];
  if (!raw) return all;
  const requested = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return all.filter((t) => requested.includes(t));
}

// Both build on the shared list scope (company fence + tier), ANDed with the
// calendar's own filters so a filter can only narrow it.
async function scopedTicketWhere(req, extraWhere) {
  return andWhere(extraWhere, await ticketScopeWhere(req.user));
}

// Returns the where-clause for Project.findAll AND is reused to resolve
// the set of in-scope project ids for tasks (which have no view-scope
// concept of their own — they inherit their parent project's).
async function scopedProjectWhere(req, requestedDepartmentId) {
  const departmentFilter = requestedDepartmentId
    ? { [Op.or]: [{ ownerDepartmentId: requestedDepartmentId }, { forDepartmentId: requestedDepartmentId }] }
    : {};
  return andWhere(await projectScopeWhere(req.user), departmentFilter);
}

function ticketPriorityColor(priority) {
  // Matches PRIORITY_META already established in TicketDetail.jsx/Tickets.jsx.
  return { critical: '#dc2626', high: '#d97706', medium: '#2563eb', low: '#64748b' }[priority] || '#64748b';
}
function taskPriorityColor(priority) {
  // Tasks use 'urgent' where tickets use 'critical' — same meaning.
  return { urgent: '#dc2626', high: '#d97706', medium: '#2563eb', low: '#64748b' }[priority] || '#64748b';
}

// GET /calendar/events?startDate=&endDate=&assigneeId=&departmentId=&types=tickets,projects,tasks&statusFilter=open|overdue|all
const listEvents = asyncHandler(async (req, res) => {
  const { startDate, endDate, assigneeId, departmentId, statusFilter } = req.query;
  const types = parseTypes(req.query.types);
  const todayStr = new Date().toISOString().slice(0, 10);

  const dateWhere = {};
  if (startDate) dateWhere[Op.gte] = startDate;
  if (endDate) dateWhere[Op.lte] = endDate;

  const events = [];

  if (types.includes('tickets')) {
    const [buckets, statusRows] = await Promise.all([getTicketStatusBuckets(), TicketStatus.findAll()]);
    const colorByStatus = new Map(statusRows.map((s) => [s.name, s.color]));

    let where = { dueDate: { ...dateWhere, [Op.ne]: null } };
    if (assigneeId) where.assigneeId = assigneeId;
    if (statusFilter === 'open') where.status = { [Op.in]: buckets.open };
    else if (statusFilter === 'overdue') where.status = { [Op.in]: buckets.open }; // dueDate<today filtered below (dueDate range is caller-controlled)
    where = await scopedTicketWhere(req, where);
    if (departmentId) where.departmentId = departmentId;

    const tickets = await Ticket.findAll({
      where,
      include: [{ model: User, as: 'assignee', attributes: userAttrs }],
      attributes: ['id', 'title', 'dueDate', 'dueTime', 'status', 'priority', 'assigneeId', 'departmentId'],
    });
    tickets.forEach((t) => {
      if (statusFilter === 'overdue' && !(t.dueDate < todayStr)) return;
      events.push({
        id: `ticket-${t.id}`,
        type: 'ticket',
        title: t.title,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        status: t.status,
        statusColor: colorByStatus.get(t.status) || '#3b82f6',
        priority: t.priority,
        priorityColor: ticketPriorityColor(t.priority),
        assigneeId: t.assigneeId,
        assigneeName: t.assignee?.displayName || null,
        departmentIds: t.departmentId ? [t.departmentId] : [],
        ticketNumber: `#${String(t.id).padStart(5, '0')}`,
        url: `/tickets/${t.id}`,
      });
    });
  }

  let scopedProjectIds = null; // resolved lazily, shared by projects + tasks
  if (types.includes('projects') || types.includes('tasks')) {
    const projWhere = await scopedProjectWhere(req, departmentId || null);
    const inScopeProjects = await Project.findAll({ where: projWhere, attributes: ['id', 'projectCode', 'ownerDepartmentId', 'forDepartmentId'] });
    scopedProjectIds = inScopeProjects.map((p) => p.id);

    if (types.includes('projects')) {
      const buckets = await getProjectStatusBuckets();
      const statusRows = await ProjectStatus.findAll();
      const colorByStatus = new Map(statusRows.map((s) => [s.name, s.color]));

      let where = { id: { [Op.in]: scopedProjectIds.length ? scopedProjectIds : [-1] }, dueDate: { ...dateWhere, [Op.ne]: null } };
      if (assigneeId) where.assignedToUserId = assigneeId;
      if (statusFilter === 'open' || statusFilter === 'overdue') where.status = { [Op.in]: buckets.open };

      const projects = await Project.findAll({
        where,
        include: [{ model: User, as: 'lead', attributes: userAttrs }],
        attributes: ['id', 'name', 'projectCode', 'dueDate', 'status', 'assignedToUserId', 'ownerDepartmentId', 'forDepartmentId'],
      });
      projects.forEach((p) => {
        if (statusFilter === 'overdue' && !(p.dueDate < todayStr)) return;
        events.push({
          id: `project-${p.id}`,
          type: 'project',
          title: p.name,
          dueDate: p.dueDate,
          dueTime: null,
          status: p.status,
          statusColor: colorByStatus.get(p.status) || '#3b82f6',
          priority: null,
          priorityColor: '#7c3aed',
          assigneeId: p.assignedToUserId,
          assigneeName: p.lead?.displayName || null,
          departmentIds: [p.ownerDepartmentId, p.forDepartmentId].filter(Boolean),
          projectCode: p.projectCode,
          url: `/projects/${p.id}`,
        });
      });
    }

    if (types.includes('tasks')) {
      const statusIdBehavior = await taskStatusBehaviorMap();
      const statusRows = await TaskStatus.findAll({ where: { scope: 'project' } });
      const colorByStatusId = new Map(statusRows.map((s) => [s.id, s.color]));
      const nameByStatusId = new Map(statusRows.map((s) => [s.id, s.name]));
      const projectById = new Map(inScopeProjects.map((p) => [p.id, p]));

      const where = {
        projectId: { [Op.in]: scopedProjectIds.length ? scopedProjectIds : [-1] }, parentTaskId: null, dueDate: { ...dateWhere, [Op.ne]: null },
      };
      if (assigneeId) where.assigneeId = assigneeId;

      const tasks = await Task.findAll({
        where,
        include: [{ model: User, as: 'assignee', attributes: userAttrs }],
        attributes: ['id', 'title', 'projectId', 'dueDate', 'statusId', 'priority', 'assigneeId'],
      });
      tasks.forEach((task) => {
        const behavior = statusIdBehavior.get(task.statusId);
        if ((statusFilter === 'open' || statusFilter === 'overdue') && behavior !== 'open') return;
        if (statusFilter === 'overdue' && !(task.dueDate < todayStr)) return;
        const project = projectById.get(task.projectId);
        events.push({
          id: `task-${task.id}`,
          type: 'task',
          title: task.title,
          dueDate: task.dueDate,
          dueTime: null,
          status: nameByStatusId.get(task.statusId) || 'Unknown',
          statusColor: colorByStatusId.get(task.statusId) || '#0891b2',
          priority: task.priority,
          priorityColor: taskPriorityColor(task.priority),
          assigneeId: task.assigneeId,
          assigneeName: task.assignee?.displayName || null,
          departmentIds: project ? [project.ownerDepartmentId, project.forDepartmentId].filter(Boolean) : [],
          projectCode: project?.projectCode || null,
          url: `/projects/${task.projectId}`,
        });
      });
    }
  }

  // Renewal events come from assets, licenses and contracts, fenced by the
  // viewer's companies like the records themselves.
  const assetScope = await companyScopeWhere(req.user);

  if (types.includes('subscriptions')) {
    const renewals = await getSubscriptionRenewals({ where: assetScope });
    renewals.forEach((r) => {
      if (startDate && r.renewalDate < startDate) return;
      if (endDate && r.renewalDate > endDate) return;
      if (departmentId && String(r.asset.departmentId) !== String(departmentId)) return;
      events.push({
        id: `subscription-${r.asset.id}`,
        type: 'subscription',
        title: `${r.asset.name} renewal${r.provider ? ` — ${r.provider}` : ''}`,
        dueDate: r.renewalDate,
        dueTime: null,
        status: 'Renewal',
        statusColor: '#0d9488',
        priority: null,
        priorityColor: '#0d9488',
        assigneeId: null,
        assigneeName: null,
        departmentIds: r.asset.departmentId ? [r.asset.departmentId] : [],
        url: `/assets/${r.asset.id}`,
      });
    });
  }

  if (types.includes('license_expiry')) {
    const where = { expiryDate: { [Op.ne]: null } };
    if (startDate) where.expiryDate = { ...where.expiryDate, [Op.gte]: startDate };
    if (endDate) where.expiryDate = { ...where.expiryDate, [Op.lte]: endDate };
    if (departmentId) where.departmentId = departmentId;
    const licenses = await License.findAll({ where: andWhere(where, assetScope) });
    licenses.forEach((lic) => {
      events.push({
        id: `license-${lic.id}`,
        type: 'license_expiry',
        title: `${lic.name} expires${lic.vendor ? ` — ${lic.vendor}` : ''}`,
        dueDate: lic.expiryDate,
        dueTime: null,
        status: 'Expiring',
        statusColor: '#ea580c',
        priority: null,
        priorityColor: '#ea580c',
        assigneeId: null,
        assigneeName: null,
        departmentIds: lic.departmentId ? [lic.departmentId] : [],
        url: `/assets/licenses/${lic.id}`,
      });
    });
  }

  if (types.includes('contract_renewal')) {
    const where = {
      [Op.or]: [
        { renewalDate: { [Op.ne]: null } },
        { renewalDate: null, endDate: { [Op.ne]: null } },
      ],
    };
    if (departmentId) where.departmentId = departmentId;
    const contracts = await Contract.findAll({ where: andWhere(where, assetScope) });
    contracts.forEach((c) => {
      const renewsOn = c.renewalDate || c.endDate;
      if (startDate && renewsOn < startDate) return;
      if (endDate && renewsOn > endDate) return;
      events.push({
        id: `contract-${c.id}`,
        type: 'contract_renewal',
        title: `${c.name} renews${c.vendor ? ` — ${c.vendor}` : ''}`,
        dueDate: renewsOn,
        dueTime: null,
        status: 'Renewal',
        statusColor: '#0f766e',
        priority: null,
        priorityColor: '#0f766e',
        assigneeId: null,
        assigneeName: null,
        departmentIds: c.departmentId ? [c.departmentId] : [],
        url: `/assets/contracts/${c.id}`,
      });
    });
  }

  res.json({ events });
});

module.exports = { listEvents };
