// The docked task panel on the Tasks tab: editable fields, helpers, what the
// task waits on and holds up, subtasks, quick time, notes and activity. Each
// field saves as it changes; with no edit access it all reads as text.
import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Button from '../../../components/ui/Button';
import Avatar from '../../../components/ui/Avatar';
import EditableCode from '../../../components/work/EditableCode';
import TimerButton from '../../../components/work/TimerButton';
import { workPaths } from '../../../components/work/workPaths';
import { ACTIVITY_LABELS } from './ActivityTab';
import { HelpersField, Dependencies } from './PanelLinks';
import QuickTime from './QuickTime';
import {
  dateRange, hoursFromMinutes, hoursFromSeconds, isDone,
} from './taskFilters';

const PRIORITIES = [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const priorityName = (p) => PRIORITIES.find(([v]) => v === p)?.[1] || p;

function Row({ label, children }) {
  return (
    <>
      <span className="text-[13px] text-navy-400">{label}</span>
      <div className="flex min-h-[36px] min-w-0 flex-wrap items-center gap-2">{children}</div>
    </>
  );
}

function Section({ title, hint, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        {title} {hint && <span className="text-[13px] font-normal text-navy-400">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

export default function TaskPanel({
  task, projectId, tasks, phases, statuses, users, canEdit, canLog, currentUser, timerLabel, today,
  activity, onClose, onSelect, onChanged, onShiftOffer, onStopRequest,
}) {
  const paths = workPaths('project', projectId);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.description || '');
  const [estimate, setEstimate] = useState(task.estimateMinutes == null ? '' : String(task.estimateMinutes / 60));
  const [newSub, setNewSub] = useState('');
  // Follow the server's values when the task reloads; drafts survive otherwise.
  useEffect(() => { setTitle(task.title); }, [task.title]);
  useEffect(() => { setNotes(task.description || ''); }, [task.description]);
  useEffect(() => { setEstimate(task.estimateMinutes == null ? '' : String(task.estimateMinutes / 60)); }, [task.estimateMinutes]);

  const me = currentUser?.id;
  const done = isDone(task);
  const isMilestone = !!task.isMilestone;

  const save = async (changes, id = task.id) => {
    try {
      const { data } = await api.patch(paths.task(id), changes);
      if (id === task.id && data.shiftOffer) onShiftOffer(data.task || task, data.shiftOffer);
    } catch (err) { alert(errMessage(err)); }
    await onChanged();
  };
  const toggle = (t) => {
    const closed = t.status?.behaviorType === 'closed';
    const next = statuses.find((s) => s.behaviorType === (closed ? 'open' : 'closed'));
    if (next) save({ statusId: next.id }, t.id);
  };
  const addSubtask = async () => {
    const t = newSub.trim();
    if (!t) return;
    try {
      await api.post(paths.tasks, { title: t, parentTaskId: task.id });
      setNewSub('');
    } catch (err) { alert(errMessage(err)); }
    await onChanged();
  };
  const remove = async () => {
    if (!window.confirm('Delete this task and its subtasks?')) return;
    try { await api.delete(paths.task(task.id)); onClose(); } catch (err) { alert(errMessage(err)); }
    await onChanged();
  };

  const subs = task.subtasks || [];
  const subsDone = subs.filter((s) => s.status?.behaviorType === 'closed').length;
  const mine = (activity || []).filter((a) => a.detail?.taskId === task.id).slice(0, 8);
  const phase = phases.find((p) => p.id === task.phaseId);
  const canAddHelper = canEdit || (!!me && task.assigneeId === me);

  return (
    <aside
      aria-label="Task details"
      className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-navy-100 bg-surface shadow-lg max-md:fixed max-md:inset-0 max-md:z-40 max-md:max-h-none max-md:rounded-none"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 px-[18px] py-3.5">
        <EditableCode
          code={task.code} letter="T" disabled={!canEdit}
          onRename={async (number) => { await api.patch(paths.code(task.id), { number }); await onChanged(); }}
        />
        <span className="flex-1" />
        {canLog && !isMilestone && (
          <TimerButton kind="project" parentId={projectId} taskId={task.id} label={`${timerLabel} · ${task.title}`} onStopRequest={onStopRequest} compact />
        )}
        {canEdit && <Button size="sm" onClick={() => toggle(task)}>{done ? 'Reopen' : isMilestone ? 'Mark reached' : 'Mark done'}</Button>}
        <Button size="sm" variant="quiet" className="!w-8 !px-0 justify-center" aria-label="Close panel" onClick={onClose}><IconX size={16} /></Button>
      </div>

      <div className="flex flex-col gap-5 overflow-y-auto p-[18px]">
        {canEdit ? (
          <input
            aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title.trim() !== task.title) save({ title: title.trim() }); else setTitle(task.title); }}
            className="-mx-1.5 w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[21px] font-semibold tracking-tight hover:border-navy-100 focus:border-prism focus:outline-none"
          />
        ) : (
          <h2 className="text-[21px] font-semibold tracking-tight">{task.title}</h2>
        )}

        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <Row label="Status">
            {canEdit ? (
              <select aria-label="Status" className="input !h-9 !w-auto" value={task.statusId} onChange={(e) => save({ statusId: Number(e.target.value) })}>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : <span className="font-medium">{task.status?.name}</span>}
          </Row>
          <Row label="Assignee">
            {canEdit ? (
              <select aria-label="Assignee" className="input !h-9 !w-auto" value={task.assigneeId || ''} onChange={(e) => save({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            ) : (
              <span className="flex items-center gap-2">
                <Avatar name={task.assignee?.displayName || task.assignee?.username} size={22} />
                {task.assignee?.displayName || task.assignee?.username || ''}
              </span>
            )}
          </Row>
          <Row label="Helpers">
            <HelpersField
              task={task} users={users} canAdd={canAddHelper} canEdit={canEdit} meId={me}
              helpersPath={`${paths.task(task.id)}/helpers`} onChanged={onChanged}
            />
          </Row>
          <Row label="Phase">
            {canEdit && !isMilestone ? (
              <select aria-label="Phase" className="input !h-9 !w-auto" value={task.phaseId ?? ''} onChange={(e) => save({ phaseId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No phase</option>
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : <span>{phase ? phase.name : 'No phase'}</span>}
          </Row>
          <Row label={isMilestone ? 'Date' : 'Dates'}>
            {canEdit ? (
              <>
                {!isMilestone && (
                  <input aria-label="Start date" type="date" className="input !h-9 !w-auto" value={task.startDate || ''} onChange={(e) => save({ startDate: e.target.value || null })} />
                )}
                {!isMilestone && <span className="text-navy-400">→</span>}
                <input aria-label="Due date" type="date" className="input !h-9 !w-auto" value={task.dueDate || ''} onChange={(e) => save({ dueDate: e.target.value || null })} />
              </>
            ) : <span className="num">{dateRange(task.startDate, task.dueDate) || 'No dates'}</span>}
          </Row>
          {!isMilestone && (
            <Row label="Estimate">
              {canEdit ? (
                <span className="flex items-center gap-2">
                  <input
                    aria-label="Estimate in hours" type="number" min="0" step="0.25" className="input !h-9 !w-24 num" value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                    onBlur={() => {
                      const v = estimate === '' ? null : Math.round(Number(estimate) * 60);
                      if (v !== (task.estimateMinutes ?? null)) save({ estimateMinutes: v });
                    }}
                  />
                  h
                </span>
              ) : <span className="num">{task.estimateMinutes != null ? `${hoursFromMinutes(task.estimateMinutes)} h` : 'None'}</span>}
              <span className="num text-navy-400">· {hoursFromSeconds(task.loggedSeconds)} h logged</span>
            </Row>
          )}
          <Row label="Priority">
            {canEdit ? (
              <select aria-label="Priority" className="input !h-9 !w-auto" value={task.priority} onChange={(e) => save({ priority: e.target.value })}>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : <span>{priorityName(task.priority)}</span>}
          </Row>
          <Row label="Milestone">
            {canEdit ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isMilestone} onChange={(e) => save({ isMilestone: e.target.checked })} style={{ accentColor: 'var(--color-accent)' }} />
                <span className={isMilestone ? '' : 'text-navy-400'}>{isMilestone ? 'This task is a milestone' : 'Turn this task into a milestone'}</span>
              </label>
            ) : <span className="text-navy-400">{isMilestone ? 'Yes' : 'No'}</span>}
          </Row>
        </div>

        <Dependencies projectId={projectId} task={task} tasks={tasks} canEdit={canEdit} onOpen={onSelect} onChanged={onChanged} />

        {!isMilestone && (
          <Section title="Subtasks" hint={subs.length ? `${subsDone} of ${subs.length}` : null}>
            {subs.map((s) => {
              const closed = s.status?.behaviorType === 'closed';
              return (
                <label key={s.id} className="flex min-h-[36px] items-center gap-2.5">
                  <input
                    type="checkbox" checked={closed} disabled={!canEdit} onChange={() => toggle(s)}
                    aria-label={`Complete ${s.title}`} style={{ accentColor: 'var(--color-accent)' }}
                  />
                  <span className={closed ? 'text-navy-400 line-through' : ''}>{s.title}</span>
                </label>
              );
            })}
            {canEdit && (
              <input
                className="input mt-1.5 border-dashed" placeholder="Add a subtask, press Enter" aria-label="Add a subtask"
                value={newSub} onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
              />
            )}
          </Section>
        )}

        {canLog && !isMilestone && (
          <Section title="Log time">
            <QuickTime timePath={paths.time} taskId={task.id} today={today} onLogged={onChanged} />
          </Section>
        )}

        <Section title="Notes">
          {canEdit ? (
            <textarea
              aria-label="Notes" className="input min-h-[72px] resize-y" placeholder="Add a note" value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (task.description || '')) save({ description: notes }); }}
            />
          ) : <p className="whitespace-pre-wrap leading-relaxed text-navy-500">{task.description || 'No notes.'}</p>}
        </Section>

        <Section title="Activity">
          {mine.length === 0 && <p className="text-sm text-navy-400">Nothing yet.</p>}
          {mine.map((a) => (
            <div key={a.id} className="flex gap-2.5 py-1 text-[13px] text-navy-500">
              <Avatar name={a.user?.displayName} size={22} />
              <span className="min-w-0 flex-1">
                <b className="font-medium text-navy-900">{a.user?.displayName || 'System'}</b> {ACTIVITY_LABELS[a.action] || a.action}
              </span>
              <time className="whitespace-nowrap text-navy-400">{new Date(a.createdAt).toLocaleDateString()}</time>
            </div>
          ))}
        </Section>

        {canEdit && <button type="button" onClick={remove} className="self-start text-sm" style={{ color: 'var(--color-danger)' }}>Delete task</button>}
      </div>
    </aside>
  );
}
