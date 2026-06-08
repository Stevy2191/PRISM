import { useEffect, useState } from 'react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

const PRIORITIES = ['', 'low', 'medium', 'high', 'critical'];
const TYPES = ['', 'incident', 'request', 'problem', 'task', 'change'];
const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];

const EMPTY = {
  name: '', description: '', category: '',
  defaultTitle: '', defaultDescription: '', defaultPriority: '', defaultType: '',
  defaultDepartmentId: '', customFields: [],
};

export default function AdminBlueprints() {
  const [blueprints, setBlueprints] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // id or 'new' or null
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([api.get('/blueprints'), api.get('/departments')])
      .then(([b, d]) => {
        setBlueprints(b.data.blueprints);
        setDepartments(d.data.departments);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const startNew = () => {
    setEditing('new');
    setForm(EMPTY);
    setFormError('');
  };

  const startEdit = (b) => {
    setEditing(b.id);
    setForm({
      name: b.name || '', description: b.description || '', category: b.category || '',
      defaultTitle: b.defaultTitle || '', defaultDescription: b.defaultDescription || '',
      defaultPriority: b.defaultPriority || '', defaultType: b.defaultType || '',
      defaultDepartmentId: b.defaultDepartmentId || '',
      customFields: Array.isArray(b.customFields) ? b.customFields : [],
    });
    setFormError('');
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Custom field builder helpers
  const addField = () =>
    setForm((f) => ({ ...f, customFields: [...f.customFields, { label: '', type: 'text', required: false, options: [] }] }));
  const updateField = (i, key, value) =>
    setForm((f) => ({
      ...f,
      customFields: f.customFields.map((cf, idx) => (idx === i ? { ...cf, [key]: value } : cf)),
    }));
  const removeField = (i) =>
    setForm((f) => ({ ...f, customFields: f.customFields.filter((_, idx) => idx !== i) }));

  const save = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        defaultDepartmentId: form.defaultDepartmentId || null,
        customFields: form.customFields.map((cf) => ({
          label: cf.label,
          type: cf.type,
          required: !!cf.required,
          ...(cf.type === 'select'
            ? { options: (Array.isArray(cf.options) ? cf.options : String(cf.options || '').split(',')).map((o) => String(o).trim()).filter(Boolean) }
            : {}),
        })),
      };
      if (editing === 'new') {
        await api.post('/blueprints', payload);
      } else {
        await api.patch(`/blueprints/${editing}`, payload);
      }
      setEditing(null);
      setLoading(true);
      load();
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this blueprint?')) return;
    try {
      await api.delete(`/blueprints/${id}`);
      setBlueprints((bs) => bs.filter((b) => b.id !== id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Blueprints</h1>
        {editing === null && <button onClick={startNew} className="btn-primary">+ New Blueprint</button>}
      </div>
      <p className="text-sm text-navy-500">
        Reusable ticket templates. They pre-fill the new-ticket form and can define
        custom fields that are captured on the ticket.
      </p>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {editing !== null ? (
        <form onSubmit={save} className="card space-y-4 p-6">
          <h2 className="font-semibold text-navy-900">{editing === 'new' ? 'New blueprint' : 'Edit blueprint'}</h2>
          {formError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={set('name')} required />
            </div>
            <div>
              <label className="label">Category</label>
              <input className="input" value={form.category} onChange={set('category')} placeholder="Hardware, Software, Network…" />
            </div>
          </div>
          <div>
            <label className="label">Description (admin-facing)</label>
            <input className="input" value={form.description} onChange={set('description')} />
          </div>

          <div className="border-t border-navy-100 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-navy-700">Ticket defaults</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Default title</label>
                <input className="input" value={form.defaultTitle} onChange={set('defaultTitle')} />
              </div>
              <div>
                <label className="label">Default department</label>
                <select className="input" value={form.defaultDepartmentId} onChange={set('defaultDepartmentId')}>
                  <option value="">None</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Default priority</label>
                <select className="input" value={form.defaultPriority} onChange={set('defaultPriority')}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p || '—'}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Default type</label>
                <select className="input" value={form.defaultType} onChange={set('defaultType')}>
                  {TYPES.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="label">Default description</label>
              <textarea className="input min-h-[6rem]" value={form.defaultDescription} onChange={set('defaultDescription')} />
            </div>
          </div>

          {/* Custom field builder */}
          <div className="border-t border-navy-100 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-navy-700">Custom fields</h3>
              <button type="button" onClick={addField} className="btn-secondary text-xs">+ Add field</button>
            </div>
            {form.customFields.length === 0 && <p className="text-sm text-navy-400">No custom fields.</p>}
            <div className="space-y-3">
              {form.customFields.map((cf, i) => (
                <div key={i} className="rounded-md border border-navy-100 bg-navy-50 p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-5">
                      <label className="label">Label</label>
                      <input className="input" value={cf.label} onChange={(e) => updateField(i, 'label', e.target.value)} required />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="label">Type</label>
                      <select className="input" value={cf.type} onChange={(e) => updateField(i, 'type', e.target.value)}>
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end sm:col-span-3">
                      <label className="flex items-center gap-2 text-sm text-navy-700">
                        <input
                          type="checkbox"
                          checked={!!cf.required}
                          onChange={(e) => updateField(i, 'required', e.target.checked)}
                          className="h-4 w-4 rounded border-navy-300 text-prism"
                        />
                        Required
                      </label>
                    </div>
                    <div className="flex items-end sm:col-span-1">
                      <button type="button" onClick={() => removeField(i)} className="text-xs text-red-500 hover:underline">remove</button>
                    </div>
                    {cf.type === 'select' && (
                      <div className="sm:col-span-12">
                        <label className="label">Options (comma-separated)</label>
                        <input
                          className="input"
                          value={Array.isArray(cf.options) ? cf.options.join(', ') : cf.options || ''}
                          onChange={(e) => updateField(i, 'options', e.target.value.split(','))}
                          placeholder="Option A, Option B, Option C"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-navy-100 pt-4">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save blueprint'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {blueprints.length === 0 && <div className="card p-8 text-center text-navy-400">No blueprints yet.</div>}
          {blueprints.map((b) => (
            <div key={b.id} className="card p-5">
              <div className="flex items-start justify-between">
                <h2 className="font-semibold text-navy-900">{b.name}</h2>
                {b.category && <span className="badge bg-navy-100 text-navy-700">{b.category}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-navy-500">{b.description || 'No description.'}</p>
              <p className="mt-2 text-xs text-navy-400">
                {(b.customFields?.length || 0)} custom field{(b.customFields?.length || 0) === 1 ? '' : 's'}
              </p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => startEdit(b)} className="text-xs text-prism hover:underline">edit</button>
                <button onClick={() => remove(b.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
