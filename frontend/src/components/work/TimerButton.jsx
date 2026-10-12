// The timer control for a ticket, a project or one of their tasks. Each item
// has at most one timer (user decision 2026-10-12): starting on another of
// its tasks logs the item's current timer first; timers on other items are
// left running. Stop hands the stopped timer to onStopRequest (the page's
// Log time form); with no handler it logs straight away.
import {
  IconPlayerPlayFilled, IconPlayerPauseFilled, IconPlayerStopFilled,
} from '@tabler/icons-react';
import { useTimer, formatHMS } from '../../context/TimerContext';
import { errMessage } from '../../api/api';

// target: names what the buttons act on when several timers share a screen (subtask rows).
export default function TimerButton({
  kind, parentId, taskId = null, label, onStopRequest, compact = false, anyTask = false, target = null,
}) {
  const ctx = useTimer();
  const itemTimer = ctx.timerFor(kind, parentId);
  // A page header (anyTask) owns the item's timer on any of its tasks too, so
  // it never offers Start while one of them is running.
  const here = !!itemTimer && (anyTask || (itemTimer.taskId ?? null) === (taskId ?? null));
  const timer = here ? itemTimer : null;
  const onTask = here && anyTask && itemTimer.taskId;
  const limited = here && ctx.atLimit(timer);
  const state = here ? (limited ? 'paused' : timer.state) : 'idle';
  const color = state === 'running' ? 'var(--color-timer)' : state === 'paused' ? 'var(--color-warning)' : 'var(--color-text-muted)';
  const otherTask = !here && itemTimer;
  const name = (verb) => (target ? `${verb} timer on ${target}` : `${verb} timer`);
  const elapsed = here ? ctx.elapsedOf(timer) : 0;

  const stop = async () => {
    // Freeze it while the form is open; read the paused timer the server
    // returns (the context's value in this closure is from before the pause).
    const paused = state === 'running' ? await ctx.pause(timer.timerId) : timer;
    if (!paused) return; // the pause failed; the context has said why and re-synced
    if (onStopRequest) onStopRequest({ ...paused, resumeAfter: state === 'running' });
    else await ctx.stop(paused.timerId).catch((err) => alert(errMessage(err)));
  };

  let title;
  if (limited) title = `This timer reached the ${timer.limitSeconds / 3600}-hour limit: stop it and correct the time`;
  else if (otherTask) title = `The timer on ${itemTimer.label?.split(' · ').pop() || 'another task'} is logged first if you start here`;

  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
      title={title}
    >
      {state === 'idle' && (
        <button type="button" aria-label={name('Start')} title="Start timer" style={{ color }}
          onClick={() => ctx.start(kind, parentId, { taskId, label })}>
          <IconPlayerPlayFilled size={compact ? 13 : 15} />
        </button>
      )}
      {state === 'running' && (
        <button type="button" aria-label={name('Pause')} title="Pause timer" style={{ color }} onClick={() => ctx.pause(timer.timerId)}>
          <IconPlayerPauseFilled size={compact ? 13 : 15} />
        </button>
      )}
      {state === 'paused' && !limited && (
        <button type="button" aria-label={name('Resume')} title="Resume timer" style={{ color }} onClick={() => ctx.resume(timer.timerId)}>
          <IconPlayerPlayFilled size={compact ? 13 : 15} />
        </button>
      )}
      {!compact && <span className="font-mono text-sm font-semibold" style={{ color }}>{formatHMS(elapsed)}</span>}
      {compact && here && <span className="font-mono text-xs" style={{ color }}>{formatHMS(elapsed)}</span>}
      {limited && <span className="text-xs font-semibold" style={{ color }}>limit</span>}
      {onTask && <span className="max-w-[12rem] truncate text-xs" style={{ color }}>on {itemTimer.label?.split(' · ').pop() || 'a task'}</span>}
      {state !== 'idle' && (
        <button type="button" aria-label={name('Stop')} title="Stop and log time" style={{ color }} onClick={stop}>
          <IconPlayerStopFilled size={compact ? 13 : 15} />
        </button>
      )}
    </div>
  );
}
