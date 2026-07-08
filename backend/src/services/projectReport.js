const {
  Project, ProjectMember, ProjectTask, ProjectSubtask, ProjectTimeEntry, ProjectExpense,
  ProjectMaterial, ProjectActivity, ProjectStatus, User, Department, Team,
} = require('../models');
const { computeProjectCompletion, isTaskComplete, subtaskCompletionPercent } = require('./projectCompletion');
const { getProjectStatusIdBehaviorMap } = require('./statusBehavior');
const {
  newDocument, drawHeader, sectionTitle, fieldGrid, paragraph, table, streamPdfResponse, ensureSpace,
  MUTED, TEXT, CONTENT_WIDTH, PAGE_MARGIN,
} = require('./pdfReport');

const userAttrs = ['id', 'displayName', 'username', 'email'];

// ProjectActivity has a much longer tail of granular actions than tickets
// (file_uploaded, expense_added, material_added, subtask_closed, ...) —
// "key events" keeps only creation, status, and major task/member milestones.
const KEY_ACTIVITY_ACTIONS = new Set(['project_created', 'status_changed', 'member_added', 'task_created', 'task_closed']);

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString() : '—';
}
function fmtDuration(seconds) {
  const s = Number(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtCost(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadProjectReportData(projectId) {
  const project = await Project.findByPk(projectId, {
    include: [
      { model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] },
      { model: Department, as: 'forDepartment', attributes: ['id', 'name'] },
      { model: User, as: 'lead', attributes: userAttrs },
      { model: Team, as: 'team', attributes: ['id', 'name'] },
    ],
  });
  if (!project) return null;

  const statusIdBehavior = await getProjectStatusIdBehaviorMap();

  const [completion, members, tasks, timeEntries, expenses, materials, activity] = await Promise.all([
    computeProjectCompletion(project.id),
    ProjectMember.findAll({ where: { projectId: project.id }, include: [{ model: User, as: 'user', attributes: [...userAttrs, 'userType', 'hourlyRate'] }] }),
    ProjectTask.findAll({
      where: { projectId: project.id },
      include: [
        { model: User, as: 'assignee', attributes: userAttrs },
        { model: ProjectStatus, as: 'status' },
        { model: ProjectSubtask, as: 'subtasks', include: [{ model: User, as: 'assignee', attributes: userAttrs }, { model: ProjectStatus, as: 'status' }] },
      ],
      order: [['position', 'ASC'], ['id', 'ASC']],
    }),
    ProjectTimeEntry.findAll({
      where: { projectId: project.id },
      include: [{ model: User, as: 'loggedFor', attributes: [...userAttrs, 'userType'] }, { model: ProjectTask, as: 'task', attributes: ['id', 'title'] }],
      order: [['entryDate', 'ASC'], ['createdAt', 'ASC']],
    }),
    ProjectExpense.findAll({ where: { projectId: project.id }, include: [{ model: User, as: 'loggedByUser', attributes: userAttrs }], order: [['entryDate', 'ASC']] }),
    ProjectMaterial.findAll({ where: { projectId: project.id }, include: [{ model: User, as: 'addedByUser', attributes: userAttrs }], order: [['createdAt', 'ASC']] }),
    ProjectActivity.findAll({
      where: { projectId: project.id },
      include: [{ model: User, as: 'user', attributes: userAttrs }],
      order: [['createdAt', 'ASC']],
    }),
  ]);

  const annotatedTasks = tasks.map((t) => {
    const json = t.toJSON();
    json.isComplete = isTaskComplete(t, t.subtasks || [], statusIdBehavior);
    json.subtaskPercent = subtaskCompletionPercent(t.subtasks || [], statusIdBehavior);
    return json;
  });

  const keyActivity = activity.filter((a) => KEY_ACTIVITY_ACTIONS.has(a.action));

  return {
    project, completion, members, tasks: annotatedTasks, timeEntries, expenses, materials, activity: keyActivity,
  };
}

function timeByTech(timeEntries) {
  const map = new Map();
  timeEntries.forEach((e) => {
    const user = e.loggedFor;
    const key = user ? user.id : 'unknown';
    if (!map.has(key)) map.set(key, { user, entries: [], seconds: 0, cost: 0 });
    const bucket = map.get(key);
    bucket.entries.push(e);
    bucket.seconds += e.durationSeconds || 0;
    bucket.cost += e.laborCost != null ? Number(e.laborCost) : 0;
  });
  return [...map.values()].sort((a, b) => (a.user?.displayName || '').localeCompare(b.user?.displayName || ''));
}

async function renderProjectReportPdf(doc, data) {
  const { project, completion, members, tasks, timeEntries, expenses, materials, activity } = data;

  await drawHeader(doc, 'Project Report');

  sectionTitle(doc, `${project.projectCode} — ${project.name}`);
  fieldGrid(doc, [
    ['Status', project.status],
    ['Owned by department', project.ownerDepartment?.name || '—'],
    ['For department', project.forDepartment?.name || '—'],
    ['Project lead', project.lead?.displayName || 'Unassigned'],
    ['Start date', fmtDate(project.createdAt)],
    ['Due date', fmtDate(project.dueDate)],
    ['Closed', project.closedAt ? fmtDate(project.closedAt) : 'Still open'],
    ['Completion', `${completion.percent}% (${completion.closedTasks}/${completion.totalTasks} tasks)`],
    ['Tags', Array.isArray(project.tags) && project.tags.length ? project.tags.join(', ') : '—'],
  ]);

  sectionTitle(doc, 'Description');
  paragraph(doc, project.description);

  sectionTitle(doc, 'Team');
  const teamByTech = timeByTech(timeEntries);
  const timeByUserId = new Map(teamByTech.map((t) => [t.user?.id, t]));
  table(doc, [
    { key: 'name', label: 'Name', width: 180, render: (m) => m.user?.displayName || 'Unknown' },
    { key: 'role', label: 'Role', width: 90, render: (m) => (m.role === 'lead' ? 'Lead' : 'Member') },
    { key: 'hours', label: 'Total hours', width: 121, align: 'right', render: (m) => fmtDuration(timeByUserId.get(m.userId)?.seconds || 0) },
    { key: 'cost', label: 'Labor cost', width: 121, align: 'right', render: (m) => (timeByUserId.get(m.userId)?.cost ? fmtCost(timeByUserId.get(m.userId).cost) : '—') },
  ], members);

  sectionTitle(doc, 'Tasks');
  renderTasks(doc, tasks);

  sectionTitle(doc, 'Time entries');
  renderTimeEntries(doc, teamByTech);

  sectionTitle(doc, 'Expenses');
  table(doc, [
    { key: 'description', label: 'Description', width: 160, render: (e) => e.description },
    { key: 'category', label: 'Category', width: 80, render: (e) => e.category },
    { key: 'date', label: 'Date', width: 75, render: (e) => e.entryDate || '' },
    { key: 'loggedBy', label: 'Logged by', width: 100, render: (e) => e.loggedByUser?.displayName || 'Unknown' },
    { key: 'amount', label: 'Amount', width: 97, align: 'right', render: (e) => fmtCost(e.amount) },
  ], expenses);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  ensureSpace(doc, 14);
  doc.fontSize(9).fillColor(TEXT).text(`Total expenses: ${fmtCost(totalExpenses)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 12, ellipsis: true });
  doc.y += 12;
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);

  sectionTitle(doc, 'Materials');
  table(doc, [
    { key: 'itemName', label: 'Item', width: 120, render: (m) => m.itemName },
    { key: 'vendor', label: 'Vendor', width: 85, render: (m) => m.vendor || '—' },
    { key: 'modelNumber', label: 'Model', width: 75, render: (m) => m.modelNumber || '—' },
    { key: 'serials', label: 'Serial #s', width: 90, render: (m) => (Array.isArray(m.serialNumber) && m.serialNumber.length ? m.serialNumber.join(', ') : '—') },
    { key: 'quantity', label: 'Qty', width: 35, align: 'right', render: (m) => m.quantity },
    { key: 'unitCost', label: 'Unit cost', width: 55, align: 'right', render: (m) => fmtCost(m.unitCost) },
    { key: 'totalCost', label: 'Total', width: 52, align: 'right', render: (m) => fmtCost(m.totalCost) },
  ], materials);
  const totalMaterials = materials.reduce((sum, m) => sum + Number(m.totalCost || 0), 0);
  ensureSpace(doc, 14);
  doc.fontSize(9).fillColor(TEXT).text(`Total materials: ${fmtCost(totalMaterials)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 12, ellipsis: true });
  doc.y += 12;
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);

  const totalLaborCost = timeEntries.reduce((sum, e) => sum + (e.laborCost != null ? Number(e.laborCost) : 0), 0);
  const grandTotal = totalLaborCost + totalExpenses + totalMaterials;
  sectionTitle(doc, 'Cost summary');
  fieldGrid(doc, [
    ['Labor cost (contractor time)', fmtCost(totalLaborCost)],
    ['Expenses total', fmtCost(totalExpenses)],
    ['Materials total', fmtCost(totalMaterials)],
    ['Grand total project cost', fmtCost(grandTotal)],
  ]);

  sectionTitle(doc, 'Activity log');
  table(doc, [
    { key: 'date', label: 'Date', width: 100, render: (a) => fmtDateTime(a.createdAt) },
    { key: 'user', label: 'User', width: 110, render: (a) => a.user?.displayName || 'System' },
    { key: 'event', label: 'Event', width: 302, render: (a) => describeActivity(a) },
  ], activity);
}

function renderTasks(doc, tasks) {
  if (!tasks.length) {
    ensureSpace(doc, 18);
    doc.fontSize(9).fillColor(MUTED).text('No tasks.', PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 12 });
    doc.y += 18;
    doc.x = PAGE_MARGIN;
    return;
  }
  tasks.forEach((t) => {
    ensureSpace(doc, 16);
    doc.fontSize(8.5).fillColor(TEXT).text(
      `${t.taskCode}  ${t.title}  —  ${t.status?.name || 'No status'}  —  ${t.assignee?.displayName || 'Unassigned'}  —  Due ${fmtDate(t.dueDate)}  —  ${t.subtaskPercent}% complete`,
      PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 12, ellipsis: true },
    );
    doc.y += 15;
    (t.subtasks || []).forEach((s) => {
      ensureSpace(doc, 14);
      doc.fontSize(8).fillColor(MUTED).text(
        `    ${s.subtaskCode}  ${s.title}  —  ${s.status?.name || 'No status'}  —  ${s.assignee?.displayName || 'Unassigned'}  —  Due ${fmtDate(s.dueDate)}`,
        PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 11, ellipsis: true },
      );
      doc.y += 13;
    });
  });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);
  doc.fillColor(TEXT);
}

function renderTimeEntries(doc, teamByTech) {
  if (!teamByTech.length) {
    ensureSpace(doc, 18);
    doc.fontSize(9).fillColor(MUTED).text('No time logged.', PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 12 });
    doc.y += 18;
    doc.x = PAGE_MARGIN;
    return;
  }
  let totalSeconds = 0;
  let contractorSeconds = 0;
  let totalCost = 0;
  teamByTech.forEach((bucket) => {
    const isContractor = bucket.user?.userType === 'contractor';
    ensureSpace(doc, 16);
    doc.fontSize(9.5).fillColor(TEXT).text(
      `${bucket.user?.displayName || 'Unknown'} (${isContractor ? 'Contractor' : 'Internal'})`,
      PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, height: 12, ellipsis: true },
    );
    doc.y += 15;
    table(doc, [
      { key: 'date', label: 'Date', width: 75, render: (e) => e.entryDate || '' },
      { key: 'description', label: 'Description', width: hasAnyCost(bucket.entries) ? 267 : 337, render: (e) => e.description || '' },
      { key: 'duration', label: 'Duration', width: 85, align: 'right', render: (e) => fmtDuration(e.durationSeconds) },
      ...(hasAnyCost(bucket.entries) ? [{ key: 'cost', label: 'Cost', width: 85, align: 'right', render: (e) => (e.laborCost != null ? fmtCost(e.laborCost) : '—') }] : []),
    ], bucket.entries, { rowHeight: 16 });
    ensureSpace(doc, 13);
    doc.fontSize(8.5).fillColor(MUTED).text(
      `Subtotal: ${fmtDuration(bucket.seconds)}${bucket.cost ? ` — ${fmtCost(bucket.cost)}` : ''}`,
      PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 11, ellipsis: true },
    );
    doc.y += 16;
    doc.x = PAGE_MARGIN;
    totalSeconds += bucket.seconds;
    totalCost += bucket.cost;
    if (isContractor) contractorSeconds += bucket.seconds;
  });

  ensureSpace(doc, 40);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
  doc.y += 6;
  doc.fontSize(9).fillColor(TEXT).text(`Grand total: ${fmtDuration(totalSeconds)} — ${fmtCost(totalCost)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 12, ellipsis: true });
  doc.y += 13;
  doc.fontSize(8.5).fillColor(MUTED).text(
    `Internal: ${fmtDuration(totalSeconds - contractorSeconds)}   Contractor: ${fmtDuration(contractorSeconds)}`,
    PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 11, ellipsis: true },
  );
  doc.y += 14;
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);
}

function hasAnyCost(entries) {
  return entries.some((e) => e.laborCost != null);
}

function describeActivity(a) {
  const detail = a.detail || {};
  switch (a.action) {
    case 'project_created': return 'Project created';
    case 'status_changed': return `Status changed: ${detail.from || '—'} → ${detail.to || '—'}`;
    case 'member_added': return `Member added: ${detail.displayName || detail.userName || 'Unknown'}`;
    case 'task_created': return `Task created: ${detail.title || ''}`;
    case 'task_closed': return `Task closed: ${detail.title || ''}`;
    default: return a.action;
  }
}

async function generateProjectReport(projectId, res) {
  const data = await loadProjectReportData(projectId);
  if (!data) return false;
  const filename = `project-[${data.project.projectCode}]-report.pdf`;
  const doc = newDocument();
  await streamPdfResponse(res, filename, doc, (d) => renderProjectReportPdf(d, data));
  return true;
}

module.exports = { generateProjectReport, loadProjectReportData };
