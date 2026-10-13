// A ticket's most urgent running SLA clock as a short badge: time left,
// "at risk" in amber, breached in red. `sla` is the server's SLA view
// (services/sla/slaView.js) or null for a ticket with no SLA.
export const CLOCK_LABELS = { assign: 'Assignment', response: 'First response', resolution: 'Resolution' };

export function formatLeft(ms) {
  const sign = ms < 0 ? '-' : '';
  const min = Math.round(Math.abs(ms) / 60000);
  if (min < 60) return `${sign}${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${sign}${h}h${min % 60 ? ` ${min % 60}m` : ''}`;
  return `${sign}${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ''}`;
}

export function formatDue(dueAt) {
  return new Date(dueAt).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const STYLES = {
  breached: { color: 'white', backgroundColor: 'var(--color-danger)' },
  at_risk: { color: 'white', backgroundColor: 'var(--color-warning)' },
  running: { color: 'var(--color-text-muted, #64748b)', backgroundColor: 'transparent' },
};

export default function SlaBadge({ sla, now = Date.now() }) {
  if (!sla) return <span className="text-sm" style={{ color: 'var(--color-text-muted, #64748b)' }}>—</span>;
  const { worst } = sla;
  if (!worst) {
    const breached = Object.values(sla.clocks).some((c) => c.state === 'breached');
    return (
      <span className="text-xs font-medium" style={{ color: breached ? 'var(--color-danger)' : 'var(--color-text-muted, #64748b)' }}>
        {breached ? 'Breached' : 'On hold'}
      </span>
    );
  }
  const left = new Date(worst.dueAt).getTime() - now;
  const text = worst.state === 'breached' ? `Breached ${formatLeft(-left)} ago` : `${formatLeft(left)} left`;
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-xs font-medium"
      style={STYLES[worst.state] || STYLES.running}
      title={`${CLOCK_LABELS[worst.clock]} due ${formatDue(worst.dueAt)}`}
      data-testid="sla-badge"
    >
      {text}
    </span>
  );
}
