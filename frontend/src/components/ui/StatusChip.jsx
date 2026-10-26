// Status pill. tone: info (default, accent) | neutral | waiting | good | bad.
const TONES = {
  info: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)' },
  neutral: { bg: 'var(--color-hover)', fg: 'var(--color-text-secondary)' },
  waiting: { bg: 'var(--color-waiting-bg)', fg: 'var(--color-waiting)' },
  good: { bg: 'var(--color-timer-bg)', fg: 'var(--color-timer)' },
  bad: { bg: 'color-mix(in srgb, var(--color-danger) 14%, var(--color-card))', fg: 'var(--color-danger)' },
};

export default function StatusChip({ tone = 'info', className = '', children }) {
  const t = TONES[tone] || TONES.info;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${className}`}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}
