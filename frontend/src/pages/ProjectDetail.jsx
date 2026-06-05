import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

const STATUSES = ['active', 'on_hold', 'completed', 'archived'];

export default function ProjectDetail() {
  const { id } = useParams();
  const { isStaff, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newMilestone, setNewMilestone] = useState({ title: '', dueDate: '' });

  const load = async () => {
    try {
      const [p, t] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get('/tickets', { params: { project: id } }),
      ]);
      setProject(p.data.project);
      setMilestones(p.data.project.milestones || []);
      setTickets(t.data.tickets);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patchProject = async (changes) => {
    try {
      const { data } = await api.patch(`/projects/${id}`, changes);
      setProject(data.project);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const toggleMilestone = async (m) => {
    try {
      const { data } = await api.patch(`/projects/${id}/milestones/${m.id}`, { completed: !m.completed });
      setMilestones((ms) => ms.map((x) => (x.id === m.id ? data.milestone : x)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addMilestone = async (e) => {
    e.preventDefault();
    if (!newMilestone.title.trim()) return;
    try {
      const { data } = await api.post(`/projects/${id}/milestones`, {
        title: newMilestone.title,
        dueDate: newMilestone.dueDate || null,
      });
      setMilestones((ms) => [...ms, data.milestone]);
      setNewMilestone({ title: '', dueDate: '' });
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteMilestone = async (mId) => {
    try {
      await api.delete(`/projects/${id}/milestones/${mId}`);
      setMilestones((ms) => ms.filter((x) => x.id !== mId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteProject = async () => {
    if (!confirm('Delete this project?')) return;
    try {
      await api.delete(`/projects/${id}`);
      navigate('/projects');
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!project) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/projects" className="text-sm text-prism hover:underline">← Back to projects</Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-navy-900">
            {project.name}
            <Badge value={project.status} />
          </h1>
          <p className="text-sm text-navy-500">
            {project.department?.name || 'No department'} · Owner: {project.owner?.displayName || '—'}
            {project.dueDate ? ` · Due ${project.dueDate}` : ''}
          </p>
        </div>
        {isAdmin && <button onClick={deleteProject} className="btn-danger">Delete</button>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-500">Description</h2>
            <p className="whitespace-pre-wrap text-navy-800">{project.description || 'No description provided.'}</p>
          </div>

          {/* Linked tickets */}
          <div className="card">
            <div className="border-b border-navy-100 px-5 py-3">
              <h2 className="font-semibold text-navy-900">Linked Tickets ({tickets.length})</h2>
            </div>
            <ul className="divide-y divide-navy-100">
              {tickets.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-5 py-3">
                  <Link to={`/tickets/${t.id}`} className="font-medium text-navy-800 hover:text-prism">
                    #{t.id} {t.title}
                  </Link>
                  <div className="flex gap-2">
                    <Badge value={t.priority} />
                    <Badge value={t.status} />
                  </div>
                </li>
              ))}
              {tickets.length === 0 && <li className="px-5 py-4 text-sm text-navy-400">No linked tickets.</li>}
            </ul>
          </div>
        </div>

        {/* Sidebar: status + milestones */}
        <div className="space-y-6">
          {isStaff && (
            <div className="card p-5">
              <label className="label">Status</label>
              <select className="input" value={project.status} onChange={(e) => patchProject({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          )}

          <div className="card">
            <div className="border-b border-navy-100 px-5 py-3">
              <h2 className="font-semibold text-navy-900">Milestones</h2>
            </div>
            <ul className="divide-y divide-navy-100">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-5 py-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={m.completed}
                      disabled={!isStaff}
                      onChange={() => toggleMilestone(m)}
                      className="h-4 w-4 rounded border-navy-300 text-prism"
                    />
                    <span className={m.completed ? 'text-navy-400 line-through' : 'text-navy-800'}>
                      {m.title}
                      {m.dueDate && <span className="ml-2 text-xs text-navy-400">{m.dueDate}</span>}
                    </span>
                  </label>
                  {isStaff && (
                    <button onClick={() => deleteMilestone(m.id)} className="text-xs text-red-500 hover:underline">
                      delete
                    </button>
                  )}
                </li>
              ))}
              {milestones.length === 0 && <li className="px-5 py-4 text-sm text-navy-400">No milestones.</li>}
            </ul>
            {isStaff && (
              <form onSubmit={addMilestone} className="space-y-2 border-t border-navy-100 p-4">
                <input
                  className="input"
                  placeholder="Milestone title"
                  value={newMilestone.title}
                  onChange={(e) => setNewMilestone((f) => ({ ...f, title: e.target.value }))}
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    className="input"
                    value={newMilestone.dueDate}
                    onChange={(e) => setNewMilestone((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                  <button type="submit" className="btn-primary">Add</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
