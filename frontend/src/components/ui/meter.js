// Budget meter maths, shared by <Meter> and anything that needs the same
// thresholds (project budget, workload bars). Pure so it is unit-testable.

// 'none' with no budget; 'near' from 80% up to and including 100%; 'over' above.
export function meterLevel(used, budget) {
  const b = Number(budget);
  if (budget == null || !Number.isFinite(b) || b <= 0) return 'none';
  const pct = (Number(used) || 0) / b;
  if (pct > 1) return 'over';
  if (pct >= 0.8) return 'near';
  return 'ok';
}

// Bar fill, 0 to 100 (an over-budget bar is full, not wider than its track).
export function meterPercent(used, budget) {
  const b = Number(budget);
  if (budget == null || !Number.isFinite(b) || b <= 0) return 0;
  return Math.max(0, Math.min(100, ((Number(used) || 0) / b) * 100));
}
