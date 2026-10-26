// The four figures under the project header: tasks done, hours used against
// the budget, the next milestone and the tasks that are waiting.
import Button from '../../../components/ui/Button';
import Meter from '../../../components/ui/Meter';
import Notice from '../../../components/ui/Notice';
import { inDays, daysUntil, weekdayDate, hoursFromMinutes } from './taskFilters';

function Stat({ label, tone, children }) {
  return (
    <div className="rounded-xl border border-navy-100 bg-surface px-[18px] py-4">
      <div className="text-[13px] text-navy-400">{label}</div>
      <div className="num mt-1 text-[22px] font-semibold tracking-tight" style={tone === 'warn' ? { color: 'var(--color-waiting)' } : undefined}>
        {children}
      </div>
    </div>
  );
}

const Small = ({ children }) => <small className="text-sm font-medium text-navy-400">{children}</small>;
const Note = ({ children }) => <div className="mt-1.5 text-[13px] text-navy-400">{children}</div>;

export default function SummaryRow({ stats, estimateMinutes, today, onChangeBudget }) {
  const done = stats.tasksDone || 0;
  const total = stats.tasksTotal || 0;
  const logged = stats.loggedMinutes || 0;
  const budget = stats.hourBudgetMinutes;
  const next = stats.nextMilestone;
  const waiting = stats.waitingCount || 0;
  const over = budget > 0 && logged > budget;
  return (
    <>
      {over && (
        <Notice tone="bad" className="mt-6">
          <span className="min-w-[16rem] flex-1">
            <b>{hoursFromMinutes(logged)} of {hoursFromMinutes(budget)} h used ({Math.round((logged / budget) * 100)}%).</b>{' '}
            People can still log time.
          </span>
          {onChangeBudget && <Button size="sm" variant="primary" onClick={onChangeBudget}>Change the budget</Button>}
        </Notice>
      )}
    <section aria-label="Project summary" className="mt-6 grid grid-cols-2 gap-4 max-md:gap-3 lg:grid-cols-4">
      <Stat label="Tasks done">
        {done} <Small>of {total}</Small>
        <Meter className="mt-2.5" used={done} budget={total} label="Tasks done" />
      </Stat>
      <Stat label="Hours used">
        {hoursFromMinutes(logged)} <Small>{budget != null ? `of ${hoursFromMinutes(budget)} h budget` : 'h logged'}</Small>
        {budget != null && <Meter className="mt-2.5" used={logged} budget={budget} label="Hours used" />}
        {estimateMinutes > 0 && <Note>Task estimates add up to {hoursFromMinutes(estimateMinutes)} h</Note>}
      </Stat>
      <Stat label="Next milestone">
        {next ? <span className="block truncate text-lg">{next.title}</span> : <span className="text-lg text-navy-400">None open</span>}
        {next?.dueDate && <Note>{weekdayDate(next.dueDate)} — {inDays(daysUntil(today, next.dueDate))}</Note>}
      </Stat>
      <Stat label="Waiting" tone={waiting > 0 ? 'warn' : undefined}>
        {waiting} <Small>{waiting === 1 ? 'task' : 'tasks'}</Small>
        <Note>{waiting > 0 ? 'Held up by work not finished yet' : 'Nothing is held up'}</Note>
      </Stat>
    </section>
    </>
  );
}
