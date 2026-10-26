// "Start from": Blank project, one card per template, Copy an existing project.
import { hoursInput } from '../detail/budgetFormat';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CARD = 'flex min-w-0 flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent';

function Card({ on, dashed, title, hint, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${CARD} ${dashed ? 'border-dashed' : ''} hover:border-[var(--color-accent)]`}
      style={{
        borderColor: on ? 'var(--color-accent)' : 'var(--color-border)',
        borderWidth: on ? 2 : 1,
        backgroundColor: on ? 'var(--color-accent-soft)' : 'var(--color-card)',
        color: 'var(--color-text-primary)',
      }}
    >
      <b className="truncate font-semibold">{title}</b>
      <span className="text-[12.5px]" style={{ color: 'var(--color-text-secondary)' }}>{hint}</span>
    </button>
  );
}

export default function StartFromCards({
  origin, templates, templateId, onBlank, onTemplate, onCopy,
}) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Start from">
      <span className="text-[13px] font-medium text-navy-500">Start from</span>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <Card dashed on={origin === 'blank'} title="Blank project" hint="Add phases and tasks yourself" onClick={onBlank} />
        {templates.map((t) => (
          <Card
            key={t.id}
            on={origin === 'template' && String(t.id) === String(templateId)}
            title={t.name}
            hint={[plural(t.phaseCount, 'phase'), plural(t.taskCount, 'task'), t.hourBudgetMinutes ? `${hoursInput(t.hourBudgetMinutes)} h` : null].filter(Boolean).join(' · ')}
            onClick={() => onTemplate(t.id)}
          />
        ))}
        <Card on={origin === 'copy'} title="Copy an existing project" hint="Pick any project you can see" onClick={onCopy} />
      </div>
    </div>
  );
}
