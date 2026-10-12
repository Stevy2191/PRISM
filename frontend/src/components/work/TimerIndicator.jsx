// "My timers" (user decision 2026-10-12), on every page: how many timers are
// running, and a list of all of them (running or paused) with their time,
// a link to their ticket or project, Pause/Resume, Stop and log, and Discard.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  IconClockPlay, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerStopFilled, IconTrash,
} from '@tabler/icons-react';
import { useTimer, formatHMS, formatElapsed, timerPath } from '../../context/TimerContext';
import { useAuth } from '../../context/AuthContext';
import { errMessage } from '../../api/api';
import TimeEntryForm from './TimeEntryForm';

const nameOf = (t) => t.label || (t.type === 'ticket' ? 'Ticket' : 'Project');

// compact: the narrow sidebar layout (icon and count; the list opens beside it).
export default function TimerIndicator({ compact = false }) {
  const ctx = useTimer();
  const { user, canLogTimeForOthers } = useAuth();
  const [open, setOpen] = useState(false);
  const [stopped, setStopped] = useState(null); // a timer waiting in the Log time form
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!ctx.timers.length && !stopped) return null;
  const running = ctx.timers.filter((t) => t.state === 'running' && !ctx.atLimit(t));
  // The button shows the newest running timer's time, else the newest timer's.
  const shown = running[0] || ctx.timers[0];
  const color = running.length ? 'var(--color-timer)' : 'var(--color-warning)';
  const summary = running.length
    ? `${running.length} timer${running.length === 1 ? '' : 's'} running`
    : `${ctx.timers.length} timer${ctx.timers.length === 1 ? '' : 's'} paused`;

  // Freeze it while the form is open (as the timer button does).
  const stop = async (t) => {
    const wasRunning = t.state === 'running' && !ctx.atLimit(t);
    const paused = wasRunning ? await ctx.pause(t.timerId) : t;
    if (!paused) return;
    setOpen(false);
    setStopped({ ...paused, resumeAfter: wasRunning });
  };
  const discard = async (t) => {
    if (!window.confirm(`Discard the time on ${nameOf(t)}?`)) return;
    await ctx.stop(t.timerId, { discard: true }).catch((err) => alert(errMessage(err)));
  };

  return (
    <div className="relative" ref={ref}>
      {shown && (compact ? (
        <button type="button" onClick={() => setOpen((o) => !o)} title={`My timers: ${summary}`} aria-label={`My timers: ${summary}`}
          className="relative flex h-11 w-11 flex-col items-center justify-center rounded-md font-mono text-[10px] font-semibold hover:bg-[var(--color-hover)]"
          style={{ color }}>
          {running.length ? <IconClockPlay size={14} /> : <IconPlayerPauseFilled size={14} />}
          {formatElapsed(ctx.elapsedOf(shown))}
          {ctx.timers.length > 1 && <Badge n={running.length || ctx.timers.length} color={color} />}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)} title={`My timers: ${summary}`} aria-label={`My timers: ${summary}`}
          className="relative flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-semibold"
          style={{ color, backgroundColor: 'var(--color-hover)' }}>
          {running.length ? <IconClockPlay size={13} /> : <IconPlayerPauseFilled size={13} />}
          <span className="hidden max-w-[10rem] truncate font-sans sm:inline">{nameOf(shown)}</span>
          {formatHMS(ctx.elapsedOf(shown))}
          {ctx.timers.length > 1 && <Badge n={running.length || ctx.timers.length} color={color} />}
        </button>
      ))}

      {open && (
        <div
          role="dialog"
          aria-label="My timers"
          className={`absolute z-40 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border shadow-lg ${compact ? 'bottom-0 left-full ml-2' : 'right-0 mt-2'}`}
          style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
        >
          <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>My timers</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{summary}</p>
          </div>
          <ul className="max-h-96 divide-y overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
            {ctx.timers.map((t) => {
              const limited = ctx.atLimit(t);
              const isRunning = t.state === 'running' && !limited;
              const c = isRunning ? 'var(--color-timer)' : 'var(--color-warning)';
              return (
                <li key={t.timerId} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link to={timerPath(t)} onClick={() => setOpen(false)} className="block truncate text-sm font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {nameOf(t)}
                    </Link>
                    <p className="font-mono text-xs font-semibold" style={{ color: c }}>
                      {formatHMS(ctx.elapsedOf(t))}
                      <span className="ml-2 font-sans font-normal">
                        {limited ? `paused at the ${t.limitSeconds / 3600}-hour limit` : isRunning ? 'running' : 'paused'}
                      </span>
                    </p>
                  </div>
                  {isRunning && (
                    <IconButton label={`Pause ${nameOf(t)}`} onClick={() => ctx.pause(t.timerId)} color={c}><IconPlayerPauseFilled size={15} /></IconButton>
                  )}
                  {!isRunning && !limited && (
                    <IconButton label={`Resume ${nameOf(t)}`} onClick={() => ctx.resume(t.timerId)} color={c}><IconPlayerPlayFilled size={15} /></IconButton>
                  )}
                  <IconButton label={`Stop and log ${nameOf(t)}`} onClick={() => stop(t)} color={c}><IconPlayerStopFilled size={15} /></IconButton>
                  <IconButton label={`Discard ${nameOf(t)}`} onClick={() => discard(t)} color="var(--color-text-muted)"><IconTrash size={15} /></IconButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* In a portal: the bar it sits in must never trap the modal. */}
      {stopped && createPortal(
        <TimeEntryForm
          kind={stopped.type}
          parentId={stopped.id}
          timer={stopped}
          canManageOthers={canLogTimeForOthers}
          currentUser={user}
          onClose={() => setStopped(null)}
        />,
        document.body,
      )}
    </div>
  );
}

function Badge({ n, color }) {
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-[3px] px-1 font-sans text-[10px] font-bold text-white"
      style={{ backgroundColor: color }}>
      {n}
    </span>
  );
}

function IconButton({ label, onClick, color, children }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md hover:bg-[var(--color-hover)]" style={{ color }}>
      {children}
    </button>
  );
}
