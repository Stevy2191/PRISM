import { useEffect, useState } from 'react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

const EMPTY = { name: '', shortCode: '', description: '', defaultRoleId: '' };

export default function AdminDepartments() {
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);

  const load = () => {
    Promise.all([api.get('/departments'), api.get('/roles')])
      .then(([d, r]) => { setDepartments(d.data.departments); setRoles(r.data.roles); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const payload = { ...form, defaultRoleId: form.defaultRoleId || null };
    try {
      if (editing) {
        const { data } = await api.patch(`/departments/${editing}`, payload);
        setDepartments((d) => d.map((x) => (x.id === editing ? data.department : x)));
      } else {
        const { data } = await api.post('/departments', payload);
        setDepartments((d) => [...d, data.department]);
      }
      setForm(EMPTY);
      setEditing(null);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const startEdit = (d) => {
    setEditing(d.id);
    setForm({
      name: d.name,
      shortCode: d.shortCode || '',
      description: d.description || '',
      defaultRoleId: d.defaultRoleId || '',
    });
  };

  const remove = async (d) => {
    const msg = d.memberCount > 0
      ? `${d.name} has ${d.memberCount} user${d.memberCount === 1 ? '' : 's'}. Deleting it will leave them without a department. Are you sure?`
      : `Delete ${d.name}?`;
    if (!confirm(msg)) return;
    try {
      await api.delete(`/departments/${d.id}`);
      setDepartments((ds) => ds.filter((x) => x.id !== d.id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Departments</h1>
        {!editing && (
          <button className="btn-primary" onClick={() => { setForm(EMPTY); setEditing('new'); }}>+ New department</button>
        )}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {editing !== null && (
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Short code <span className="text-red-500">*</span></label>
              <input
                className="input uppercase"
                value={form.shortCode}
                maxLength={10}
                placeholder="e.g. IT, HR, MNT"
                onChange={(e) => setForm((f) => ({ ...f, shortCode: e.target.value.toUpperCase() }))}
                required={editing === 'new'}
              />
              <p className="mt-1 text-xs text-navy-400">Used to prefix this department's project IDs (e.g. IT-P00001).</p>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Default role</label>
            <select
              className="input"
              value={form.defaultRoleId}
              onChange={(e) => setForm((f) => ({ ...f, defaultRoleId: e.target.value }))}
            >
              <option value="">None</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-navy-400">New users added to this department get this role automatically.</p>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>
            <button type="submit" className="btn-primary">{editing === 'new' ? 'Create' : 'Save'}</button>
          </div>
        </form>
      )}

      <div className="card divide-y divide-navy-100">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-navy-900">{d.name}</p>
                {d.shortCode ? (
                  <span className="badge bg-navy-100 text-navy-700">{d.shortCode}</span>
                ) : (
                  <span className="badge bg-amber-100 text-amber-800" title="Configure a short code so this department's project IDs use it instead of the generic fallback">
                    No short code — project IDs will use &quot;DEPT&quot; prefix
                  </span>
                )}
              </div>
              {d.description && <p className="text-sm text-navy-500">{d.description}</p>}
              <p className="mt-0.5 text-xs text-navy-400">
                {d.memberCount} member{d.memberCount === 1 ? '' : 's'}
                {d.defaultRole ? ` · Default role: ${d.defaultRole.name}` : ''}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => startEdit(d)} className="text-xs text-prism hover:underline">edit</button>
              <button onClick={() => remove(d)} className="text-xs text-red-500 hover:underline">delete</button>
            </div>
          </div>
        ))}
        {departments.length === 0 && <p className="px-5 py-4 text-sm text-navy-400">No departments yet.</p>}
      </div>
    </div>
  );
}
