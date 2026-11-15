// A company's SLA and hours (CS part 2): its targets by ticket type and
// priority, its support hours and time zone, and its holidays. The same
// editor serves a customer's page, Your company, and the starting values
// for new companies (base = the API path: /companies/:id/sla or
// /sla/starting-values).
import { useEffect, useMemo, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Notice from '../ui/Notice';
import Button from '../ui/Button';
import { zoneOptions } from '../../utils/timeZones';

const TYPES = [['incident', 'Incident'], ['request', 'Request'], ['problem', 'Problem'], ['change', 'Change'], ['task', 'Task']];
const PRIORITIES = [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const DAYS = [['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'], ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday']];
const input = 'h-9 rounded-md border border-navy-200 bg-surface px-2 text-sm';

// A target as an amount and a unit people read: 90 → 1.5 hours.
const UNIT_MIN = { minutes: 1, hours: 60, days: 1440 };
function split(minutes, unit) {
  if (minutes === null || minutes === undefined) return { amount: '', unit: 'hours' };
  if (unit === 'business_days') return { amount: String(Math.round(minutes / 1440)), unit: 'business_days' };
  if (minutes % 1440 === 0) return { amount: String(minutes / 1440), unit: 'days' };
  if (minutes % 60 === 0) return { amount: String(minutes / 60), unit: 'hours' };
  return { amount: String(minutes), unit: 'minutes' };
}
function join(amount, unit) {
  const n = Number(amount);
  if (amount === '' || !Number.isFinite(n) || n <= 0) return { minutes: null, unit: 'minutes' };
  if (unit === 'business_days') return { minutes: Math.round(n) * 1440, unit: 'business_days' };
  return { minutes: Math.round(n * UNIT_MIN[unit]), unit: 'minutes' };
}

function TargetCell({ value, unit, onChange, label, disabled }) {
  const v = split(value, unit);
  return (
    <span className="inline-flex gap-1">
      <input className={`${input} w-16`} inputMode="decimal" aria-label={`${label}: amount`} value={v.amount} placeholder="—" disabled={disabled}
        onChange={(e) => onChange(join(e.target.value, v.unit))} />
      <select className={input} aria-label={`${label}: unit`} value={v.unit} disabled={disabled} onChange={(e) => onChange(join(v.amount || '1', e.target.value))}>
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
        <option value="business_days">business days</option>
      </select>
    </span>
  );
}

export default function CompanySla({ base, who = 'this company' }) {
  const [sla, setSla] = useState(null);
  const [canChange, setCanChange] = useState(true);
  const [form, setForm] = useState(null);
  const [type, setType] = useState('incident');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [day, setDay] = useState({ name: '', date: '' });

  const take = (data) => {
    setSla(data.sla);
    setForm({
      warnAtPercent: data.sla.warnAtPercent, timezone: data.sla.timezone, is24x7: data.sla.is24x7, schedule: data.sla.schedule, targets: data.sla.targets,
    });
    if (data.canChange !== undefined) setCanChange(data.canChange);
  };
  useEffect(() => { api.get(base).then(({ data }) => take(data)).catch((err) => setError(errMessage(err))); }, [base]);
  const dirty = useMemo(() => sla && form && JSON.stringify({
    warnAtPercent: sla.warnAtPercent, timezone: sla.timezone, is24x7: sla.is24x7, schedule: sla.schedule, targets: sla.targets,
  }) !== JSON.stringify(form), [sla, form]);

  if (error && !sla) return <Notice tone="bad">{error}</Notice>;
  if (!form) return <Spinner />;

  const set = (patch) => { setSaved(false); setForm((f) => ({ ...f, ...patch })); };
  const setTarget = (priority, clock, { minutes, unit }) => set({
    targets: { ...form.targets, [type]: { ...form.targets[type], [priority]: { ...form.targets[type][priority], [`${clock}Minutes`]: minutes, [`${clock}Unit`]: unit } } },
  });
  const setClock = (priority, useBusinessHours) => set({
    targets: { ...form.targets, [type]: { ...form.targets[type], [priority]: { ...form.targets[type][priority], useBusinessHours } } },
  });
  const setDayHours = (d, patch) => set({ schedule: { ...form.schedule, [d]: { ...form.schedule[d], ...patch } } });
  const call = async (fn) => {
    setError('');
    try { const { data } = await fn(); take(data); return true; } catch (err) { setError(errMessage(err)); return false; }
  };
  const save = async () => { setSaving(true); if (await call(() => api.put(base, form))) setSaved(true); setSaving(false); };
  const ro = !canChange;

  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      {ro && <Notice tone="info">Changing an SLA needs the System settings permission.</Notice>}

      <section className="card overflow-hidden" aria-label="SLA targets">
        <div className="flex flex-wrap items-center gap-3 border-b border-navy-100 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-navy-900">SLA targets</h3>
            <p className="text-xs text-navy-500">How fast {who}&apos;s tickets are answered and resolved. Empty means no target.</p>
          </div>
          <div role="group" aria-label="Ticket type" className="flex flex-wrap gap-1">
            {TYPES.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold max-sm:min-h-[40px] ${type === k ? 'border-prism-accent text-navy-900' : 'border-navy-100 text-navy-500'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-navy-400">
                <th className="px-5 py-2 font-semibold">Priority</th>
                <th className="px-3 py-2 font-semibold">First response within</th>
                <th className="px-3 py-2 font-semibold">Resolved within</th>
                <th className="px-3 py-2 font-semibold">The clock runs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {PRIORITIES.map(([p, label]) => {
                const t = form.targets[type][p];
                return (
                  <tr key={p}>
                    <td className="px-5 py-2 font-semibold">{label}</td>
                    <td className="px-3 py-2"><TargetCell label={`${label} first response`} value={t.responseMinutes} unit={t.responseUnit} disabled={ro} onChange={(v) => setTarget(p, 'response', v)} /></td>
                    <td className="px-3 py-2"><TargetCell label={`${label} resolved`} value={t.resolutionMinutes} unit={t.resolutionUnit} disabled={ro} onChange={(v) => setTarget(p, 'resolution', v)} /></td>
                    <td className="px-3 py-2">
                      <select className={input} aria-label={`${label}: when the clock runs`} value={t.useBusinessHours ? 'hours' : 'always'} disabled={ro} onChange={(e) => setClock(p, e.target.value === 'hours')}>
                        <option value="hours">In support hours</option>
                        <option value="always">Around the clock</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy-100 px-5 py-3 text-sm">
          <label className="flex items-center gap-2">
            Warn the assignee at
            <input className={`${input} w-16`} type="number" min="1" max="99" aria-label="Warn at percent of the time" value={form.warnAtPercent} disabled={ro}
              onChange={(e) => set({ warnAtPercent: Number(e.target.value) })} />
            % of the time
          </label>
          <span className="text-xs text-navy-500">New tickets use these from the moment you save. Tickets already open keep their due dates.</span>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section className="card min-w-0 flex-[999_1_480px] overflow-hidden" aria-label="Support hours">
          <div className="flex flex-wrap items-center gap-3 border-b border-navy-100 px-5 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-navy-900">Support hours</h3>
              <p className="text-xs text-navy-500">When {who}&apos;s SLA clock runs. Due dates are shown in this time zone.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={form.is24x7} disabled={ro} onChange={(e) => set({ is24x7: e.target.checked })} />
              Around the clock
            </label>
          </div>
          <div className="divide-y divide-navy-100 text-sm">
            <label className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="font-semibold">Time zone</span>
              <select className={input} value={form.timezone} disabled={ro} onChange={(e) => set({ timezone: e.target.value })} aria-label="Time zone">
                {zoneOptions(form.timezone).map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>
            {!form.is24x7 && DAYS.map(([d, label]) => {
              const h = form.schedule[d] || { enabled: false, start: '08:00', end: '17:00' };
              return (
                <div key={d} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                  <label className="flex items-center gap-2 font-semibold">
                    <input type="checkbox" className="h-4 w-4" checked={!!h.enabled} disabled={ro} onChange={(e) => setDayHours(d, { enabled: e.target.checked })} />
                    {label}
                  </label>
                  {h.enabled ? (
                    <span className="flex items-center gap-1.5">
                      <input type="time" className={input} aria-label={`${label} opens`} value={h.start} disabled={ro} onChange={(e) => setDayHours(d, { start: e.target.value })} />
                      to
                      <input type="time" className={input} aria-label={`${label} closes`} value={h.end} disabled={ro} onChange={(e) => setDayHours(d, { end: e.target.value })} />
                    </span>
                  ) : <span className="text-navy-400">Closed</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card min-w-0 flex-[1_1_300px] overflow-hidden" aria-label="Holidays">
          <div className="border-b border-navy-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-navy-900">Holidays</h3>
            <p className="text-xs text-navy-500">{who === 'your company' ? 'The SLA clock stops all day, and these are the days your staff are off in Workload.' : 'The SLA clock stops all day.'}</p>
          </div>
          <ul className="divide-y divide-navy-100 text-sm">
            {sla.holidays.length === 0 && <li className="px-5 py-3 text-navy-400">No holidays yet.</li>}
            {sla.holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-5 py-2">
                <span>{h.name}</span>
                <span className="flex items-center gap-2 text-navy-500">
                  {h.date}
                  {!ro && <Button size="sm" variant="quiet" aria-label={`Remove ${h.name}`} onClick={() => call(() => api.delete(`${base}/holidays/${h.id}`))}>Remove</Button>}
                </span>
              </li>
            ))}
          </ul>
          {!ro && (
            <form className="flex flex-wrap gap-2 border-t border-navy-100 px-5 py-3" onSubmit={async (e) => { e.preventDefault(); if (await call(() => api.post(`${base}/holidays`, day))) setDay({ name: '', date: '' }); }}>
              <input className={`${input} min-w-0 flex-1`} placeholder="Name" aria-label="Holiday name" value={day.name} onChange={(e) => setDay({ ...day, name: e.target.value })} />
              <input type="date" className={input} aria-label="Holiday date" value={day.date} onChange={(e) => setDay({ ...day, date: e.target.value })} />
              <Button size="sm" type="submit" disabled={!day.name.trim() || !day.date}>Add a day</Button>
            </form>
          )}
        </section>
      </div>

      {!ro && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {saved && !dirty && <span className="text-xs text-navy-500">Saved</span>}
          {base.startsWith('/companies/') && (
            <Button variant="quiet" onClick={() => { if (window.confirm(`Replace ${who}'s targets, hours and holidays with the starting values?`)) call(() => api.post(`${base}/reset`)); }}>
              Reset to the starting values
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </div>
  );
}
