// Thin progress bar for a budget: accent while ok, amber from 80%, red over.
import { meterLevel, meterPercent } from './meter';

const FILL = {
  none: 'var(--color-accent)',
  ok: 'var(--color-accent)',
  near: 'var(--color-warning)',
  over: 'var(--color-danger)',
};

export default function Meter({ used, budget, className = '', label }) {
  const level = meterLevel(used, budget);
  const pct = meterPercent(used, budget);
  return (
    <div
      role="meter"
      aria-label={label || 'Budget used'}
      aria-valuemin={0}
      aria-valuemax={budget ?? 0}
      aria-valuenow={used ?? 0}
      data-level={level}
      className={`h-1.5 overflow-hidden rounded-full bg-navy-100 ${className}`}
    >
      <i className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: FILL[level] }} />
    </div>
  );
}
