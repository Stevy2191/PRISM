// Banner. tone: info | warn (default) | bad.
const TONES = {
  info: { bg: 'var(--color-accent-soft)', bd: 'var(--color-accent)', fg: 'var(--color-text-primary)' },
  warn: { bg: 'var(--color-waiting-bg)', bd: 'var(--color-warning)', fg: 'var(--color-text-primary)' },
  bad: { bg: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-card))', bd: 'var(--color-danger)', fg: 'var(--color-text-primary)' },
};

export default function Notice({ tone = 'warn', className = '', children }) {
  const t = TONES[tone] || TONES.warn;
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={`flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3 text-sm ${className}`}
      style={{ backgroundColor: t.bg, borderColor: `color-mix(in srgb, ${t.bd} 45%, transparent)`, color: t.fg }}
    >
      {children}
    </div>
  );
}
