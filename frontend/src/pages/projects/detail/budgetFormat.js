// Hours <-> minutes for the budget editor. Budgets are stored as whole minutes.

// "80", "80 h", "7.5 hours" or "1,5" -> minutes. '' -> null (no budget);
// anything else that is not a number of hours from 0 to 100,000 -> NaN.
export function parseHours(text) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/\s*(hours?|hrs?|h)$/, '').replace(',', '.');
  if (raw === '') return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return NaN;
  const minutes = Math.round(Number(raw) * 60);
  return minutes > 6000000 ? NaN : minutes;
}

// Minutes -> the text for an input: "7.5", "80", or '' for none.
export function hoursInput(minutes) {
  return minutes == null ? '' : `${Math.round((minutes / 60) * 10) / 10}`;
}

// Bar geometry for "Where the time went": the track is drawn at twice the
// budget (so the budget mark sits at 50%); without a budget it scales to the
// biggest phase. Returns { width, mark } as percentages (mark null with no budget).
export function barShape(used, budget, scaleMax) {
  const u = Number(used) || 0;
  if (budget > 0) return { width: Math.min(100, (u / (budget * 2)) * 100), mark: 50 };
  return { width: scaleMax > 0 ? Math.min(100, (u / scaleMax) * 100) : 0, mark: null };
}
