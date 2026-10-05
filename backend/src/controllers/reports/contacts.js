// Contacts report.
const { Op } = require('sequelize');
const { Ticket, Department, Contact } = require('../../models');
const { asyncHandler } = require('../../middleware/error');
const { getUserReportScope } = require('../../services/permissionService');
const { companyFilterWhere } = require('../../services/recordScope');
const { getTicketStatusBuckets } = require('../../services/statusBehavior');
const {
  parseDateRange,
  dateWhere,
  parseDepartmentId,
  granularityFor,
  bucketKey,
  contactDeptWhere,
  sendCsv,
  hoursBetween,
} = require('./shared');

// ==================== Report 7: Contacts ====================

async function buildContactsReport(req) {
  const scope = await getUserReportScope(req.user.id);
  const range = parseDateRange(req.query);
  const deptId = parseDepartmentId(req.query);

  const contactWhere = contactDeptWhere({}, scope, req.user, deptId, await companyFilterWhere(req.user, req.query.companyId));
  const contacts = await Contact.findAll({
    where: contactWhere,
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const contactIds = contacts.map((c) => c.id);

  const buckets = await getTicketStatusBuckets();
  const tickets = contactIds.length
    ? await Ticket.findAll({
        where: { contactId: { [Op.in]: contactIds }, ...dateWhere('createdAt', range) },
        attributes: ['id', 'contactId', 'status', 'createdAt', 'resolvedAt'],
      })
    : [];

  const ticketsByContact = new Map();
  tickets.forEach((t) => {
    const cur = ticketsByContact.get(t.contactId) || [];
    cur.push(t);
    ticketsByContact.set(t.contactId, cur);
  });

  const contactsWithOpenTickets = contacts.filter((c) => (ticketsByContact.get(c.id) || []).some((t) => buckets.open.includes(t.status))).length;

  let mostActiveContact = null;
  contacts.forEach((c) => {
    const count = (ticketsByContact.get(c.id) || []).length;
    if (!mostActiveContact || count > mostActiveContact.count) mostActiveContact = { name: c.displayName, count };
  });

  const deptStats = new Map();
  contacts.forEach((c) => {
    const key = c.departmentId || 'none';
    const label = c.department?.name || 'No department';
    const cur = deptStats.get(key) || { name: label, totalContacts: 0, totalTickets: 0, openTickets: 0, closedTickets: 0, resolutionHoursSum: 0, resolutionCount: 0 };
    cur.totalContacts += 1;
    (ticketsByContact.get(c.id) || []).forEach((t) => {
      cur.totalTickets += 1;
      if (buckets.open.includes(t.status)) cur.openTickets += 1;
      if (t.resolvedAt) {
        cur.closedTickets += 1;
        cur.resolutionHoursSum += hoursBetween(t.createdAt, t.resolvedAt);
        cur.resolutionCount += 1;
      }
    });
    deptStats.set(key, cur);
  });

  const deptRows = [...deptStats.values()]
    .map((d) => ({
      name: d.name, totalContacts: d.totalContacts, totalTickets: d.totalTickets, openTickets: d.openTickets, closedTickets: d.closedTickets,
      avgResolutionHours: d.resolutionCount ? Math.round((d.resolutionHoursSum / d.resolutionCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.totalTickets - a.totalTickets);

  const topContacts = contacts
    .map((c) => ({ name: c.displayName, count: (ticketsByContact.get(c.id) || []).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const granularity = granularityFor(range) === 'day' ? 'week' : granularityFor(range);
  const submissionsByDeptOverTime = new Map();
  tickets.forEach((t) => {
    const deptName = contactById.get(t.contactId)?.department?.name || 'No department';
    const bk = bucketKey(t.createdAt, granularity);
    const cur = submissionsByDeptOverTime.get(bk) || { date: bk };
    cur[deptName] = (cur[deptName] || 0) + 1;
    submissionsByDeptOverTime.set(bk, cur);
  });

  return {
    summary: {
      totalContacts: contacts.length,
      contactsWithOpenTickets,
      mostActiveContact: mostActiveContact?.name || null,
      departmentWithMostTickets: deptRows.length ? deptRows[0].name : null,
    },
    chartData: {
      byDepartment: deptRows.map((d) => ({ name: d.name, count: d.totalTickets })),
      topContacts,
      submissionsByDeptOverTime: [...submissionsByDeptOverTime.values()].sort((a, b) => a.date.localeCompare(b.date)),
    },
    tableData: {
      columns: [
        { key: 'name', label: 'Department' },
        { key: 'totalContacts', label: 'Contacts' },
        { key: 'totalTickets', label: 'Tickets' },
        { key: 'openTickets', label: 'Open' },
        { key: 'closedTickets', label: 'Closed' },
        { key: 'avgResolutionHours', label: 'Avg resolution (hrs)' },
      ],
      rows: deptRows,
    },
  };
}

const contactsReport = asyncHandler(async (req, res) => res.json(await buildContactsReport(req)));

const contactsReportExport = asyncHandler(async (req, res) => {
  const { tableData } = await buildContactsReport(req);
  sendCsv(res, 'contacts', tableData.columns, tableData.rows);
});

module.exports = {
  contactsReport,
  contactsReportExport,
};
