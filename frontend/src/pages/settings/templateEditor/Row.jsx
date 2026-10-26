// One row of the template editor grid: a phase heading or a task, with the
// grip you drag by, "Starts on Day N", "Takes N days", estimate and "Waits on".
import { IconGripVertical, IconDiamond, IconX, IconPlus, IconCornerDownRight } from '@tabler/icons-react';
import { hoursInput, parseHours } from '../../projects/detail/budgetFormat.js';

export const GRID = 'grid grid-cols-[24px_minmax(0,1fr)_110px_90px_100px_190px_64px] items-center gap-3 px-4 min-w-[820px]';
const CELL = 'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-navy-100 hover:bg-surface focus:border-prism focus:bg-surface focus:outline-none';

// Text that is saved when you leave it (Enter or blur); a value the page
// does not accept snaps back. Keyed by the saved value so outside changes show.
function CommitInput({ value, onCommit, label, className = '', ...rest }) {
  const commit = (e) => {
    const ok = onCommit(e.target.value);
    if (ok === false) e.target.value = value;
  };
  return (
    <input
      key={value}
      defaultValue={value}
      aria-label={label}
      className={`${CELL} ${className}`}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      {...rest}
    />
  );
}

const whole = (text, min) => {
  const t = String(text).trim().replace(/^day\s*/i, '').replace(/\s*days?$/i, '');
  return /^\d{1,4}$/.test(t) && Number(t) >= min ? Number(t) : null;
};

function Grip({ label, drag, onKey }) {
  return (
    <button
      type="button"
      draggable
      aria-label={label}
      title="Drag to reorder (or press the up and down arrow keys)"
      className="cursor-grab text-navy-300 hover:text-navy-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent"
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', drag.id);
        const row = e.currentTarget.closest('[data-row]');
        if (row) e.dataTransfer.setDragImage(row, 8, 8);
        drag.start();
      }}
      onDragEnd={drag.end}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onKey(e.key === 'ArrowUp' ? -1 : 1); }
      }}
    >
      <IconGripVertical size={16} aria-hidden="true" />
    </button>
  );
}

export function PhaseRow({
  phase, summary, onRename, onRemove, drag, onDropTask, onKeyMove, over,
}) {
  return (
    <div
      data-row
      className={`${GRID} min-h-[48px] border-b border-navy-100 bg-[var(--color-hover)] font-semibold ${over ? 'ring-2 ring-inset ring-prism' : ''}`}
      onDragOver={drag.over}
      onDrop={onDropTask}
    >
      <Grip label={`Move phase ${phase.name}`} drag={drag} onKey={onKeyMove} />
      <CommitInput value={phase.name} label="Phase name" className="font-semibold" onCommit={(t) => (t.trim() ? onRename(t.trim()) : false)} />
      <span className="num px-2 text-sm font-normal text-navy-500">{summary ? `Day ${summary.start}` : ''}</span>
      <span className="num px-2 text-sm font-normal text-navy-500">{summary ? `${summary.days} ${summary.days === 1 ? 'day' : 'days'}` : ''}</span>
      <span className="num px-2 text-sm font-normal text-navy-500">{summary && summary.minutes ? `${hoursInput(summary.minutes)} h` : ''}</span>
      <span />
      <span className="flex justify-end">
        <button type="button" aria-label={`Remove phase ${phase.name}`} className="h-7 w-7 rounded-md text-navy-300 hover:bg-surface hover:text-navy-700" onClick={onRemove}>
          <IconX size={14} className="mx-auto" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export function TaskRow({
  task, sub, hasSubtasks, others, predecessors, onChange, onMilestone, onAddSub, onRemove, onAddWait, onRemoveWait, drag, onDropTask, onKeyMove, over,
}) {
  const ms = task.isMilestone;
  return (
    <div
      data-row
      className={`${GRID} min-h-[48px] border-b border-navy-100 ${over ? 'ring-2 ring-inset ring-prism' : ''}`}
      onDragOver={drag.over}
      onDrop={onDropTask}
    >
      <Grip label={`Move ${task.title}`} drag={drag} onKey={onKeyMove} />
      <span className={`flex min-w-0 items-center gap-1.5 ${sub ? 'pl-5' : ''}`}>
        {ms && <IconDiamond size={14} aria-label="Milestone" style={{ color: 'var(--color-accent)' }} className="flex-shrink-0" />}
        <CommitInput value={task.title} label="Task title" className={ms ? 'font-semibold' : ''} onCommit={(t) => (t.trim() ? onChange({ title: t.trim() }) : false)} />
      </span>
      {sub ? <span className="num px-2 text-sm text-navy-400">Day {task.startDay}</span> : (
        <CommitInput value={`Day ${task.startDay}`} label={`Starts on for ${task.title}`} className="num" onCommit={(t) => { const n = whole(t, 1); return n == null ? false : onChange({ startDay: n }); }} />
      )}
      {ms ? <span className="px-2 text-sm text-navy-400">Milestone</span> : (
        <CommitInput value={`${task.lengthDays} ${task.lengthDays === 1 ? 'day' : 'days'}`} label={`Takes for ${task.title}`} className="num" onCommit={(t) => { const n = whole(t, 1); return n == null ? false : onChange({ lengthDays: n }); }} />
      )}
      {ms ? <span className="px-2 text-sm text-navy-300">—</span> : (
        <CommitInput
          value={task.estimateMinutes == null ? '' : `${hoursInput(task.estimateMinutes)} h`}
          label={`Estimate for ${task.title}`}
          placeholder="—"
          className="num"
          onCommit={(t) => {
            const m = parseHours(t);
            return Number.isNaN(m) ? false : onChange({ estimateMinutes: m });
          }}
        />
      )}
      {sub ? <span /> : (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {predecessors.map((p) => (
            <span key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-navy-100 px-2 text-xs text-navy-600">
              <span className="truncate">{p.title}</span>
              <button type="button" aria-label={`Stop waiting on ${p.title}`} className="text-navy-300 hover:text-navy-700" onClick={() => onRemoveWait(p.id)}><IconX size={11} aria-hidden="true" /></button>
            </span>
          ))}
          <select
            aria-label={`Waits on for ${task.title}`}
            className={`${CELL} ${predecessors.length ? 'w-8 px-0 text-center' : ''} text-navy-500`}
            value=""
            onChange={(e) => { if (e.target.value) onAddWait(e.target.value); }}
          >
            <option value="">{predecessors.length ? '+' : '—'}</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </div>
      )}
      <span className="flex justify-end gap-0.5">
        {!sub && !ms && (
          <button type="button" aria-label={`Add a subtask to ${task.title}`} title="Add a subtask" className="h-7 w-7 rounded-md text-navy-300 hover:bg-surface hover:text-navy-700" onClick={onAddSub}>
            <IconCornerDownRight size={14} className="mx-auto" aria-hidden="true" />
          </button>
        )}
        {!sub && (
          <button
            type="button"
            aria-label={ms ? `Make ${task.title} a task` : `Make ${task.title} a milestone`}
            aria-pressed={ms}
            disabled={!ms && hasSubtasks}
            title={!ms && hasSubtasks ? "A milestone can't have subtasks" : 'Milestone'}
            className="h-7 w-7 rounded-md text-navy-300 hover:bg-surface hover:text-navy-700 disabled:opacity-40"
            onClick={onMilestone}
          >
            <IconDiamond size={14} className="mx-auto" aria-hidden="true" />
          </button>
        )}
        <button type="button" aria-label={`Remove ${task.title}`} className="h-7 w-7 rounded-md text-navy-300 hover:bg-surface hover:text-navy-700" onClick={onRemove}>
          <IconX size={14} className="mx-auto" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

// "Add a task to Plan, press Enter" under a phase; also used for phases.
export function AddRow({ label, placeholder, onAdd, indent = true, autoFocus = false, onBlur }) {
  return (
    <label className={`flex min-h-[44px] items-center gap-2.5 border-b border-navy-100 pr-4 text-navy-400 ${indent ? 'pl-[52px]' : 'pl-4'}`}>
      <IconPlus size={14} aria-hidden="true" />
      <input
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onBlur={onBlur}
        className="w-full bg-transparent text-sm text-navy-900 placeholder-navy-300 outline-none"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const v = e.target.value.trim();
          if (v) { onAdd(v); e.target.value = ''; }
        }}
      />
    </label>
  );
}
