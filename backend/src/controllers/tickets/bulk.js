// POST /tickets/bulk (service desk 5b): one action over up to 100 tickets,
// with a result per ticket. Each ticket goes through the same service
// function as the single edit (services/tickets/ticketWrite), so its access
// checks, activity, workflow rules, SLA hooks and notifications all apply.
// A missing ticket and one the caller can't see get the same answer.
const { Ticket } = require('../../models');
const { loadTree: loadCategoryTree } = require('../../services/tickets/categories');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessTicket, hasPermission, parseTicketId } = require('../../services/permissionService');
const { closedStatusName } = require('../../services/statusBehavior');
const {
  updateTicket, deleteTicket, addTicketWatcher,
} = require('../../services/tickets/ticketWrite');
const { mergeTickets } = require('../../services/tickets/merge');

const MAX_IDS = 100;
const ACTIONS = ['status', 'priority', 'assign', 'team', 'category', 'close', 'add_watcher', 'delete', 'merge'];
// Actions that need a permission beyond edit access, checked once.
const EXTRA_PERMISSION = { add_watcher: 'tickets.manage_watchers', delete: 'tickets.delete' };
const NOT_FOUND = 'Ticket not found';

// The error text a ticket's result carries: an ApiError's own message;
// anything else is logged and kept generic (no internals in responses).
function resultError(err, id) {
  if (err instanceof ApiError) return err.message;
  console.error(`[bulk] ticket ${id}:`, err);
  return 'Could not update this ticket';
}

async function applyOne(req, action, value, id, { categoryTree = null } = {}) {
  const ticket = id ? await Ticket.findByPk(id) : null;
  if (!ticket || !(await canAccessTicket(req.user, ticket))) throw new ApiError(404, NOT_FOUND, 'NOT_FOUND');
  switch (action) {
    case 'status': return updateTicket(req, ticket, { status: value });
    case 'priority': return updateTicket(req, ticket, { priority: value });
    case 'assign': return updateTicket(req, ticket, { assigneeId: value || null });
    case 'team': return updateTicket(req, ticket, { teamId: value || null });
    case 'category': return updateTicket(req, ticket, { categoryId: value ?? null }, { categoryTree });
    case 'close': return updateTicket(req, ticket, { status: await closedStatusName() });
    case 'add_watcher': return addTicketWatcher(req, ticket, value);
    case 'delete': return deleteTicket(req, ticket);
    default: throw new ApiError(400, 'Unknown action', 'VALIDATION_ERROR');
  }
}

const bulk = asyncHandler(async (req, res) => {
  const { ids, action, value } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS) {
    throw new ApiError(400, `Choose between 1 and ${MAX_IDS} tickets`, 'VALIDATION_ERROR');
  }
  if (!ACTIONS.includes(action)) throw new ApiError(400, 'Unknown action', 'VALIDATION_ERROR');

  // De-duplicated, in the order given; an id that doesn't parse keeps its
  // raw value in the result so the caller can match it up.
  const seen = new Set();
  const items = [];
  ids.forEach((raw) => {
    const id = parseTicketId(raw);
    const key = id || `raw:${String(raw)}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ raw, id });
  });

  // A merge is one operation: all of it happens or none, so every id gets
  // the same result.
  if (action === 'merge') {
    const valid = items.filter((i) => i.id);
    let error = valid.length === items.length ? null : NOT_FOUND;
    if (!error) {
      try {
        await mergeTickets(req, value, valid.map((i) => i.id));
      } catch (err) {
        error = resultError(err, value);
      }
    }
    res.json({ results: items.map(({ raw, id }) => (error ? { id: id || raw, ok: false, error } : { id, ok: true })) });
    return;
  }

  const extra = EXTRA_PERMISSION[action];
  const allowed = !extra || (await hasPermission(req.user.id, extra));

  // One category tree for the whole batch, not one per ticket.
  const categoryTree = action === 'category' ? await loadCategoryTree() : null;
  const results = [];
  for (const { raw, id } of items) {
    if (!allowed) {
      results.push({ id: id || raw, ok: false, error: 'Insufficient permissions' });
      continue; // eslint-disable-line no-continue
    }
    try {
      // One at a time: workflow rules and notifications run in order, and a
      // hundred parallel edits would only contend for the same rows.
      // eslint-disable-next-line no-await-in-loop
      if (!id) throw new ApiError(404, NOT_FOUND, 'NOT_FOUND');
      // eslint-disable-next-line no-await-in-loop
      await applyOne(req, action, value, id, { categoryTree });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id: id || raw, ok: false, error: resultError(err, id) });
    }
  }
  res.json({ results });
});

module.exports = { bulk };
