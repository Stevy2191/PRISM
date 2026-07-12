import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
];
const FIELD_TYPE_LABELS = Object.fromEntries(FIELD_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const ICON_OPTIONS = [
  { value: '💻', label: 'Laptop' },
  { value: '🖥️', label: 'Desktop' },
  { value: '🖨️', label: 'Printer' },
  { value: '📱', label: 'Phone' },
  { value: '📶', label: 'Router' },
  { value: '🗄️', label: 'Server' },
  { value: '📷', label: 'Camera' },
  { value: '📲', label: 'Tablet' },
  { value: '📦', label: 'Other' },
];

function slugify(text) {
  return String(text || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ==================== Inline field add/edit form ====================
// Deliberately inline (not a second Modal) — this app has no established
// nested-modal stacking pattern, and a category's field list is already
// inside a modal itself.
function InlineFieldForm({ field, onCancel, onSave }) {
  const isNew = !field;
  const [label, setLabel] = useState(field?.label || '');
  const [fieldKey, setFieldKey] = useState(field?.fieldKey || '');
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [fieldType, setFieldType] = useState(field?.fieldType || 'text');
  const [required, setRequired] = useState(field?.required || false);
  const [options, setOptions] = useState(field?.options?.length ? field.options : ['', '']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleLabelChange = (value) => {
    setLabel(value);
    if (!keyTouched) setFieldKey(slugify(value));
  };
  const updateOption = (idx, value) => setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  const addOption = () => setOptions((prev) => [...prev, '']);
  const removeOption = (idx) => setOptions((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    if (!label.trim()) { setError('Field label is required'); return; }
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (fieldType === 'dropdown' && cleanOptions.length < 2) { setError('Dropdown fields need at least 2 options'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave({
        label: label.trim(),
        fieldKey: fieldKey || undefined,
        fieldType,
        required,
        options: fieldType === 'dropdown' ? cleanOptions : null,
      });
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-navy-200 bg-navy-50 p-3">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Label *</label>
          <input className="input h-9 text-sm" value={label} onChange={(e) => handleLabelChange(e.target.value)} required />
        </div>
        <div>
          <label className="label">Field type</label>
          <select className="input h-9 text-sm" value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            {FIELD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {fieldType === 'dropdown' && (
        <div>
          <label className="label">Options (at least 2)</label>
          <div className="space-y-1.5">
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input className="input h-8 text-sm" value={opt} onChange={(e) => updateOption(idx, e.target.value)} placeholder={`Option ${idx + 1}`} />
                <button type="button" onClick={() => removeOption(idx)} className="text-xs text-red-500">✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addOption} className="mt-1 text-xs text-prism hover:underline">+ Add option</button>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-navy-700">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 rounded border-navy-300" />
        Required
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary text-xs">{saving ? 'Saving…' : 'Save field'}</button>
      </div>
    </form>
  );
}

// ==================== Field row (drag-reorderable) ====================
function FieldRow({ field, dragging, onDragStart, onDragOver, onDrop, onDragEnd, onEdit, onDelete }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="flex items-center gap-3 px-3 py-2.5"
      style={{ opacity: dragging ? 0.5 : 1 }}
    >
      <span className="cursor-grab select-none text-navy-300" title="Drag to reorder">⠿</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-navy-900">{field.label}</p>
          <span className="badge bg-navy-100 text-navy-700">{FIELD_TYPE_LABELS[field.fieldType] || field.fieldType}</span>
          {field.required && <span className="badge bg-amber-100 text-amber-800">Required</span>}
          {field.isBuiltIn && <span className="badge bg-navy-100 text-navy-500" title="Built-in field">🔒 Built-in</span>}
        </div>
        <p className="mt-0.5 text-xs text-navy-400"><code className="font-mono">{field.fieldKey}</code></p>
      </div>
      <button type="button" onClick={onEdit} className="text-xs text-prism hover:underline">edit</button>
      {!field.isBuiltIn && <button type="button" onClick={onDelete} className="text-xs text-red-500 hover:underline">delete</button>}
    </div>
  );
}

// ==================== Category editor modal ====================
function CategoryEditorModal({ category, onClose, onSaved }) {
  const [savedCategory, setSavedCategory] = useState(category);
  const [name, setName] = useState(category?.name || '');
  const [icon, setIcon] = useState(category?.icon || ICON_OPTIONS[0].value);
  const [color, setColor] = useState(category?.color || '#64748b');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [fields, setFields] = useState([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [editorField, setEditorField] = useState(null); // 'new' | field | null
  const dragId = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  const loadFields = (catId) => {
    setLoadingFields(true);
    api.get(`/assets/categories/${catId}/fields`).then(({ data }) => setFields(data.fields)).finally(() => setLoadingFields(false));
  };

  useEffect(() => {
    if (savedCategory?.id) loadFields(savedCategory.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCategory?.id]);

  const saveCategory = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Category name is required'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = { name: name.trim(), icon, color };
      const { data } = savedCategory
        ? await api.patch(`/assets/categories/${savedCategory.id}`, payload)
        : await api.post('/assets/categories', payload);
      setSavedCategory(data.category);
      onSaved(data.category);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
      await api.patch(`/assets/categories/${savedCategory.id}/fields/reorder`, { order });
    } catch (err) {
      alert(errMessage(err));
      loadFields(savedCategory.id);
    }
  };

  const saveField = async (payload) => {
    if (editorField === 'new') {
      const { data } = await api.post(`/assets/categories/${savedCategory.id}/fields`, payload);
      setFields((prev) => [...prev, data.field]);
    } else {
      const { data } = await api.patch(`/assets/categories/${savedCategory.id}/fields/${editorField.id}`, payload);
      setFields((prev) => prev.map((f) => (f.id === editorField.id ? data.field : f)));
    }
    setEditorField(null);
  };

  const deleteField = async (field, force) => {
    try {
      await api.delete(`/assets/categories/${savedCategory.id}/fields/${field.id}${force ? '?force=true' : ''}`);
      setFields((prev) => prev.filter((f) => f.id !== field.id));
    } catch (err) {
      if (err?.response?.data?.code === 'HAS_VALUES') {
        if (confirm(err.response.data.message)) deleteField(field, true);
        return;
      }
      alert(errMessage(err));
    }
  };

  return (
    <Modal title={savedCategory ? 'Edit category' : 'New category'} onClose={onClose} wide>
      <form onSubmit={saveCategory} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div>
          <label className="label">Category name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div>
          <label className="label">Icon</label>
          <div className="flex flex-wrap gap-2">
            {ICON_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setIcon(o.value)}
                title={o.label}
                className="flex h-10 w-10 items-center justify-center rounded-md border text-lg"
                style={{ borderColor: icon === o.value ? 'var(--color-accent)' : '#e2e8f0', backgroundColor: icon === o.value ? 'color-mix(in srgb, var(--color-accent) 12%, white)' : 'white' }}
              >
                {o.value}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-16 cursor-pointer rounded border border-navy-200"
          />
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <button type="button" onClick={onClose} className="btn-secondary">{savedCategory ? 'Close' : 'Cancel'}</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : savedCategory ? 'Save category' : 'Create category'}</button>
        </div>
      </form>

      {savedCategory && (
        <div className="mt-6 space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-navy-900">Fields</h3>
            <button type="button" onClick={() => setEditorField('new')} className="btn-secondary text-xs">+ Add field</button>
          </div>
          {savedCategory.isBuiltIn && (
            <p className="text-xs text-navy-400">Built-in fields can be edited but not deleted. You can still add your own fields to this category.</p>
          )}

          {loadingFields ? (
            <Spinner />
          ) : (
            <div className="divide-y divide-navy-100 rounded-md border border-navy-100">
              {fields.map((f) => (
                editorField !== 'new' && editorField?.id === f.id ? (
                  <div key={f.id} className="p-3">
                    <InlineFieldForm field={f} onCancel={() => setEditorField(null)} onSave={saveField} />
                  </div>
                ) : (
                  <FieldRow
                    key={f.id}
                    field={f}
                    dragging={draggingId === f.id}
                    onDragStart={() => { dragId.current = f.id; setDraggingId(f.id); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(f.id)}
                    onDragEnd={() => { dragId.current = null; setDraggingId(null); }}
                    onEdit={() => setEditorField(f)}
                    onDelete={() => deleteField(f)}
                  />
                )
              ))}
              {fields.length === 0 && editorField !== 'new' && <p className="px-3 py-4 text-center text-sm text-navy-400">No extra fields yet.</p>}
              {editorField === 'new' && <div className="p-3"><InlineFieldForm onCancel={() => setEditorField(null)} onSave={saveField} /></div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ==================== Page ====================
export default function AssetCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorCategory, setEditorCategory] = useState(null); // 'new' | category | null

  const load = () => {
    setLoading(true);
    api.get('/assets/categories/manage')
      .then(({ data }) => setCategories(data.categories))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const deleteCategory = async (category) => {
    if (!confirm(`Delete category "${category.name}"?`)) return;
    try {
      await api.delete(`/assets/categories/${category.id}`);
      load();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const handleClosed = () => {
    setEditorCategory(null);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Asset Categories</h1>
          <p className="text-sm text-navy-500">Manage asset categories and the device-specific fields shown for each.</p>
        </div>
        <button type="button" onClick={() => setEditorCategory('new')} className="btn-primary flex-shrink-0">+ New category</button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card divide-y divide-navy-100">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-lg"
              style={{ backgroundColor: `color-mix(in srgb, ${c.color || '#64748b'} 15%, white)` }}
            >
              {c.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-navy-900">{c.name}</p>
                {c.isBuiltIn && <span title="Built-in category">🔒</span>}
              </div>
              <p className="text-xs text-navy-400">{c.fieldCount} extra field{c.fieldCount === 1 ? '' : 's'}</p>
            </div>
            <button type="button" onClick={() => setEditorCategory(c)} className="text-xs text-prism hover:underline">edit</button>
            {!c.isBuiltIn && <button type="button" onClick={() => deleteCategory(c)} className="text-xs text-red-500 hover:underline">delete</button>}
          </div>
        ))}
        {categories.length === 0 && <p className="px-4 py-6 text-center text-sm text-navy-400">No categories yet.</p>}
      </div>

      {editorCategory !== null && (
        <CategoryEditorModal
          category={editorCategory === 'new' ? null : editorCategory}
          onClose={handleClosed}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
