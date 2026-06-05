import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['incident', 'request', 'task', 'change'];

export default function TicketNew() {
  const { isStaff } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    type: 'request',
    projectId: '',
    departmentId: '',
    assigneeId: '',
    dueDate: '',
  });
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/projects').then(({ data }) => setProjects(data.projects)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    if (isStaff) {
      api.get('/users').then(({ data }) => setUsers(data.users)).catch(() => {});
    }
  }, [isStaff]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      ['projectId', 'departmentId', 'assigneeId', 'dueDate'].forEach((k) => {
        if (!payload[k]) payload[k] = null;
      });
      const { data } = await api.post('/tickets', payload);
      navigate(`/tickets/${data.ticket.id}`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">New Ticket</h1>
        <Link to="/tickets" className="btn-secondary">Cancel</Link>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <div>
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={set('title')} required />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[8rem]" value={form.description} onChange={set('description')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={set('type')}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Project</label>
            <select className="input" value={form.projectId} onChange={set('projectId')}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {isStaff && (
            <div>
              <label className="label">Assignee</label>
              <select className="input" value={form.assigneeId} onChange={set('assigneeId')}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.dueDate} onChange={set('dueDate')} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
