import { useState } from 'react';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const PRIORITY_LABELS = { critical: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
export const TICKET_TYPES = ['incident', 'request', 'problem', 'change', 'task'];
export const TYPE_LABELS = {
  incident: 'Incident', request: 'Request', problem: 'Problem', change: 'Change', task: 'Task',
};
export const CLOCKS = [
  { key: 'assign', label: 'Assign within' },
  { key: 'response', label: 'First response within' },
  { key: 'resolution', label: 'Resolve within' },
];

// A target as the editor shows it: an amount and a unit (minutes, hours or
// business days). Hours are stored as minutes; days as a day count.
export function toCell(amount, unit) {
  if (amount == null) return { amount: '', unit: 'hours' };
  if (unit === 'business_days') return { amount: String(amount), unit: 'days' };
  return amount % 60 === 0 ? { amount: String(amount / 60), unit: 'hours' } : { amount: String(amount), unit: 'minutes' };
}
function fromCell({ amount, unit }) {
  const n = Number(amount);
  if (amount === '' || !Number.isInteger(n) || n <= 0) return { amount: null, unit: 'minutes' };
  if (unit === 'days') return { amount: n, unit: 'business_days' };
  return { amount: unit === 'hours' ? n * 60 : n, unit: 'minutes' };
}
export function formatTarget(amount, unit) {
  if (amount == null) return '—';
  const c = toCell(amount, unit);
  return `${c.amount}${{ days: 'd', hours: 'h', minutes: 'm' }[c.unit]}`;
}

const key = (type, priority) => `${type}:${priority}`;

export function formFromPolicy(policy) {
  const targets = {};
  TICKET_TYPES.forEach((type) => PRIORITIES.forEach((p) => {
    const t = policy?.targets?.find((x) => x.ticketType === type && x.priority === p) || {};
    targets[key(type, p)] = {
      assign: toCell(t.assignMinutes, t.assignUnit),
      response: toCell(t.responseMinutes, t.responseUnit),
      resolution: toCell(t.resolutionMinutes, t.resolutionUnit),
      useBusinessHours: t.useBusinessHours ?? true,
    };
  }));
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
    targets: TICKET_TYPES.flatMap((type) => PRIORITIES.map((p) => {
      const row = form.targets[key(type, p)];
      const out = { ticketType: type, priority: p, useBusinessHours: row.useBusinessHours };
      CLOCKS.forEach(({ key: c }) => {
        const { amount, unit } = fromCell(row[c]);
        out[`${c}Minutes`] = amount;
        out[`${c}Unit`] = unit;
      });
      return out;
    })),
  };
}

function TargetCell({ value, onChange, label }) {
  return (
    <div className="flex items-center gap-1">
      <input
        aria-label={`${label} amount`} inputMode="numeric" className="input h-9 w-16 px-2 text-sm" placeholder="–"
        value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value.replace(/\D/g, '') })}
      />
      <select aria-label={`${label} unit`} className="input h-9 w-24 px-1 text-sm" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })}>
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}

export default function SlaPolicyEditor({
  initial, schedules, onSave, onCancel, saving,
}) {
  const [form, setForm] = useState(() => formFromPolicy(initial));
  const [tab, setTab] = useState('incident');
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  const setTarget = (p, field, v) => setForm((f) => {
    const k = key(tab, p);
    return { ...f, targets: { ...f.targets, [k]: { ...f.targets[k], [field]: v } } };
  });
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
        <p className="mb-3 text-xs text-navy-500">
          Set targets for each ticket type and priority. Hours count business hours; days count business days (same time of day).
          The resolve target sets the ticket's due date. Leave a target blank to not track it. Turn off business hours on a row to count every hour.
        </p>
        <div role="tablist" aria-label="Ticket type" className="mb-3 flex flex-wrap gap-1 border-b border-navy-100">
          {TICKET_TYPES.map((t) => (
            <button
              key={t} type="button" role="tab" aria-selected={tab === t}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${tab === t ? 'border-prism text-prism' : 'border-transparent text-navy-500 hover:text-navy-700'}`}
              onClick={() => setTab(t)}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-xs font-semibold uppercase tracking-wide text-navy-400">
                <th className="px-2 py-2">Priority</th>
                {CLOCKS.map((c) => <th key={c.key} className="px-2 py-2">{c.label}</th>)}
                <th className="px-2 py-2">Business hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {PRIORITIES.map((p) => {
                const row = form.targets[key(tab, p)];
                const label = `${TYPE_LABELS[tab]} ${PRIORITY_LABELS[p]}`;
                return (
                  <tr key={p}>
                    <td className="px-2 py-2 font-medium text-navy-900">{PRIORITY_LABELS[p]}</td>
                    {CLOCKS.map((c) => (
                      <td key={c.key} className="px-2 py-2">
                        <TargetCell label={`${label} ${c.label}`} value={row[c.key]} onChange={(v) => setTarget(p, c.key, v)} />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <input
                        type="checkbox" aria-label={`${label} uses business hours`} className="h-4 w-4 rounded border-navy-300 text-prism"
                        checked={row.useBusinessHours} disabled={!form.businessHoursId}
                        onChange={(e) => setTarget(p, 'useBusinessHours', e.target.checked)}
                      />
                    </td>
                  </tr>
                );
              })}
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
