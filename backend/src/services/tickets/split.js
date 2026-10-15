// Splitting a ticket (service desk 5b): one comment becomes a new ticket,
// for when a customer raises a second issue on an existing one. The new
// ticket goes through the normal create path (checked against the caller,
// SLA from creation) and starts unassigned in the same team's queue; the
// comment and the attachments that arrived with it move over, and the two
// tickets are linked as related.
const {
  Ticket, Comment, Attachment, TicketCc, TicketRelation, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { findAccessibleTicket, canEditTicket, parseRecordId } = require('../permissionService');
const { logActivity } = require('../ticketActivity');
const { createTicket } = require('./ticketWrite');
const { copyToTicket, removeFiles } = require('./attachmentFiles');

const num = (id) => `#${String(id).padStart(5, '0')}`;

async function splitTicket(req, ticketRaw, commentRaw) {
  const { user } = req;
  const notFound = () => new ApiError(404, 'Not found', 'NOT_FOUND');
  const ticket = await findAccessibleTicket(user, ticketRaw);
  if (!ticket) throw notFound();
  if (!(await canEditTicket(user, ticket))) throw new ApiError(403, 'You do not have permission to edit this ticket', 'FORBIDDEN');
  const commentId = parseRecordId(commentRaw);
  const comment = commentId ? await Comment.findOne({ where: { id: commentId, ticketId: ticket.id } }) : null;
  if (!comment) throw notFound();

  const firstLine = String(comment.body || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '(no text)';
  const created = await createTicket(user, {
    title: `Split from ${num(ticket.id)}: ${firstLine.slice(0, 200)}`,
    description: comment.body,
    contactId: ticket.contactId,
    departmentId: ticket.departmentId,
    teamId: ticket.teamId,
    priority: ticket.priority,
    type: ticket.type,
  }, { req, source: ticket.source });

  let files = { copied: [], originals: [] };
  try {
    await sequelize.transaction(async (transaction) => {
      await comment.update({ ticketId: created.id }, { transaction, silent: true });
      const attachments = await Attachment.findAll({ where: { ticketId: ticket.id, commentId: comment.id }, transaction });
      files = await copyToTicket(attachments, created.id);
      await Attachment.update({ ticketId: created.id }, { where: { ticketId: ticket.id, commentId: comment.id }, transaction });
      const ccs = await TicketCc.findAll({ where: { ticketId: ticket.id }, transaction });
      for (const cc of ccs) {
        // eslint-disable-next-line no-await-in-loop
        await TicketCc.create({
          ticketId: created.id, email: cc.email, contactId: cc.contactId, addedById: user.id,
        }, { transaction });
      }
      await TicketRelation.create({ ticketId: created.id, relatedTicketId: ticket.id, relationType: 'related' }, { transaction });
    });
  } catch (err) {
    await removeFiles(files.copied);
    // The new ticket is empty without its comment: don't leave it behind.
    await Ticket.destroy({ where: { id: created.id } }).catch(() => {});
    throw err;
  }
  await removeFiles(files.originals);

  await writeAudit(req, 'ticket.split', 'Ticket', ticket.id, { newTicketId: created.id, commentId: comment.id });
  await logActivity(ticket.id, user.id, 'split_to', null, num(created.id));
  await logActivity(created.id, user.id, 'split_from', num(ticket.id), null);
  return created;
}

module.exports = { splitTicket };
