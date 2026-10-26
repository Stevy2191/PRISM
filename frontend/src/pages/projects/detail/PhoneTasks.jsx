// The Tasks tab on a phone (under 768 px): one card per task with a large
// checkbox and a 44 px timer button, Mine / All / Waiting filters and a dock
// at the bottom with Log time and Add task. Dragging and reordering are off.
import { useEffect, useState } from 'react';
import { IconPlayerPlayFilled, IconPlayerStopFilled, IconPlus } from '@tabler/icons-react';
import Pill from '../../../components/ui/Pill';
import Button from '../../../components/ui/Button';
import StatusChip from '../../../components/ui/StatusChip';
import { useTimer, formatHMS } from '../../../context/TimerContext';
import { errMessage } from '../../../api/api';
import { dateRange, isDone, shortCode } from './taskFilters';

const PHONE_FILTERS = [
  { id: 'mine', label: 'Mine' },
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
];
export { PHONE_FILTERS };

// One 44 px button: start, or stop (which pauses and hands the timer to the
// Log time form, as the desktop button does), or resume when paused.
function PhoneTimer({ ctx, task }) {
  const timer = useTimer();
  const itemTimer = timer.timerFor('project', ctx.projectId);
  const here = !!itemTimer && (itemTimer.taskId ?? null) === task.id;
  const state = here ? itemTimer.state : 'idle';
  const label = `${shortCode(task.code)}`;
  const press = async () => {
    if (state === 'idle') {
      await timer.start('project', ctx.projectId, { taskId: task.id, label: `${ctx.timerLabel} · ${task.title}` });
    } else if (state === 'paused') {
      await timer.resume(itemTimer.timerId);
    } else {
      const paused = await timer.pause(itemTimer.timerId);
      if (!paused) return;
      if (ctx.onStopRequest) ctx.onStopRequest({ ...paused, resumeAfter: true });
      else await timer.stop(paused.timerId).catch((err) => alert(errMessage(err)));
    }
  };
  const running = state === 'running';
  return (
    <button
      type="button"
      onClick={press}
      aria-label={state === 'idle' ? `Start timer on ${label}` : state === 'paused' ? `Resume timer on ${label}` : `Stop timer on ${label}`}
      className="flex h-11 w-11 items-center justify-center rounded-xl border"
      style={running
        ? { backgroundColor: 'var(--color-timer)', borderColor: 'var(--color-timer)', color: 'var(--color-bg)' }
        : { backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
    >
      {running ? <IconPlayerStopFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
    </button>
  );
}

function TaskCard({ task, ctx }) {
  const timer = useTimer();
  const done = isDone(task);
  const itemTimer = timer.timerFor('project', ctx.projectId);
  const mine = !!itemTimer && (itemTimer.taskId ?? null) === task.id;
  const subs = task.subtasks || [];
  const waiting = !done ? task.waitingOn || [] : [];
  const overdue = !done && !!task.dueDate && task.dueDate < ctx.today;
  const dates = dateRange(task.startDate, task.dueDate);
  return (
    <div
      className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border p-3"
      style={mine
        ? { borderColor: 'var(--color-timer)', backgroundColor: 'color-mix(in srgb, var(--color-timer) 8%, var(--color-card))' }
        : { borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
    >
      {/* The label is the 44 px touch target around the 22 px box. */}
      <label className="-m-[11px] flex h-11 w-11 items-center justify-center">
        <input
          type="checkbox"
          aria-label={task.isMilestone ? `Mark ${task.title} reached` : `Complete ${task.title}`}
          checked={done}
          disabled={!ctx.canEdit}
          onChange={() => ctx.onToggle(task)}
          className="h-[22px] w-[22px]"
          style={{ accentColor: 'var(--color-accent)' }}
        />
      </label>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => ctx.onSelect(task.id)}
          className={`block max-w-full break-words text-left font-semibold ${done ? 'text-navy-400 line-through' : ''}`}
        >
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-navy-400">
          <span className="num">
            {shortCode(task.code)}
            {subs.length > 0 && ` · ${subs.filter((s) => s.status?.behaviorType === 'closed').length} of ${subs.length} subtasks`}
            {dates && ` · ${dates}`}
          </span>
          {mine && <span className="num font-semibold" style={{ color: 'var(--color-timer)' }}>Running {formatHMS(timer.elapsedOf(itemTimer))}</span>}
          {waiting.length > 0 && (
            <StatusChip tone="waiting" className="!px-2 !py-px !text-xs">Waiting on {shortCode(waiting[0].code)}</StatusChip>
          )}
          {overdue && <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>Overdue</span>}
        </div>
      </div>
      {ctx.canLog && !task.isMilestone ? <PhoneTimer ctx={ctx} task={task} /> : <span />}
    </div>
  );
}

export default function PhoneTasks({
  groups, filter, onFilter, ctx, addTarget, onQuickAdd, onLogTime, addFocus,
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  // The header's Add task opens the same input as the dock's.
  useEffect(() => { if (addFocus) setAdding(true); }, [addFocus]);
  const shown = groups.filter((g) => g.tasks.length > 0);

  const submit = (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle('');
    setAdding(false);
    onQuickAdd(t, addTarget ? addTarget.id : null);
  };

  return (
    <div className={`min-w-0 flex-1 ${adding ? 'pb-48' : 'pb-28'}`}>
      <div role="group" aria-label="Filter tasks" className="my-3 flex gap-1.5">
        {PHONE_FILTERS.map((f) => (
          <Pill key={f.id} on={filter === f.id} onClick={() => onFilter(f.id)}>{f.label}</Pill>
        ))}
      </div>
      {shown.length === 0 && (
        <div className="rounded-xl border border-navy-100 bg-surface p-6 text-center text-sm text-navy-400">
          {filter === 'mine' && (
            <>
              <p>No tasks assigned to you.</p>
              <Button type="button" size="sm" className="mt-3" onClick={() => onFilter('all')}>Show all tasks</Button>
            </>
          )}
          {filter === 'waiting' && <p>Nothing is waiting.</p>}
          {filter === 'all' && <p>No tasks yet.</p>}
        </div>
      )}
      {shown.map((g) => (
        <section key={g.phase ? g.phase.id : 'none'} aria-label={g.phase ? g.phase.name : 'No phase'} className="mt-3 flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between font-semibold">
            {g.phase ? g.phase.name : 'No phase'}
            {g.phase && <span className="num text-[13px] font-normal text-navy-400">{dateRange(g.phase.startDate, g.phase.dueDate)}</span>}
          </div>
          {g.tasks.map((task) => <TaskCard key={task.id} task={task} ctx={ctx} />)}
        </section>
      ))}
      {(ctx.canLog || ctx.canEdit) && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))', backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
        >
          {adding && (
            <form onSubmit={submit} className="mb-3 flex gap-2">
              <input
                autoFocus
                aria-label="New task title"
                placeholder={`New task${addTarget ? ` in ${addTarget.name}` : ''}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input min-w-0 flex-1"
              />
              <Button type="submit" variant="primary" className="!h-12" disabled={!title.trim()}>Add</Button>
            </form>
          )}
          <div className="flex gap-2.5">
            {ctx.canLog && <Button type="button" className="!h-12 flex-1 justify-center" onClick={onLogTime}>Log time</Button>}
            {ctx.canEdit && (
              <Button type="button" variant="primary" className="!h-12 flex-1 justify-center" onClick={() => setAdding((v) => !v)}>
                <IconPlus size={14} aria-hidden="true" />Add task
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
