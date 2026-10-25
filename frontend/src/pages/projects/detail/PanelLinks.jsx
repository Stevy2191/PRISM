// The people and dependency sections of the task panel: helpers, "Waiting on"
// and "Holding up".
import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Avatar from '../../../components/ui/Avatar';
import { shortCode, weekdayDate } from './taskFilters';

const linkBtn = 'text-[13px] font-semibold text-[var(--color-accent)] hover:underline';

export function HelpersField({ task, users, canAdd, meId, canEdit, helpersPath, onChanged }) {
  const [adding, setAdding] = useState(false);
  const helpers = task.helpers || [];
  const taken = new Set([task.assigneeId, ...helpers.map((h) => h.id)]);
  const options = users.filter((u) => !taken.has(u.id));

  const run = async (fn) => {
    try { await fn(); } catch (err) { alert(errMessage(err)); }
    await onChanged();
  };
  const add = (userId) => {
    setAdding(false);
    return run(() => api.post(helpersPath, { userId: Number(userId) }));
  };
  const remove = (h) => run(() => api.delete(`${helpersPath}/${h.id}`));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {helpers.length === 0 && !adding && <span className="text-navy-400">None</span>}
      {helpers.map((h) => (
        <span key={h.id} className="inline-flex items-center gap-1.5 rounded-full border border-navy-100 py-0.5 pl-0.5 pr-2 text-sm">
          <Avatar name={h.name} size={22} />
          {h.name}
          {(canEdit || h.id === meId) && (
            <button type="button" aria-label={`Remove ${h.name}`} onClick={() => remove(h)} className="text-navy-400 hover:text-navy-900">
              <IconX size={13} />
            </button>
          )}
        </span>
      ))}
      {canAdd && !adding && <button type="button" className={linkBtn} onClick={() => setAdding(true)}>Add a helper</button>}
      {canAdd && adding && (
        <select
          aria-label="Choose a helper" autoFocus defaultValue="" className="input !h-8 !w-auto"
          onChange={(e) => e.target.value && add(e.target.value)} onBlur={() => setAdding(false)}
        >
          <option value="">Choose a person…</option>
          {options.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      )}
    </div>
  );
}

function Dep({ dep, blocking, showDue, onRemove, onOpen }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5"
      style={blocking
        ? { backgroundColor: 'var(--color-waiting-bg)', borderColor: 'color-mix(in srgb, var(--color-warning) 45%, transparent)' }
        : { borderColor: 'var(--color-border)' }}
    >
      <span className="num text-[13px] text-navy-400">{shortCode(dep.code)}</span>
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onOpen(dep.id)}>{dep.title}</button>
      {showDue && dep.dueDate && <span className="num text-[13px] text-navy-400">due {weekdayDate(dep.dueDate)}</span>}
      {onRemove && (
        <button type="button" aria-label={`Remove link to ${dep.title}`} onClick={() => onRemove(dep)} className="text-navy-400 hover:text-navy-900">
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}

export function Dependencies({ projectId, task, tasks, canEdit, onOpen, onChanged }) {
  const [adding, setAdding] = useState(false);
  const base = `/projects/${projectId}/dependencies`;
  const waitingOn = task.waitingOn || [];
  const holdingUp = task.holdingUp || [];

  const run = async (fn) => {
    try { await fn(); } catch (err) { alert(errMessage(err)); }
    await onChanged();
  };
  const add = (predecessorId) => {
    setAdding(false);
    return run(() => api.post(base, { predecessorId: Number(predecessorId), successorId: task.id }));
  };
  // The link's id is not on the task, so find it by its two ends.
  const unlink = (predecessorId, successorId) => run(async () => {
    const { data } = await api.get(base);
    const link = (data.dependencies || data).find((d) => d.predecessorId === predecessorId && d.successorId === successorId);
    if (link) await api.delete(`${base}/${link.id}`);
  });

  const excluded = new Set([task.id, ...waitingOn.map((d) => d.id), ...holdingUp.map((d) => d.id)]);
  const options = tasks.filter((t) => !excluded.has(t.id));
  const none = <p className="text-sm text-navy-400">Nothing.</p>;

  return (
    <>
      <section>
        <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
          Waiting on <span className="text-[13px] font-normal text-navy-400">must finish before this can start</span>
        </h3>
        <div className="space-y-2">
          {waitingOn.length === 0 && none}
          {waitingOn.map((d) => (
            <Dep key={d.id} dep={d} blocking showDue onOpen={onOpen} onRemove={canEdit ? () => unlink(d.id, task.id) : null} />
          ))}
        </div>
        {canEdit && !adding && <button type="button" className={`${linkBtn} mt-2`} onClick={() => setAdding(true)}>+ Add a task this waits on</button>}
        {canEdit && adding && (
          <select
            aria-label="Choose a task this waits on" autoFocus defaultValue="" className="input mt-2"
            onChange={(e) => e.target.value && add(e.target.value)} onBlur={() => setAdding(false)}
          >
            <option value="">Choose a task…</option>
            {options.map((t) => <option key={t.id} value={t.id}>{shortCode(t.code)} {t.title}</option>)}
          </select>
        )}
      </section>
      <section>
        <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
          Holding up <span className="text-[13px] font-normal text-navy-400">can&apos;t start until this is done</span>
        </h3>
        <div className="space-y-2">
          {holdingUp.length === 0 && none}
          {holdingUp.map((d) => (
            <Dep key={d.id} dep={d} onOpen={onOpen} onRemove={canEdit ? () => unlink(task.id, d.id) : null} />
          ))}
        </div>
      </section>
    </>
  );
}
