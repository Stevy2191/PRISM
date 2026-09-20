// "Show N older …" control for the per-record lists on a detail page.
//
// Those read chronologically — a comment thread, an activity log — so they
// load in chunks from the newest end rather than being split into numbered
// pages. Renders nothing once everything is loaded, so a short list looks
// exactly as it did before pagination existed.

export default function LoadMore({ loaded, total, loading, onLoadMore, noun = 'items', className = '' }) {
  const remaining = Math.max(0, total - loaded);
  if (remaining === 0) return null;

  return (
    <div className={`flex justify-center py-2 ${className}`}>
      <button
        type="button"
        className="btn-secondary px-3 py-1 text-xs"
        disabled={loading}
        onClick={onLoadMore}
      >
        {loading ? 'Loading…' : `Show ${remaining.toLocaleString()} older ${noun}`}
      </button>
    </div>
  );
}
