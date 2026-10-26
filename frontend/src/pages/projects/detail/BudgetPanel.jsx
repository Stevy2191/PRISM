// The Time tab's budget view: where the time went by phase and by person, with
// the billable split, and the budget editor beside it. Only people with edit
// access on the project can save; everyone else sees the same numbers.
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Notice from '../../../components/ui/Notice';
import { hoursFromMinutes } from './taskFilters';
import { parseHours, hoursInput, barShape } from './budgetFormat';

const OVER = { color: 'var(--color-danger)' };

function PhaseBars({ phases }) {
  const scaleMax = Math.max(0, ...phases.map((p) => p.usedMinutes));
  return (
    <div className="grid gap-3 px-5 pb-4 pt-3">
      {phases.map((p) => {
        const over = p.budgetMinutes > 0 && p.usedMinutes > p.budgetMinutes;
        const { width, mark } = barShape(p.usedMinutes, p.budgetMinutes, scaleMax);
        return (
          <div key={p.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm max-sm:grid-cols-[1fr_auto]">
            <span className="truncate">{p.name}</span>
            <div className="relative h-2.5 rounded-full bg-navy-100 max-sm:order-last max-sm:col-span-2" aria-hidden="true">
              <i className="absolute inset-y-0 left-0 block rounded-full" style={{ width: `${width}%`, backgroundColor: over ? 'var(--color-danger)' : 'var(--color-accent)' }} />
              {mark != null && <b className="absolute -inset-y-1 w-0.5 rounded" style={{ left: `${mark}%`, backgroundColor: 'var(--color-text-primary)' }} />}
            </div>
            <span className="num whitespace-nowrap text-[13px] text-navy-500" style={over ? OVER : undefined}>
              {p.budgetMinutes ? `${hoursFromMinutes(p.usedMinutes)} of ${hoursFromMinutes(p.budgetMinutes)} h` : `${hoursFromMinutes(p.usedMinutes)} h`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WhereTheTimeWent({ budget }) {
  const { phases, people, billableMinutes, usedMinutes, noTaskMinutes } = budget;
  const notBillable = Math.max(0, usedMinutes - billableMinutes);
  return (
    <section className="rounded-xl border border-navy-100 bg-surface" aria-label="Where the time went">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h2 className="text-base font-semibold">Where the time went</h2>
        {phases.some((p) => p.budgetMinutes) && <span className="text-[13px] text-navy-400">The black line is each phase&apos;s budget</span>}
      </div>
      {phases.length > 0
        ? <PhaseBars phases={phases} />
        : <p className="px-5 py-4 text-sm text-navy-400">This project has no phases yet.</p>}
      {noTaskMinutes > 0 && <p className="px-5 pb-3 text-[13px] text-navy-400">{hoursFromMinutes(noTaskMinutes)} h was logged on no task.</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-navy-100 px-5 py-3 text-sm">
        {people.length === 0 && <span className="text-navy-400">No time logged yet.</span>}
        {people.map((p) => (
          <span key={p.userId} className="inline-flex items-center gap-2">
            <Avatar name={p.name || 'Former user'} size={22} />
            {p.name || 'Former user'} <b className="num">{hoursFromMinutes(p.minutes)} h</b>
          </span>
        ))}
        {usedMinutes > 0 && (
          <span className="text-[13px] text-navy-400">
            · {hoursFromMinutes(billableMinutes)} h billable, {hoursFromMinutes(notBillable)} h not billable
          </span>
        )}
      </div>
    </section>
  );
}

function BudgetEditor({ project, budget, canEdit, onSaved }) {
  const fresh = useCallback(() => ({
    total: hoursInput(budget.budgetMinutes),
    phases: Object.fromEntries(budget.phases.map((p) => [p.id, hoursInput(p.budgetMinutes)])),
    alert80: project.budgetAlert80 !== false,
    alert100: project.budgetAlert100 !== false,
  }), [budget, project.budgetAlert80, project.budgetAlert100]);
  const [form, setForm] = useState(fresh);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(fresh()); }, [fresh]);

  const totalMinutes = parseHours(form.total);
  const phaseMinutes = (id) => parseHours(form.phases[id]);
  const bad = Number.isNaN(totalMinutes) || budget.phases.some((p) => Number.isNaN(phaseMinutes(p.id)));
  const phaseSum = budget.phases.reduce((n, p) => n + (phaseMinutes(p.id) || 0), 0);

  const save = async () => {
    if (bad) { setError('Enter hours as a number, like 80 or 7.5.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.patch(`/projects/${project.id}`, {
        hourBudgetMinutes: totalMinutes, budgetAlert80: form.alert80, budgetAlert100: form.alert100,
      });
      for (const p of budget.phases) {
        const next = phaseMinutes(p.id) || null;
        if (next !== (p.budgetMinutes || null)) await api.patch(`/projects/${project.id}/phases/${p.id}`, { hourBudgetMinutes: next }); // eslint-disable-line no-await-in-loop
      }
      await onSaved();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const ro = !canEdit;
  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-navy-100 bg-surface p-5" aria-label="Edit hour budget">
      <h2 className="text-base font-semibold">Hour budget</h2>
      <Field label="Project budget" hint={ro ? undefined : 'Leave empty for no budget.'}>
        <input className="input num" inputMode="decimal" value={form.total} readOnly={ro} placeholder="No budget" onChange={(e) => set({ total: e.target.value })} />
      </Field>
      {budget.phases.length > 0 && (
        <div>
          <span className="text-[13px] font-medium text-navy-500">Split by phase <span className="font-normal text-navy-400">(optional)</span></span>
          <div className="mt-1.5 grid gap-2">
            {budget.phases.map((p) => {
              const over = p.budgetMinutes > 0 && p.usedMinutes > p.budgetMinutes;
              return (
                <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-2 text-sm">
                  <span className="truncate">{p.name}</span>
                  <input
                    className="input num" inputMode="decimal" aria-label={`${p.name} budget`} readOnly={ro}
                    value={form.phases[p.id] ?? ''} onChange={(e) => set({ phases: { ...form.phases, [p.id]: e.target.value } })}
                  />
                  <span className="num text-right text-[13px] text-navy-400" style={over ? OVER : undefined}>{hoursFromMinutes(p.usedMinutes)} used</span>
                </div>
              );
            })}
          </div>
          {totalMinutes > 0 && (
            <p className="mt-2 text-[12.5px] text-navy-400">
              Phase budgets add up to {hoursFromMinutes(phaseSum)} of {hoursFromMinutes(totalMinutes)} h.
            </p>
          )}
        </div>
      )}
      <div>
        <span className="text-[13px] font-medium text-navy-500">Tell the project lead when it reaches</span>
        {[['alert80', '80% of the budget'], ['alert100', '100% of the budget']].map(([key, label]) => (
          <label key={key} className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={ro} checked={form[key]} onChange={(e) => set({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-sm" style={OVER}>{error}</p>}
      {canEdit
        ? (
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setForm(fresh()); setError(''); }}>Cancel</Button>
            <Button variant="primary" disabled={saving} onClick={save}>Save budget</Button>
          </div>
        )
        : <p className="text-[13px] text-navy-400">You can see the budget but not change it.</p>}
    </aside>
  );
}

export default function BudgetPanel({ project, canEdit, version, onSaved }) {
  const [budget, setBudget] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/projects/${project.id}/budget`)
    .then(({ data }) => { setBudget(data.budget); setError(''); })
    .catch((err) => setError(errMessage(err))), [project.id]);
  useEffect(() => { load(); }, [load, version]);

  const saved = async () => { await load(); await onSaved(); };
  if (error) return <Notice tone="bad" className="mt-5">{error}</Notice>;
  if (!budget) return null;
  const over = budget.budgetMinutes > 0 && budget.usedMinutes > budget.budgetMinutes;
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-3">
        <WhereTheTimeWent budget={budget} />
        {over && budget.remainingEstimateMinutes > 0 && (
          <p className="text-[13px] text-navy-400">The remaining tasks are estimated at {hoursFromMinutes(budget.remainingEstimateMinutes)} more hours.</p>
        )}
      </div>
      <BudgetEditor project={project} budget={budget} canEdit={canEdit} onSaved={saved} />
    </div>
  );
}
