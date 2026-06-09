import { useTimer, formatElapsed } from '../context/TimerContext';

// Start/stop timer toggle for a ticket or project. Safe to place inside links
// (it stops event propagation/default). `type` is 'ticket' | 'project'.
export default function TimerButton({ type, id, label, className = '' }) {
  const { isRunning, elapsedSeconds, start, stop } = useTimer();
  const running = isRunning(type, id);

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (running) stop();
    else start(type, id, label);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={running ? 'Stop timer and log time' : 'Start timer'}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        running
          ? 'bg-red-600 text-white hover:bg-red-700'
          : 'border border-navy-200 bg-white text-navy-700 hover:border-prism hover:text-prism'
      } ${className}`}
    >
      {running ? (
        <>
          <span className="text-[10px]">■</span> {formatElapsed(elapsedSeconds)}
        </>
      ) : (
        <>
          <span className="text-[10px]">▶</span> Start
        </>
      )}
    </button>
  );
}
