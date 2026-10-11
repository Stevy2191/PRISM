// The running timer, on every page: what it's on and how long, linking there.
import { Link } from 'react-router-dom';
import { IconClockPlay, IconPlayerPauseFilled } from '@tabler/icons-react';
import { useTimer, formatHMS, formatElapsed } from '../../context/TimerContext';

// compact: the narrow sidebar layout, icon and time only (the label is the tooltip).
export default function TimerIndicator({ compact = false }) {
  const { activeTimer, elapsedSeconds } = useTimer();
  if (!activeTimer) return null;
  const to = activeTimer.type === 'ticket' ? `/tickets/${activeTimer.id}` : `/projects/${activeTimer.id}`;
  const paused = activeTimer.state === 'paused';
  const name = activeTimer.label || (activeTimer.type === 'ticket' ? 'Ticket' : 'Project');
  if (compact) {
    return (
      <Link to={to} title={`${paused ? 'Timer paused' : 'Timer running'}: ${name}`}
        className="flex h-11 w-11 flex-col items-center justify-center rounded-md font-mono text-[10px] font-semibold hover:bg-[var(--color-hover)]"
        style={{ color: paused ? 'var(--color-warning)' : 'var(--color-timer)' }}>
        {paused ? <IconPlayerPauseFilled size={14} /> : <IconClockPlay size={14} />}
        {formatElapsed(elapsedSeconds)}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-semibold"
      style={{ color: paused ? 'var(--color-warning)' : 'var(--color-timer)', backgroundColor: 'var(--color-hover)' }}
      title={paused ? 'Timer paused' : 'Timer running'}
    >
      {paused ? <IconPlayerPauseFilled size={13} /> : <IconClockPlay size={13} />}
      <span className="max-w-[10rem] truncate font-sans">{activeTimer.label || (activeTimer.type === 'ticket' ? 'Ticket' : 'Project')}</span>
      {formatHMS(elapsedSeconds)}
    </Link>
  );
}
