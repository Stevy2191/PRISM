import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import TimerButton from '../components/TimerButton';

export default function Projects() {
  const { isStaff } = useAuth();
  const [projects, setProjects] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/projects')
      .then(({ data }) => setProjects(data.projects))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    api.get('/project-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
  }, []);

  const colorFor = (name) => statuses.find((s) => s.name === name)?.color;

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Projects</h1>
        {isStaff && <Link to="/projects/new" className="btn-primary">+ New Project</Link>}
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {projects.length === 0 ? (
        <div className="card p-8 text-center text-navy-400">No projects yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card p-5 transition hover:shadow-md">
              <div className="flex items-start justify-between">
                <h2 className="font-semibold text-navy-900">{p.name}</h2>
                <Badge value={p.status} color={colorFor(p.status)} />
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-navy-500">{p.description || 'No description.'}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-navy-400">
                <span>{p.department?.name || 'No department'}</span>
                <span>{p.dueDate ? `Due ${p.dueDate}` : ''}</span>
              </div>
              {isStaff && (
                <div className="mt-3 border-t border-navy-100 pt-3">
                  <TimerButton type="project" id={p.id} label={p.name} />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
