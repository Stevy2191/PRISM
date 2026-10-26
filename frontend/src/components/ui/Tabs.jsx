// Underlined tab strip. items: [{ id, label, count? }]; controlled by value/onChange.
export default function Tabs({ items, value, onChange, className = '', label = 'Sections' }) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 overflow-x-auto pb-px border-b md:flex-wrap md:overflow-visible border-navy-100 ${className}`}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(t.id)}
            className={`-mb-px flex-shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent ${
              on ? 'font-semibold text-navy-900' : 'border-transparent font-medium text-navy-500 hover:text-navy-900'
            }`}
            style={on ? { borderBottomColor: 'var(--color-accent)' } : undefined}
          >
            {t.label}
            {t.count != null && <span className="num ml-1 font-medium text-navy-400">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
