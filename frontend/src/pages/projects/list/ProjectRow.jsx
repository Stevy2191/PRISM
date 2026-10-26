// One project in the list: project, lead, where it's at, hours against budget
// (red when over), next milestone, due date and status. On a phone the cells
// stack under the name.
import { Link } from 'react-router-dom';
import Avatar from '../../../components/ui/Avatar';
import Meter from '../../../components/ui/Meter';
import { meterLevel } from '../../../components/ui/meter';
import { shortDate, weekdayDate } from '../detail/taskFilters';
import { hoursText, budgetPercent, isLate } from './listFilters';

export const COLUMNS = 'minmax(0,2.2fr) minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,1.4fr) minmax(0,1.6fr) 4.5rem 6.5rem';
const OVER = { color: 'var(--color-danger)' };

function Where({ project }) {
  const phase = project.currentPhase;
  const { closedTasks = 0, totalTasks = 0, percent = 0 } = project.completion || {};
  // No phase with open work: say how the tasks stand overall.
  const label = phase ? phase.name : (totalTasks > 0 && closedTasks === totalTasks ? 'Finished' : totalTasks > 0 ? 'Tasks' : 'Not started');
  const done = phase ? phase.doneCount : closedTasks;
  const of = phase ? phase.taskCount : totalTasks;
  return (
    <div className="text-[13px]">
      <div className="flex justify-between gap-2"><span className="truncate">{label}</span><span className="num whitespace-nowrap text-navy-400">{done} of {of}</span></div>
      <Meter className="mt-1.5" used={done} budget={of || null} label={`${label}, ${done} of ${of} tasks`} />
      <span className="sr-only">{percent}% of tasks done</span>
    </div>
  );
}

function Hours({ project }) {
  const used = project.loggedMinutes || 0;
  const budget = project.hourBudgetMinutes;
  if (!budget) return <div className="num text-[13px]">{hoursText(used)} h <span className="text-navy-400">logged</span></div>;
  const over = meterLevel(used, budget) === 'over';
  return (
    <div className="text-[13px]">
      <div className="flex justify-between gap-2">
        <span className="num" style={over ? OVER : undefined}>{hoursText(used)} / {hoursText(budget)} h</span>
        <span className="num text-navy-400" style={over ? OVER : undefined}>{budgetPercent(used, budget)}%</span>
      </div>
      <Meter className="mt-1.5" used={used} budget={budget} label="Hours used" />
    </div>
  );
}

export default function ProjectRow({ project, statusColor, closed, today, selectable, selected, onToggle }) {
  const lead = project.lead?.displayName;
  const next = project.nextMilestone;
  const where = [project.projectCode, project.company?.name || project.ownerDepartment?.name || 'Internal'].filter(Boolean).join(' · ');
  return (
    <div
      role="row"
      className={`grid items-center gap-x-4 gap-y-2 border-t border-navy-100 px-5 py-3.5 max-lg:!grid-cols-1 ${closed ? 'opacity-70' : ''}`}
      style={{ gridTemplateColumns: COLUMNS }}
    >
      <div className="flex min-w-0 items-start gap-3">
        {selectable && (
          <input type="checkbox" className="mt-1 h-4 w-4 flex-shrink-0" checked={selected} onChange={onToggle} aria-label={`Select ${project.name}`} />
        )}
        <div className="min-w-0">
          <Link to={`/projects/${project.id}`} className="block truncate font-semibold hover:underline">{project.name}</Link>
          <div className="num truncate text-[12.5px] text-navy-400">{where}</div>
        </div>
      </div>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {lead ? <><Avatar name={lead} size={24} /><span className="truncate">{lead}</span></> : <span className="text-navy-400">No lead</span>}
      </span>
      <Where project={project} />
      <Hours project={project} />
      <div className="min-w-0 text-[13px]">
        {next ? (
          <>
            <span className="block truncate">{next.title}</span>
            {next.dueDate && <span className="text-navy-400">{weekdayDate(next.dueDate)}</span>}
          </>
        ) : <span className="text-navy-400">{closed ? '—' : 'None open'}</span>}
      </div>
      <span className="num text-sm" style={isLate(project.dueDate, today, closed) ? OVER : undefined}>{project.dueDate ? shortDate(project.dueDate) : '—'}</span>
      <span>
        <span
          className="inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
          style={{
            backgroundColor: `color-mix(in srgb, ${statusColor || 'var(--color-text-muted)'} 16%, transparent)`,
            color: statusColor || 'var(--color-text-secondary)',
          }}
        >
          {project.status}
        </span>
      </span>
    </div>
  );
}
