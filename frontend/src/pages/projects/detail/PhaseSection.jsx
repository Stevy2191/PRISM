// One phase on the Tasks tab: a collapsible header with progress and hours,
// its task rows (subtasks indented) and a quick-add row.
import { useState } from 'react';
import { IconChevronRight, IconChevronDown, IconPlus } from '@tabler/icons-react';
import Meter from '../../../components/ui/Meter';
import TaskRow from './TaskRow';
import { dateRange, hoursFromMinutes, hoursFromSeconds } from './taskFilters';

// Progress figures: the server's for a real phase; counted here for "No phase".
function progressOf(phase, tasks, done) {
  if (phase) {
    return {
      count: phase.taskCount, done: phase.doneCount, loggedMinutes: phase.loggedMinutes,
      goalMinutes: phase.hourBudgetMinutes ?? phase.estimateMinutes ?? null,
    };
  }
  return {
    count: tasks.length,
    done: tasks.filter(done).length,
    loggedMinutes: Math.round(tasks.reduce((n, t) => n + (t.loggedSeconds || 0), 0) / 60),
    goalMinutes: tasks.reduce((n, t) => n + (t.estimateMinutes || 0), 0) || null,
  };
}

export default function PhaseSection({
  group, collapsed, onToggle, ctx, allTasks, onQuickAdd, quickRef, active,
}) {
  const { phase, tasks } = group;
  const name = phase ? phase.name : 'No phase';
  const [title, setTitle] = useState('');
  const p = progressOf(phase, allTasks, ctx.isDone);
  const finished = p.count > 0 && p.done === p.count;

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    onQuickAdd(t, phase ? phase.id : null);
  };

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-navy-100 bg-surface" aria-label={name}>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-3 py-3 md:px-[18px]">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-navy-400 hover:bg-[var(--color-hover)]"
        >
          {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
        </button>
        <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }} aria-hidden="true" />
        <span className="text-base font-semibold">{name}</span>
        {phase && <span className="num text-sm text-navy-400">{dateRange(phase.startDate, phase.dueDate)}</span>}
        <div className="num flex items-center gap-5 text-sm text-navy-500 md:ml-auto">
          {finished && <span className="font-semibold" style={{ color: 'var(--color-timer)' }}>Done</span>}
          <span>{p.done} of {p.count}</span>
          <Meter className="w-[90px]" used={p.done} budget={p.count} label={`${name} progress`} />
          <span>{hoursFromMinutes(p.loggedMinutes)}{p.goalMinutes ? ` of ${hoursFromMinutes(p.goalMinutes)}` : ''} h</span>
        </div>
      </div>
      {!collapsed && (
        <>
          {tasks.length > 0 && (
            <div className={`hidden h-[34px] items-center gap-x-3 border-t border-navy-100 px-[18px] text-xs font-medium text-navy-400 md:grid ${ctx.compact ? 'grid-cols-[28px_minmax(0,1fr)_150px_88px]' : 'grid-cols-[28px_120px_minmax(0,1fr)_150px_120px_160px_104px]'}`}>
              {ctx.compact
                ? <><span /><span>Task</span><span>Assignee</span><span /></>
                : <><span /><span>Code</span><span>Task</span><span>Assignee</span><span>Dates</span><span>Logged / est.</span><span /></>}
            </div>
          )}
          {tasks.map((task) => (
            <div key={task.id}>
              <TaskRow task={task} ctx={ctx} />
              {(task.subtasks || []).map((st) => <TaskRow key={st.id} task={st} sub parentId={task.id} ctx={ctx} />)}
            </div>
          ))}
          {tasks.length === 0 && <p className="border-t border-navy-100 px-[18px] py-3 text-sm text-navy-400">{ctx.filtered ? 'No tasks match this filter.' : 'No tasks in this phase yet.'}</p>}
          {ctx.canEdit && (
            <label className="flex min-h-[48px] items-center gap-2.5 border-t border-navy-100 px-[18px] text-navy-400 md:pl-[58px]">
              <IconPlus size={16} aria-hidden="true" />
              <input
                ref={quickRef}
                aria-label={`Add a task to ${name}`}
                placeholder={`Add a task to ${name} — type a title, press Enter`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                className="w-full border-0 bg-transparent py-2 text-sm text-navy-900 outline-none placeholder:text-navy-300"
              />
              <kbd className="hidden rounded border border-navy-100 px-1.5 text-xs md:inline">Enter</kbd>
            </label>
          )}
        </>
      )}
    </section>
  );
}
