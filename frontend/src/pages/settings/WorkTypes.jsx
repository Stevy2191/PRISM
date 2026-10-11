// Settings → Work types: the kinds of work time is logged as. A type in use
// can be deactivated (it stays on old entries) but not deleted; one stays active.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

export default function WorkTypes() {
  const [types, setTypes] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const load = () => api.get('/work-types').then(({ data }) => setTypes(data.workTypes)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);

  const patch = async (t, changes) => {
    try {
      const { data } = await api.patch(`/work-types/${t.id}`, changes);
      setTypes((list) => list.map((x) => (x.id === t.id ? data.workType : x)));
    } catch (err) { alert(errMessage(err)); load(); }
  };
  const add = async () => {
    if (!name.trim()) return;
    try {
      const { data } = await api.post('/work-types', { name: name.trim() });
      setTypes((list) => [...list, data.workType]);
      setName('');
    } catch (err) { alert(errMessage(err)); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/work-types/${t.id}`);
      setTypes((list) => list.filter((x) => x.id !== t.id));
    } catch (err) { alert(errMessage(err)); }
  };

  if (!types) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  return (
    <div className="space-y-4">
      <Link to="/settings" className="text-sm text-[var(--color-accent)] hover:underline">← Settings</Link>
      <div>
        <h1 className="page-title">Work types</h1>
        <p className="text-sm text-navy-500">What kind of work time is logged as, and whether it is billable by default. A type in use can be turned off but not deleted.</p>
      </div>
      <div className="card divide-y divide-navy-100">
        {types.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 p-3">
            <input className="input max-w-xs" defaultValue={t.name} aria-label={`${t.name} name`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patch(t, { name: v }); else e.target.value = t.name; }} />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" aria-label={`${t.name} billable`} checked={t.billableDefault} onChange={(e) => patch(t, { billableDefault: e.target.checked })} /> Billable by default
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" aria-label={`${t.name} active`} checked={t.isActive} onChange={(e) => patch(t, { isActive: e.target.checked })} /> Active
            </label>
            <button type="button" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} className="ml-auto text-sm" style={{ color: 'var(--color-danger)' }}>Delete</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input max-w-xs" placeholder="New work type" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button type="button" onClick={add} className="btn-primary">Add</button>
      </div>
    </div>
  );
}
