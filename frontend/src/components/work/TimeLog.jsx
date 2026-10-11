// The time on a ticket or project: entries with who, task, work type,
// billable, duration and cost; edit and delete where the user may; totals
// over the whole ticket or project.
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import LoadMore from '../LoadMore';
import TimeEntryForm from './TimeEntryForm';
import { workPaths } from './workPaths';

const STEP = 25;
export const formatSeconds = (sec) => {
  const m = Math.round((sec || 0) / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TimeLog({
  kind, parentId, tasks = [], canLog, canManageOthers, currentUser, assignableUsers, reloadKey = 0, onChanged,
}) {
  const paths = workPaths(kind, parentId);
  const [data, setData] = useState({ entries: [], total: 0, totalSeconds: 0, totalLaborCost: null });
  const [limit, setLimit] = useState(STEP);
  const [editing, setEditing] = useState(null); // null | 'new' | entry
  const load = useCallback(() => api.get(paths.time, { params: { limit } }).then(({ data: d }) => setData(d)).catch(() => {}), [paths.time, limit]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const mayChange = (e) => e.userId === currentUser.id || e.loggedById === currentUser.id || canManageOthers;
  // Time by task: general time (no task) is the total less every task's time
  // (a task's loggedSeconds already includes its subtasks').
  const onTasks = tasks.reduce((n, t) => n + (t.loggedSeconds || 0), 0);
  const general = Math.max(0, data.totalSeconds - onTasks);
  const changed = () => { load(); onChanged?.(); };
  const remove = async (e) => {
    if (!window.confirm('Delete this time entry?')) return;
    try { await api.delete(paths.entry(e.id)); changed(); } catch (err) { alert(errMessage(err)); }
  };

  return (
    <div className="overflow-x-auto rounded-[10px] border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
      <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="font-semibold text-[var(--color-text-primary)]">Time entries</h2>
        {canLog && <button type="button" onClick={() => setEditing('new')} className="btn-primary">Log time</button>}
      </div>
      {onTasks > 0 && (
        <section aria-label="Time by task" className="border-b p-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
          <p className="mb-2 font-semibold">Time by task</p>
          <ul className="space-y-1">
            <li className="flex justify-between"><span>General ({kind === 'ticket' ? 'the ticket' : 'the project'}, no task)</span><span className="font-mono">{formatSeconds(general)}</span></li>
            {tasks.filter((t) => t.loggedSeconds > 0).map((t) => (
              <li key={t.id}>
                <div className="flex justify-between"><span>{t.code ? `${t.code} ` : ''}{t.title}</span><span className="font-mono">{formatSeconds(t.loggedSeconds)}</span></div>
                {(t.subtasks || []).filter((st) => st.loggedSeconds > 0).map((st) => (
                  <div key={st.id} className="flex justify-between pl-5 text-[var(--color-text-muted)]"><span>{st.code ? `${st.code} ` : ''}{st.title}</span><span className="font-mono">{formatSeconds(st.loggedSeconds)}</span></div>
                ))}
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 font-semibold" style={{ borderColor: 'var(--color-border)' }}><span>Total</span><span className="font-mono">{formatSeconds(data.totalSeconds)}</span></li>
          </ul>
        </section>
      )}
      <table className="min-w-full">
        <thead>
          <tr>{['Date', 'Who', 'Task', 'Work type', 'Note', 'Duration', 'Cost', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.id}>
              <td className="table-td whitespace-nowrap">{e.entryDate}</td>
              <td className="table-td">
                {e.user?.displayName || '—'}
                {e.loggedById && e.loggedById !== e.userId && <span className="block text-xs text-[var(--color-text-muted)]">by {e.loggedBy?.displayName || 'someone'}</span>}
              </td>
              <td className="table-td">{e.task ? `${e.task.code || ''} ${e.task.title}`.trim() : '—'}</td>
              <td className="table-td">
                {e.workType?.name || '—'}
                {!e.billable && <span className="ml-1 rounded bg-[var(--color-hover)] px-1 text-xs">non-billable</span>}
              </td>
              <td className="table-td">{e.note || '—'}</td>
              <td className="table-td font-mono font-semibold">{formatSeconds(e.durationSeconds)}</td>
              <td className="table-td">{e.laborCost != null ? money(e.laborCost) : '—'}</td>
              <td className="table-td whitespace-nowrap text-right">
                {mayChange(e) && (
                  <>
                    <button type="button" onClick={() => setEditing(e)} className="mr-2 text-xs text-[var(--color-accent)]">Edit</button>
                    <button type="button" onClick={() => remove(e)} className="text-xs" style={{ color: 'var(--color-danger)' }}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {data.entries.length === 0 && <tr><td colSpan={8} className="table-td text-[var(--color-text-muted)]">No time logged yet.</td></tr>}
        </tbody>
      </table>
      <LoadMore loaded={data.entries.length} total={data.total} onLoadMore={() => setLimit((n) => n + STEP)} noun="entries" />
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: 'var(--color-border)' }}>
        Total: {formatSeconds(data.totalSeconds)}
        {data.totalLaborCost != null && <span className="ml-4">Labor cost: {money(data.totalLaborCost)}</span>}
      </div>
      {editing && (
        <TimeEntryForm
          kind={kind} parentId={parentId} tasks={tasks} entry={editing === 'new' ? null : editing}
          canManageOthers={canManageOthers} currentUser={currentUser} assignableUsers={assignableUsers}
          onSaved={changed} onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
