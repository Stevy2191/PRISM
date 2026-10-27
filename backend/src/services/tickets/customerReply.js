// What a customer reply does to its ticket, whichever way it arrived (an
// email reply or the client portal). A reply never reopens a closed ticket:
// a person decides (user decision 2026-10-15), so the assignee is told
// instead. An open or on-hold ticket moves to User responded and the usual
// comment notices go out.
const { getTicketStatusBehaviorMap } = require('../statusBehavior');
const { moveToSystemStatus } = require('../statusMoves');
const { notifyComment, createNotification } = require('../notifications');

async function applyCustomerReply(ticket, comment, actorId) {
  const kind = (await getTicketStatusBehaviorMap()).get(ticket.status);
  if (kind === 'closed' || kind === 'archived') {
    if (ticket.assigneeId) {
      await createNotification({
        userId: ticket.assigneeId,
        type: 'comment',
        message: `Customer replied to closed ticket #${String(ticket.id).padStart(5, '0')}: ${ticket.title}`,
        ticketId: ticket.id,
      }).catch(() => {});
    }
    return;
  }
  await moveToSystemStatus(ticket, 'user_responded', actorId);
  if (actorId) await notifyComment(ticket, comment, actorId).catch(() => {});
}

module.exports = { applyCustomerReply };
