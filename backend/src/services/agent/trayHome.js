// The agent window's home (owner, 2026-11-13): help-desk notices, the
// person's tickets from this computer, a ticket's conversation and a reply.
//
// Which tickets (owner, 2026-11-13): every OPEN ticket of the contact this
// computer's signed-in user matches, wherever it was raised (the agent,
// email, the portal, staff). Closed tickets are for the portal, behind the
// person's own sign-in. The owner chose this knowing a device key is only
// as trustworthy as the computer: someone with administrator rights on an
// enrolled computer could ask as another of the company's contacts. It
// stays inside the computer's own company, to open tickets and what a
// customer may read (never a private note).
const { Op } = require('sequelize');
const {
  Asset, Ticket, Comment, AgentNotice, User, Contact, TicketStatus,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId } = require('../permissionService');
const { resolveContact } = require('./trayIdentity');
const { applyCustomerReply } = require('../tickets/customerReply');
const { getSystemActorUserId } = require('../inboundEmailService');

const PUBLIC_TYPES = ['reply', 'comment_public'];
const MAX_REPLY = 10000;
const HOME_TICKETS = 10;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const account = (source) => {
  const s = source || {};
  const email = (v) => (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().slice(0, 255) : null);
  return { account: typeof s.account === 'string' ? s.account.trim().slice(0, 255) : null, upn: email(s.upn), email: email(s.email) };
};

// → what a person reads: open, needs_answer, on_hold or done.
async function stateMap() {
  const rows = await TicketStatus.findAll({ attributes: ['name', 'behaviorType', 'countsAsWaiting'], raw: true });
  const map = new Map();
  rows.forEach((s) => {
    let state = 'open';
    if (s.behaviorType === 'closed' || s.behaviorType === 'archived') state = 'done';
    else if (s.countsAsWaiting) state = 'needs_answer';
    else if (s.behaviorType === 'on_hold') state = 'on_hold';
    map.set(s.name, state);
  });
  return map;
}

async function context(device, source) {
  const asset = await Asset.findByPk(device.assetId, { attributes: ['id', 'name', 'companyId', 'assignedToContactId'] });
  if (!asset) throw new ApiError(404, 'This device has no Asset', 'NOT_FOUND');
  const contact = await resolveContact(device, asset, account(source));
  return { asset, contact };
}

// The contact's open tickets in this computer's company (not closed, not
// archived), or nothing for someone who matches no contact.
async function openWhere(asset, contact, states) {
  if (!contact) return null;
  const open = [...states].filter(([, state]) => state !== 'done').map(([name]) => name);
  return { contactId: contact.id, companyId: asset.companyId, status: { [Op.in]: open } };
}

async function activeNotices(companyId) {
  const now = new Date();
  const rows = await AgentNotice.findAll({
    where: {
      removedAt: null,
      [Op.and]: [
        { [Op.or]: [{ companyId: null }, { companyId }] },
        { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] },
      ],
    },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: 5,
  });
  return rows.map((n) => ({
    id: n.id, headline: n.headline, message: n.message || '', postedAt: n.createdAt,
  }));
}

const fromStaff = (c) => !c.fromCustomer && c.authorContactId == null;
const snippet = (body) => {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
};

// GET /agent/v1/tray/home?account=&upn= → { notices, tickets, matched }
async function home(device, query) {
  const { asset, contact } = await context(device, query);
  const [notices, states] = await Promise.all([activeNotices(asset.companyId), stateMap()]);
  const where = await openWhere(asset, contact, states);
  const rows = where ? await Ticket.findAll({
    where,
    attributes: ['id', 'title', 'status', 'updatedAt'],
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit: HOME_TICKETS,
  }) : [];
  const replies = rows.length ? await Comment.findAll({
    where: { ticketId: { [Op.in]: rows.map((t) => t.id) }, type: { [Op.in]: PUBLIC_TYPES }, fromCustomer: false, authorContactId: null },
    attributes: ['id', 'ticketId', 'body', 'createdAt'],
    include: [{ model: User, as: 'author', attributes: ['displayName', 'username'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: 200,
  }) : [];
  const last = new Map();
  replies.forEach((c) => { if (!last.has(c.ticketId)) last.set(c.ticketId, c); });
  return {
    matched: !!contact,
    notices,
    tickets: rows.map((t) => {
      const c = last.get(t.id);
      return {
        id: t.id,
        number: String(t.id).padStart(5, '0'),
        title: t.title,
        state: states.get(t.status) || 'open',
        updatedAt: t.updatedAt,
        lastReply: c ? {
          id: c.id, from: c.author ? (c.author.displayName || c.author.username) : 'Support', snippet: snippet(c.body), at: c.createdAt,
        } : null,
      };
    }),
  };
}

async function reachableTicket(device, source, rawId) {
  const { asset, contact } = await context(device, source);
  const id = parseRecordId(rawId);
  const where = id ? await openWhere(asset, contact, await stateMap()) : null;
  const ticket = where ? await Ticket.findOne({ where: { ...where, id } }) : null;
  // The same answer for a ticket that isn't there, one that's closed and one
  // that belongs to someone else.
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  return { ticket, contact };
}

// GET /agent/v1/tray/tickets/:id?account=&upn= → { ticket, messages }
// Only what the customer may read: replies and public comments, never a
// private note.
async function ticketView(device, query, rawId) {
  const { ticket, contact } = await reachableTicket(device, query, rawId);
  const [states, comments] = await Promise.all([
    stateMap(),
    Comment.findAll({
      where: { ticketId: ticket.id, type: { [Op.in]: PUBLIC_TYPES } },
      include: [
        { model: User, as: 'author', attributes: ['displayName', 'username'] },
        { model: Contact, as: 'authorContact', attributes: ['id', 'displayName'] },
      ],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: 200,
    }),
  ]);
  return {
    ticket: {
      id: ticket.id,
      number: String(ticket.id).padStart(5, '0'),
      title: ticket.title,
      description: ticket.description || '',
      state: states.get(ticket.status) || 'open',
      createdAt: ticket.createdAt,
    },
    messages: comments.map((c) => {
      const staff = fromStaff(c);
      const mine = !staff && (c.authorContactId == null || c.authorContactId === contact.id);
      let from = 'You';
      if (staff) from = c.author ? (c.author.displayName || c.author.username) : 'Support';
      else if (!mine) from = c.authorContact ? c.authorContact.displayName : 'Someone else';
      return {
        id: c.id, from, side: staff ? 'support' : (mine ? 'you' : 'contact'), body: c.body, at: c.createdAt,
      };
    }),
  };
}

// POST /agent/v1/tray/tickets/:id/reply { account, upn, body } → { id }
// The contact's own reply, exactly as one written in the portal.
async function reply(device, body, rawId) {
  const b = body || {};
  const message = text(b.body, MAX_REPLY + 1);
  if (!message) throw new ApiError(400, 'A reply is required', 'VALIDATION_ERROR');
  if (message.length > MAX_REPLY) throw new ApiError(400, 'A reply is too long', 'VALIDATION_ERROR');
  const { ticket, contact } = await reachableTicket(device, b, rawId);
  const actorId = await getSystemActorUserId();
  if (!actorId) throw new ApiError(503, 'The help desk is not ready: no administrator account exists', 'NO_SYSTEM_ACTOR');
  const comment = await Comment.create({
    body: message, authorId: actorId, authorContactId: contact.id, ticketId: ticket.id, type: 'reply', fromCustomer: true,
  });
  await applyCustomerReply(ticket, comment, actorId);
  return { id: comment.id };
}

module.exports = {
  home, ticketView, reply, activeNotices,
};
