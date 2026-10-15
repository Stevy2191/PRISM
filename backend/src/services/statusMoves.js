// Automatic status moves (user decisions 2026-10-15): a customer's reply
// puts an open or on-hold ticket in "User responded"; a technician's public
// reply on such a ticket puts it in "Waiting on User". The statuses are
// found by systemKey, so an admin may rename them.
const { TicketStatus } = require('../models');
const { logActivity } = require('./ticketActivity');
const { evaluateRules } = require('./workflowEngine');

async function systemStatus(systemKey) {
  return TicketStatus.findOne({ where: { systemKey } });
}

// Moves the ticket the way a status edit does: the model hooks keep the SLA
// clocks current, and the activity log and workflow rules see the change.
// `from` limits the move to tickets currently in that system status.
async function moveToSystemStatus(ticket, systemKey, actorId, { from = null } = {}) {
  const target = await systemStatus(systemKey);
  if (!target || ticket.status === target.name) return false;
  if (from) {
    const source = await systemStatus(from);
    if (!source || ticket.status !== source.name) return false;
  }
  const previous = ticket.status;
  await ticket.update({ status: target.name });
  await logActivity(ticket.id, actorId, 'status', previous, target.name);
  await evaluateRules(ticket.id, 'ticket_updated', ['status']);
  await evaluateRules(ticket.id, 'ticket_status_changed');
  return true;
}

module.exports = { moveToSystemStatus, systemStatus };
