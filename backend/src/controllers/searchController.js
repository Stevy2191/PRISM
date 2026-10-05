const { Op } = require('sequelize');
const { Ticket, Project, Contact } = require('../models');
const { asyncHandler } = require('../middleware/error');
const { hasPermission } = require('../services/permissionService');
const {
  andWhere, ticketScopeWhere, projectScopeWhere, contactScopeWhere,
} = require('../services/recordScope');

const RESULT_LIMIT = 5;

// GET /search?q= — combined lookup across tickets, projects, contacts for the
// global search overlay. Each domain reuses that domain's own scope rules so
// results never leak beyond what the caller could already see on that list page.
const search = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tickets: [], projects: [], contacts: [] });

  const numericId = /^\d+$/.test(q) ? parseInt(q, 10) : null;

  // Each domain reuses the shared list scope (company fence + tier), so
  // results never leak beyond what the caller could see on that list page.
  const [ticketWhere, projectWhere, contactScope, canViewAllContacts, canViewOwnDeptContacts] = await Promise.all([
    ticketScopeWhere(req.user),
    projectScopeWhere(req.user),
    contactScopeWhere(req.user),
    hasPermission(req.user.id, 'people.view_all'),
    hasPermission(req.user.id, 'people.view_own_department'),
  ]);
  const canViewContacts = canViewAllContacts || canViewOwnDeptContacts;

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
      where: andWhere(ticketWhere, { [Op.or]: ticketOr }),
      attributes: ['id', 'title', 'status', 'priority'],
      order: [['updatedAt', 'DESC']],
      limit: RESULT_LIMIT,
    }),
    Project.findAll({
      where: andWhere(projectWhere, { [Op.or]: projectOr }),
      attributes: ['id', 'name', 'projectCode', 'status'],
      order: [['updatedAt', 'DESC']],
      limit: RESULT_LIMIT,
    }),
    canViewContacts
      ? Contact.findAll({
          where: andWhere(contactScope, { [Op.or]: contactOr }),
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
