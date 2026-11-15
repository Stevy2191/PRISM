import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import portalApi, { p } from '../api';
import { usePortalAuth } from '../PortalAuth';
import PageHeader from '../../components/ui/PageHeader';
import StatusChip from '../../components/ui/StatusChip';
import { projectLine, statusTone } from '../projectFormat';

// CN: the company's projects this contact can follow: status and progress.
// Company admins see them all; a department admin sees their department's
// and the company-wide ones; anyone named on a project sees that one.
export default function Projects() {
  const { me } = usePortalAuth();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    portalApi.get('/projects')
      .then(({ data }) => { if (live) setProjects(data.projects); })
      .catch(() => { if (live) { setProjects([]); setError("Couldn't load the projects."); } });
    return () => { live = false; };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Projects" sub={`${me?.company?.name || 'Your company'}'s projects you can follow`} />
      {error && <div className="card p-4 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</div>}
      {projects && projects.length === 0 && !error && (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No projects to follow yet.</div>
      )}
      <div className="flex flex-col gap-2.5">
        {(projects || []).map((pr) => (
          <Link key={pr.id} to={p(`/projects/${pr.id}`)} className="card flex flex-col gap-1.5 p-4" style={{ color: 'var(--color-text-primary)' }}>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="num font-semibold" style={{ color: 'var(--color-text-muted)' }}>{pr.projectCode}</span>
              <StatusChip tone={statusTone(pr.statusBehavior)}>{pr.status}</StatusChip>
            </div>
            <div className="break-words font-semibold">{pr.name}</div>
            <div className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>{projectLine(pr, me?.company?.name)}</div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-border)' }} aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${pr.progress.percent}%`, backgroundColor: 'var(--color-accent)' }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
