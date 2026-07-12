const { Op, fn, col } = require('sequelize');
const { Contact, Ticket, Department, User, ContactActivity, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission } = require('../services/permissionService');
const { getTicketStatusBuckets } = require('../services/statusBehavior');
const { logContactActivity } = require('../services/contactActivity');
const { normalizePhone } = require('../utils/phone');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const contactInclude = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'assignedToUser', attributes: userAttrs },
];
const ticketAttrs = ['id', 'title', 'status', 'priority', 'type', 'dueDate', 'resolvedAt', 'createdAt', 'updatedAt'];

// Department-scoped unless the caller holds people.view_all (mirrors
// usersController.list's exact pattern).
async function scopeWhere(req) {
  const canViewAll = await hasPermission(req.user.id, 'people.view_all');
  return canViewAll ? {} : { departmentId: req.user.departmentId };
}

const SORTABLE_COLUMNS = ['firstName', 'lastName', 'displayName', 'email', 'createdAt', 'updatedAt'];

// GET /contacts
const list = asyncHandler(async (req, res) => {
  const {
    search, departmentId, assignedTo, myContacts, noDept, sortBy, sortDir, status,
  } = req.query;

  const where = await scopeWhere(req);
  if (departmentId) where.departmentId = departmentId;
  if (noDept === 'true') where.departmentId = null;
  if (assignedTo) where.assignedTo = assignedTo;
  if (myContacts === 'true') where.assignedTo = req.user.id;
  if (status === 'active' || status === 'inactive') where.status = status;

  if (search && search.trim()) {
    const term = search.trim();
    where[Op.or] = [
      { displayName: { [Op.like]: `%${term}%` } },
      { firstName: { [Op.like]: `%${term}%` } },
      { lastName: { [Op.like]: `%${term}%` } },
      { email: { [Op.like]: `%${term}%` } },
      { phone: { [Op.like]: `%${term}%` } },
      { mobile: { [Op.like]: `%${term}%` } },
    ];
  }

  const orderColumn = SORTABLE_COLUMNS.includes(sortBy) ? sortBy : 'lastName';
  const orderDir = sortDir === 'desc' ? 'DESC' : 'ASC';

  const contacts = await Contact.findAll({
    where,
    include: contactInclude,
    order: [[orderColumn, orderDir], ['firstName', 'ASC']],
  });

  const contactIds = contacts.map((c) => c.id);
  const ticketStats = contactIds.length
    ? await Ticket.findAll({
        where: { contactId: { [Op.in]: contactIds } },
        attributes: ['contactId', [fn('COUNT', col('id')), 'count'], [fn('MAX', col('createdAt')), 'lastTicketAt']],
        group: ['contactId'],
        raw: true,
      })
    : [];
  const statsByContact = new Map(ticketStats.map((r) => [r.contactId, { count: Number(r.count) || 0, lastTicketAt: r.lastTicketAt }]));

  res.json({
    contacts: contacts.map((c) => ({
      ...c.toJSON(),
      ticketCount: statsByContact.get(c.id)?.count || 0,
      lastTicketAt: statsByContact.get(c.id)?.lastTicketAt || null,
    })),
  });
});

// POST /contacts
const create = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, mobile, departmentId, jobTitle, assignedTo, notes, displayName } = req.body || {};
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  if (!first && !last) {
    throw new ApiError(400, 'First or last name is required', 'VALIDATION_ERROR');
  }
  if (email) {
    const existing = await Contact.findOne({ where: { email } });
    if (existing) throw new ApiError(409, 'A contact with this email already exists', 'EMAIL_TAKEN');
  }

  const contact = await Contact.create({
    firstName: first,
    lastName: last,
    displayName: (displayName && displayName.trim()) || `${first} ${last}`.trim(),
    email: email || null,
    phone: normalizePhone(phone),
    mobile: normalizePhone(mobile),
    departmentId: departmentId || null,
    jobTitle: jobTitle || null,
    notes: notes || null,
    assignedTo: assignedTo || req.user.id,
    createdBy: req.user.id,
  });
  await writeAudit(req, 'contact.create', 'Contact', contact.id, { displayName: contact.displayName });
  await logContactActivity(contact.id, req.user.id, 'created', { displayName: contact.displayName });

  const fresh = await Contact.findByPk(contact.id, { include: contactInclude });
  res.status(201).json({ contact: fresh });
});

// GET /contacts/:id — includes stats + recent tickets for the Overview tab.
const get = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id, { include: contactInclude });
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
  // Route-level viewMin only checked "has EITHER view tier" — a
  // department-scoped user could otherwise read any contact by id.
  const canViewAll = await hasPermission(req.user.id, 'people.view_all');
  if (!canViewAll && contact.departmentId !== req.user.departmentId) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

  const buckets = await getTicketStatusBuckets();
  const [totalTickets, openTickets, overdueTickets, resolvedTickets, recentTickets] = await Promise.all([
    Ticket.count({ where: { contactId: contact.id } }),
    Ticket.count({ where: { contactId: contact.id, status: { [Op.in]: buckets.open } } }),
    Ticket.count({
      where: {
        contactId: contact.id,
        status: { [Op.in]: buckets.open },
        dueDate: { [Op.lt]: new Date().toISOString().slice(0, 10) },
      },
    }),
    Ticket.findAll({
      where: { contactId: contact.id, resolvedAt: { [Op.ne]: null } },
      attributes: ['createdAt', 'resolvedAt'],
      raw: true,
    }),
    Ticket.findAll({
      where: { contactId: contact.id },
      attributes: ticketAttrs,
      include: [{ model: User, as: 'assignee', attributes: userAttrs }],
      order: [['createdAt', 'DESC']],
      limit: 5,
    }),
  ]);

  let avgResolutionHours = null;
  if (resolvedTickets.length) {
    const totalHours = resolvedTickets.reduce((sum, t) => {
      const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
      return sum + ms / (1000 * 60 * 60);
    }, 0);
    avgResolutionHours = totalHours / resolvedTickets.length;
  }

  res.json({
    contact,
    stats: { totalTickets, openTickets, overdueTickets, avgResolutionHours },
    recentTickets,
  });
});

// PATCH /contacts/:id
const update = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');

  const allowed = ['firstName', 'lastName', 'displayName', 'email', 'phone', 'mobile', 'departmentId', 'jobTitle', 'assignedTo', 'notes'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key] === '' ? null : req.body[key];
  }
  if (changes.phone !== undefined) changes.phone = normalizePhone(changes.phone);
  if (changes.mobile !== undefined) changes.mobile = normalizePhone(changes.mobile);
  if (changes.email) {
    const existing = await Contact.findOne({ where: { email: changes.email, id: { [Op.ne]: contact.id } } });
    if (existing) throw new ApiError(409, 'A contact with this email already exists', 'EMAIL_TAKEN');
  }

  const previousDepartmentId = contact.departmentId;
  await contact.update(changes);
  await writeAudit(req, 'contact.update', 'Contact', contact.id, changes);

  if (changes.departmentId !== undefined && changes.departmentId !== previousDepartmentId) {
    const dept = changes.departmentId ? await Department.findByPk(changes.departmentId) : null;
    await logContactActivity(contact.id, req.user.id, 'department_assigned', { departmentName: dept?.name || null });
  } else {
    await logContactActivity(contact.id, req.user.id, 'updated', { fields: Object.keys(changes) });
  }

  const fresh = await Contact.findByPk(contact.id, { include: contactInclude });
  res.json({ contact: fresh });
});

// PATCH /contacts/:id/department { departmentId } — assigns a department and
// retroactively updates every existing ticket for this contact to match, so
// their history stays consistent. Powers the inline "no department" prompt.
const assignDepartment = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');

  const { departmentId } = req.body || {};
  if (!departmentId) {
    throw new ApiError(400, 'departmentId is required', 'VALIDATION_ERROR');
  }
  const dept = await Department.findByPk(departmentId);
  if (!dept) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');

  const ticketCount = await sequelize.transaction(async (t) => {
    await contact.update({ departmentId }, { transaction: t });
    const [affected] = await Ticket.update(
      { departmentId },
      { where: { contactId: contact.id }, transaction: t }
    );
    return affected;
  });

  await writeAudit(req, 'contact.assign_department', 'Contact', contact.id, { departmentId, ticketCount });
  await logContactActivity(contact.id, req.user.id, 'department_assigned', { departmentName: dept.name, ticketsUpdated: ticketCount });

  const fresh = await Contact.findByPk(contact.id, { include: contactInclude });
  res.json({ contact: fresh, ticketsUpdated: ticketCount });
});

// DELETE /contacts/:id — warns (409) if the contact has open tickets unless
// ?force=true is passed, so the frontend can confirm before retrying.
const remove = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');

  if (req.query.force !== 'true') {
    const buckets = await getTicketStatusBuckets();
    const openCount = await Ticket.count({ where: { contactId: contact.id, status: { [Op.in]: buckets.open } } });
    if (openCount > 0) {
      throw new ApiError(
        409,
        `${contact.displayName} has ${openCount} open ticket${openCount === 1 ? '' : 's'}. Delete anyway?`,
        'HAS_OPEN_TICKETS'
      );
    }
  }

  // Historical tickets are kept (never cascade-deleted) but must not be left
  // pointing at a contact id that no longer exists.
  await sequelize.transaction(async (t) => {
    await Ticket.update({ contactId: null }, { where: { contactId: contact.id }, transaction: t });
    await contact.destroy({ transaction: t });
  });
  await writeAudit(req, 'contact.delete', 'Contact', contact.id, { displayName: contact.displayName });
  res.json({ ok: true });
});

// GET /contacts/:id/tickets
const listTickets = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
  const canViewAllContacts = await hasPermission(req.user.id, 'people.view_all');
  if (!canViewAllContacts && contact.departmentId !== req.user.departmentId) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

  const tickets = await Ticket.findAll({
    where: { contactId: contact.id },
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ tickets });
});

// GET /contacts/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
  const canViewAllContacts = await hasPermission(req.user.id, 'people.view_all');
  if (!canViewAllContacts && contact.departmentId !== req.user.departmentId) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

  const activity = await ContactActivity.findAll({
    where: { contactId: contact.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ activity });
});

module.exports = {
  list,
  create,
  get,
  update,
  assignDepartment,
  remove,
  listTickets,
  listActivity,
};
