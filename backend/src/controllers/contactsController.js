const { Op, fn, col } = require('sequelize');
const { Contact, Ticket, Department, User, ContactActivity, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const {
  hasPermission, findAccessibleContact, canAccessContact, parseRecordId,
} = require('../services/permissionService');
const { getTicketStatusBuckets } = require('../services/statusBehavior');
const { andWhere, contactScopeWhere } = require('../services/recordScope');
const { getInternalCompanyId, findDepartmentInCompany } = require('../services/companyService');
const { logContactActivity } = require('../services/contactActivity');
const { normalizePhone } = require('../utils/phone');
const { parsePagination, paginated } = require('../utils/pagination');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const contactInclude = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'assignedToUser', attributes: userAttrs },
];
const ticketAttrs = ['id', 'title', 'status', 'priority', 'type', 'dueDate', 'resolvedAt', 'createdAt', 'updatedAt'];

// Chunk size for the "load more" lists on a contact's detail page.
const SUBLIST_LIMIT = 25;
// The detail-page lists grow by "load more", which asks for a larger single
// page rather than a second one — so their ceiling is higher than the shared
// 200 used for browsable tables.
const SUBLIST_MAX = 500;

const SORTABLE_COLUMNS = ['firstName', 'lastName', 'displayName', 'email', 'createdAt', 'updatedAt'];

// Builds the WHERE clause for a contact listing. Shared by the paginated
// list and the A-Z index so the index always describes the list it sits above.
// The caller's scope (recordScope.contactScopeWhere) is ANDed in last, so a
// filter can only narrow it — it used to be merged, which let ?departmentId=
// and ?noDept=true replace a department-scoped user's own department (S10).
async function buildContactListWhere(req) {
  const { search, departmentId, assignedTo, myContacts, noDept, status } = req.query;

  const where = {};
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
  return andWhere(where, await contactScopeWhere(req.user));
}

function contactOrder(req) {
  const orderColumn = SORTABLE_COLUMNS.includes(req.query.sortBy) ? req.query.sortBy : 'lastName';
  const orderDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';
  return { orderColumn, orderDir, order: [[orderColumn, orderDir], ['firstName', 'ASC'], ['id', 'ASC']] };
}

// GET /contacts — paginated
const list = asyncHandler(async (req, res) => {
  const where = await buildContactListWhere(req);
  const { page, limit, offset } = parsePagination(req);
  const { order } = contactOrder(req);

  // contactInclude is belongsTo-only, so a single findAndCountAll is safe
  // here — no hasMany join to multiply the count or eat into the LIMIT.
  const { rows, count } = await Contact.findAndCountAll({
    where,
    include: contactInclude,
    order,
    limit,
    offset,
    distinct: true,
  });

  const contactIds = rows.map((c) => c.id);
  const ticketStats = contactIds.length
    ? await Ticket.findAll({
        where: { contactId: { [Op.in]: contactIds } },
        attributes: ['contactId', [fn('COUNT', col('id')), 'count'], [fn('MAX', col('createdAt')), 'lastTicketAt']],
        group: ['contactId'],
        raw: true,
      })
    : [];
  const statsByContact = new Map(ticketStats.map((r) => [r.contactId, { count: Number(r.count) || 0, lastTicketAt: r.lastTicketAt }]));

  res.json(paginated(
    'contacts',
    {
      rows: rows.map((c) => ({
        ...c.toJSON(),
        ticketCount: statsByContact.get(c.id)?.count || 0,
        lastTicketAt: statsByContact.get(c.id)?.lastTicketAt || null,
      })),
      count,
    },
    { page, limit }
  ));
});

// GET /contacts/index — which page each letter of the alphabet starts on,
// for the A-Z jump strip.
//
// The strip used to scroll to a row index within the fully-loaded list. With
// one page in the browser at a time it has to resolve to a page number
// instead, which only the server can work out. Takes the same filters, sort
// and ?limit as the listing so the two always agree.
const alphaIndex = asyncHandler(async (req, res) => {
  const where = await buildContactListWhere(req);
  const { orderColumn, order } = contactOrder(req);
  const { limit } = parsePagination(req);

  // One indexed column, no joins — cheap enough to walk the whole matching
  // set, and there is no way to get a letter's ordinal position without it.
  const rows = await Contact.findAll({ where, attributes: ['id', orderColumn, 'firstName'], order, raw: true });

  const index = {};
  rows.forEach((row, i) => {
    const source = String(row[orderColumn] || row.firstName || '').trim();
    if (!source) return;
    const letter = source[0].toUpperCase();
    if (!/[A-Z]/.test(letter)) return;
    // First occurrence wins — that's where the jump should land.
    if (index[letter] === undefined) index[letter] = Math.floor(i / limit) + 1;
  });

  res.json({ index, total: rows.length, limit });
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
  // A contact's department belongs to the contact's company.
  const contactCompanyId = await getInternalCompanyId();
  let resolvedDepartmentId = null;
  if (departmentId) {
    const dept = await findDepartmentInCompany(departmentId, contactCompanyId);
    if (!dept) throw new ApiError(400, 'Department not found', 'VALIDATION_ERROR');
    resolvedDepartmentId = dept.id;
  }

  const contact = await Contact.create({
    firstName: first,
    lastName: last,
    displayName: (displayName && displayName.trim()) || `${first} ${last}`.trim(),
    email: email || null,
    phone: normalizePhone(phone),
    mobile: normalizePhone(mobile),
    companyId: contactCompanyId,
    departmentId: resolvedDepartmentId,
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
  if (!(await canAccessContact(req.user, contact))) {
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
  if (!(await canAccessContact(req.user, contact))) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

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

  if (changes.departmentId) {
    const dept = await findDepartmentInCompany(changes.departmentId, contact.companyId);
    if (!dept) throw new ApiError(400, 'Department not found', 'VALIDATION_ERROR');
    changes.departmentId = dept.id;
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
  // This also moves every ticket the contact owns into the department, so it
  // decides who can see those tickets: the caller must be able to see the
  // contact (missing and out-of-scope look the same), and a caller without
  // people.view_all may only assign their own department — otherwise a
  // department-scoped user could pull another department's tickets into view.
  const contact = await findAccessibleContact(req.user, req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');

  const { departmentId: rawDepartmentId } = req.body || {};
  if (!rawDepartmentId) {
    throw new ApiError(400, 'departmentId is required', 'VALIDATION_ERROR');
  }
  const dept = await Department.findByPk(parseRecordId(rawDepartmentId) || 0);
  if (!dept) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');
  // The department must be one of the contact's own company's.
  if (dept.companyId !== contact.companyId) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');
  const departmentId = dept.id;
  if (departmentId !== req.user.departmentId && !(await hasPermission(req.user.id, 'people.view_all'))) {
    throw new ApiError(403, 'You can only assign contacts to your own department', 'FORBIDDEN');
  }

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
  if (!(await canAccessContact(req.user, contact))) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

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
  if (!(await canAccessContact(req.user, contact))) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await Ticket.findAndCountAll({
    where: { contactId: contact.id },
    include: [{ model: User, as: 'assignee', attributes: userAttrs }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  res.json(paginated('tickets', { rows, count }, { page, limit }));
});

// GET /contacts/:id/activity
const listActivity = asyncHandler(async (req, res) => {
  const contact = await Contact.findByPk(req.params.id);
  if (!contact) throw new ApiError(404, 'Contact not found', 'NOT_FOUND');
  if (!(await canAccessContact(req.user, contact))) {
    throw new ApiError(403, 'You do not have access to this contact', 'FORBIDDEN');
  }

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await ContactActivity.findAndCountAll({
    where: { contactId: contact.id },
    include: [{ model: User, as: 'user', attributes: userAttrs }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  res.json(paginated('activity', { rows, count }, { page, limit }));
});

module.exports = {
  list,
  alphaIndex,
  create,
  get,
  update,
  assignDepartment,
  remove,
  listTickets,
  listActivity,
};
