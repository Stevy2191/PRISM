// Colors (admin-customizable theme CSS variables), the input style and small
// formatters shared by the project page.

export const BG = 'var(--color-bg)';

export const CARD_BG = 'var(--color-card)';

export const BORDER = 'var(--color-border)';

export const TEXT = 'var(--color-text-primary)';

export const MUTED = 'var(--color-text-muted)';

export const BLUE = 'var(--color-accent)';

export const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

export const PRIORITY_META = {
  urgent: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};

export function formatSeconds(sec) {
  const s = Number(sec) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatCost(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function completionColor(percent) {
  if (percent >= 80) return 'var(--color-success)';
  if (percent >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}
