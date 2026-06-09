import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date', 'url'];
const TICKET_TYPES = ['incident', 'request', 'problem', 'task', 'change'];
const EMPTY = {
  name: '', fieldType: 'text', options: '', required: false,
  ticketType: '', departmentId: '', displayOrder: 0,
};

export default function Layouts() {
  const [fields, setFields] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    Promise.all([api.get('/custom-fields'), api.get('/departments')])
      .then(([f, d]) => { setFields(f.data.customFields); setDepartments(d.data.departments); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const startNew = () => { setForm(EMPTY); setEditing('new'); };
  const startEdit = (f) => {
    setForm({
      name: f.name, fieldType: f.fieldType,
      options: Array.isArray(f.options) ? f.options.join(', ') : '',
      required: !!f.required, ticketType: f.ticketType || '',
      departmentId: f.departmentId || '', displayOrder: f.displayOrder || 0,
    });
    setEditing(f.id);
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        fieldType: form.fieldType,
        required: form.required,
        ticketType: form.ticketType || null,
        departmentId: form.departmentId || null,
        displayOrder: parseInt(form.displayOrder, 10) || 0,
        options: form.fieldType === 'select'
          ? String(form.options).split(',').map((o) => o.trim()).filter(Boolean)
          : null,
      };
      if (editing === 'new') await api.post('/custom-fields', payload);
      else await api.patch(`/custom-fields/${editing}`, payload);
      setEditing(null); setLoading(true); load();
    } catch (err) { alert(errMessage(err)); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this field? Existing values will be removed.')) return;
    try { await api.delete(`/custom-fields/${id}`); setFields((fs) => fs.filter((x) => x.id !== id)); }
    catch (err) { alert(errMessage(err)); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Layouts &amp; Fields</h1>
        {editing === null && <button onClick={startNew} className="btn-primary">+ New Field</button>}
      </div>
      <p className="text-sm text-navy-500">
        Custom fields appear on ticket create/edit forms. Scope a field to a ticket type
        and/or department, or leave both blank to apply everywhere.
      </p>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {editing !== null ? (
        <form onSubmit={save} className="card space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Field name</label>
              <input className="input" value={form.name} onChange={set('name')} required />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.fieldType} onChange={set('fieldType')}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {form.fieldType === 'select' && (
            <div>
              <label className="label">Options (comma-separated)</label>
              <input className="input" value={form.options} onChange={set('options')} placeholder="Option A, Option B" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Applies to type</label>
              <select className="input" value={form.ticketType} onChange={set('ticketType')}>
                <option value="">All types</option>
                {TICKET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Applies to department</label>
              <select className="input" value={form.departmentId} onChange={set('departmentId')}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Display order</label>
              <input type="number" className="input" value={form.displayOrder} onChange={set('displayOrder')} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-navy-700">
            <input type="checkbox" checked={form.required}
              onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
              className="h-4 w-4 rounded border-navy-300 text-prism" />
            Required
          </label>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn-primary">Save field</button>
          </div>
        </form>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-navy-50">
              <tr>
                <th className="table-th">Order</th>
                <th className="table-th">Name</th>
                <th className="table-th">Type</th>
                <th className="table-th">Scope</th>
                <th className="table-th">Required</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {fields.map((f) => (
                <tr key={f.id} className="hover:bg-navy-50">
                  <td className="table-td text-navy-400">{f.displayOrder}</td>
                  <td className="table-td font-medium">{f.name}</td>
                  <td className="table-td"><span className="badge bg-navy-100 text-navy-700">{f.fieldType}</span></td>
                  <td className="table-td text-navy-500">
                    {(f.ticketType || 'all types')} · {(f.department?.name || 'all departments')}
                  </td>
                  <td className="table-td">{f.required ? 'Yes' : 'No'}</td>
                  <td className="table-td">
                    <div className="flex gap-3">
                      <button onClick={() => startEdit(f)} className="text-xs text-prism hover:underline">edit</button>
                      <button onClick={() => remove(f.id)} className="text-xs text-red-500 hover:underline">delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr><td colSpan={6} className="table-td text-navy-400">No custom fields yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
