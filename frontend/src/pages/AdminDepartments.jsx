import { useEffect, useState } from 'react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

export default function AdminDepartments() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);

  const load = () => {
    api
      .get('/departments')
      .then(({ data }) => setDepartments(data.departments))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editing) {
        const { data } = await api.patch(`/departments/${editing}`, form);
        setDepartments((d) => d.map((x) => (x.id === editing ? data.department : x)));
      } else {
        const { data } = await api.post('/departments', form);
        setDepartments((d) => [...d, data.department]);
      }
      setForm({ name: '', description: '' });
      setEditing(null);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const startEdit = (d) => {
    setEditing(d.id);
    setForm({ name: d.name, description: d.description || '' });
  };

  const remove = async (id) => {
    if (!confirm('Delete this department?')) return;
    try {
      await api.delete(`/departments/${id}`);
      setDepartments((d) => d.filter((x) => x.id !== id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-navy-900">Departments</h1>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="flex-1">
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="flex-[2]">
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <button type="submit" className="btn-primary">{editing ? 'Save' : 'Add'}</button>
        {editing && (
          <button type="button" className="btn-secondary" onClick={() => { setEditing(null); setForm({ name: '', description: '' }); }}>
            Cancel
          </button>
        )}
      </form>

      <div className="card divide-y divide-navy-100">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-navy-900">{d.name}</p>
              <p className="text-sm text-navy-500">{d.description}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => startEdit(d)} className="text-xs text-prism hover:underline">edit</button>
              <button onClick={() => remove(d.id)} className="text-xs text-red-500 hover:underline">delete</button>
            </div>
          </div>
        ))}
        {departments.length === 0 && <p className="px-5 py-4 text-sm text-navy-400">No departments yet.</p>}
      </div>
    </div>
  );
}
