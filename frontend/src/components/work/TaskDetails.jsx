// A task's details, inline under its row: fields, subtasks, time on the
// task, a timer on it. Saves each field as it changes.
import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import TimerButton from './TimerButton';
import EditableCode from './EditableCode';
import TimeEntryForm from './TimeEntryForm';
import { formatSeconds } from './TimeLog';
import { workPaths } from './workPaths';

const field = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };
const label = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';
const PRIORITIES = [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

export default function TaskDetails({
  kind, parentId, task, tasks, statuses, assignableUsers, canEdit, canLog, canManageOthers, currentUser, timerLabel, onChanged,
}) {
  const paths = workPaths(kind, parentId);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [estimate, setEstimate] = useState(task.estimateMinutes ?? '');
  // Follow the server's values when the task reloads (the panel stays
  // mounted, so open forms and drafts survive a reload).
  useEffect(() => { setTitle(task.title); }, [task.title]);
  useEffect(() => { setDescription(task.description || ''); }, [task.description]);
  useEffect(() => { setEstimate(task.estimateMinutes ?? ''); }, [task.estimateMinutes]);
  const [newSubtask, setNewSubtask] = useState('');
  const [loggingFor, setLoggingFor] = useState(null); // task or subtask id the Log time form is for
  const [stoppedTimer, setStoppedTimer] = useState(null);

  const patch = async (id, changes) => {
    try { await api.patch(paths.task(id), changes); onChanged(); } catch (err) { alert(errMessage(err)); }
  };
  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    try {
      await api.post(paths.tasks, { title: newSubtask.trim(), parentTaskId: task.id });
      setNewSubtask('');
      onChanged();
    } catch (err) { alert(errMessage(err)); }
  };
  const removeTask = async (id, what) => {
    if (!window.confirm(`Delete this ${what}?`)) return;
    try { await api.delete(paths.task(id)); onChanged(); } catch (err) { alert(errMessage(err)); }
  };
  const toggle = (st) => {
    const closed = st.status?.behaviorType === 'closed';
    const next = statuses.find((s) => s.behaviorType === (closed ? 'open' : 'closed'));
    if (next) patch(st.id, { statusId: next.id });
  };

  return (
    <section aria-label="Task details" className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }} onClick={(e) => e.stopPropagation()}>
      <fieldset disabled={!canEdit} className="space-y-3">
        <div>
          <label className={label} htmlFor={`t-title-${task.id}`}>Title</label>
          <input id={`t-title-${task.id}`} className="input" style={field} value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title.trim() !== task.title) patch(task.id, { title: title.trim() }); else setTitle(task.title); }} />
        </div>
        <div>
          <label className={label} htmlFor={`t-desc-${task.id}`}>Description</label>
          <textarea id={`t-desc-${task.id}`} className="input resize-y" style={{ ...field, minHeight: '60px' }} value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => { if (description !== (task.description || '')) patch(task.id, { description }); }} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label className={label} htmlFor={`t-status-${task.id}`}>Status</label>
            <select id={`t-status-${task.id}`} className="input" style={field} value={task.statusId} onChange={(e) => patch(task.id, { statusId: Number(e.target.value) })}>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`t-prio-${task.id}`}>Priority</label>
            <select id={`t-prio-${task.id}`} className="input" style={field} value={task.priority} onChange={(e) => patch(task.id, { priority: e.target.value })}>
              {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`t-assignee-${task.id}`}>Assignee</label>
            <select id={`t-assignee-${task.id}`} className="input" style={field} value={task.assigneeId || ''} onChange={(e) => patch(task.id, { assigneeId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`t-due-${task.id}`}>Due date</label>
            <input id={`t-due-${task.id}`} type="date" className="input" style={field} value={task.dueDate || ''} onChange={(e) => patch(task.id, { dueDate: e.target.value || null })} />
          </div>
          <div>
            <label className={label} htmlFor={`t-est-${task.id}`}>Estimate (min)</label>
            <input id={`t-est-${task.id}`} type="number" min="0" className="input" style={field} value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              onBlur={() => {
                const v = estimate === '' ? null : Number(estimate);
                if (v !== (task.estimateMinutes ?? null)) patch(task.id, { estimateMinutes: v });
              }} />
          </div>
        </div>
      </fieldset>

      <div>
        <p className={label}>Subtasks</p>
        <ul className="space-y-1">
          {(task.subtasks || []).map((st) => (
            <li key={st.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label={`Complete ${st.title}`} disabled={!canEdit} checked={st.status?.behaviorType === 'closed'} onChange={() => toggle(st)} />
              {st.code && (
                <EditableCode code={st.code} letter="S" disabled={!canEdit}
                  onRename={async (number) => { await api.patch(paths.code(st.id), { number }); onChanged(); }} />
              )}
              <span className="flex-1">{st.title}</span>
              <span className="font-mono text-xs text-[var(--color-text-muted)]" title="Time on this subtask">{formatSeconds(st.loggedSeconds)}</span>
              {canLog && (
                <>
                  <TimerButton kind={kind} parentId={parentId} taskId={st.id} label={`${timerLabel} · ${st.title}`} onStopRequest={setStoppedTimer} compact target={st.title} />
                  <button type="button" aria-label={`Log time on ${st.title}`} onClick={() => setLoggingFor(st.id)} className="text-xs font-medium text-[var(--color-accent)]">Log time</button>
                </>
              )}
              {canEdit && <button type="button" aria-label={`Delete ${st.title}`} onClick={() => removeTask(st.id, 'subtask')} style={{ color: 'var(--color-danger)' }}><IconX size={14} /></button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <input className="input mt-2 h-9 text-sm" style={field} placeholder="Add a subtask…" value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--color-text-muted)]">Time on this task: <span className="font-mono font-semibold text-[var(--color-text-primary)]">{formatSeconds(task.loggedSeconds)}</span></span>
        {canLog && (
          <>
            <TimerButton kind={kind} parentId={parentId} taskId={task.id} label={`${timerLabel} · ${task.title}`} onStopRequest={setStoppedTimer} compact />
            <button type="button" onClick={() => setLoggingFor(task.id)} className="text-sm font-medium text-[var(--color-accent)]">Log time on this task</button>
          </>
        )}
        {canEdit && <button type="button" onClick={() => removeTask(task.id, 'task and its subtasks')} className="ml-auto text-sm" style={{ color: 'var(--color-danger)' }}>Delete task</button>}
      </div>
      {(loggingFor || stoppedTimer) && (
        <TimeEntryForm
          kind={kind} parentId={parentId} tasks={tasks} defaultTaskId={loggingFor || task.id} timer={stoppedTimer}
          canManageOthers={canManageOthers} currentUser={currentUser} assignableUsers={assignableUsers}
          onSaved={onChanged} onClose={() => { setLoggingFor(null); setStoppedTimer(null); }}
        />
      )}
    </section>
  );
}
