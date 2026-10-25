// The chart body: one row per phase and task, bars drawn as DOM boxes, a
// diamond for a milestone. Bars drag and resize when `onBegin` is given.
import { dragResult, barRect, formatDay, daysBetween } from './geometry';

export const ROW = 36;

const edge = 'absolute top-0 h-full w-2';

function barStyle(task, done, waiting) {
  if (done) return { background: 'var(--color-border-strong)', border: '1px solid var(--color-border-strong)' };
  if (waiting) {
    return {
      background: 'repeating-linear-gradient(135deg, var(--color-waiting-bg) 0 6px, transparent 6px 12px), var(--color-waiting-bg)',
      border: '1px solid var(--color-warning)',
    };
  }
  if (!task.assigneeId) return { background: 'var(--color-hover)', border: '1px dashed var(--color-text-faint)' };
  return { background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)' };
}

function Tip({ left, children }) {
  return (
    <span
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ top: -26, left, background: 'var(--color-text-primary)', color: 'var(--color-bg)' }}
    >
      {children}
    </span>
  );
}

function TaskBar({ row, lay, drag, isDone, onBegin }) {
  const { task } = row;
  const rect = barRect(task, lay);
  if (!rect) return null;
  const dragging = drag && drag.taskId === task.id;
  const next = dragging ? dragResult(task, drag.mode, drag.delta) : null;
  const shown = next ? barRect(next, lay) : rect;
  const done = isDone(task);
  const waiting = !done && (task.waitingOn || []).length > 0;
  const label = `${task.code ? `${task.code} ` : ''}${task.title}`;
  const tip = next ? (
    <Tip left={shown.x}>
      {next.startDate === next.dueDate ? formatDay(next.startDate) : `${formatDay(next.startDate)} – ${formatDay(next.dueDate)}`}
      {drag.delta !== 0 && ` · ${Math.abs(drag.delta)} ${Math.abs(drag.delta) === 1 ? 'day' : 'days'} ${drag.delta > 0 ? 'later' : 'earlier'}`}
    </Tip>
  ) : null;
  const cursor = onBegin ? { cursor: 'grab', touchAction: 'none' } : {};

  if (task.isMilestone) {
    const size = 16;
    return (
      <>
        <div
          data-task-id={task.id} data-bar="milestone" title={label} aria-label={label}
          onPointerDown={onBegin ? (e) => onBegin(e, task, 'move') : undefined}
          className="absolute z-10"
          style={{
            left: shown.x + shown.width / 2 - size / 2, top: (ROW - size) / 2, width: size, height: size,
            transform: 'rotate(45deg)', borderRadius: 3, background: done ? 'var(--color-border-strong)' : 'var(--color-text-primary)',
            opacity: dragging ? 0.8 : 1, ...cursor,
          }}
        />
        {tip}
      </>
    );
  }
  return (
    <>
      {dragging && (
        <div
          className="absolute rounded-md" aria-hidden="true"
          style={{ left: rect.x, width: rect.width, top: 8, height: 20, opacity: 0.4, ...barStyle(task, done, waiting) }}
        />
      )}
      <div
        data-task-id={task.id} data-bar="task" title={label} aria-label={label}
        onPointerDown={onBegin ? (e) => onBegin(e, task, 'move') : undefined}
        className="absolute z-10 box-border select-none overflow-hidden rounded-md"
        style={{
          left: shown.x, width: shown.width, top: 8, height: 20, ...barStyle(task, done, waiting), ...cursor,
          ...(dragging ? { borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--color-accent)', boxShadow: '0 6px 16px rgba(0,0,0,0.3)' } : {}),
        }}
      >
        {onBegin && (
          <>
            <span
              data-handle="start" className={`${edge} left-0`} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => { e.stopPropagation(); onBegin(e, task, 'start'); }}
            />
            <span
              data-handle="end" className={`${edge} right-0`} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => { e.stopPropagation(); onBegin(e, task, 'end'); }}
            />
          </>
        )}
      </div>
      {tip}
    </>
  );
}

function PhaseBar({ phase, lay }) {
  const rect = barRect(phase, lay);
  if (!rect) return null;
  return (
    <div
      className="absolute rounded-sm" title={`${phase.name}: ${daysBetween(phase.startDate || phase.dueDate, phase.dueDate || phase.startDate) + 1} days`}
      style={{ left: rect.x, width: rect.width, top: 13, height: 10, background: 'var(--color-text-primary)', opacity: 0.85 }}
    />
  );
}

export default function TimelineBars({ rows, lay, drag, isDone, onBegin }) {
  return rows.map((row, i) => (
    <div
      key={row.key} className="absolute left-0 right-0 border-b border-navy-100"
      style={{ top: i * ROW, height: ROW, background: row.phase ? 'color-mix(in srgb, var(--color-hover) 60%, transparent)' : undefined }}
    >
      {row.phase
        ? <PhaseBar phase={row.phase} lay={lay} />
        : <TaskBar row={row} lay={lay} drag={drag} isDone={isDone} onBegin={onBegin} />}
    </div>
  ));
}
