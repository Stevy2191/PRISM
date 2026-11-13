// The agent window's home (owner, 2026-11-13): help-desk notices, the
// person's tickets from this computer, a ticket's conversation and a reply.
//
// What a computer may see is deliberately narrow. A device key can only be
// trusted as far as the computer itself, so it reaches only tickets that
// are linked to this computer AND belong to the contact its signed-in user
// matches. A contact's other tickets (emailed in, raised in the portal or
// from another computer) stay in the portal, behind their own sign-in.
const { Op } = require('sequelize');
const {
  Asset, Ticket, Comment, AssetTicket, AgentNotice, User, Contact, TicketStatus,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId } = require('../permissionService');
const { matchContact } = require('./inventory');
const { applyCustomerReply } = require('../tickets/customerReply');
const { getSystemActorUserId } = require('../inboundEmailService');

const PUBLIC_TYPES = ['reply', 'comment_public'];
const MAX_REPLY = 10000;
const HOME_TICKETS = 5;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const account = (source) => {
  const s = source || {};
  const email = (v) => (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().slice(0, 255) : null);
  return { upn: email(s.upn), email: email(s.email) };
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
  const asset = await Asset.findByPk(device.assetId, { attributes: ['id', 'name', 'companyId'] });
  if (!asset) throw new ApiError(404, 'This device has no Asset', 'NOT_FOUND');
  const contact = await matchContact(asset.companyId, account(source));
  return { asset, contact };
}

// This computer's tickets for this contact, or none.
async function reachableIds(asset, contact) {
  if (!contact) return [];
  const links = await AssetTicket.findAll({ where: { assetId: asset.id }, attributes: ['ticketId'], raw: true });
  return links.map((l) => l.ticketId);
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
  const ids = await reachableIds(asset, contact);
  const [notices, states, rows] = await Promise.all([
    activeNotices(asset.companyId),
    stateMap(),
    ids.length ? Ticket.findAll({
      where: { id: { [Op.in]: ids }, contactId: contact.id },
      attributes: ['id', 'title', 'status', 'updatedAt'],
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
      limit: HOME_TICKETS,
    }) : [],
  ]);
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
  const ids = await reachableIds(asset, contact);
  const ticket = id && ids.includes(id) ? await Ticket.findOne({ where: { id, contactId: contact.id } }) : null;
  // The same answer for a ticket that isn't there and one this computer may not see.
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
