// Settings → Recurring tickets (5b): rules that open a ticket on a schedule.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function scheduleSummary(r) {
  const every = (unit) => (r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`);
  let when;
  if (r.frequency === 'daily') when = every('day');
  else if (r.frequency === 'weekly') when = `${every('week')} on ${(r.weekdays || []).map((d) => DAY_NAMES[d]).join(', ')}`;
  else if (r.frequency === 'monthly') when = `${every('month')} on day ${r.dayOfMonth}`;
  else when = `${every('year')} on ${MONTHS[(r.monthOfYear || 1) - 1]} ${r.dayOfMonth}`;
  return `${when} at ${r.timeOfDay} (${r.timezone})`;
}

const fmt = (v) => (v ? new Date(v).toLocaleString() : '—');

export default function RecurringTickets() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = () => {
    api.get('/recurring-tickets')
      .then(({ data }) => setRules(data.rules))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const act = async (r, fn) => {
    setBusy(r.id);
    try { await fn(); load(); } catch (err) { alert(errMessage(err)); } finally { setBusy(null); }
  };
  const toggle = (r) => act(r, () => api.patch(`/recurring-tickets/${r.id}`, { active: !r.active }));
  const runNow = (r) => act(r, async () => {
    const { data } = await api.post(`/recurring-tickets/${r.id}/run`);
    alert(`Created ticket #${String(data.ticket.id).padStart(5, '0')}`);
  });
  const remove = (r) => {
    if (!confirm(`Delete "${r.title}"? Tickets it already made stay.`)) return;
    act(r, () => api.delete(`/recurring-tickets/${r.id}`));
  };

  if (loading) return <Spinner />;

  return (
    <SettingsPage description="Tickets opened automatically on a schedule — one per run, nothing piled up after downtime. Each rule runs with the access of whoever last saved it.">
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <div><Link to="/settings/recurring-tickets/new" className="btn-primary">New recurring ticket</Link></div>
      <div className="card divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {rules.map((r) => {
          const state = r.active ? 'Active' : (r.nextRunAt ? 'Paused' : (r.lastError ? 'Paused' : 'Ended'));
          return (
            <div key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="recurring-row">
              <div className="min-w-0">
                <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {r.title} <span className="eyebrow ml-2">{state}</span>
                </p>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{scheduleSummary(r)}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {r.contact ? `For ${r.contact.displayName}` : 'No contact'} · Next run {r.active ? fmt(r.nextRunAt) : '—'} · Runs as {r.runsAs?.displayName || '—'}
                </p>
                {r.lastError && <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{r.lastError}</p>}
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-3 text-xs">
                <button type="button" disabled={busy === r.id} className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => runNow(r)}>Run now</button>
                <button type="button" disabled={busy === r.id} className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => toggle(r)}>{r.active ? 'Pause' : 'Resume'}</button>
                <Link to={`/settings/recurring-tickets/${r.id}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>edit</Link>
                <button type="button" disabled={busy === r.id} className="text-red-500 hover:underline" onClick={() => remove(r)}>delete</button>
              </div>
            </div>
          );
        })}
        {rules.length === 0 && <div className="p-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>No recurring tickets yet.</div>}
      </div>
    </SettingsPage>
  );
}
