// The full condition editor (PB), behind a checklist line's Advanced rules
// (PB2): conditions on the device, the person or an earlier answer, all of
// which must match.
import { IconTrash, IconPlus } from '@tabler/icons-react';
import Button from '../../../components/ui/Button';

const inputClass = 'h-9 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm';

export default function ConditionEditor({ conditions = [], options, onChange }) {
  const set = (i, patch) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const fieldsOf = (on) => options.fields.filter((f) => f.on === on);
  return (
    <div className="flex flex-col gap-2">
      {conditions.map((c, i) => {
        const def = options.fields.find((f) => f.on === c.on && f.field === c.field) || null;
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-md border border-navy-100 p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-1.5">
              <select className={inputClass} aria-label="Condition is about" value={`${c.on}:${c.field}`} onChange={(e) => { const [on, ...rest] = e.target.value.split(':'); set(i, { on, field: rest.join(':'), op: 'is', value: null }); }}>
                {['device', 'person', 'answer'].map((on) => fieldsOf(on).length > 0 && (
                  <optgroup key={on} label={on === 'device' ? 'The device' : on === 'person' ? 'The person' : 'An earlier answer'}>
                    {fieldsOf(on).map((f) => <option key={f.field} value={`${on}:${f.field}`}>{f.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <Button size="sm" variant="quiet" aria-label="Remove condition" onClick={() => onChange(conditions.filter((_, j) => j !== i))}><IconTrash size={14} /></Button>
            </div>
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-1.5">
              <select className={inputClass} aria-label="Operator" value={c.op} onChange={(e) => set(i, { op: e.target.value, ...(e.target.value.startsWith('is_') && e.target.value !== 'is_not' ? { value: undefined } : {}) })}>
                <option value="is">is</option>
                <option value="is_not">is not</option>
                <option value="is_empty">is empty</option>
                <option value="is_not_empty">is not empty</option>
              </select>
              {(c.op === 'is' || c.op === 'is_not') && (def?.choices ? (
                <select className={inputClass} aria-label="Value" value={c.value === null || c.value === undefined ? '' : String(c.value)} onChange={(e) => { const opt = def.choices.find((o) => String(o.value) === e.target.value); set(i, { value: opt ? opt.value : null }); }}>
                  <option value="">Choose…</option>
                  {def.choices.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                </select>
              ) : (
                <input className={inputClass} aria-label="Value" value={c.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} />
              ))}
            </div>
          </div>
        );
      })}
      {options.fields.length > 0 && (
        <Button size="sm" variant="quiet" className="self-start" style={{ color: 'var(--color-accent)' }}
          onClick={() => onChange([...conditions, { on: options.fields[0].on, field: options.fields[0].field, op: 'is', value: null }])}>
          <IconPlus size={14} />Add condition
        </Button>
      )}
      {conditions.length > 1 && <p className="text-xs text-navy-400">All must match.</p>}
    </div>
  );
}
