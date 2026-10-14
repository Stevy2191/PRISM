import { CLOCK_LABELS, formatDue, formatLeft } from '../../../components/SlaBadge';
import { TEXT, MUTED } from '../theme';

// The ticket's three SLA clocks: due time and time left while running,
// met / breached / paused otherwise. `sla` is the server's SLA view, or
// null for a ticket from before SLAs were tracked.
const hm = (minutes) => formatLeft(minutes * 60000);

function ClockRow({ clock, view, now }) {
  if (view.state === 'untracked') return null;
  let detail;
  let color = MUTED;
  if (view.state === 'running') {
    const left = new Date(view.dueAt).getTime() - now;
    detail = `${formatLeft(left)} left · due ${formatDue(view.dueAt)}`;
    if (view.atRisk) color = 'var(--color-warning)';
  } else if (view.state === 'breached') {
    detail = `Breached · was due ${formatDue(view.breachedAt || view.dueAt)}`;
    color = 'var(--color-danger)';
  } else if (view.state === 'met') {
    detail = `Met in ${hm(view.usedMinutes)}`;
    color = 'var(--color-success, #16a34a)';
  } else {
    detail = `Paused · ${hm(view.usedMinutes)} of ${hm(view.targetMinutes)} used`;
  }
  return (
    <li className="flex flex-col" data-testid={`sla-clock-${clock}`}>
      <span className="text-xs font-medium" style={{ color: TEXT }}>
        {CLOCK_LABELS[clock]} <span className="font-normal" style={{ color: MUTED }}>· target {hm(view.targetMinutes)}</span>
      </span>
      <span className="font-mono text-xs" style={{ color }}>{detail}</span>
    </li>
  );
}

export default function SlaPanel({ sla, now = Date.now() }) {
  if (!sla) return <p className="text-xs" style={{ color: MUTED }}>No SLA (created before SLAs were tracked)</p>;
  const rows = ['assign', 'response', 'resolution'].filter((c) => sla.clocks[c].state !== 'untracked');
  const res = sla.clocks.resolution;
  const moved = res.originalDueAt && res.dueAt && new Date(res.originalDueAt).getTime() !== new Date(res.dueAt).getTime();
  return (
    <div className="space-y-2">
      {sla.policy?.name && <p className="text-xs" style={{ color: MUTED }}>Policy: {sla.policy.name}</p>}
      {moved && <p className="text-xs" style={{ color: MUTED }} data-testid="sla-original-due">Original SLA due {formatDue(res.originalDueAt)}</p>}
      {rows.length === 0
        ? <p className="text-xs" style={{ color: MUTED }}>No targets for this priority</p>
        : <ul className="space-y-2">{rows.map((c) => <ClockRow key={c} clock={c} view={sla.clocks[c]} now={now} />)}</ul>}
      {sla.changes?.length > 0 && (
        <div data-testid="sla-due-changes">
          <p className="mt-2 text-xs font-medium" style={{ color: TEXT }}>Due date changes</p>
          <ul className="mt-1 space-y-1">
            {sla.changes.map((ch) => (
              <li key={`${ch.createdAt}-${ch.toDueAt}`} className="text-xs" style={{ color: MUTED }}>
                {ch.kind === 'extension' ? 'Extended' : 'Changed'} to {formatDue(ch.toDueAt)} by {ch.user?.displayName || 'a workflow rule'}
                {ch.reason ? <span style={{ color: TEXT }}> — {ch.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
