// How much of a ticket's life was spent waiting on the customer (user
// decisions 2026-10-15). Worked out from the ticket's status activity rows,
// so it covers tickets from before this existed and follows the per-status
// "counts as waiting" switch backwards in time. Lifecycle times and the SLA
// are not affected: this is a separate figure.

// The activity log writes status names with spaces for underscores
// (resolveDisplayValue), so names are compared in that form.
const shown = (name) => String(name ?? '').replace(/_/g, ' ');

// rows: the ticket's 'status' activity rows (any order). Each row ends the
// stretch spent in its fromValue; when that disagrees with the previous
// row's toValue some change went unlogged, and the row's own fromValue is
// the better evidence. After the last row the ticket is in currentStatus.
// Time after endAt (closing, or now) is not part of the ticket's life.
function waitingFor({
  createdAt, endAt, currentStatus, rows, waitingNames,
}) {
  const waiting = new Set(waitingNames.map(shown));
  const start = new Date(createdAt).getTime();
  const end = new Date(endAt).getTime();
  const sorted = [...rows].sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id));

  let waitingMs = 0;
  const add = (status, from, to) => {
    if (!waiting.has(shown(status))) return;
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (b > a) waitingMs += b - a;
  };

  let cursor = start;
  sorted.forEach((r) => {
    const t = new Date(r.createdAt).getTime();
    add(r.fromValue, cursor, t);
    cursor = Math.max(cursor, t);
  });
  add(currentStatus, cursor, end);

  return {
    waitingMs,
    lifeMs: Math.max(0, end - start),
    waitingNow: waiting.has(shown(currentStatus)),
  };
}

module.exports = { waitingFor, shownStatusName: shown };
