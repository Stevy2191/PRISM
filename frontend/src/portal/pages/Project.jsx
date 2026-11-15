import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import portalApi, { p } from '../api';
import { usePortalAuth } from '../PortalAuth';
import PageHeader from '../../components/ui/PageHeader';
import StatusChip from '../../components/ui/StatusChip';
import { shortDay, statusTone, stepLine } from '../projectFormat';

// CN: one project, as its customer sees it: status, progress, phases and
// milestones. No tasks, people, time, costs, files or notes.
export default function Project() {
  const { id } = useParams();
  const { me } = usePortalAuth();
  const [project, setProject] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    portalApi.get(`/projects/${id}`)
      .then(({ data }) => { if (live) setProject(data.project); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [id]);

  if (missing) return <div className="card p-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>This project isn&apos;t one you can follow.</div>;
  if (!project) return null;
  const forName = project.forDepartment ? project.forDepartment.name : (me?.company?.name || 'the whole company');
  const dates = [project.startDate && `Started ${shortDay(project.startDate)}`, project.dueDate && `Due ${shortDay(project.dueDate)}`].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={[{ label: 'Projects', to: p('/projects') }, { label: project.projectCode, id: true }]}
        title={project.name}
        sub={<span className="flex flex-wrap items-center gap-2"><span className="num font-semibold">{project.projectCode}</span><StatusChip tone={statusTone(project.statusBehavior)}>{project.status}</StatusChip><span>For {forName}{dates ? ` · ${dates}` : ''}</span></span>}
      />
      <section className="card flex flex-col gap-4 p-5" aria-label="Progress">
        <div>
          <div className="mb-1.5 text-sm font-medium">Progress: {project.progress.done} of {project.progress.total} tasks done</div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={project.progress.percent}
            aria-label="Progress"
            className="h-2.5 overflow-hidden rounded-full"
            style={{ backgroundColor: 'var(--color-border)' }}
          >
            <div className="h-full rounded-full" style={{ width: `${project.progress.percent}%`, backgroundColor: 'var(--color-accent)' }} />
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Phases and milestones</h2>
          {project.steps.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No phases or milestones yet.</p>}
          <ol className="flex flex-col gap-2">
            {project.steps.map((s) => (
              <li key={`${s.kind}-${s.id}`} className="flex items-start gap-2.5 text-sm">
                <span
                  aria-label={{ done: 'Done', active: 'In progress', todo: 'Not started' }[s.state]}
                  className="mt-1 h-3 w-3 flex-shrink-0 rounded-full border-2"
                  style={{ borderColor: 'var(--color-accent)', backgroundColor: s.state === 'done' ? 'var(--color-accent)' : 'transparent' }}
                />
                <span>{s.kind === 'milestone' ? `Milestone: ${s.name}` : <b>{s.name}</b>}{stepLine(s)}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>Questions about this project? Open a ticket and mention {project.projectCode}.</p>
      </section>
    </div>
  );
}
