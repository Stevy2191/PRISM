// One task (or subtask) row on the Tasks tab: checkbox, code, title with
// chips, stacked people, dates, hours and a timer.
import { IconChevronUp, IconChevronDown, IconGripVertical } from '@tabler/icons-react';
import Avatar from '../../../components/work/Avatar';
import TimerButton from '../../../components/work/TimerButton';
import StatusChip from '../../../components/ui/StatusChip';
import {
  isDone, rowPeople, loggedText, dateRange, shortCode, daysUntil,
} from './taskFilters';

function People({ task }) {
  const people = rowPeople(task);
  if (people.length === 0) {
    return (
      <span className="flex items-center gap-2 text-sm italic text-navy-400">
        <span className="inline-block h-6 w-6 rounded-full border border-dashed border-navy-300" aria-hidden="true" />
        Unassigned
      </span>
    );
  }
  const shown = people.slice(0, 3);
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm text-navy-500">
      <span className="flex flex-shrink-0 items-center" aria-label={people.map((p) => p.name).join(', ')}>
        {shown.map((p, i) => (
          <span key={p.id} className={i ? '-ml-1.5' : ''} style={{ borderRadius: '9999px', boxShadow: '0 0 0 2px var(--color-card)' }}>
            <Avatar name={p.name} size={24} />
          </span>
        ))}
        {people.length > shown.length && <span className="num ml-1 text-xs text-navy-400">+{people.length - shown.length}</span>}
      </span>
      <span className="truncate">{people[0].name}{people.length > 1 && <span className="text-navy-400"> +{people.length - 1}</span>}</span>
    </span>
  );
}

export default function TaskRow({ task, sub = false, parentId = null, ctx }) {
  const done = sub ? task.status?.behaviorType === 'closed' : isDone(task);
  const selectedId = sub ? parentId : task.id;
  const selected = ctx.selectedId === selectedId;
  const overdue = !done && !!task.dueDate && task.dueDate < ctx.today;
  const waiting = !done && !sub ? task.waitingOn || [] : [];
  const subs = sub ? [] : task.subtasks || [];
  const estimate = task.estimateMinutes;
  const over = !task.isMilestone && task.loggedBy <= 1 && estimate != null && task.loggedSeconds > estimate * 60;
  const dueSoon = task.isMilestone && !done && task.dueDate ? daysUntil(ctx.today, task.dueDate) : null;
  return (
    <div
      onDragOver={ctx.reorderable && !sub ? (e) => ctx.onDragOver(e, task) : undefined}
      onDrop={ctx.reorderable && !sub ? (e) => { e.preventDefault(); ctx.onDrop(task); } : undefined}
      aria-current={selected && !sub ? 'true' : undefined}
      className={`group grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-navy-100 px-4 hover:bg-[var(--color-hover)] md:px-[18px] ${ctx.compact ? 'md:grid-cols-[28px_minmax(0,1fr)_150px_88px]' : 'md:grid-cols-[28px_120px_minmax(0,1fr)_150px_120px_160px_104px]'} ${sub ? 'min-h-[40px]' : 'min-h-[52px]'} max-md:py-2`}
      style={{
        ...(selected && !sub ? { backgroundColor: 'var(--color-accent-soft)', boxShadow: 'inset 3px 0 0 var(--color-accent)' } : {}),
        ...(sub ? { backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 2%, transparent)' } : {}),
        ...(ctx.draggedId === task.id ? { opacity: 0.5 } : {}),
        ...(ctx.overId === task.id && ctx.draggedId !== task.id ? { boxShadow: 'inset 0 2px 0 var(--color-accent)' } : {}),
      }}
    >
      <input
        type="checkbox"
        aria-label={task.isMilestone ? `Mark ${task.title} reached` : `Complete ${task.title}`}
        checked={done}
        disabled={!ctx.canEdit}
        onChange={() => ctx.onToggle(task)}
        className="h-4 w-4 max-md:h-6 max-md:w-6"
        style={{ accentColor: 'var(--color-accent)' }}
      />
      <span className={`num hidden text-[13px] text-navy-400 ${ctx.compact ? '' : 'md:block'}`}>{sub ? shortCode(task.code) : task.code}</span>
      <div className={`flex min-w-0 flex-wrap items-center gap-2 py-1 ${sub ? 'md:pl-5' : ''}`}>
          {task.isMilestone && <span className="inline-block h-[11px] w-[11px] rotate-45 rounded-[2px] bg-navy-900" aria-label="Milestone" />}
          <button
            type="button"
            onClick={() => ctx.onSelect(selectedId)}
            className={`text-left ${task.isMilestone ? 'font-semibold' : 'font-medium'} ${done ? 'text-navy-400 line-through' : ''}`}
          >
            {task.title}
          </button>
          {subs.length > 0 && (
            <span className="num rounded-full border border-navy-100 px-2 text-xs text-navy-400">
              {subs.filter((s) => s.status?.behaviorType === 'closed').length} of {subs.length}
            </span>
          )}
          {waiting.length > 0 && (
            <StatusChip tone="waiting" className="!px-2 !py-px !text-xs">
              Waiting on {shortCode(waiting[0].code)}{waiting.length > 1 ? ` +${waiting.length - 1}` : ''}
            </StatusChip>
          )}
          {overdue && (
            <span className="rounded-full px-2 py-px text-xs font-semibold" style={{ color: 'var(--color-danger)', backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, transparent)' }}>
              Overdue
            </span>
          )}
          {dueSoon != null && dueSoon >= 0 && dueSoon <= 7 && (
            <span className="text-xs text-navy-400">{dueSoon === 0 ? 'today' : `in ${dueSoon} d`}</span>
          )}
          <span className={`num text-[13px] text-navy-400 ${ctx.compact ? '' : 'md:hidden'}`}>{sub ? shortCode(task.code) : task.code}</span>
      </div>
      <div className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1 pb-1 pl-10 max-md:order-3 md:col-span-1 md:contents md:p-0">
          <People task={task} />
          {!ctx.compact && <span className="num text-[13px] text-navy-400">{dateRange(task.startDate, task.dueDate)}</span>}
          {!ctx.compact && <span className={`num text-[13px] ${over ? 'font-semibold' : 'text-navy-500'}`} style={over ? { color: 'var(--color-danger)' } : undefined}>
            {loggedText(task)}
          </span>}
      </div>
      <div className="flex items-center justify-end gap-1">
        {ctx.reorderable && !sub && (
          <span
            draggable
            aria-label={`Drag ${task.title}`}
            title="Drag to reorder"
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(task.id)); ctx.onDragStart(task); }}
            onDragEnd={ctx.onDragEnd}
            className="cursor-grab text-navy-300 opacity-100 active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100"
          >
            <IconGripVertical size={16} />
          </span>
        )}
        {ctx.canEdit && !sub && (
          <div className="flex flex-col opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
            <button type="button" aria-label={`Move ${task.title} up`} title="Move up" disabled={!ctx.canMove(task, -1)}
              onClick={() => ctx.onMove(task, -1)} className="rounded text-navy-400 disabled:cursor-not-allowed disabled:opacity-30">
              <IconChevronUp size={14} />
            </button>
            <button type="button" aria-label={`Move ${task.title} down`} title="Move down" disabled={!ctx.canMove(task, 1)}
              onClick={() => ctx.onMove(task, 1)} className="rounded text-navy-400 disabled:cursor-not-allowed disabled:opacity-30">
              <IconChevronDown size={14} />
            </button>
          </div>
        )}
        {ctx.canLog && !sub && !task.isMilestone && (
          <TimerButton kind="project" parentId={ctx.projectId} taskId={task.id} target={task.code} compact
            label={`${ctx.timerLabel} · ${task.title}`} onStopRequest={ctx.onStopRequest} />
        )}
      </div>
    </div>
  );
}
