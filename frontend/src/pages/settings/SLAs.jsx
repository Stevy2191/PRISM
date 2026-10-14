import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import SlaPolicyEditor, {
  PRIORITIES, PRIORITY_LABELS, TICKET_TYPES, TYPE_LABELS, formatTarget,
} from './SlaPolicyEditor';

export default function SLAs() {
  const [policies, setPolicies] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | { policy } (policy null = new)
  const [saving, setSaving] = useState(false);

  const load = () => Promise.all([api.get('/sla-policies'), api.get('/business-hours')])
    .then(([p, b]) => { setPolicies(p.data.policies); setSchedules(b.data.businessHours); })
    .catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);

  const save = async (payload) => {
    setSaving(true);
    setError('');
    try {
      if (editing.policy) await api.patch(`/sla-policies/${editing.policy.id}`, payload);
      else await api.post('/sla-policies', payload);
      setEditing(null);
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn) => {
    setError('');
    try { await fn(); await load(); } catch (err) { setError(errMessage(err)); }
  };
  const makeDefault = (p) => act(() => api.post(`/sla-policies/${p.id}/default`));
  const remove = (p) => {
    if (!window.confirm(`Delete the "${p.name}" policy? Its companies and open tickets move to the default policy.`)) return;
    act(() => api.delete(`/sla-policies/${p.id}`));
  };

  if (!policies) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  return (
    <SettingsPage
      description="SLA policies set how quickly tickets must be assigned, first answered and resolved, per priority. A ticket uses its company's policy, or the default. The resolve target sets each ticket's due date; time counts during the policy's business hours and never pauses."
      actions={editing === null && <button type="button" className="btn-primary" onClick={() => setEditing({ policy: null })}>+ New policy</button>}
    >
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {editing !== null ? (
        <SlaPolicyEditor
          key={editing.policy?.id || 'new'}
          initial={editing.policy}
          schedules={schedules}
          saving={saving}
          onSave={save}
          onCancel={() => { setEditing(null); setError(''); }}
        />
      ) : (
        <div className="space-y-3">
          {policies.map((p) => (
            <div key={p.id} className="card p-4" data-testid="sla-policy">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-navy-900">
                    {p.name}
                    {p.isDefault && <span className="ml-2 rounded-sm bg-prism/10 px-1.5 py-0.5 text-xs font-medium text-prism">Default</span>}
                  </h3>
                  <p className="text-xs text-navy-500">
                    {p.businessHours ? p.businessHours.name : '24×7'} · warns at {p.warnAtPercent}%
                    {p.companies.length > 0 && ` · ${p.companies.map((c) => c.name).join(', ')}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => setEditing({ policy: p })}>Edit</button>
                  {!p.isDefault && <button type="button" className="btn-secondary text-xs" onClick={() => makeDefault(p)}>Make default</button>}
                  <button
                    type="button" className="btn-secondary text-xs" disabled={p.isDefault}
                    title={p.isDefault ? 'Make another policy the default first' : undefined}
                    onClick={() => remove(p)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <p className="mb-1 text-xs text-navy-400">Resolve within</p>
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="text-left text-navy-400">
                      <th className="py-1 pr-3 font-medium">Type</th>
                      {PRIORITIES.map((pr) => <th key={pr} className="py-1 pr-3 font-medium">{PRIORITY_LABELS[pr]}</th>)}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-navy-700">
                    {TICKET_TYPES.map((type) => (
                      <tr key={type}>
                        <td className="py-1 pr-3 font-sans">{TYPE_LABELS[type]}</td>
                        {PRIORITIES.map((pr) => {
                          const t = p.targets.find((x) => x.ticketType === type && x.priority === pr);
                          return <td key={pr} className="py-1 pr-3">{t ? formatTarget(t.resolutionMinutes, t.resolutionUnit) : '—'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsPage>
  );
}
