// Value labels on report bars. Kept free of React so node:test can load it.
// Sums of money and hours come back as floats (1234.5600000000001), so round:
// whole dollars for cost, otherwise at most one decimal.
export function formatBarValue(value, dataKey) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (dataKey === 'cost') return `$${Math.round(n).toLocaleString('en-US')}`;
  return (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
