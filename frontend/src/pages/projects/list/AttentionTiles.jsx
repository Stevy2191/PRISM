// The three tiles over the list. Each one is a filter: click to show only those
// projects, click again to clear. The count is in the tile; the number is zero
// for a viewer who cannot see any such project.
const TILES = [
  { kind: 'over_budget', key: 'overBudget', one: 'project over its hour budget', many: 'projects over their hour budget', warn: true },
  { kind: 'milestones_7d', key: 'milestonesSoon', one: 'milestone due in the next 7 days', many: 'milestones due in the next 7 days' },
  { kind: 'unassigned', key: 'unassignedTasks', one: 'task with no one assigned', many: 'tasks with no one assigned' },
];

export default function AttentionTiles({ counts, active, onPick }) {
  return (
    <div className="mt-6 grid grid-cols-3 gap-4 max-md:grid-cols-1 max-md:gap-3" role="group" aria-label="Needs attention">
      {TILES.map((t) => {
        const n = counts ? counts[t.key] : null;
        const on = active === t.kind;
        const warn = t.warn && n > 0;
        return (
          <button
            key={t.kind}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(t.kind)}
            className={`rounded-xl border px-[18px] py-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:min-h-[44px] ${on ? 'border-transparent' : 'border-navy-100 bg-surface hover:bg-[var(--color-hover)]'}`}
            style={on ? { backgroundColor: 'var(--color-accent-soft)', boxShadow: 'inset 0 0 0 2px var(--color-accent)' } : undefined}
          >
            <div className="num text-[26px] font-semibold tracking-tight" style={warn ? { color: 'var(--color-danger)' } : undefined}>{n ?? '–'}</div>
            <div className="mt-0.5 text-[13px] text-navy-400">{n === 1 ? t.one : t.many}</div>
          </button>
        );
      })}
    </div>
  );
}
