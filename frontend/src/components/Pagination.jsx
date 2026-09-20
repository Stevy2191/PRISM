// Page controls for the paginated list endpoints.
//
// Reads as a console readout rather than a web-shop pager: the range and total
// sit in the mono data face on the left, the page-size selector and the step
// controls on the right. Numbers are the thing being reported, so they get the
// data face; the words around them stay in the UI face.

const RANGE_OPTIONS = [25, 50, 100, 200];

// "1–50 of 2,431" — the range actually on screen, not just the page number.
function describeRange(page, limit, total) {
  if (!total) return 'No results';
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  return `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
}

export default function Pagination({
  page,
  limit,
  total,
  totalPages,
  onPageChange,
  onLimitChange,
  // Some lists (the ticket table) have a bulk-select bar that needs to state
  // how many rows match beyond the current page — it renders in the gap.
  children,
}) {
  // One page of results needs no controls, but the total is still worth
  // showing — it's the answer to "how many are there?".
  const single = totalPages <= 1;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {describeRange(page, limit, total)}
        </span>
        {children}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {onLimitChange && (
          <label className="flex items-center gap-2">
            <span className="eyebrow">Rows</span>
            <select
              className="input w-auto py-1 text-xs"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              {/* A limit arriving from a saved URL may not be one of the
                  presets; show it rather than silently snapping the select. */}
              {[...new Set([...RANGE_OPTIONS, limit])]
                .sort((a, b) => a - b)
                .map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}

        {!single && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={page <= 1}
              onClick={() => onPageChange(1)}
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              Prev
            </button>
            <span className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            >
              Next
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={page >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label="Last page"
            >
              »
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
