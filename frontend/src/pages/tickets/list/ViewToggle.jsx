// Table / Board switch for the ticket list.
export function ViewToggle({ view, setView }) {
  return (
    <div role="group" aria-label="View" className="inline-flex flex-shrink-0 overflow-hidden rounded-md border border-navy-100 bg-surface">
      {[['table', 'Table'], ['board', 'Board']].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => setView(key)}
          className={`h-10 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-prism-accent lg:h-8 ${view === key ? 'font-semibold' : 'font-medium text-navy-500 hover:bg-[var(--color-hover)]'}`}
          style={view === key ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
