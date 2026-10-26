// "What you'll get": the phases of the chosen template with the dates they
// will get (from /project-templates/:id/preview).
import { hoursInput } from '../detail/budgetFormat';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Body({ origin, template, summary, error, finishBeforeStart, copyName }) {
  if (origin === 'blank') return <p className="hint text-sm text-navy-400">An empty project. Add phases and tasks on the project page once it exists.</p>;
  if (origin === 'copy') {
    return <p className="text-sm text-navy-400">{copyName ? `Phases, tasks and links from ${copyName}, with their dates spread from your start date.` : 'Pick a project to copy.'} Tasks arrive unassigned.</p>;
  }
  if (!template) return <p className="text-sm text-navy-400">Pick a template to see what it will create.</p>;
  if (finishBeforeStart) return <p className="text-sm" style={{ color: 'var(--color-danger)' }}>The finish date is before the start date.</p>;
  if (error) return <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!summary) return <p className="text-sm text-navy-400">Working out the dates…</p>;
  return (
    <>
      <div>
        {summary.phases.map((p) => (
          <div key={p.id} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-2.5 border-t border-navy-100 py-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: 'var(--color-accent)' }} />
            <div className="min-w-0">
              <div className="font-semibold">{p.name}</div>
              <div className="num text-[13px] text-navy-500">{[p.range, plural(p.taskCount, 'task')].filter(Boolean).join(' · ')}</div>
              {p.milestones.map((m) => (
                <div key={m.id} className="mt-1 flex items-center gap-2 pl-0.5 text-[13px] text-navy-600">
                  <span className="inline-block h-2 w-2 rotate-45" style={{ backgroundColor: 'var(--color-accent)' }} />
                  {m.title} · <span className="num">{m.date}</span>
                </div>
              ))}
            </div>
            <span className="num text-right text-[13px] text-navy-600">{p.minutes ? `${hoursInput(p.minutes)} h` : ''}</span>
          </div>
        ))}
        {summary.phases.length === 0 && <p className="text-sm text-navy-400">This template has no phases.</p>}
      </div>
      <div className="flex justify-between border-t border-navy-200 pt-2.5 font-semibold">
        <span>{plural(summary.taskCount, 'task')}{summary.linkCount ? `, ${plural(summary.linkCount, 'link')} between them` : ''}</span>
        <span className="num">{summary.minutes ? `${hoursInput(summary.minutes)} h` : ''}</span>
      </div>
    </>
  );
}

export default function PlanPreview(props) {
  return (
    <aside aria-label="What the template will create" className="card flex min-w-0 flex-[1_1_400px] max-w-[460px] flex-col gap-3 p-5">
      <h2 className="text-base font-semibold">What you&apos;ll get</h2>
      <p className="m-0 text-[12.5px] text-navy-400">Dates follow your start date. Tasks arrive unassigned; hand them out here or on Workload.</p>
      <Body {...props} />
    </aside>
  );
}
