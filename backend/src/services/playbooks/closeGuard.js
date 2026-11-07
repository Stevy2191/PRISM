// No closing a ticket with unfinished forms (Playbooks, PB, task 8).
//
// Every way into a closed or archived status goes through assertCanClose:
// the ticket page, bulk actions and the API (prepareTicketUpdate), workflow
// rules (set_status) and automatic status moves. A form is unfinished while
// it is open: neither finished nor skipped. Someone with "Close tickets with
// unfinished forms" may close anyway, giving a reason, which is logged.
// Devices no form covers only warn: they never block (owner, 2026-11-06).
const { TicketForm, FormVersion, Form, Asset } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { hasPermission } = require('../permissionService');
const { logActivity } = require('../ticketActivity');
const { getTicketStatusBehaviorMap } = require('../statusBehavior');

const CLOSING = ['closed', 'archived'];

// → { blocking: [{ id, formName, asset }], warnings: [{ id, assetTag, name }] }
async function checkClose(ticket) {
  const open = await TicketForm.findAll({
    where: { ticketId: ticket.id, state: 'open' },
    include: [
      { model: FormVersion, as: 'formVersion', attributes: ['id'], include: [{ model: Form, as: 'form', attributes: ['id', 'name'] }] },
      { model: Asset, as: 'asset', attributes: ['id', 'assetTag', 'name'] },
    ],
    order: [['id', 'ASC']],
  });
  // Lazy: the apply service loads the tasks service, which loads this one's callers.
  const { ticketPlaybooksView } = require('./apply'); // eslint-disable-line global-require
  const { uncovered } = await ticketPlaybooksView(ticket);
  return {
    blocking: open.map((f) => ({
      id: f.id,
      formName: f.formVersion && f.formVersion.form ? f.formVersion.form.name : null,
      asset: f.asset ? { id: f.asset.id, assetTag: f.asset.assetTag, name: f.asset.name } : null,
    })),
    warnings: uncovered.map((a) => ({ id: a.id, assetTag: a.assetTag, name: a.name })),
  };
}

async function isClosingMove(fromStatus, toStatus) {
  if (!toStatus || toStatus === fromStatus) return false;
  const behavior = await getTicketStatusBehaviorMap();
  return CLOSING.includes(behavior.get(toStatus)) && !CLOSING.includes(behavior.get(fromStatus));
}

// Throws 409 FORMS_UNFINISHED when the ticket would close with open forms,
// unless override.reason is given by someone allowed to; that is logged.
// actor: the user, or null for a workflow rule (never overrides).
async function assertCanClose(ticket, toStatus, { actor = null, override = null } = {}) {
  if (!(await isClosingMove(ticket.status, toStatus))) return;
  if (!(await TicketForm.count({ where: { ticketId: ticket.id, state: 'open' } }))) return;
  const reason = override && typeof override.reason === 'string' ? override.reason.trim() : '';
  if (actor && reason) {
    if (!(await hasPermission(actor.id, 'tickets.override_checklist'))) {
      throw new ApiError(403, 'Closing a ticket with unfinished checklists needs the Close tickets with unfinished checklists permission', 'FORBIDDEN');
    }
    await logActivity(ticket.id, actor.id, 'close_override', null, reason.slice(0, 255));
    return;
  }
  const details = await checkClose(ticket);
  throw new ApiError(409, `This ticket has ${details.blocking.length} unfinished checklist${details.blocking.length === 1 ? '' : 's'}`, 'FORMS_UNFINISHED', details);
}

module.exports = { checkClose, assertCanClose, isClosingMove };
