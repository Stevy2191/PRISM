import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';

export default function ProjectNew() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: '',
    departmentId: '',
    dueDate: '',
  });
  const [departments, setDepartments] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/project-statuses').then(({ data }) => {
      setStatuses(data.statuses);
      const def = data.statuses.find((s) => s.isDefault) || data.statuses[0];
      if (def) setForm((f) => ({ ...f, status: def.name }));
    }).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.departmentId) payload.departmentId = null;
      if (!payload.dueDate) payload.dueDate = null;
      const { data } = await api.post('/projects', payload);
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">New Project</h1>
        <Link to="/projects" className="btn-secondary">Cancel</Link>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[8rem]" value={form.description} onChange={set('description')} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.dueDate} onChange={set('dueDate')} />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
