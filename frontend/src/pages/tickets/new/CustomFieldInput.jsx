// One custom field's input on the new-ticket form.
import { BORDER, TEXT, fieldStyle } from '../theme';

// Renders the appropriate input for a custom field's fieldType. `value` is
// always a string except for multiselect, where it's an array.
export function CustomFieldInput({ field, value, onChange }) {
  const commonProps = { className: 'input', style: fieldStyle, placeholder: field.placeholder || '' };

  if (field.fieldType === 'textarea') {
    return <textarea {...commonProps} value={value || ''} onChange={(e) => onChange(e.target.value)} className="input resize-y" style={{ ...fieldStyle, minHeight: '80px' }} />;
  }
  if (field.fieldType === 'dropdown') {
    return (
      <select {...commonProps} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{field.placeholder || 'Select…'}</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) => onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
    return (
      <div className="flex flex-wrap gap-2">
        {(field.options || []).map((o) => (
          <label key={o} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm" style={{ borderColor: BORDER, color: TEXT }}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="h-3.5 w-3.5" />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (field.fieldType === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === 'true' || value === true}
        onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        className="h-4 w-4 rounded"
      />
    );
  }
  const typeAttr = { number: 'number', date: 'date', datetime: 'datetime-local', url: 'url', email: 'email', phone: 'tel' }[field.fieldType] || 'text';
  return <input type={typeAttr} {...commonProps} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
}
