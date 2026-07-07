const { Op } = require('sequelize');
const { Ticket, Project, Contact, ProjectMember } = require('../models');
const { asyncHandler } = require('../middleware/error');
const { getUserTicketScope, getUserProjectScope, hasPermission } = require('../services/permissionService');

const RESULT_LIMIT = 5;

// Mirrors ticketsController.list's scope rules, trimmed to what search needs.
async function ticketScopeWhere(user) {
  const scope = await getUserTicketScope(user.id);
  if (scope === 'department') return { [Op.or]: [{ departmentId: user.departmentId }, { assigneeId: user.id }] };
  if (scope === 'own') return { assigneeId: user.id };
  return {};
}

// Mirrors projectsController.list's scope rules, trimmed to what search needs.
async function projectScopeWhere(user) {
  const scope = await getUserProjectScope(user.id);
  if (scope === 'all') return {};
  const memberships = await ProjectMember.findAll({ where: { userId: user.id }, attributes: ['projectId'], raw: true });
  const memberProjectIds = memberships.map((m) => m.projectId);
  if (scope === 'department') {
    const or = [{ ownerDepartmentId: user.departmentId }, { forDepartmentId: user.departmentId }];
    if (memberProjectIds.length) or.push({ id: { [Op.in]: memberProjectIds } });
    return { [Op.or]: or };
  }
  return memberProjectIds.length ? { id: { [Op.in]: memberProjectIds } } : { id: -1 };
}

// GET /search?q= — combined lookup across tickets, projects, contacts for the
// global search overlay. Each domain reuses that domain's own scope rules so
// results never leak beyond what the caller could already see on that list page.
const search = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tickets: [], projects: [], contacts: [] });

  const numericId = /^\d+$/.test(q) ? parseInt(q, 10) : null;

  const [ticketWhere, projectWhere, canViewAllContacts, canViewOwnDeptContacts] = await Promise.all([
    ticketScopeWhere(req.user),
    projectScopeWhere(req.user),
    hasPermission(req.user.id, 'people.view_all'),
    hasPermission(req.user.id, 'people.view_own_department'),
  ]);
  const canViewContacts = canViewAllContacts || canViewOwnDeptContacts;
  const contactScope = canViewAllContacts ? {} : { departmentId: req.user.departmentId };

  const ticketOr = [{ title: { [Op.like]: `%${q}%` } }];
  if (numericId !== null) ticketOr.push({ id: numericId });

  const projectOr = [
    { name: { [Op.like]: `%${q}%` } },
    { projectCode: { [Op.like]: `%${q}%` } },
  ];

  const contactOr = [
    { displayName: { [Op.like]: `%${q}%` } },
    { email: { [Op.like]: `%${q}%` } },
  ];

  const [tickets, projects, contacts] = await Promise.all([
    Ticket.findAll({
      where: { ...ticketWhere, [Op.or]: ticketOr },
      attributes: ['id', 'title', 'status', 'priority'],
      order: [['updatedAt', 'DESC']],
      limit: RESULT_LIMIT,
    }),
    Project.findAll({
      where: { ...projectWhere, [Op.or]: projectOr },
      attributes: ['id', 'name', 'projectCode', 'status'],
      order: [['updatedAt', 'DESC']],
      limit: RESULT_LIMIT,
    }),
    canViewContacts
      ? Contact.findAll({
          where: { ...contactScope, [Op.or]: contactOr },
          attributes: ['id', 'displayName', 'email'],
          order: [['updatedAt', 'DESC']],
          limit: RESULT_LIMIT,
        })
      : [],
  ]);

  res.json({
    tickets: tickets.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, projectCode: p.projectCode, status: p.status })),
    contacts: contacts.map((c) => ({ id: c.id, displayName: c.displayName, email: c.email })),
  });
});

module.exports = { search };
