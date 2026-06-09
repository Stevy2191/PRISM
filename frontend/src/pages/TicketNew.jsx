import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['incident', 'request', 'problem', 'task', 'change'];

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
    teamId: '',
    dueDate: '',
  });
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [blueprints, setBlueprints] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({}); // { customFieldId: value }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Blueprint state
  const [showModal, setShowModal] = useState(false);
  const [blueprint, setBlueprint] = useState(null); // applied blueprint
  const [bpFieldValues, setBpFieldValues] = useState({}); // blueprint fields, keyed by name

  useEffect(() => {
    api.get('/projects').then(({ data }) => setProjects(data.projects)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/blueprints').then(({ data }) => setBlueprints(data.blueprints)).catch(() => {});
    api.get('/custom-fields').then(({ data }) => setCustomFields(data.customFields)).catch(() => {});
    if (isStaff) {
      api.get('/users').then(({ data }) => setUsers(data.users)).catch(() => {});
      api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    }
  }, [isStaff]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const applyBlueprint = (b) => {
    setBlueprint(b);
    setForm((f) => ({
      ...f,
      title: b.defaultTitle || f.title,
      description: b.defaultDescription || f.description,
      priority: b.defaultPriority || f.priority,
      type: b.defaultType || f.type,
      departmentId: b.defaultDepartmentId ? String(b.defaultDepartmentId) : f.departmentId,
    }));
    // Initialize custom field values.
    const init = {};
    (b.customFields || []).forEach((cf) => {
      init[cf.name] = cf.type === 'checkbox' ? false : '';
    });
    setBpFieldValues(init);
    setShowModal(false);
  };

  const clearBlueprint = () => {
    setBlueprint(null);
    setBpFieldValues({});
  };

  const setBpFieldValue = (name, value) => setBpFieldValues((v) => ({ ...v, [name]: value }));

  // Admin-defined custom fields applicable to the current type/department.
  const applicableFields = customFields.filter(
    (cf) =>
      (!cf.ticketType || cf.ticketType === form.type) &&
      (!cf.departmentId || String(cf.departmentId) === String(form.departmentId))
  );
  const setFieldValue = (id, value) => setFieldValues((v) => ({ ...v, [id]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      ['projectId', 'departmentId', 'assigneeId', 'teamId', 'dueDate'].forEach((k) => {
        if (!payload[k]) payload[k] = null;
      });
      if (blueprint) {
        payload.blueprintId = blueprint.id;
        payload.customFields = (blueprint.customFields || []).map((cf) => ({
          name: cf.name,
          label: cf.label,
          type: cf.type,
          value: bpFieldValues[cf.name] ?? '',
        }));
      }
      // Admin-defined custom fields applicable to this ticket.
      payload.fieldValues = applicableFields.map((cf) => ({
        customFieldId: cf.id,
        value: fieldValues[cf.id] ?? '',
      }));
      const { data } = await api.post('/tickets', payload);
      navigate(`/tickets/${data.ticket.id}`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // Group blueprints by category for the picker.
  const grouped = blueprints.reduce((acc, b) => {
    const cat = b.category || 'Uncategorized';
    (acc[cat] = acc[cat] || []).push(b);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">New Ticket</h1>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setShowModal(true)}>
            Use Blueprint
          </button>
          <Link to="/tickets" className="btn-secondary">Cancel</Link>
        </div>
      </div>

      {blueprint && (
        <div className="flex items-center justify-between rounded-md border border-prism/30 bg-navy-50 px-4 py-2 text-sm">
          <span className="text-navy-700">
            Using blueprint: <span className="font-medium">{blueprint.name}</span>
          </span>
          <button type="button" onClick={clearBlueprint} className="text-xs text-red-500 hover:underline">
            remove
          </button>
        </div>
      )}

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

        {isStaff && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Assignee</label>
              <select className="input" value={form.assigneeId} onChange={set('assigneeId')}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Team</label>
              <select className="input" value={form.teamId} onChange={set('teamId')}>
                <option value="">No team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.dueDate} onChange={set('dueDate')} />
          </div>
        </div>

        {/* Blueprint custom fields */}
        {blueprint && (blueprint.customFields || []).length > 0 && (
          <div className="space-y-4 border-t border-navy-100 pt-4">
            <h3 className="text-sm font-semibold text-navy-700">{blueprint.name} fields</h3>
            {blueprint.customFields.map((cf) => (
              <CustomField
                key={cf.name}
                field={cf}
                value={bpFieldValues[cf.name]}
                onChange={(v) => setBpFieldValue(cf.name, v)}
              />
            ))}
          </div>
        )}

        {/* Admin-defined custom fields (Layouts & Fields) */}
        {applicableFields.length > 0 && (
          <div className="space-y-4 border-t border-navy-100 pt-4">
            <h3 className="text-sm font-semibold text-navy-700">Additional fields</h3>
            {applicableFields.map((cf) => (
              <AdminField
                key={cf.id}
                field={cf}
                value={fieldValues[cf.id]}
                onChange={(v) => setFieldValue(cf.id, v)}
              />
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </form>

      {/* Blueprint picker modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowModal(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto card p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-navy-900">Choose a blueprint</h2>
              <button onClick={() => setShowModal(false)} className="text-navy-400 hover:text-navy-700">✕</button>
            </div>
            {blueprints.length === 0 ? (
              <p className="text-sm text-navy-400">No blueprints available. Admins can create them under Admin → Blueprints.</p>
            ) : (
              <div className="space-y-5">
                {Object.keys(grouped).sort().map((cat) => (
                  <div key={cat}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-400">{cat}</p>
                    <div className="space-y-2">
                      {grouped[cat].map((b) => (
                        <button
                          key={b.id}
                          onClick={() => applyBlueprint(b)}
                          className="w-full rounded-md border border-navy-200 p-3 text-left transition hover:border-prism hover:bg-navy-50"
                        >
                          <p className="font-medium text-navy-800">{b.name}</p>
                          {b.description && <p className="text-xs text-navy-500">{b.description}</p>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Renders a single blueprint custom field based on its type.
function CustomField({ field, value, onChange }) {
  const common = { className: 'input', required: field.required, value: value ?? '' };
  switch (field.type) {
    case 'textarea':
      return (
        <Wrap field={field}>
          <textarea {...common} className="input min-h-[5rem]" onChange={(e) => onChange(e.target.value)} />
        </Wrap>
      );
    case 'number':
      return (
        <Wrap field={field}>
          <input {...common} type="number" onChange={(e) => onChange(e.target.value)} />
        </Wrap>
      );
    case 'date':
      return (
        <Wrap field={field}>
          <input {...common} type="date" onChange={(e) => onChange(e.target.value)} />
        </Wrap>
      );
    case 'select':
      return (
        <Wrap field={field}>
          <select {...common} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Wrap>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm text-navy-700">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-navy-300 text-prism"
          />
          {field.label}{field.required && <span className="text-red-500">*</span>}
        </label>
      );
    default:
      return (
        <Wrap field={field}>
          <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
        </Wrap>
      );
  }
}

function Wrap({ field, children }) {
  return (
    <div>
      <label className="label">
        {field.label}{field.required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

// Renders an admin-defined CustomField (Layouts & Fields). Uses `name` as label
// and `fieldType`; supports the extra `url` type.
function AdminField({ field, value, onChange }) {
  const label = { label: field.name, required: field.required };
  const common = { className: 'input', required: field.required, value: value ?? '' };
  switch (field.fieldType) {
    case 'textarea':
      return <Wrap field={label}><textarea {...common} className="input min-h-[5rem]" onChange={(e) => onChange(e.target.value)} /></Wrap>;
    case 'number':
      return <Wrap field={label}><input {...common} type="number" onChange={(e) => onChange(e.target.value)} /></Wrap>;
    case 'date':
      return <Wrap field={label}><input {...common} type="date" onChange={(e) => onChange(e.target.value)} /></Wrap>;
    case 'url':
      return <Wrap field={label}><input {...common} type="url" placeholder="https://…" onChange={(e) => onChange(e.target.value)} /></Wrap>;
    case 'select':
      return (
        <Wrap field={label}>
          <select {...common} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Wrap>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm text-navy-700">
          <input type="checkbox" checked={value === 'true' || value === true}
            onChange={(e) => onChange(e.target.checked ? 'true' : '')}
            className="h-4 w-4 rounded border-navy-300 text-prism" />
          {field.name}{field.required && <span className="text-red-500">*</span>}
        </label>
      );
    default:
      return <Wrap field={label}><input {...common} type="text" onChange={(e) => onChange(e.target.value)} /></Wrap>;
  }
}
