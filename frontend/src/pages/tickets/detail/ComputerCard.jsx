// The PRISM agent's health snapshot of the computer a tray ticket came from:
// the lines a tech looks at first, the rest one click away. Out of the
// conversation, so the thread is only what people wrote.
import { useState } from 'react';
import { MUTED, TEXT, timeAgo } from '../theme';

const FIRST = ['OS', 'Memory in use', 'Uptime', 'Signed in', 'IP addresses'];

export default function ComputerCard({ snapshot }) {
  const [all, setAll] = useState(false);
  if (!snapshot) return null;
  const items = snapshot.items || [];
  const isFirst = (i) => FIRST.includes(i.label) || (/^Free on /.test(i.label) && items.find((x) => /^Free on /.test(x.label)) === i);
  const shown = all ? items : items.filter(isFirst);
  const more = items.length - items.filter(isFirst).length;
  return (
    <section className="rounded-xl border border-navy-100 bg-surface" aria-label="Computer">
      <div className="flex items-baseline justify-between gap-2 border-b border-navy-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-navy-900">Computer</h3>
        <span className="text-xs" style={{ color: MUTED }} title="When the PRISM agent took this snapshot">Snapshot {timeAgo(snapshot.createdAt)}</span>
      </div>
      <div className="px-4 py-3">
        <p className="mb-2 break-words text-sm font-medium" style={{ color: TEXT }}>{snapshot.computer}</p>
        <dl className="space-y-1.5 text-sm">
          {shown.map((i) => (
            <div key={i.label}>
              <dt className="text-xs" style={{ color: MUTED }}>{i.label}</dt>
              <dd className="break-words" style={{ color: TEXT }}>{i.value}</dd>
            </div>
          ))}
        </dl>
        {more > 0 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-semibold text-prism hover:underline">
            {all ? 'Show less' : `Show all (${more} more)`}
          </button>
        )}
      </div>
    </section>
  );
}
