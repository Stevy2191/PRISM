import { useState } from 'react';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const PRIORITY_LABELS = { critical: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
export const CLOCKS = [
  { key: 'assign', label: 'Assign within' },
  { key: 'response', label: 'First response within' },
  { key: 'resolution', label: 'Resolve within' },
];

// Minutes ↔ the two inputs a target cell shows. Both blank = not tracked.
const toParts = (minutes) => (minutes == null ? { h: '', m: '' } : { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) });
function toMinutes({ h, m }) {
  if (h === '' && m === '') return null;
  const total = (Number(h) || 0) * 60 + (Number(m) || 0);
  return total > 0 ? total : null;
}

export function formFromPolicy(policy) {
  const targets = {};
  PRIORITIES.forEach((p) => {
    const t = policy?.targets?.find((x) => x.priority === p) || {};
    targets[p] = {
      assign: toParts(t.assignMinutes), response: toParts(t.responseMinutes), resolution: toParts(t.resolutionMinutes),
      useBusinessHours: t.useBusinessHours ?? true,
    };
  });
  return {
    name: policy?.name || '',
    businessHoursId: policy?.businessHoursId ? String(policy.businessHoursId) : '',
    warnAtPercent: String(policy?.warnAtPercent ?? 75),
    companyIds: (policy?.companies || []).map((c) => c.id),
    targets,
  };
}

export function payloadFromForm(form) {
  return {
    name: form.name,
    businessHoursId: form.businessHoursId ? Number(form.businessHoursId) : null,
    warnAtPercent: Number(form.warnAtPercent),
    companyIds: form.companyIds,
    targets: PRIORITIES.map((p) => ({
      priority: p,
      assignMinutes: toMinutes(form.targets[p].assign),
      responseMinutes: toMinutes(form.targets[p].response),
      resolutionMinutes: toMinutes(form.targets[p].resolution),
      useBusinessHours: form.targets[p].useBusinessHours,
    })),
  };
}

function TargetCell({ value, onChange, label }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value.replace(/\D/g, '') });
  return (
    <div className="flex items-center gap-1">
      <input aria-label={`${label} hours`} inputMode="numeric" className="input h-9 w-14 px-2 text-sm" placeholder="–" value={value.h} onChange={set('h')} />
      <span className="text-xs text-navy-400">h</span>
      <input aria-label={`${label} minutes`} inputMode="numeric" className="input h-9 w-12 px-2 text-sm" placeholder="–" value={value.m} onChange={set('m')} />
      <span className="text-xs text-navy-400">m</span>
    </div>
  );
}

export default function SlaPolicyEditor({
  initial, schedules, onSave, onCancel, saving,
}) {
  const [form, setForm] = useState(() => formFromPolicy(initial));
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  const setTarget = (p, key, v) => setForm((f) => ({ ...f, targets: { ...f.targets, [p]: { ...f.targets[p], [key]: v } } }));
  const toggleCompany = (id) => setForm((f) => ({
    ...f, companyIds: f.companyIds.includes(id) ? f.companyIds.filter((x) => x !== id) : [...f.companyIds, id],
  }));

  return (
    <form className="card space-y-5 p-5" onSubmit={(e) => { e.preventDefault(); onSave(payloadFromForm(form)); }}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="sla-name">Name</label>
          <input id="sla-name" className="input" required maxLength={100} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="label" htmlFor="sla-hours">Business hours</label>
          <select id="sla-hours" className="input" value={form.businessHoursId} onChange={(e) => setForm((f) => ({ ...f, businessHoursId: e.target.value }))}>
            <option value="">24×7 (every hour counts)</option>
            {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sla-warn">Warn at (% of target)</label>
          <input id="sla-warn" type="number" min="1" max="99" className="input" value={form.warnAtPercent} onChange={(e) => setForm((f) => ({ ...f, warnAtPercent: e.target.value }))} />
        </div>
      </div>

      <div>
        <p className="eyebrow mb-2">Targets</p>
        <p className="mb-3 text-xs text-navy-500">Leave a target blank to not track that clock for that priority. Turn off business hours on a row to count every hour for it (for example, urgent tickets around the clock).</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-xs font-semibold uppercase tracking-wide text-navy-400">
                <th className="px-2 py-2">Priority</th>
                {CLOCKS.map((c) => <th key={c.key} className="px-2 py-2">{c.label}</th>)}
                <th className="px-2 py-2">Business hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {PRIORITIES.map((p) => (
                <tr key={p}>
                  <td className="px-2 py-2 font-medium text-navy-900">{PRIORITY_LABELS[p]}</td>
                  {CLOCKS.map((c) => (
                    <td key={c.key} className="px-2 py-2">
                      <TargetCell label={`${PRIORITY_LABELS[p]} ${c.label}`} value={form.targets[p][c.key]} onChange={(v) => setTarget(p, c.key, v)} />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <input
                      type="checkbox" aria-label={`${PRIORITY_LABELS[p]} uses business hours`} className="h-4 w-4 rounded border-navy-300 text-prism"
                      checked={form.targets[p].useBusinessHours} disabled={!form.businessHoursId}
                      onChange={(e) => setTarget(p, 'useBusinessHours', e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {multiCompany && companies.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Companies on this policy</p>
          <p className="mb-2 text-xs text-navy-500">A company is on one policy at a time; companies not on any policy use the default.</p>
          <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {companies.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-navy-700">
                <input type="checkbox" className="h-4 w-4 rounded border-navy-300 text-prism" checked={form.companyIds.includes(c.id)} onChange={() => toggleCompany(c.id)} />
                {c.name}{c.isInternal ? ' (internal)' : ''}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save policy'}</button>
      </div>
    </form>
  );
}
