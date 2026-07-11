import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';
import Switch from '../../components/Switch';

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];
const FIELD_TYPE_LABELS = Object.fromEntries(FIELD_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const TICKET_TYPES = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'problem', label: 'Problem' },
  { value: 'change', label: 'Change' },
];
const OPTION_TYPES = ['dropdown', 'multiselect'];
const FIELD_KEY_RE = /^[a-z0-9_]+$/;

function slugify(text) {
  return String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || '';
}

function AppliesToText({ ticketTypes }) {
  if (!ticketTypes || ticketTypes.length === 0) return <span>All types</span>;
  return <span>{ticketTypes.map((t) => TICKET_TYPES.find((tt) => tt.value === t)?.label || t).join(', ')}</span>;
}

// ==================== Field editor modal ====================
function FieldEditorModal({ field, onClose, onSaved }) {
  const isNew = !field;
  const [label, setLabel] = useState(field?.label || '');
  const [fieldKey, setFieldKey] = useState(field?.fieldKey || '');
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [fieldType, setFieldType] = useState(field?.fieldType || 'text');
  const [ticketTypes, setTicketTypes] = useState(field?.ticketTypes || []);
  const [isRequired, setIsRequired] = useState(field?.isRequired || false);
  const [isActive, setIsActive] = useState(field?.isActive !== false);
  const [placeholder, setPlaceholder] = useState(field?.placeholder || '');
  const [defaultValue, setDefaultValue] = useState(field?.defaultValue || '');
  const [options, setOptions] = useState(field?.options?.length ? field.options : ['', '']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleLabelChange = (value) => {
    setLabel(value);
    if (!keyTouched) setFieldKey(slugify(value));
  };

  const toggleTicketType = (value) => {
    setTicketTypes((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));
  };

  const updateOption = (idx, value) => setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  const addOption = () => setOptions((prev) => [...prev, '']);
  const removeOption = (idx) => setOptions((prev) => prev.filter((_, i) => i !== idx));
  const moveOption = (idx, dir) => setOptions((prev) => {
    const next = [...prev];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return prev;
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!label.trim()) { setError('Label is required'); return; }
    if (!FIELD_KEY_RE.test(fieldKey)) {
      setError('Field key may only contain lowercase letters, numbers, and underscores');
      return;
    }
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (OPTION_TYPES.includes(fieldType) && cleanOptions.length < 2) {
      setError('Dropdown/multiselect fields need at least 2 options');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        label: label.trim(),
        fieldKey,
        fieldType,
        ticketTypes,
        isRequired,
        isActive,
        placeholder: placeholder || null,
        defaultValue: defaultValue || null,
        options: OPTION_TYPES.includes(fieldType) ? cleanOptions : null,
      };
      const { data } = isNew
        ? await api.post('/custom-fields', payload)
        : await api.patch(`/custom-fields/${field.id}`, payload);
      onSaved(data.customField);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add field' : 'Edit field'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Label *</label>
            <input className="input" value={label} onChange={(e) => handleLabelChange(e.target.value)} required />
          </div>
          <div>
            <label className="label">Field key *</label>
            <input
              className="input font-mono"
              value={fieldKey}
              onChange={(e) => { setFieldKey(e.target.value.toLowerCase()); setKeyTouched(true); }}
              required
            />
            <p className="mt-1 text-xs text-navy-400">Lowercase letters, numbers, underscores only. Must be unique.</p>
          </div>
        </div>

        <div>
          <label className="label">Field type</label>
          <select className="input" value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            {FIELD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {OPTION_TYPES.includes(fieldType) && (
          <div>
            <label className="label">Options (at least 2)</label>
            <div className="space-y-1.5">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    className="input"
                    value={opt}
                    onChange={(e) => updateOption(idx, e.target.value)}
                    placeholder={`Option ${idx + 1}`}
                  />
                  <button type="button" onClick={() => moveOption(idx, -1)} disabled={idx === 0} className="text-navy-400 disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveOption(idx, 1)} disabled={idx === options.length - 1} className="text-navy-400 disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => removeOption(idx)} className="text-red-500">✕</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addOption} className="mt-2 text-sm text-prism hover:underline">+ Add option</button>
          </div>
        )}

        <div>
          <label className="label">Applies to</label>
          <div className="flex flex-wrap gap-3">
            {TICKET_TYPES.map((t) => (
              <label key={t.value} className="flex items-center gap-1.5 text-sm text-navy-700">
                <input
                  type="checkbox"
                  checked={ticketTypes.includes(t.value)}
                  onChange={() => toggleTicketType(t.value)}
                  className="h-4 w-4 rounded border-navy-300 text-prism"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-navy-400">Leave all unchecked to apply to every ticket type.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Placeholder text</label>
            <input className="input" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
          </div>
          <div>
            <label className="label">Default value</label>
            <input className="input" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
            <Switch checked={isRequired} onChange={setIsRequired} label="Required" /> Required
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
            <Switch checked={isActive} onChange={setIsActive} label="Active" /> Active
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save field'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ==================== Preview modal ====================
function PreviewInput({ field }) {
  const common = { placeholder: field.placeholder || '', className: 'input', disabled: true };
  if (field.fieldType === 'textarea') return <textarea {...common} />;
  if (field.fieldType === 'dropdown') {
    return (
      <select className="input" disabled>
        <option>{field.placeholder || 'Select…'}</option>
        {(field.options || []).map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'multiselect') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options || []).map((o) => (
          <span key={o} className="badge bg-navy-100 text-navy-700">{o}</span>
        ))}
      </div>
    );
  }
  if (field.fieldType === 'checkbox') {
    return <input type="checkbox" disabled className="h-4 w-4 rounded border-navy-300" />;
  }
  const typeAttr = { number: 'number', date: 'date', datetime: 'datetime-local', url: 'url', email: 'email', phone: 'tel' }[field.fieldType] || 'text';
  return <input type={typeAttr} {...common} />;
}

function PreviewFormModal({ fields, onClose }) {
  const [ticketType, setTicketType] = useState('');
  const visible = ticketType
    ? fields.filter((f) => f.isActive && (!f.ticketTypes?.length || f.ticketTypes.includes(ticketType)))
    : fields.filter((f) => f.isActive);

  return (
    <Modal title="Preview form" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className="label">Ticket type</label>
          <select className="input" value={ticketType} onChange={(e) => setTicketType(e.target.value)}>
            <option value="">All types (show every active field)</option>
            {TICKET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="rounded-md border border-navy-100 p-4">
          <p className="mb-3 text-sm font-semibold text-navy-900">Additional Details</p>
          {visible.length === 0 ? (
            <p className="text-sm text-navy-400">No custom fields apply — this section would be hidden.</p>
          ) : (
            <div className="space-y-3">
              {visible.map((f) => (
                <div key={f.id}>
                  <label className="label">{f.label}{f.isRequired && <span className="text-red-500"> *</span>}</label>
                  <PreviewInput field={f} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}

// ==================== Field row (drag-reorderable) ====================
function FieldRow({ field, dragging, onDragStart, onDragOver, onDrop, onDragEnd, onToggleActive, onEdit, onDelete }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="flex items-center gap-3 px-4 py-3"
      style={{ opacity: dragging ? 0.5 : 1 }}
    >
      <span className="cursor-grab select-none text-navy-300" title="Drag to reorder">⠿</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-navy-900">{field.label}</p>
          <span className="badge bg-navy-100 text-navy-700">{FIELD_TYPE_LABELS[field.fieldType] || field.fieldType}</span>
          {field.isRequired && <span className="badge bg-amber-100 text-amber-800">Required</span>}
        </div>
        <p className="mt-0.5 text-xs text-navy-400">
          <code className="font-mono">{field.fieldKey}</code> · Applies to: <AppliesToText ticketTypes={field.ticketTypes} />
        </p>
      </div>
      <Switch checked={field.isActive} onChange={onToggleActive} label={field.isActive ? 'Active' : 'Inactive'} />
      <span className="w-14 flex-shrink-0 text-xs text-navy-400">{field.isActive ? 'Active' : 'Inactive'}</span>
      <button type="button" onClick={onEdit} className="text-xs text-prism hover:underline">edit</button>
      <button type="button" onClick={onDelete} className="text-xs text-red-500 hover:underline">delete</button>
    </div>
  );
}

// ==================== Ticket Fields tab ====================
function TicketFieldsTab() {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorField, setEditorField] = useState(null); // field object | 'new' | null
  const [showPreview, setShowPreview] = useState(false);
  const dragId = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  const load = () => {
    api.get('/custom-fields')
      .then(({ data }) => setFields(data.customFields))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDrop = async (targetId) => {
    const sourceId = dragId.current;
    dragId.current = null;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const order = fields.map((f) => f.id);
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    order.splice(to, 0, order.splice(from, 1)[0]);
    setFields(order.map((id) => fields.find((f) => f.id === id)));
    try {
      await api.patch('/custom-fields/reorder', { order });
    } catch (err) {
      alert(errMessage(err));
      load();
    }
  };

  const toggleActive = async (field) => {
    try {
      const { data } = await api.patch(`/custom-fields/${field.id}`, { isActive: !field.isActive });
      setFields((prev) => prev.map((f) => (f.id === field.id ? data.customField : f)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const handleSaved = (saved) => {
    setEditorField(null);
    setFields((prev) => {
      const exists = prev.some((f) => f.id === saved.id);
      const next = exists ? prev.map((f) => (f.id === saved.id ? saved : f)) : [...prev, saved];
      return next.sort((a, b) => a.position - b.position);
    });
  };

  const deleteField = async (field, force) => {
    try {
      await api.delete(`/custom-fields/${field.id}${force ? '?force=true' : ''}`);
      setFields((prev) => prev.filter((f) => f.id !== field.id));
    } catch (err) {
      if (err?.response?.data?.code === 'HAS_VALUES') {
        if (confirm(err.response.data.message)) deleteField(field, true);
        return;
      }
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-navy-500">
          Custom fields appear on the ticket creation form and ticket detail sidebar. Scope a field to
          one or more ticket types, or leave all unchecked to apply everywhere.
        </p>
        <div className="flex flex-shrink-0 gap-2">
          <button onClick={() => setShowPreview(true)} className="btn-secondary">Preview form</button>
          <button onClick={() => setEditorField('new')} className="btn-primary">+ Add field</button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card divide-y divide-navy-100">
        {fields.map((f) => (
          <FieldRow
            key={f.id}
            field={f}
            dragging={draggingId === f.id}
            onDragStart={() => { dragId.current = f.id; setDraggingId(f.id); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(f.id)}
            onDragEnd={() => { dragId.current = null; setDraggingId(null); }}
            onToggleActive={() => toggleActive(f)}
            onEdit={() => setEditorField(f)}
            onDelete={() => deleteField(f)}
          />
        ))}
        {fields.length === 0 && <p className="px-4 py-6 text-center text-sm text-navy-400">No custom fields yet.</p>}
      </div>

      {editorField !== null && (
        <FieldEditorModal
          field={editorField === 'new' ? null : editorField}
          onClose={() => setEditorField(null)}
          onSaved={handleSaved}
        />
      )}
      {showPreview && <PreviewFormModal fields={fields} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

// ==================== Page ====================
export default function Layouts() {
  const [tab, setTab] = useState('ticket');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Layouts &amp; Fields</h1>

      <div className="flex gap-1 border-b border-navy-100">
        <button
          type="button"
          onClick={() => setTab('ticket')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'ticket' ? 'border-prism text-prism' : 'border-transparent text-navy-400'}`}
        >
          Ticket Fields
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-navy-300"
        >
          Contact Fields
          <span className="badge bg-navy-100 text-navy-400">Coming soon</span>
        </button>
      </div>

      {tab === 'ticket' && <TicketFieldsTab />}
    </div>
  );
}
