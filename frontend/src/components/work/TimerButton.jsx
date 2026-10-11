// The timer control for a ticket, a project or one of their tasks. One server
// timer per user: starting here logs a timer running elsewhere first. Stop
// hands the stopped timer to onStopRequest (the page's Log time form); with
// no handler it logs straight away.
import {
  IconPlayerPlayFilled, IconPlayerPauseFilled, IconPlayerStopFilled,
} from '@tabler/icons-react';
import { useTimer, formatHMS } from '../../context/TimerContext';

// target: names what the buttons act on when several timers share a screen (subtask rows).
export default function TimerButton({
  kind, parentId, taskId = null, label, onStopRequest, compact = false, anyTask = false, target = null,
}) {
  const timer = useTimer();
  // A page header (anyTask) owns a timer on any of its tasks too, so it never
  // offers Start while one of them is running.
  const here = anyTask ? timer.isRunning(kind, parentId) : timer.isRunning(kind, parentId, taskId);
  const onTask = here && anyTask && timer.activeTimer.taskId;
  const state = here ? timer.activeTimer.state : 'idle';
  const color = state === 'running' ? 'var(--color-timer)' : state === 'paused' ? 'var(--color-warning)' : 'var(--color-text-muted)';
  const elsewhere = !here && timer.activeTimer;
  const name = (verb) => (target ? `${verb} timer on ${target}` : `${verb} timer`);

  const stop = async () => {
    // Freeze it while the form is open; read the paused timer the server
    // returns (the context's value in this closure is from before the pause).
    const paused = state === 'running' ? await timer.pause() : timer.activeTimer;
    if (onStopRequest) onStopRequest({ ...paused, resumeAfter: state === 'running' });
    else await timer.stop();
  };

  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
      title={elsewhere ? `A timer is running on ${timer.activeTimer.label || 'another item'}; starting here logs it first` : undefined}
    >
      {state === 'idle' && (
        <button type="button" aria-label={name('Start')} title="Start timer" style={{ color }}
          onClick={() => timer.start(kind, parentId, { taskId, label })}>
          <IconPlayerPlayFilled size={compact ? 13 : 15} />
        </button>
      )}
      {state === 'running' && (
        <button type="button" aria-label={name('Pause')} title="Pause timer" style={{ color }} onClick={timer.pause}>
          <IconPlayerPauseFilled size={compact ? 13 : 15} />
        </button>
      )}
      {state === 'paused' && (
        <button type="button" aria-label={name('Resume')} title="Resume timer" style={{ color }} onClick={timer.resume}>
          <IconPlayerPlayFilled size={compact ? 13 : 15} />
        </button>
      )}
      {!compact && <span className="font-mono text-sm font-semibold" style={{ color }}>{formatHMS(here ? timer.elapsedSeconds : 0)}</span>}
      {compact && here && <span className="font-mono text-xs" style={{ color }}>{formatHMS(timer.elapsedSeconds)}</span>}
      {onTask && <span className="max-w-[12rem] truncate text-xs" style={{ color }}>on {timer.activeTimer.label?.split(' · ').pop() || 'a task'}</span>}
      {state !== 'idle' && (
        <button type="button" aria-label={name('Stop')} title="Stop and log time" style={{ color }} onClick={stop}>
          <IconPlayerStopFilled size={compact ? 13 : 15} />
        </button>
      )}
    </div>
  );
}
