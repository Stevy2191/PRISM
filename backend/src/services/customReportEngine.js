// Custom report builder engine — config-driven so the 5 data sources share
// one execution path (load flat records -> filter -> project fields ->
// optionally group/aggregate) instead of 5 bespoke hand-rolled reports.
const { Op } = require('sequelize');
const {
  Ticket, TimeEntry, ProjectTimeEntry, User, Team, Project, ProjectExpense, ProjectMaterial,
  Department, Contact, CustomField, TicketFieldValue,
} = require('../models');
const { getUserReportScope } = require('./permissionService');
const { getTicketStatusBuckets } = require('./statusBehavior');
const { computeProjectCompletion } = require('./projectCompletion');
const rc = require('../controllers/reportsController'); // reuse scope/date-range helpers, not routes

const userAttrs = ['id', 'displayName', 'username'];

// ---- Field definitions (key, label, type) per data source ----

const FIELD_DEFS = {
  tickets: [
    { key: 'ticketNumber', label: 'Ticket #', type: 'string' },
    { key: 'title', label: 'Title', type: 'string' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'priority', label: 'Priority', type: 'string' },
    { key: 'type', label: 'Type', type: 'string' },
    { key: 'contactName', label: 'Contact name', type: 'string' },
    { key: 'contactDepartment', label: 'Contact department', type: 'string' },
    { key: 'assignee', label: 'Assignee', type: 'string' },
    { key: 'team', label: 'Team', type: 'string' },
    { key: 'createdAt', label: 'Created date', type: 'date' },
    { key: 'closedAt', label: 'Closed date', type: 'date' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'resolutionHours', label: 'Resolution time (hours)', type: 'number' },
    { key: 'timeLoggedHours', label: 'Time logged', type: 'number' },
    { key: 'source', label: 'Source', type: 'string' },
    { key: 'tags', label: 'Tags', type: 'string' },
  ],
  projects: [
    { key: 'projectCode', label: 'Project code', type: 'string' },
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'ownedByDept', label: 'Owned by dept', type: 'string' },
    { key: 'forDept', label: 'For dept', type: 'string' },
    { key: 'lead', label: 'Lead', type: 'string' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'completionPercent', label: 'Completion %', type: 'number' },
    { key: 'totalTasks', label: 'Total tasks', type: 'number' },
    { key: 'closedTasks', label: 'Closed tasks', type: 'number' },
    { key: 'totalTimeLoggedHours', label: 'Total time logged', type: 'number' },
    { key: 'laborCost', label: 'Labor cost', type: 'number' },
    { key: 'expensesTotal', label: 'Expenses total', type: 'number' },
    { key: 'materialsTotal', label: 'Materials total', type: 'number' },
    { key: 'totalCost', label: 'Total cost', type: 'number' },
    { key: 'tags', label: 'Tags', type: 'string' },
  ],
  time_entries: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'techName', label: 'Tech name', type: 'string' },
    { key: 'userType', label: 'User type', type: 'string' },
    { key: 'ticketNumber', label: 'Ticket #', type: 'string' },
    { key: 'projectCode', label: 'Project code', type: 'string' },
    { key: 'description', label: 'Description', type: 'string' },
    { key: 'durationHours', label: 'Duration', type: 'number' },
    { key: 'laborCost', label: 'Labor cost', type: 'number' },
  ],
  expenses_materials: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'projectCode', label: 'Project code', type: 'string' },
    { key: 'item', label: 'Item/description', type: 'string' },
    { key: 'category', label: 'Category', type: 'string' },
    { key: 'vendor', label: 'Vendor', type: 'string' },
    { key: 'model', label: 'Model', type: 'string' },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'unitCost', label: 'Unit cost', type: 'number' },
    { key: 'totalCost', label: 'Total cost', type: 'number' },
    { key: 'loggedBy', label: 'Logged by', type: 'string' },
  ],
  contacts: [
    { key: 'name', label: 'Name', type: 'string' },
    { key: 'email', label: 'Email', type: 'string' },
    { key: 'phone', label: 'Phone', type: 'string' },
    { key: 'department', label: 'Department', type: 'string' },
    { key: 'jobTitle', label: 'Job title', type: 'string' },
    { key: 'assignedTo', label: 'Assigned to', type: 'string' },
    { key: 'totalTickets', label: 'Total tickets', type: 'number' },
    { key: 'openTickets', label: 'Open tickets', type: 'number' },
    { key: 'lastTicketDate', label: 'Last ticket date', type: 'date' },
    { key: 'createdAt', label: 'Created date', type: 'date' },
    { key: 'status', label: 'Status', type: 'string' },
  ],
};

const GROUP_BY_OPTIONS = {
  tickets: ['department', 'assignee', 'status', 'priority', 'month', 'type', 'source'],
  projects: ['department', 'status', 'month'],
  time_entries: ['tech', 'month', 'ticket', 'project'],
  expenses_materials: [],
  contacts: ['department'],
};

async function activeTicketCustomFields() {
  const fields = await CustomField.findAll({ where: { isActive: true }, order: [['position', 'ASC']] });
  return fields.map((f) => ({ key: `cf_${f.fieldKey}`, label: f.label, type: 'string', fieldId: f.id, fieldKey: f.fieldKey }));
}

// GET-style metadata endpoint payload — field/filter/groupBy options per
// source, so the frontend wizard doesn't hardcode this in two places.
async function getSourceMetadata() {
  const ticketCustomFields = await activeTicketCustomFields();
  return {
    dataSources: [
      { key: 'tickets', label: 'Tickets', fields: [...FIELD_DEFS.tickets, ...ticketCustomFields], groupBy: GROUP_BY_OPTIONS.tickets },
      { key: 'projects', label: 'Projects', fields: FIELD_DEFS.projects, groupBy: GROUP_BY_OPTIONS.projects },
      { key: 'time_entries', label: 'Time Entries', fields: FIELD_DEFS.time_entries, groupBy: GROUP_BY_OPTIONS.time_entries },
      { key: 'expenses_materials', label: 'Expenses & Materials', fields: FIELD_DEFS.expenses_materials, groupBy: GROUP_BY_OPTIONS.expenses_materials },
      { key: 'contacts', label: 'Contacts', fields: FIELD_DEFS.contacts, groupBy: GROUP_BY_OPTIONS.contacts },
    ],
  };
}

// ---- Record loaders — one per data source, each returns flat plain
// objects keyed by every field defined above, regardless of what the
// caller actually selected (projection to selected fields happens later). ----

async function loadTicketRecords(req, filters) {
  const scope = await getUserReportScope(req.user.id);
  const dateField = filters.dateField && ['createdAt', 'closedAt', 'dueDate'].includes(filters.dateField) ? filters.dateField : 'createdAt';
  const range = { start: filters.startDate ? new Date(filters.startDate) : null, end: filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null };
  const modelDateField = dateField === 'closedAt' ? 'resolvedAt' : dateField;

  let where = rc.dateWhere(modelDateField, range);
  where = rc.ticketScopeWhere(where, scope, req.user, filters.departmentId || null);
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.source) where.source = filters.source;

  const tickets = await Ticket.findAll({
    where,
    include: [
      { model: User, as: 'assignee', attributes: userAttrs },
      { model: Contact, as: 'contact', attributes: ['id', 'displayName'], include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }] },
      { model: Team, as: 'team', attributes: ['id', 'name'] },
      { model: Department, as: 'department', attributes: ['id', 'name'] },
      { model: TicketFieldValue, as: 'fieldValues', include: [{ model: CustomField, as: 'field' }] },
    ],
    order: [['createdAt', 'DESC']],
  });

  const ticketIds = tickets.map((t) => t.id);
  const timeTotals = ticketIds.length
    ? await TimeEntry.findAll({ where: { ticketId: { [Op.in]: ticketIds } }, attributes: ['ticketId', 'minutes'], raw: true })
    : [];
  const minutesByTicket = new Map();
  timeTotals.forEach((r) => minutesByTicket.set(r.ticketId, (minutesByTicket.get(r.ticketId) || 0) + r.minutes));

  let records = tickets.map((t) => {
    const resolutionHours = t.resolvedAt ? Math.round(((new Date(t.resolvedAt) - new Date(t.createdAt)) / 3600000) * 10) / 10 : null;
    const rec = {
      id: t.id,
      ticketNumber: `#${String(t.id).padStart(5, '0')}`,
      title: t.title,
      status: t.status,
      priority: t.priority,
      type: t.type,
      contactName: t.contact?.displayName || '',
      contactDepartment: t.contact?.department?.name || '',
      assignee: t.assignee?.displayName || 'Unassigned',
      team: t.team?.name || '',
      createdAt: t.createdAt ? t.createdAt.toISOString().slice(0, 10) : '',
      closedAt: t.resolvedAt ? new Date(t.resolvedAt).toISOString().slice(0, 10) : '',
      dueDate: t.dueDate || '',
      resolutionHours,
      timeLoggedHours: Math.round(((minutesByTicket.get(t.id) || 0) / 60) * 10) / 10,
      source: t.source,
      tags: Array.isArray(t.tags) ? t.tags.join(', ') : '',
      _departmentName: t.department?.name || 'Unassigned',
      _assigneeName: t.assignee?.displayName || 'Unassigned',
      _month: t.createdAt ? t.createdAt.toISOString().slice(0, 7) : '',
      _tagList: Array.isArray(t.tags) ? t.tags : [],
    };
    (t.fieldValues || []).forEach((fv) => { rec[`cf_${fv.field.fieldKey}`] = fv.value; });
    return rec;
  });

  if (filters.tag) records = records.filter((r) => r._tagList.includes(filters.tag));
  if (filters.customField && filters.customField.key) {
    const fk = `cf_${filters.customField.key}`;
    records = records.filter((r) => String(r[fk] ?? '') === String(filters.customField.value ?? ''));
  }
  return records;
}

async function loadProjectRecords(req, filters) {
  const scope = await getUserReportScope(req.user.id);
  const range = { start: filters.startDate ? new Date(filters.startDate) : null, end: filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null };
  const dateField = filters.dateField === 'closedAt' ? 'closedAt' : (filters.dateField === 'dueDate' ? 'dueDate' : 'createdAt');

  let where = rc.dateWhere(dateField, range);
  where = rc.projectScopeWhere(where, scope, req.user, filters.departmentId || null);
  if (filters.status) where.status = filters.status;
  if (filters.assigneeId) where.assignedToUserId = filters.assigneeId;

  const projects = await Project.findAll({
    where,
    include: [
      { model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] },
      { model: Department, as: 'forDepartment', attributes: ['id', 'name'] },
      { model: User, as: 'lead', attributes: userAttrs },
    ],
    order: [['createdAt', 'DESC']],
  });

  let records = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const p of projects) {
    // eslint-disable-next-line no-await-in-loop
    const [completion, timeSum, laborSum, expenseSum, materialSum] = await Promise.all([
      computeProjectCompletion(p.id),
      ProjectTimeEntry.sum('durationSeconds', { where: { projectId: p.id } }),
      ProjectTimeEntry.sum('laborCost', { where: { projectId: p.id } }),
      ProjectExpense.sum('amount', { where: { projectId: p.id } }),
      ProjectMaterial.sum('totalCost', { where: { projectId: p.id } }),
    ]);
    const laborCost = Number(laborSum) || 0;
    const expensesTotal = Number(expenseSum) || 0;
    const materialsTotal = Number(materialSum) || 0;
    records.push({
      id: p.id,
      projectCode: p.projectCode,
      name: p.name,
      status: p.status,
      ownedByDept: p.ownerDepartment?.name || '',
      forDept: p.forDepartment?.name || '',
      lead: p.lead?.displayName || 'Unassigned',
      dueDate: p.dueDate || '',
      completionPercent: completion.percent,
      totalTasks: completion.totalTasks,
      closedTasks: completion.closedTasks,
      totalTimeLoggedHours: Math.round(((Number(timeSum) || 0) / 3600) * 10) / 10,
      laborCost: Math.round(laborCost * 100) / 100,
      expensesTotal: Math.round(expensesTotal * 100) / 100,
      materialsTotal: Math.round(materialsTotal * 100) / 100,
      totalCost: Math.round((laborCost + expensesTotal + materialsTotal) * 100) / 100,
      tags: Array.isArray(p.tags) ? p.tags.join(', ') : '',
      _departmentName: p.ownerDepartment?.name || 'Unassigned',
      _month: p.createdAt ? p.createdAt.toISOString().slice(0, 7) : '',
      _tagList: Array.isArray(p.tags) ? p.tags : [],
    });
  }
  if (filters.tag) records = records.filter((r) => r._tagList.includes(filters.tag));
  return records;
}

async function loadTimeEntryRecords(req, filters) {
  const scope = await getUserReportScope(req.user.id);
  const range = { start: filters.startDate ? new Date(filters.startDate) : null, end: filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null };

  let ticketWhere = rc.dateWhere('loggedAt', range);
  let projectWhere = rc.dateWhere('createdAt', range);
  if (scope === 'department') {
    ticketWhere = { ...ticketWhere, '$ticket.departmentId$': req.user.departmentId };
    projectWhere = { ...projectWhere, '$project.ownerDepartmentId$': req.user.departmentId };
  } else if (scope === 'own') {
    ticketWhere = { ...ticketWhere, userId: req.user.id };
    projectWhere = { ...projectWhere, loggedForUserId: req.user.id };
  } else if (scope === 'all' && filters.departmentId) {
    ticketWhere = { ...ticketWhere, '$ticket.departmentId$': filters.departmentId };
    projectWhere = { ...projectWhere, '$project.ownerDepartmentId$': filters.departmentId };
  }
  if (filters.assigneeId) {
    ticketWhere = { ...ticketWhere, userId: filters.assigneeId };
    projectWhere = { ...projectWhere, loggedForUserId: filters.assigneeId };
  }

  const [ticketEntries, projectEntries] = await Promise.all([
    TimeEntry.findAll({
      where: ticketWhere,
      include: [{ model: User, as: 'user', attributes: [...userAttrs, 'userType'] }, { model: Ticket, as: 'ticket', attributes: ['id', 'title'] }],
      order: [['loggedAt', 'DESC']],
    }),
    ProjectTimeEntry.findAll({
      where: projectWhere,
      include: [{ model: User, as: 'loggedFor', attributes: [...userAttrs, 'userType'] }, { model: Project, as: 'project', attributes: ['id', 'projectCode'] }],
      order: [['createdAt', 'DESC']],
    }),
  ]);

  let records = [
    ...ticketEntries.map((e) => ({
      id: `t${e.id}`,
      date: e.entryDate || (e.loggedAt ? e.loggedAt.toISOString().slice(0, 10) : ''),
      techName: e.user?.displayName || 'Unknown',
      userType: e.user?.userType === 'contractor' ? 'Contractor' : 'Internal',
      ticketNumber: e.ticket ? `#${String(e.ticket.id).padStart(5, '0')}` : '',
      projectCode: '',
      description: e.note || '',
      durationHours: Math.round(((e.durationSeconds != null ? e.durationSeconds : e.minutes * 60) / 3600) * 10) / 10,
      laborCost: e.laborCost != null ? Number(e.laborCost) : null,
      _userTypeRaw: e.user?.userType || 'internal',
      _techId: e.user?.id ?? 'unknown',
      _month: (e.entryDate || '').slice(0, 7),
    })),
    ...projectEntries.map((e) => ({
      id: `p${e.id}`,
      date: e.entryDate || (e.createdAt ? e.createdAt.toISOString().slice(0, 10) : ''),
      techName: e.loggedFor?.displayName || 'Unknown',
      userType: e.loggedFor?.userType === 'contractor' ? 'Contractor' : 'Internal',
      ticketNumber: '',
      projectCode: e.project?.projectCode || '',
      description: e.description || '',
      durationHours: Math.round(((e.durationSeconds || 0) / 3600) * 10) / 10,
      laborCost: e.laborCost != null ? Number(e.laborCost) : null,
      _userTypeRaw: e.loggedFor?.userType || 'internal',
      _techId: e.loggedFor?.id ?? 'unknown',
      _month: (e.entryDate || '').slice(0, 7),
    })),
  ];

  if (filters.userType) records = records.filter((r) => r._userTypeRaw === filters.userType);
  return records;
}

async function loadExpenseMaterialRecords(req, filters) {
  const scope = await getUserReportScope(req.user.id);
  const range = { start: filters.startDate ? new Date(filters.startDate) : null, end: filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null };

  let expenseWhere = rc.dateWhere('entryDate', range);
  let materialWhere = rc.dateWhere('createdAt', range);
  if (scope === 'department') {
    expenseWhere = { ...expenseWhere, '$project.ownerDepartmentId$': req.user.departmentId };
    materialWhere = { ...materialWhere, '$project.ownerDepartmentId$': req.user.departmentId };
  } else if (scope === 'all' && filters.departmentId) {
    expenseWhere = { ...expenseWhere, '$project.ownerDepartmentId$': filters.departmentId };
    materialWhere = { ...materialWhere, '$project.ownerDepartmentId$': filters.departmentId };
  }

  const [expenses, materials] = await Promise.all([
    ProjectExpense.findAll({
      where: expenseWhere,
      include: [{ model: User, as: 'loggedByUser', attributes: userAttrs }, { model: Project, as: 'project', attributes: ['id', 'projectCode', 'ownerDepartmentId'] }],
      order: [['entryDate', 'DESC']],
    }),
    ProjectMaterial.findAll({
      where: materialWhere,
      include: [{ model: User, as: 'addedByUser', attributes: userAttrs }, { model: Project, as: 'project', attributes: ['id', 'projectCode', 'ownerDepartmentId'] }],
      order: [['createdAt', 'DESC']],
    }),
  ]);

  return [
    ...expenses.map((e) => ({
      id: `e${e.id}`,
      date: e.entryDate || '',
      projectCode: e.project?.projectCode || '',
      item: e.description,
      category: e.category,
      vendor: '',
      model: '',
      qty: '',
      unitCost: '',
      totalCost: Number(e.amount) || 0,
      loggedBy: e.loggedByUser?.displayName || 'Unknown',
    })),
    ...materials.map((m) => ({
      id: `m${m.id}`,
      date: m.createdAt ? m.createdAt.toISOString().slice(0, 10) : '',
      projectCode: m.project?.projectCode || '',
      item: m.itemName,
      category: 'materials',
      vendor: m.vendor || '',
      model: m.modelNumber || '',
      qty: m.quantity,
      unitCost: Number(m.unitCost) || 0,
      totalCost: Number(m.totalCost) || 0,
      loggedBy: m.addedByUser?.displayName || 'Unknown',
    })),
  ];
}

async function loadContactRecords(req, filters) {
  const scope = await getUserReportScope(req.user.id);
  const range = { start: filters.startDate ? new Date(filters.startDate) : null, end: filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null };
  let contactWhere = rc.dateWhere('createdAt', range);
  contactWhere = rc.contactDeptWhere(contactWhere, scope, req.user, filters.departmentId || null);
  if (filters.status) contactWhere.status = filters.status;

  const contacts = await Contact.findAll({
    where: contactWhere,
    include: [
      { model: Department, as: 'department', attributes: ['id', 'name'] },
      { model: User, as: 'assignedToUser', attributes: userAttrs },
    ],
    order: [['createdAt', 'DESC']],
  });

  const ticketBuckets = await getTicketStatusBuckets();
  const records = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const c of contacts) {
    // eslint-disable-next-line no-await-in-loop
    const [totalTickets, openTickets, lastTicket] = await Promise.all([
      Ticket.count({ where: { contactId: c.id } }),
      Ticket.count({ where: { contactId: c.id, status: { [Op.in]: ticketBuckets.open } } }),
      Ticket.findOne({ where: { contactId: c.id }, order: [['createdAt', 'DESC']], attributes: ['createdAt'] }),
    ]);
    records.push({
      id: c.id,
      name: c.displayName,
      email: c.email || '',
      phone: c.phone || '',
      department: c.department?.name || '',
      jobTitle: c.jobTitle || '',
      assignedTo: c.assignedToUser?.displayName || 'Unassigned',
      totalTickets,
      openTickets,
      lastTicketDate: lastTicket ? lastTicket.createdAt.toISOString().slice(0, 10) : '',
      createdAt: c.createdAt ? c.createdAt.toISOString().slice(0, 10) : '',
      status: c.status,
      _departmentName: c.department?.name || 'Unassigned',
    });
  }
  return records;
}

const LOADERS = {
  tickets: loadTicketRecords,
  projects: loadProjectRecords,
  time_entries: loadTimeEntryRecords,
  expenses_materials: loadExpenseMaterialRecords,
  contacts: loadContactRecords,
};

// ---- Grouping ----

function groupKeyFor(dataSource, groupBy, record) {
  if (dataSource === 'tickets') {
    if (groupBy === 'department') return record._departmentName;
    if (groupBy === 'assignee') return record._assigneeName;
    if (groupBy === 'status') return record.status;
    if (groupBy === 'priority') return record.priority;
    if (groupBy === 'type') return record.type;
    if (groupBy === 'source') return record.source;
    if (groupBy === 'month') return record._month;
  }
  if (dataSource === 'projects') {
    if (groupBy === 'department') return record._departmentName;
    if (groupBy === 'status') return record.status;
    if (groupBy === 'month') return record._month;
  }
  if (dataSource === 'time_entries') {
    if (groupBy === 'tech') return record.techName;
    if (groupBy === 'month') return record._month;
    if (groupBy === 'ticket') return record.ticketNumber || '(project time)';
    if (groupBy === 'project') return record.projectCode || '(ticket time)';
  }
  if (dataSource === 'contacts') {
    if (groupBy === 'department') return record._departmentName;
  }
  return 'All';
}

// Aggregates numeric fields (sum) and always includes a count, per group.
function aggregate(dataSource, groupBy, records, fields) {
  const numericKeys = (FIELD_DEFS[dataSource] || []).filter((f) => f.type === 'number' && fields.includes(f.key)).map((f) => f.key);
  const map = new Map();
  records.forEach((r) => {
    const key = groupKeyFor(dataSource, groupBy, r) || 'Unspecified';
    if (!map.has(key)) {
      const entry = { name: key, count: 0 };
      numericKeys.forEach((k) => { entry[k] = 0; });
      map.set(key, entry);
    }
    const entry = map.get(key);
    entry.count += 1;
    numericKeys.forEach((k) => { entry[k] += Number(r[k]) || 0; });
  });
  const rows = [...map.values()];
  if (groupBy === 'month') rows.sort((a, b) => a.name.localeCompare(b.name));
  else rows.sort((a, b) => b.count - a.count);
  return rows;
}

// ---- Main entry point ----

async function runCustomReport(req) {
  const { dataSource, fields, filters = {}, groupBy } = req.body || {};
  if (!LOADERS[dataSource]) throw new Error('Invalid dataSource');
  const fieldDefs = dataSource === 'tickets'
    ? [...FIELD_DEFS.tickets, ...(await activeTicketCustomFields())]
    : FIELD_DEFS[dataSource];
  const fieldKeys = Array.isArray(fields) && fields.length ? fields.filter((f) => fieldDefs.some((d) => d.key === f)) : fieldDefs.map((d) => d.key);

  const records = await LOADERS[dataSource](req, filters);

  const columns = fieldKeys.map((k) => ({ key: k, label: (fieldDefs.find((d) => d.key === k) || {}).label || k }));
  const rows = records.map((r) => {
    const row = { id: r.id };
    fieldKeys.forEach((k) => { row[k] = r[k]; });
    return row;
  });

  const validGroupBy = groupBy && (GROUP_BY_OPTIONS[dataSource] || []).includes(groupBy) ? groupBy : null;
  const chartData = validGroupBy ? aggregate(dataSource, validGroupBy, records, fieldKeys) : [];

  const numericKeys = fieldDefs.filter((f) => f.type === 'number' && fieldKeys.includes(f.key)).map((f) => f.key);
  const summary = { totalRecords: records.length };
  numericKeys.forEach((k) => {
    summary[`total_${k}`] = Math.round(records.reduce((sum, r) => sum + (Number(r[k]) || 0), 0) * 100) / 100;
  });

  return {
    tableData: { columns, rows },
    chartData,
    summary,
    groupBy: validGroupBy,
  };
}

module.exports = {
  FIELD_DEFS, GROUP_BY_OPTIONS, getSourceMetadata, runCustomReport,
};
