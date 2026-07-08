const {
  Ticket, Comment, Attachment, TimeEntry, TicketActivity, User, Contact, Project, Department,
} = require('../models');
const { Op } = require('sequelize');
const {
  newDocument, drawHeader, sectionTitle, fieldGrid, paragraph, table, streamPdfResponse, ensureSpace,
  MUTED, TEXT, CONTENT_WIDTH, PAGE_MARGIN,
} = require('./pdfReport');

const userAttrs = ['id', 'displayName', 'username', 'email'];

// Field-change activity rows use the changed field's name as `action`
// (see ticketsController.update's TRACKED_ACTIVITY_FIELDS loop) — "key
// events" for the report are creation, status changes (which cover
// closing), and reassignment, not every tracked field.
const KEY_ACTIVITY_ACTIONS = new Set(['created', 'status', 'assigneeId']);

function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : '—';
}

function fmtDuration(seconds) {
  const s = Number(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtCost(n) {
  return n === null || n === undefined ? '' : `$${Number(n).toFixed(2)}`;
}

function fmtBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadTicketReportData(ticketId) {
  const ticket = await Ticket.findByPk(ticketId, {
    include: [
      { model: User, as: 'assignee', attributes: userAttrs },
      {
        model: Contact, as: 'contact', attributes: ['id', 'displayName', 'email'],
        include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      },
      { model: Project, as: 'project', attributes: ['id', 'name'] },
      { model: Department, as: 'department', attributes: ['id', 'name'] },
    ],
  });
  if (!ticket) return null;

  // Report always excludes private comments regardless of viewer
  // permission — "no private comments in the report" per spec, independent
  // of what the generating user could otherwise see on-screen.
  const [comments, timeEntries, attachments, activity] = await Promise.all([
    Comment.findAll({
      where: { ticketId, type: { [Op.ne]: 'comment_private' } },
      include: [{ model: User, as: 'author', attributes: userAttrs }],
      order: [['createdAt', 'ASC']],
    }),
    TimeEntry.findAll({
      where: { ticketId },
      include: [{ model: User, as: 'user', attributes: userAttrs }],
      order: [['entryDate', 'ASC'], ['loggedAt', 'ASC']],
    }),
    Attachment.findAll({ where: { ticketId }, order: [['createdAt', 'ASC']] }),
    TicketActivity.findAll({
      where: { ticketId, action: { [Op.in]: [...KEY_ACTIVITY_ACTIONS] } },
      include: [{ model: User, as: 'user', attributes: userAttrs }],
      order: [['createdAt', 'ASC']],
    }),
  ]);

  return {
    ticket, comments, timeEntries, attachments, activity,
  };
}

async function renderTicketReportPdf(doc, data) {
  const { ticket, comments, timeEntries, attachments, activity } = data;
  const ticketNumber = `#${String(ticket.id).padStart(5, '0')}`;

  await drawHeader(doc, 'Ticket Report');

  sectionTitle(doc, `${ticketNumber} — ${ticket.title}`);
  const totalOpenMs = (ticket.resolvedAt ? new Date(ticket.resolvedAt) : new Date()) - new Date(ticket.createdAt);
  const totalOpenHours = Math.max(0, totalOpenMs / 3600000);
  fieldGrid(doc, [
    ['Status', ticket.status],
    ['Priority', ticket.priority],
    ['Type', ticket.type],
    ['Contact', ticket.contact?.displayName || '—'],
    ['Contact department', ticket.contact?.department?.name || '—'],
    ['Assignee', ticket.assignee?.displayName || 'Unassigned'],
    ['Created', fmtDate(ticket.createdAt)],
    ['Closed', ticket.resolvedAt ? fmtDate(ticket.resolvedAt) : 'Still open'],
    ['Total time open', `${totalOpenHours.toFixed(1)}h`],
    ['Tags', Array.isArray(ticket.tags) && ticket.tags.length ? ticket.tags.join(', ') : '—'],
  ]);

  sectionTitle(doc, 'Description');
  paragraph(doc, ticket.description);

  if (ticket.resolution) {
    sectionTitle(doc, 'Resolution');
    paragraph(doc, ticket.resolution);
  }

  sectionTitle(doc, 'Conversation');
  if (!comments.length) {
    paragraph(doc, 'No replies or public comments.');
  } else {
    comments.forEach((c) => {
      const label = c.type === 'comment_public' ? 'Internal note (visible to customer)' : 'Reply';
      paragraph(doc, `${c.author?.displayName || 'Unknown'} — ${label} — ${fmtDate(c.createdAt)}`, { fontSize: 8 });
      paragraph(doc, c.body);
    });
  }

  sectionTitle(doc, 'Time entries');
  const hasCost = timeEntries.some((e) => e.laborCost != null);
  table(doc, [
    { key: 'tech', label: 'Tech', width: 110, render: (e) => e.user?.displayName || 'Unknown' },
    { key: 'date', label: 'Date', width: 75, render: (e) => e.entryDate || '' },
    { key: 'note', label: 'Description', width: hasCost ? 187 : 247, render: (e) => e.note || '' },
    { key: 'duration', label: 'Duration', width: 70, render: (e) => fmtDuration(e.durationSeconds != null ? e.durationSeconds : (e.minutes || 0) * 60), align: 'right' },
    ...(hasCost ? [{ key: 'cost', label: 'Cost', width: 70, render: (e) => fmtCost(e.laborCost), align: 'right' }] : []),
  ], timeEntries);

  const totalSeconds = timeEntries.reduce((sum, e) => sum + (e.durationSeconds != null ? e.durationSeconds : (e.minutes || 0) * 60), 0);
  const totalCost = timeEntries.reduce((sum, e) => sum + (e.laborCost != null ? Number(e.laborCost) : 0), 0);
  ensureSpace(doc, 26);
  doc.fontSize(9).fillColor(TEXT).text(`Total time: ${fmtDuration(totalSeconds)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 12, ellipsis: true });
  doc.y += 12;
  if (hasCost) {
    doc.fontSize(9).fillColor(TEXT).text(`Total labor cost: ${fmtCost(totalCost)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right', height: 12, ellipsis: true });
    doc.y += 12;
  }
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;

  sectionTitle(doc, 'Attachments');
  table(doc, [
    { key: 'filename', label: 'Filename', width: 350, render: (a) => a.originalName || a.filename },
    { key: 'size', label: 'Size', width: 162, render: (a) => fmtBytes(a.size), align: 'right' },
  ], attachments);

  sectionTitle(doc, 'Activity log');
  table(doc, [
    { key: 'date', label: 'Date', width: 100, render: (a) => fmtDate(a.createdAt) },
    { key: 'user', label: 'User', width: 110, render: (a) => a.user?.displayName || 'System' },
    { key: 'event', label: 'Event', width: 302, render: (a) => describeActivity(a) },
  ], activity);
}

function describeActivity(a) {
  if (a.action === 'created') return 'Ticket created';
  if (a.action === 'assigneeId') return `Assignee changed: ${a.fromValue || 'Unassigned'} → ${a.toValue || 'Unassigned'}`;
  if (a.action === 'status') return `Status changed: ${a.fromValue || '—'} → ${a.toValue || '—'}`;
  return `${a.action}: ${a.fromValue || '—'} → ${a.toValue || '—'}`;
}

// GET /tickets/:id/report — streams a PDF directly to the response.
async function generateTicketReport(ticketId, res) {
  const data = await loadTicketReportData(ticketId);
  if (!data) return false;
  const filename = `ticket-#${String(data.ticket.id).padStart(5, '0')}-report.pdf`;
  const doc = newDocument();
  await streamPdfResponse(res, filename, doc, (d) => renderTicketReportPdf(d, data));
  return true;
}

module.exports = { generateTicketReport, loadTicketReportData };
