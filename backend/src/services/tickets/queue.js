// Team queues and "Take it" (service desk 5b).
//
// Security design (user OK 2026-10-15): a queue is work waiting for a team,
// so a member may see — in the queue list and the queue count only — and
// take the UNASSIGNED tickets of their own teams, inside their company
// access, whatever their ticket tier. That is what lets an edit_own
// technician claim queue work. Everything else (opening the ticket by id,
// the plain list, comments) keeps the normal tier until the ticket is
// theirs. A non-member, or anyone fenced out of the ticket's company, gets
// the same answer as for a ticket that doesn't exist.
const { Op } = require('sequelize');
const { Ticket, TeamMember, User, sequelize } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { andWhere, ticketScopeWhere } = require('../recordScope');
const {
  canAccessTicket, canEditTicket, canAccessCompany, companyScopeWhere, hasPermission, parseRecordId, parseTicketId,
} = require('../permissionService');
const { getTicketStatusBuckets } = require('../statusBehavior');
const { assertCanWorkTicket } = require('../ticketPeople');
const { runTicketUpdateEffects, snapshotBefore } = require('./ticketWrite');

async function myTeamIds(userId) {
  const rows = await TeamMember.findAll({ where: { userId }, attributes: ['teamId'] });
  return rows.map((r) => r.teamId);
}

// `queue` from the query string → the team ids it means. 'mine' is every team
// I belong to; a team id must be one of mine unless I can view all tickets.
async function resolveQueueTeamIds(user, raw) {
  const mine = await myTeamIds(user.id);
  if (raw === 'mine') return mine;
  const id = parseRecordId(raw);
  if (!id) throw new ApiError(400, 'queue must be "mine" or a team id', 'VALIDATION_ERROR');
  if (!mine.includes(id) && !(await hasPermission(user.id, 'tickets.view_all'))) {
    throw new ApiError(400, 'You are not a member of that team', 'VALIDATION_ERROR');
  }
  return [id];
}

// What a queue view may show: the caller's normal ticket scope, plus the
// unassigned tickets of their own teams inside their company access.
async function queueVisibilityWhere(user) {
  const [scope, company, mine] = await Promise.all([ticketScopeWhere(user), companyScopeWhere(user), myTeamIds(user.id)]);
  // An empty scope means "everything": nothing to widen.
  if (!Object.keys(scope).length && !Object.getOwnPropertySymbols(scope).length) return {};
  const teamWork = andWhere({ teamId: { [Op.in]: mine.length ? mine : [-1] }, assigneeId: null }, company);
  return { [Op.or]: [scope, teamWork] };
}

// The queue fragment for a ticket listing: the chosen teams, open work only
// unless a status was asked for, within queueVisibilityWhere.
async function queueListWhere(user, rawQueue, { statusGiven }) {
  const teamIds = await resolveQueueTeamIds(user, rawQueue);
  const parts = [{ teamId: { [Op.in]: teamIds.length ? teamIds : [-1] } }];
  if (!statusGiven) parts.push({ status: { [Op.in]: (await getTicketStatusBuckets()).open } });
  return andWhere(...parts, await queueVisibilityWhere(user));
}

async function queueCount(user) {
  const mine = await myTeamIds(user.id);
  if (!mine.length) return 0;
  const where = andWhere(
    { teamId: { [Op.in]: mine }, assigneeId: null, status: { [Op.in]: (await getTicketStatusBuckets()).open } },
    await companyScopeWhere(user)
  );
  return Ticket.count({ where });
}

// Take-it access. A member of the ticket's team inside their company access
// sees it as queue work; anyone else needs normal access. `edit` and
// `member` are the two ways to be allowed to take it.
async function takeAccess(user, ticket) {
  const member = !!ticket.teamId && (await TeamMember.count({ where: { teamId: ticket.teamId, userId: user.id } })) > 0;
  const memberInCompany = member && (await canAccessCompany(user, ticket.companyId));
  const viewable = memberInCompany || (await canAccessTicket(user, ticket));
  return { viewable, member: memberInCompany, edit: viewable && (await canEditTicket(user, ticket)) };
}

// POST /tickets/:id/take. Claims an unassigned ticket for `req.user`. The
// row is locked for the check-and-set, so two people pressing at once get
// one winner and one 409; the instance update keeps the SLA hooks. A team
// member told "Already taken by X" saw the ticket in their queue a moment
// ago; anyone who couldn't see it gets the not-found answer instead.
async function takeTicket(req, rawId) {
  const { user } = req;
  const id = parseTicketId(rawId);
  const found = id ? await Ticket.findByPk(id) : null;
  const access = found ? await takeAccess(user, found) : { viewable: false };
  if (!access.viewable) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (found.assigneeId !== null) throw await alreadyTaken(found.assigneeId);
  if (!access.edit && !access.member) throw new ApiError(403, "You can't take this ticket", 'FORBIDDEN');
  await assertCanWorkTicket(user.id, found.companyId, 'You');

  let before;
  let ticket;
  await sequelize.transaction(async (t) => {
    ticket = await Ticket.findByPk(found.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (ticket.assigneeId !== null) throw await alreadyTaken(ticket.assigneeId);
    before = snapshotBefore(ticket);
    await ticket.update({ assigneeId: user.id }, { transaction: t });
  });
  await writeAudit(req, 'ticket.take', 'Ticket', ticket.id, { assigneeId: user.id });
  await runTicketUpdateEffects(req, ticket, before, { assigneeId: user.id });
  return ticket;
}

async function alreadyTaken(assigneeId) {
  const winner = await User.findByPk(assigneeId, { attributes: ['displayName', 'username'] });
  const name = winner ? (winner.displayName || winner.username) : 'someone else';
  return new ApiError(409, `Already taken by ${name}`, 'CONFLICT');
}

// For the ticket page: whether the Take it button applies.
async function canTake(user, ticket) {
  if (ticket.assigneeId !== null) return false;
  const access = await takeAccess(user, ticket);
  return access.viewable && (access.edit || access.member);
}

module.exports = {
  myTeamIds, resolveQueueTeamIds, queueVisibilityWhere, queueListWhere, queueCount, takeTicket, canTake,
};
