// Canned responses (service desk 5b): reusable plain-text replies.
//
// Visibility (user decisions 2026-10-15): a personal response is private to
// its owner — admins included; a team response is seen by the team's
// members; an everyone response by all staff. Team and everyone responses
// are created and changed only with tickets.canned.manage, whose holders
// also see every shared one in Settings (?manage=1). A response someone can't
// see gets the same 404 as one that doesn't exist.
const { Op } = require('sequelize');
const { CannedResponse, Team, Ticket } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission, parseRecordId, findAccessibleTicket } = require('../services/permissionService');
const { myTeamIds } = require('../services/tickets/queue');
const { renderPlainText, branding } = require('../services/email/templates');
const { ticketContext } = require('../services/email/ticketMail');

const VISIBILITIES = ['personal', 'team', 'everyone'];
const PLACEHOLDERS = [
  'ticket.number', 'ticket.title', 'ticket.status', 'ticket.priority', 'ticket.url',
  'contact.firstName', 'contact.name', 'tech.name', 'org.name',
];
const MANAGE = 'tickets.canned.manage';
const notFound = () => new ApiError(404, 'Canned response not found', 'NOT_FOUND');

// What the picker shows `user`.
async function visibleWhere(user) {
  const teams = await myTeamIds(user.id);
  return {
    [Op.or]: [
      { visibility: 'personal', ownerId: user.id },
      { visibility: 'team', teamId: { [Op.in]: teams.length ? teams : [-1] } },
      { visibility: 'everyone' },
    ],
  };
}

// What Settings shows a manager: their own personal ones and every shared one.
const manageWhere = (user) => ({
  [Op.or]: [{ visibility: 'personal', ownerId: user.id }, { visibility: { [Op.in]: ['team', 'everyone'] } }],
});

// A LIKE pattern matching `term` literally.
const likeTerm = (term) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const shown = (r) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  visibility: r.visibility,
  ownerId: r.ownerId,
  teamId: r.teamId,
  team: r.team ? { id: r.team.id, name: r.team.name } : null,
  updatedAt: r.updatedAt,
});

// Validates title/body/visibility/teamId from a body, merged over `current`.
async function cleanInput(req, body, current = null) {
  const out = {};
  if (body.title !== undefined || !current) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) throw new ApiError(400, 'Title is required (at most 200 characters)', 'VALIDATION_ERROR');
    out.title = title;
  }
  if (body.body !== undefined || !current) {
    const text = typeof body.body === 'string' ? body.body : '';
    if (!text.trim() || text.length > 10000) throw new ApiError(400, 'Text is required (at most 10,000 characters)', 'VALIDATION_ERROR');
    out.body = text;
  }
  const visibility = body.visibility !== undefined ? body.visibility : (current ? current.visibility : 'personal');
  if (!VISIBILITIES.includes(visibility)) throw new ApiError(400, 'Unknown visibility', 'VALIDATION_ERROR');
  out.visibility = visibility;
  if (visibility === 'personal') {
    out.teamId = null;
  } else {
    if (!(await hasPermission(req.user.id, MANAGE))) {
      throw new ApiError(403, 'Shared canned responses need the "Manage shared canned responses" permission', 'FORBIDDEN');
    }
    if (visibility === 'team') {
      const rawTeam = body.teamId !== undefined ? body.teamId : current && current.teamId;
      const team = parseRecordId(rawTeam) ? await Team.findByPk(parseRecordId(rawTeam), { attributes: ['id'] }) : null;
      if (!team) throw new ApiError(400, 'Team not found', 'VALIDATION_ERROR');
      out.teamId = team.id;
    } else {
      out.teamId = null;
    }
  }
  return out;
}

// A response `user` may change: their own personal one, or a shared one
// with the permission. One they can see but not change → 403; one they
// can't see → 404, the same as a missing one.
async function findEditable(req) {
  const id = parseRecordId(req.params.id);
  const row = id ? await CannedResponse.findByPk(id) : null;
  if (!row) throw notFound();
  if (row.visibility === 'personal') {
    if (row.ownerId !== req.user.id) throw notFound();
    return row;
  }
  if (await hasPermission(req.user.id, MANAGE)) return row;
  if (!(await CannedResponse.count({ where: { id: row.id, ...(await visibleWhere(req.user)) } }))) throw notFound();
  throw new ApiError(403, 'Shared canned responses need the "Manage shared canned responses" permission', 'FORBIDDEN');
}

// GET /canned-responses?search=&manage=1
const list = asyncHandler(async (req, res) => {
  let where;
  if (req.query.manage === '1') {
    if (!(await hasPermission(req.user.id, MANAGE))) throw new ApiError(403, 'Insufficient permissions', 'FORBIDDEN');
    where = manageWhere(req.user);
  } else {
    where = await visibleWhere(req.user);
  }
  const term = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : '';
  if (term) {
    const pattern = likeTerm(term);
    where = { [Op.and]: [where, { [Op.or]: [{ title: { [Op.like]: pattern } }, { body: { [Op.like]: pattern } }] }] };
  }
  const rows = await CannedResponse.findAll({
    where, include: [{ model: Team, as: 'team', attributes: ['id', 'name'] }], order: [['title', 'ASC'], ['id', 'ASC']],
  });
  res.json({ responses: rows.map(shown), placeholders: PLACEHOLDERS });
});

// POST /canned-responses
const create = asyncHandler(async (req, res) => {
  const data = await cleanInput(req, req.body || {});
  const row = await CannedResponse.create({ ...data, ownerId: req.user.id });
  await writeAudit(req, 'canned.create', 'CannedResponse', row.id, { title: row.title, visibility: row.visibility });
  res.status(201).json({ response: shown(row) });
});

// PATCH /canned-responses/:id
const update = asyncHandler(async (req, res) => {
  const row = await findEditable(req);
  const data = await cleanInput(req, req.body || {}, row);
  await row.update(data);
  await writeAudit(req, 'canned.update', 'CannedResponse', row.id, data);
  res.json({ response: shown(row) });
});

// DELETE /canned-responses/:id
const remove = asyncHandler(async (req, res) => {
  const row = await findEditable(req);
  await row.destroy();
  await writeAudit(req, 'canned.delete', 'CannedResponse', row.id, { title: row.title });
  res.json({ ok: true });
});

// POST /tickets/:id/canned/:cannedId/render — needs sight of both.
const render = asyncHandler(async (req, res) => {
  const ticket = await findAccessibleTicket(req.user, req.params.id);
  const cannedId = parseRecordId(req.params.cannedId);
  const row = ticket && cannedId
    ? await CannedResponse.findOne({ where: { id: cannedId, ...(await visibleWhere(req.user)) } })
    : null;
  if (!ticket || !row) throw new ApiError(404, 'Not found', 'NOT_FOUND');
  const context = await ticketContext({ ticket: await Ticket.findByPk(ticket.id), author: req.user });
  const { orgName } = await branding();
  res.json({ text: renderPlainText(row.body, { ...context, org: { name: orgName } }, PLACEHOLDERS) });
});

module.exports = {
  list, create, update, remove, render, PLACEHOLDERS,
};
