// Merging tickets (service desk 5b). Everything on the sources moves into
// the target in one transaction; each source is closed quietly with
// mergedIntoId set, so mail for it follows the pointer (inboundEmailService).
//
// Who may merge: every ticket must be one the caller can see and edit, in
// the target's company; none may be merged already; the target isn't one of
// the sources. A ticket the caller can't see gets the same answer as one
// that doesn't exist. Nothing is written until every check passes.
const { Op } = require('sequelize');
const {
  Ticket, Comment, Attachment, TimeEntry, Task, ActiveTimer, TicketWatcher, TicketCc, AssetTicket, TicketRelation, Contact, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { canAccessTicket, canEditTicket, parseTicketId } = require('../permissionService');
const { closedStatusName } = require('../statusBehavior');
const { logActivity } = require('../ticketActivity');
const { formatTaskCode, formatSubtaskCode, trailingNumber } = require('../tasks/codes');
const { runTicketUpdateEffects, snapshotBefore } = require('./ticketWrite');
const { copyToTicket, removeFiles } = require('./attachmentFiles');

const MAX_SOURCES = 50;
const num = (id) => `#${String(id).padStart(5, '0')}`;
const notFound = () => new ApiError(404, 'Ticket not found', 'NOT_FOUND');
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

async function loadEditable(user, id) {
  const ticket = id ? await Ticket.findByPk(id) : null;
  if (!ticket || !(await canAccessTicket(user, ticket))) throw notFound();
  if (!(await canEditTicket(user, ticket))) throw new ApiError(403, `You can't edit ticket ${num(ticket.id)}`, 'FORBIDDEN');
  return ticket;
}

// Every check, before anything is written. Returns [target, sources].
async function checkMerge(user, targetRaw, sourceRaws) {
  if (!Array.isArray(sourceRaws) || !sourceRaws.length) throw bad('Choose at least one ticket to merge');
  const sourceIds = [];
  for (const raw of sourceRaws) {
    const id = parseTicketId(raw);
    if (!id) throw notFound();
    if (!sourceIds.includes(id)) sourceIds.push(id);
  }
  if (sourceIds.length > MAX_SOURCES) throw bad(`Merge at most ${MAX_SOURCES} tickets at once`);
  const target = await loadEditable(user, parseTicketId(targetRaw));
  if (sourceIds.includes(target.id)) throw bad("A ticket can't be merged into itself");
  if (target.mergedIntoId) throw bad(`Ticket ${num(target.id)} was merged into another ticket`);
  const sources = [];
  for (const id of sourceIds) {
    // eslint-disable-next-line no-await-in-loop
    const s = await loadEditable(user, id);
    if (s.mergedIntoId) throw bad(`Ticket ${num(s.id)} is already merged`);
    if (s.companyId !== target.companyId) throw bad('Only tickets of the same company can be merged');
    sources.push(s);
  }
  return [target, sources];
}

// Moves rows keyed (ticketId, key) onto the target, dropping the ones the
// target already has.
async function moveUnique(Model, keyField, sourceIds, targetId, transaction) {
  const have = new Set((await Model.findAll({ where: { ticketId: targetId }, attributes: [keyField], transaction }))
    .map((r) => String(r[keyField]).toLowerCase()));
  const rows = await Model.findAll({ where: { ticketId: { [Op.in]: sourceIds } }, order: [['id', 'ASC']], transaction });
  for (const row of rows) {
    const key = String(row[keyField]).toLowerCase();
    if (have.has(key)) {
      await row.destroy({ transaction }); // eslint-disable-line no-await-in-loop
    } else {
      have.add(key);
      await row.update({ ticketId: targetId }, { transaction }); // eslint-disable-line no-await-in-loop
    }
  }
}

// Tasks keep their order and get codes under the target: top-level tasks
// continue the target's T-numbers; subtasks keep their S-number under their
// task's new code.
async function moveTasks(sources, target, transaction) {
  const parent = { kind: 'ticket', record: target };
  const existing = await Task.findAll({ where: { ticketId: target.id, parentTaskId: null }, attributes: ['code', 'position'], transaction });
  let nextNumber = existing.reduce((max, t) => Math.max(max, trailingNumber(t.code, 'T')), 0);
  let nextPosition = existing.reduce((max, t) => Math.max(max, t.position), -1);
  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop
    const tops = await Task.findAll({
      where: { ticketId: source.id, parentTaskId: null }, order: [['position', 'ASC'], ['id', 'ASC']], transaction,
    });
    for (const task of tops) {
      nextNumber += 1;
      nextPosition += 1;
      const code = formatTaskCode(parent, nextNumber);
      // eslint-disable-next-line no-await-in-loop
      const subs = await Task.findAll({ where: { parentTaskId: task.id }, order: [['id', 'ASC']], transaction });
      // eslint-disable-next-line no-await-in-loop
      await task.update({ ticketId: target.id, code, position: nextPosition }, { transaction });
      for (const sub of subs) {
        // eslint-disable-next-line no-await-in-loop
        await sub.update({ ticketId: target.id, code: formatSubtaskCode(code, trailingNumber(sub.code, 'S') || sub.id) }, { transaction });
      }
    }
    // Anything left (subtasks whose parent sat elsewhere) still moves.
    // eslint-disable-next-line no-await-in-loop
    const rest = await Task.findAll({ where: { ticketId: source.id }, transaction });
    for (const t of rest) {
      nextNumber += 1;
      // eslint-disable-next-line no-await-in-loop
      await t.update({ ticketId: target.id, code: formatTaskCode(parent, nextNumber) }, { transaction });
    }
  }
}

// Relations: re-pointed at the target. Links among the merged tickets, a
// ticket linked to itself, and repeats of a link the target already has
// (either direction, any type: two tickets are linked once) are dropped.
async function moveRelations(sourceIds, targetId, transaction) {
  const merged = new Set([targetId, ...sourceIds]);
  const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join(':');
  const targetLinks = await TicketRelation.findAll({
    where: { [Op.or]: [{ ticketId: targetId }, { relatedTicketId: targetId }] }, transaction,
  });
  const seen = new Set(targetLinks.map((r) => pairKey(r.ticketId, r.relatedTicketId)));
  const rows = await TicketRelation.findAll({
    where: { [Op.or]: [{ ticketId: { [Op.in]: sourceIds } }, { relatedTicketId: { [Op.in]: sourceIds } }] },
    order: [['id', 'ASC']],
    transaction,
  });
  for (const row of rows) {
    const from = merged.has(row.ticketId) ? targetId : row.ticketId;
    const to = merged.has(row.relatedTicketId) ? targetId : row.relatedTicketId;
    const key = pairKey(from, to);
    if (from === to || seen.has(key)) {
      await row.destroy({ transaction }); // eslint-disable-line no-await-in-loop
    } else {
      seen.add(key);
      await row.update({ ticketId: from, relatedTicketId: to }, { transaction }); // eslint-disable-line no-await-in-loop
    }
  }
}

async function mergeTickets(req, targetRaw, sourceRaws) {
  const { user } = req;
  const [target, sources] = await checkMerge(user, targetRaw, sourceRaws);
  const sourceIds = sources.map((s) => s.id);
  const closedName = await closedStatusName();
  const befores = new Map();
  let files = { copied: [], originals: [] };

  try {
    await sequelize.transaction(async (transaction) => {
      // Lock every ticket in id order (no deadlocks between two merges) and
      // re-check what a concurrent merge could have changed.
      const locked = await Ticket.findAll({
        where: { id: { [Op.in]: [target.id, ...sourceIds] } }, order: [['id', 'ASC']], lock: transaction.LOCK.UPDATE, transaction,
      });
      const byId = new Map(locked.map((t) => [t.id, t]));
      if (locked.some((t) => t.mergedIntoId) || locked.some((t) => t.companyId !== target.companyId)) {
        throw bad('One of these tickets was just merged or moved; reload and try again');
      }

      // The target keeps a note of each source's own text, dated when it was written.
      for (const s of sources) {
        const body = s.description ? `From ${num(s.id)}: ${s.title}\n\n${s.description}` : `From ${num(s.id)}: ${s.title}`;
        // eslint-disable-next-line no-await-in-loop
        await Comment.create({
          body, authorId: user.id, ticketId: target.id, type: 'comment_private', createdAt: s.createdAt,
        }, { transaction, silent: true });
      }

      await Comment.update({ ticketId: target.id }, { where: { ticketId: { [Op.in]: sourceIds } }, transaction, silent: true });
      const attachments = await Attachment.findAll({ where: { ticketId: { [Op.in]: sourceIds } }, transaction });
      files = await copyToTicket(attachments, target.id);
      await Attachment.update({ ticketId: target.id }, { where: { ticketId: { [Op.in]: sourceIds } }, transaction });
      await TimeEntry.update({ ticketId: target.id }, { where: { ticketId: { [Op.in]: sourceIds } }, transaction });
      await ActiveTimer.update({ entityId: target.id }, { where: { entityType: 'ticket', entityId: { [Op.in]: sourceIds } }, transaction });
      await moveTasks(sources, target, transaction);
      await moveUnique(TicketWatcher, 'userId', sourceIds, target.id, transaction);
      await moveUnique(TicketCc, 'email', sourceIds, target.id, transaction);
      await moveUnique(AssetTicket, 'assetId', sourceIds, target.id, transaction);
      await moveRelations(sourceIds, target.id, transaction);

      // A source's contact who isn't the target's keeps hearing about it.
      const contactIds = [...new Set(sources.map((s) => s.contactId).filter((id) => id && id !== target.contactId))];
      if (contactIds.length) {
        const contacts = await Contact.findAll({ where: { id: { [Op.in]: contactIds } }, transaction });
        const targetContact = target.contactId ? await Contact.findByPk(target.contactId, { transaction }) : null;
        const have = new Set((await TicketCc.findAll({ where: { ticketId: target.id }, transaction })).map((c) => c.email));
        for (const c of contacts) {
          const email = String(c.email || '').trim().toLowerCase();
          if (!email || have.has(email) || (targetContact && String(targetContact.email || '').toLowerCase() === email)) continue; // eslint-disable-line no-continue
          have.add(email);
          // eslint-disable-next-line no-await-in-loop
          await TicketCc.create({ ticketId: target.id, email, contactId: c.id, addedById: user.id }, { transaction });
        }
      }

      for (const s of sources) {
        const row = byId.get(s.id);
        befores.set(s.id, snapshotBefore(row));
        // Instance update: the model hooks stop the SLA clocks and set resolvedAt.
        // eslint-disable-next-line no-await-in-loop
        await row.update({ status: closedName, mergedIntoId: target.id }, { transaction });
        // eslint-disable-next-line no-await-in-loop
        await Comment.create({
          body: `Merged into ${num(target.id)}`, authorId: user.id, ticketId: s.id, type: 'comment_private',
        }, { transaction });
      }
      await Comment.create({
        body: `Merged ${sourceIds.map(num).join(', ')} into this ticket`, authorId: user.id, ticketId: target.id, type: 'comment_private',
      }, { transaction });
    });
  } catch (err) {
    await removeFiles(files.copied);
    throw err;
  }
  await removeFiles(files.originals);

  await writeAudit(req, 'ticket.merge', 'Ticket', target.id, { sourceIds });
  await logActivity(target.id, user.id, 'merged', null, sourceIds.map(num).join(', '));
  for (const s of sources) {
    // eslint-disable-next-line no-await-in-loop
    await logActivity(s.id, user.id, 'merged_into', null, num(target.id));
    // eslint-disable-next-line no-await-in-loop
    const fresh = await Ticket.findByPk(s.id);
    // eslint-disable-next-line no-await-in-loop
    await runTicketUpdateEffects(req, fresh, befores.get(s.id), { status: closedName }, { quiet: true });
  }
  return { target: await Ticket.findByPk(target.id), sourceIds };
}

module.exports = { mergeTickets, checkMerge };
