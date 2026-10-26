// The Workload screen's data (sub-project 6): people x days, built only from
// what the viewer may see. Everything is loaded in a fixed number of queries
// (tickets, tasks, assignees, time, people, holidays, companies, members) and
// worked out in memory; the one per-person lookup is the permission and
// company-access resolution, which is cached.
const { Op, QueryTypes } = require('sequelize');
const {
  User, Ticket, Task, TaskAssignee, TaskStatus, Project, ProjectMember, Company, TeamMember, HolidayList, Holiday, SystemSettings, sequelize,
} = require('../../models');
const { ticketScopeWhere, projectScopeWhere, andWhere } = require('../recordScope');
const { resolveUserPermissions, getUserCompanyIds } = require('../permissionService');
const { getTicketStatusBuckets, getProjectStatusBuckets } = require('../statusBehavior');
const { peopleOn } = require('../projects/helpers');
const { addDays, isoWeekday } = require('../projects/schedule');
const {
  DEFAULT_WORK_HOURS, DEFAULT_TICKET_MINUTES, NONE, capacityFor, workingWeekdays, workingSpan, snapBack, snapForward, spread, itemMinutes, shareMinutes, validWorkHours,
} = require('./capacity');

const sameDept = (a, b) => a != null && b != null && a === b;
const inList = (ids) => ({ [Op.in]: ids.length ? ids : [-1] });

async function readSettings() {
  const rows = await SystemSettings.findAll({
    where: { key: ['workload.defaultWorkHours', 'workload.defaultTicketMinutes'] }, attributes: ['key', 'value'], raw: true,
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let workHours = null;
  try { workHours = validWorkHours(JSON.parse(byKey['workload.defaultWorkHours'])); } catch { /* fall back to the built-in */ }
  const minutes = Number(byKey['workload.defaultTicketMinutes']);
  return {
    defaultWorkHours: workHours || DEFAULT_WORK_HOURS,
    defaultTicketMinutes: Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440 ? minutes : DEFAULT_TICKET_MINUTES,
  };
}

// The N weekdays (Mon-Fri) from the first one on or after `from`.
function weekdayColumns(from, count) {
  const out = [];
  for (let d = from; out.length < count; d = addDays(d, 1)) if (isoWeekday(d) <= 5) out.push(d);
  return out;
}

// Holiday dates a person is off: lists with no department, plus their own department's.
async function loadHolidays(staff, since) {
  const deptIds = [...new Set(staff.map((p) => p.departmentId).filter(Boolean))];
  const lists = await HolidayList.findAll({
    where: { [Op.or]: [{ departmentId: null }, ...(deptIds.length ? [{ departmentId: deptIds }] : [])] },
    attributes: ['id', 'departmentId'],
    raw: true,
  });
  const holidays = lists.length
    ? await Holiday.findAll({ where: { holidayListId: lists.map((l) => l.id), date: { [Op.gte]: since } }, attributes: ['holidayListId', 'name', 'date'], raw: true })
    : [];
  const deptOf = new Map(lists.map((l) => [l.id, l.departmentId]));
  const global = new Map(); // date -> name
  const byDept = new Map(); // departmentId -> Set(date)
  for (const h of holidays) {
    const dept = deptOf.get(h.holidayListId);
    if (dept == null) global.set(h.date, h.name);
    else {
      if (!byDept.has(dept)) byDept.set(dept, new Set());
      byDept.get(dept).add(h.date);
    }
  }
  return { global, byDept };
}

// Remaining work per top-level task: its own and its subtasks' logged time, everyone's.
async function loggedMinutesByTask(topIds) {
  if (!topIds.length) return new Map();
  const rows = await sequelize.query(
    `SELECT COALESCE(t.parentTaskId, t.id) AS topId, SUM(te.durationSeconds) AS seconds
       FROM TimeEntries te JOIN Tasks t ON t.id = te.taskId
      WHERE t.id IN (:ids) OR t.parentTaskId IN (:ids)
      GROUP BY COALESCE(t.parentTaskId, t.id)`,
    { replacements: { ids: topIds }, type: QueryTypes.SELECT }
  );
  return new Map(rows.map((r) => [Number(r.topId), Math.round(Number(r.seconds) / 60)]));
}

async function openTaskStatusIds(scope) {
  const rows = await TaskStatus.findAll({ where: { scope, behaviorType: 'open' }, attributes: ['id'], raw: true });
  return rows.map((r) => r.id);
}

// The viewer's real edit access, worked out from loaded rows. Mirrors
// permissionService.canEditTicket / canEditProject (the record is already
// known to be inside the viewer's view scope).
function editRules(viewer, perms, nonHelperProjectIds) {
  return {
    ticket: (t) => !!(perms['tickets.edit_all']
      || (perms['tickets.edit_department'] && sameDept(t.departmentId, viewer.departmentId))
      || ((perms['tickets.edit_department'] || perms['tickets.edit_own']) && t.assigneeId === viewer.id)),
    project: (p) => {
      return !!(perms['projects.edit_all']
        || (perms['projects.edit_department'] && (sameDept(p.ownerDepartmentId, viewer.departmentId) || sameDept(p.forDepartmentId, viewer.departmentId)))
        || p.assignedToUserId === viewer.id || nonHelperProjectIds.has(p.id));
    },
  };
}

// Which of the staff can open which projects and companies. A person who can't
// open a project never gets its tasks in their row (their share is not theirs
// to carry), whatever the viewer can see.
async function loadReach(staff, projectIds, projects) {
  const [permsList, companyList, members] = await Promise.all([
    Promise.all(staff.map((p) => resolveUserPermissions(p.id))),
    Promise.all(staff.map((p) => getUserCompanyIds(p))),
    projectIds.length && staff.length
      ? ProjectMember.findAll({ where: { projectId: projectIds, userId: staff.map((p) => p.id) }, attributes: ['projectId', 'userId'], raw: true })
      : [],
  ]);
  const memberOf = new Set(members.map((m) => `${m.userId}:${m.projectId}`));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const info = new Map(staff.map((p, i) => [p.id, { person: p, perms: permsList[i], companies: companyList[i] }]));
  const company = (userId, companyId) => {
    const i = info.get(userId);
    return !!i && (i.companies === null || i.companies.includes(companyId));
  };
  const project = (userId, projectId) => {
    const i = info.get(userId);
    const pr = byId.get(projectId);
    if (!i || !pr || !company(userId, pr.companyId)) return false;
    if (i.perms['projects.view_all']) return true;
    const member = memberOf.has(`${userId}:${projectId}`);
    if (i.perms['projects.view_department']) {
      return sameDept(pr.ownerDepartmentId, i.person.departmentId) || sameDept(pr.forDepartmentId, i.person.departmentId) || member;
    }
    return member;
  };
  return { company, project };
}

async function buildWorkload(viewer, {
  from, days, today, teamId = null, kinds = 'all',
}) {
  const settings = await readSettings();
  const columns = weekdayColumns(from, days);
  const horizon = from < today ? from : today;

  // The assignable staff list; a team narrows who is shown, not who shares a task.
  const staff = await User.findAll({
    where: { role: { [Op.in]: ['admin', 'technician'] }, isActive: true },
    attributes: ['id', 'displayName', 'departmentId', 'workHours', 'role', 'roleId', 'allCompanies'],
    order: [['displayName', 'ASC']],
  });
  let teamUserIds = null;
  if (teamId) {
    const rows = await TeamMember.findAll({ where: { teamId }, attributes: ['userId'], raw: true });
    teamUserIds = new Set(rows.map((r) => r.userId));
  }
  const rowsShown = teamUserIds ? staff.filter((p) => teamUserIds.has(p.id)) : staff;
  const holidays = await loadHolidays(staff, horizon);
  const holidaysOf = new Map(staff.map((p) => [p.id, new Set([...holidays.global.keys(), ...(holidays.byDept.get(p.departmentId) || [])])]));

  // Everything inside the viewer's own scope, nothing else.
  const [ticketBuckets, projectBuckets, viewerPerms] = await Promise.all([
    getTicketStatusBuckets(), getProjectStatusBuckets(), resolveUserPermissions(viewer.id),
  ]);
  // workload.view alone opens the screen; what is listed still needs the
  // matching view permission, or the scope helpers would fall back to 'own'.
  const canSee = (family) => ['view_own', 'view_department', 'view_all'].some((k) => viewerPerms[`${family}.${k}`]);
  const wantTickets = (kinds === 'all' || kinds === 'tickets') && canSee('tickets');
  const wantTasks = (kinds === 'all' || kinds === 'tasks') && canSee('projects');
  const tickets = wantTickets
    ? await Ticket.findAll({
      where: andWhere(await ticketScopeWhere(viewer), { status: inList(ticketBuckets.open), mergedIntoId: null }),
      attributes: ['id', 'title', 'assigneeId', 'teamId', 'companyId', 'departmentId', 'dueDate', 'plannedDate'],
      raw: true,
    })
    : [];
  const projects = wantTasks
    ? await Project.findAll({
      where: andWhere(await projectScopeWhere(viewer), { status: inList(projectBuckets.open) }),
      attributes: ['id', 'name', 'companyId', 'ownerDepartmentId', 'forDepartmentId', 'assignedToUserId'],
      raw: true,
    })
    : [];

  const [ticketTaskStatuses, projectTaskStatuses] = await Promise.all([openTaskStatusIds('ticket'), openTaskStatusIds('project')]);
  const ticketTasks = tickets.length
    ? await Task.findAll({
      where: { ticketId: tickets.map((t) => t.id), parentTaskId: null, statusId: inList(ticketTaskStatuses) },
      attributes: ['id', 'ticketId', 'estimateMinutes'],
      raw: true,
    })
    : [];
  const projectTasks = projects.length
    ? await Task.findAll({
      where: {
        projectId: projects.map((p) => p.id), parentTaskId: null, isMilestone: false, statusId: inList(projectTaskStatuses),
      },
      attributes: ['id', 'projectId', 'code', 'title', 'assigneeId', 'startDate', 'dueDate', 'estimateMinutes'],
      raw: true,
    })
    : [];

  const taskIds = [...ticketTasks, ...projectTasks].map((t) => t.id);
  const [logged, helperRows, companyRows, memberRows, reach] = await Promise.all([
    loggedMinutesByTask(taskIds),
    projectTasks.length ? TaskAssignee.findAll({ where: { taskId: projectTasks.map((t) => t.id) }, attributes: ['taskId', 'userId'], raw: true }) : [],
    Company.findAll({ where: { id: [...new Set([...tickets, ...projects].map((r) => r.companyId))] }, attributes: ['id', 'name'], raw: true }),
    projects.length ? ProjectMember.findAll({ where: { projectId: projects.map((p) => p.id), userId: viewer.id, role: { [Op.ne]: 'helper' } }, attributes: ['projectId'], raw: true }) : [],
    loadReach(staff, projects.map((p) => p.id), projects),
  ]);
  const companyName = new Map(companyRows.map((c) => [c.id, c.name]));
  const helpersOf = new Map();
  helperRows.forEach((h) => helpersOf.set(h.taskId, [...(helpersOf.get(h.taskId) || []), h.userId]));
  const canEdit = editRules(viewer, viewerPerms, new Set(memberRows.map((m) => m.projectId)));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const staffIds = new Set(staff.map((p) => p.id));
  const tasksOfTicket = new Map();
  ticketTasks.forEach((t) => tasksOfTicket.set(t.ticketId, [...(tasksOfTicket.get(t.ticketId) || []), { estimateMinutes: t.estimateMinutes, loggedMinutes: logged.get(t.id) || 0 }]));

  // One list of items, each with the people who carry it (reachable staff only).
  const items = [];
  for (const t of tickets) {
    const carriers = t.assigneeId && staffIds.has(t.assigneeId) && reach.company(t.assigneeId, t.companyId) ? [t.assigneeId] : [];
    items.push({
      kind: 'ticket',
      id: t.id,
      projectId: null,
      code: `#${String(t.id).padStart(5, '0')}`,
      title: t.title,
      company: companyName.get(t.companyId) || null,
      minutes: itemMinutes({ kind: 'ticket', tasks: tasksOfTicket.get(t.id) || [] }, settings.defaultTicketMinutes),
      startDate: null,
      dueDate: t.dueDate || null,
      plannedDate: t.plannedDate || null,
      effectiveDue: t.plannedDate || t.dueDate || null,
      canEdit: canEdit.ticket(t),
      carriers,
      assigned: !!t.assigneeId,
      mainAssigneeId: t.assigneeId || null,
      peopleIds: t.assigneeId ? [t.assigneeId] : [],
      slaOverdue: !!t.dueDate && t.dueDate < today,
      teamId: t.teamId,
    });
  }
  for (const t of projectTasks) {
    const pr = projectById.get(t.projectId);
    const everyone = peopleOn({ assigneeId: t.assigneeId, helpers: helpersOf.get(t.id) || [] });
    items.push({
      kind: 'task',
      id: t.id,
      projectId: t.projectId,
      projectName: pr.name,
      code: t.code,
      title: t.title,
      company: companyName.get(pr.companyId) || null,
      minutes: itemMinutes({ kind: 'task', estimateMinutes: t.estimateMinutes, loggedMinutes: logged.get(t.id) || 0 }),
      startDate: t.startDate || null,
      dueDate: t.dueDate || null,
      plannedDate: null,
      effectiveDue: t.dueDate || null,
      canEdit: canEdit.project(pr),
      carriers: everyone.filter((id) => staffIds.has(id) && reach.project(id, t.projectId)),
      assigned: everyone.length > 0,
      mainAssigneeId: t.assigneeId || null,
      // Who is on it, main assignee first: a drop in one of their rows moves
      // only the dates (the client must not make a helper the main assignee).
      peopleIds: everyone,
      teamId: null,
    });
  }

  // Cells and per-person item lists.
  const people = rowsShown.map((p) => ({
    id: p.id,
    name: p.displayName,
    avatar: null,
    cells: Object.fromEntries([...columns, NONE].map((key) => [key, {
      minutes: 0, capacity: key === NONE ? 0 : capacityFor(p.workHours, settings.defaultWorkHours, holidaysOf.get(p.id), key), count: 0, overdue: false,
    }])),
  }));
  const rowOf = new Map(people.map((p) => [p.id, p]));
  const staffById = new Map(staff.map((p) => [p.id, p]));
  const out = {};
  const unassigned = [];
  // Weekends are not shown: "today" on one is the coming Monday, and the
  // working days to spread over are Monday-Friday ones, kept per person and window.
  const todayCol = snapForward(today);
  // Counted over the whole window, listed only for the visible columns.
  const range = [columns[0], columns[columns.length - 1]];
  const workingCache = new Map();
  const workingDaysFor = (person, start, due) => {
    const key = `${person.id}|${start}|${due}`;
    if (!workingCache.has(key)) {
      const workdays = workingWeekdays(person.workHours, settings.defaultWorkHours);
      workingCache.set(key, workingSpan(start, due, todayCol, workdays, holidaysOf.get(person.id), range));
    }
    return workingCache.get(key);
  };
  const unavailable = [];
  for (const it of items) {
    const overdue = !!it.effectiveDue && it.effectiveDue < today;
    const {
      carriers, assigned, teamId: itemTeam, effectiveDue, mainAssigneeId, ...shownFields
    } = it;
    if (!carriers.length) {
      // The "Not assigned yet" lane: nobody on it, or people who can't carry it
      // (inactive, or can't open it) - those are marked, never silently dropped.
      if (!teamId || itemTeam == null || itemTeam === teamId) {
        const entry = { ...shownFields, overdue };
        if (assigned) { entry.assigneeUnavailable = true; unavailable.push([entry, mainAssigneeId]); }
        unassigned.push(entry);
      }
      continue; // eslint-disable-line no-continue
    }
    const shares = shareMinutes(it.minutes, carriers);
    for (const [personId, minutes] of shares) {
      const row = rowOf.get(personId);
      if (!row) continue; // eslint-disable-line no-continue
      const working = workingDaysFor(staffById.get(personId), it.startDate, effectiveDue);
      // A single-day landing on a weekend shows on the Friday before.
      const landed = new Map();
      for (const [key, m] of spread(minutes, it.startDate, effectiveDue, working, todayCol)) {
        const day = key === NONE ? key : snapBack(key);
        landed.set(day, (landed.get(day) || 0) + m);
      }
      const byDay = {};
      for (const [key, m] of landed) {
        const cell = row.cells[key];
        if (!cell) continue; // eslint-disable-line no-continue
        cell.minutes += m;
        cell.count += 1;
        if (overdue) cell.overdue = true;
        byDay[key] = m;
      }
      if (Object.keys(byDay).length) {
        (out[personId] = out[personId] || []).push({ ...shownFields, minutes, overdue, byDay });
      }
    }
  }
  // Name the person on the lane items, as the record itself already shows it.
  const nameIds = [...new Set(unavailable.map(([, id]) => id).filter(Boolean))];
  if (nameIds.length) {
    const named = new Map((await User.findAll({ where: { id: nameIds }, attributes: ['id', 'displayName'], raw: true })).map((u) => [u.id, u.displayName]));
    unavailable.forEach(([entry, id]) => { if (named.has(id)) entry.assigneeName = named.get(id); });
  }
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title);
  unassigned.sort(byDue);
  Object.values(out).forEach((list) => list.sort(byDue));

  return {
    from,
    today,
    days: columns.map((date) => (holidays.global.has(date) ? { date, holiday: holidays.global.get(date) } : { date })),
    people,
    unassigned,
    items: out,
  };
}

module.exports = { buildWorkload, weekdayColumns };
