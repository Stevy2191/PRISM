// Loads the waiting-on-the-customer figure (services/waitingTime.js) for
// tickets: one read of the switched-on statuses, one of the tickets' status
// activity rows (in chunks, for big reports).
const { Op } = require('sequelize');
const { TicketStatus, TicketActivity } = require('../models');
const { waitingFor } = require('./waitingTime');

const CHUNK = 1000;

async function waitingStatusNames() {
  const rows = await TicketStatus.findAll({ where: { countsAsWaiting: true }, attributes: ['name'] });
  return rows.map((r) => r.name);
}

// tickets: rows with id, status, createdAt, resolvedAt. A ticket's life ends
// when it closed (resolvedAt), otherwise now.
// Returns Map<ticketId, { waitingMs, lifeMs, waitingNow }>.
async function waitingForTickets(tickets, now = new Date()) {
  const result = new Map();
  if (!tickets.length) return result;
  const waitingNames = await waitingStatusNames();
  const rowsByTicket = new Map(tickets.map((t) => [t.id, []]));
  const ids = [...rowsByTicket.keys()];
  for (let i = 0; i < ids.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await TicketActivity.findAll({
      where: { ticketId: { [Op.in]: ids.slice(i, i + CHUNK) }, action: 'status' },
      attributes: ['id', 'ticketId', 'fromValue', 'toValue', 'createdAt'],
      raw: true,
    });
    rows.forEach((r) => rowsByTicket.get(r.ticketId).push(r));
  }
  tickets.forEach((t) => {
    result.set(t.id, waitingFor({
      createdAt: t.createdAt,
      endAt: t.resolvedAt || now,
      currentStatus: t.status,
      rows: rowsByTicket.get(t.id),
      waitingNames,
    }));
  });
  return result;
}

const MIN = 60000;
const pctOf = (part, whole) => (whole > 0 ? Math.round((100 * part) / whole) : null);

// The ticket page / PDF form: whole minutes and a share of the life.
function waitingView(w) {
  return {
    minutes: Math.round(w.waitingMs / MIN),
    lifeMinutes: Math.round(w.lifeMs / MIN),
    pct: pctOf(w.waitingMs, w.lifeMs),
    now: w.waitingNow,
  };
}

async function ticketWaitingView(ticket) {
  return waitingView((await waitingForTickets([ticket])).get(ticket.id));
}

module.exports = {
  waitingForTickets, waitingView, ticketWaitingView, pctOf,
};
