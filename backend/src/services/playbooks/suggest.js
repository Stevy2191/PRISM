// Bundles that suggest themselves by ticket category (PB2).
//
// A bundle lists ticket categories (Playbooks.suggestCategoryIds). A ticket
// created in one of them, or in a category under one, or moved into one,
// gets the bundle suggested once: a person adds it or dismisses it from the
// ticket, and a dismissed suggestion stays dismissed. Only active bundles
// offered for the ticket's company are suggested. The "Suggest a bundle"
// workflow action stays for anything more involved.
const { Playbook, TicketPlaybookSuggestion } = require('../../models');
const { loadTree } = require('../tickets/categories');
const { pathOf } = require('../tickets/categoryTree');
const { offeredFor } = require('./resolve');

// → the suggestions created (already-suggested bundles are left alone).
async function suggestForTicket(ticket) {
  if (!ticket || !ticket.categoryId) return [];
  const playbooks = (await Playbook.findAll({ where: { isActive: true } }))
    .filter((p) => Array.isArray(p.suggestCategoryIds) && p.suggestCategoryIds.length && offeredFor(p, ticket.companyId));
  if (!playbooks.length) return [];
  const under = new Set(pathOf(await loadTree(), ticket.categoryId).map((n) => n.id));
  const created = [];
  for (const p of playbooks.filter((pb) => pb.suggestCategoryIds.some((id) => under.has(id)))) {
    // eslint-disable-next-line no-await-in-loop
    const [row, isNew] = await TicketPlaybookSuggestion.findOrCreate({
      where: { ticketId: ticket.id, playbookId: p.id },
      defaults: { ticketId: ticket.id, playbookId: p.id, ruleId: null },
    });
    if (isNew) created.push(row);
  }
  return created;
}

// Never lets a suggestion fail the ticket write it follows.
async function suggestQuietly(ticket) {
  try {
    await suggestForTicket(ticket);
  } catch (err) {
    console.error('[checklists] category suggestion failed:', err.message);
  }
}

// Ticket hooks: after the ticket's transaction commits (when there is one),
// so the suggestion never holds the ticket's locks or rolls back with it.
function afterWrite(ticket, options) {
  const run = () => suggestQuietly(ticket);
  if (options && options.transaction && typeof options.transaction.afterCommit === 'function') {
    options.transaction.afterCommit(run);
    return undefined;
  }
  return run();
}

module.exports = { suggestForTicket, afterWrite };
