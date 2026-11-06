// Settings → Forms → a form (PB): sections of text, steps, fields, secure
// values, agent-confirmed steps and the device action, each able to show only
// when it applies. The server checks everything on save; saving an existing
// form makes a new version (forms already on tickets keep theirs).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  IconArrowUp, IconArrowDown, IconTrash, IconAlignLeft, IconSquareCheck, IconForms, IconLock, IconCpu, IconArrowBarToRight, IconPlus,
} from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import SettingsPage from '../../../components/settings/SettingsPage';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import RichTextEditor from '../../../components/RichTextEditor';
import { conditionFieldsFor, describeCondition, newKey } from './conditions';

const inputClass = 'h-9 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm';
const KIND_META = {
  text: { label: 'Text', icon: IconAlignLeft },
  step: { label: 'Step', icon: IconSquareCheck },
  field: { label: 'Field', icon: IconForms },
  secure: { label: 'Secure field', icon: IconLock },
  agent: { label: 'Agent-confirmed step', icon: IconCpu },
  action: { label: 'Device action', icon: IconArrowBarToRight },
};
const FIELD_TYPES = [['text', 'Short text'], ['longtext', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['yesno', 'Yes / no'], ['choice', 'One choice'], ['choices', 'Several choices'], ['staff', 'Staff member'], ['contact', 'Contact']];
const STATUSES = [['ready_to_issue', 'Ready to issue'], ['in_repair', 'In repair'], ['on_hold', 'On hold'], ['retired', 'Retired']];

const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const itemTitle = (item) => (item.kind === 'field' || item.kind === 'secure' ? item.label : item.kind === 'action' ? (item.action === 'check_in' ? 'Check in this device' : 'Check out this device') : strip(item.body)) || '(empty)';

function blankItem(kind) {
  const key = newKey(kind);
  if (kind === 'field') return { key, kind, fieldType: 'text', label: 'New field', required: false };
  if (kind === 'secure') return { key, kind, label: 'New secure value' };
  if (kind === 'action') return { key, kind, action: 'check_in', statuses: STATUSES.map(([s]) => s), required: true };
  return { key, kind, body: '<p>New step</p>', required: kind === 'step' };
}

function ConditionEditor({ conditions = [], options, onChange }) {
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

export default function FormBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  const [meta, setMeta] = useState({ name: '', description: '', usage: 'device', version: null, inUse: 0 });
  const [sections, setSections] = useState(null);
  const [selected, setSelected] = useState(null); // { s, i } (i null: the section)
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lookups, setLookups] = useState({ mdms: [], categories: [], companies: [], departments: [] });

  useEffect(() => {
    if (isNew) { setSections([{ key: newKey('section'), title: 'Step 1', items: [] }]); return; }
    api.get(`/forms/${id}`).then(({ data }) => {
      setMeta({ name: data.form.name, description: data.form.description || '', usage: data.form.usage, version: data.form.version, inUse: data.form.inUse });
      setSections(data.form.definition.sections);
    }).catch((err) => setError(errMessage(err)));
  }, [id, isNew]);
  useEffect(() => {
    Promise.all([
      api.get('/mdms').then(({ data }) => data.mdms).catch(() => []),
      api.get('/assets/categories').then(({ data }) => data.categories).catch(() => []),
      api.get('/companies', { params: { limit: 200 } }).then(({ data }) => data.companies || []).catch(() => []),
      api.get('/departments').then(({ data }) => data.departments || []).catch(() => []),
    ]).then(([mdms, categories, companies, departments]) => setLookups({ mdms, categories, companies, departments }));
  }, []);

  const conditionOptions = useMemo(() => {
    if (!sections || !selected) return { fields: [] };
    return { fields: conditionFieldsFor({ sections, at: selected, usage: meta.usage, lookups }) };
  }, [sections, selected, meta.usage, lookups]);

  if (!sections) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const updateSection = (s, patch) => setSections((all) => all.map((x, j) => (j === s ? { ...x, ...patch } : x)));
  const updateItem = (s, i, patch) => setSections((all) => all.map((x, j) => (j === s ? { ...x, items: x.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) } : x)));
  const moveIn = (list, i, by) => { const out = [...list]; const j = i + by; if (j < 0 || j >= out.length) return out; [out[i], out[j]] = [out[j], out[i]]; return out; };
  const addItem = (s, kind) => {
    const item = blankItem(kind);
    setSections((all) => all.map((x, j) => (j === s ? { ...x, items: [...x.items, item] } : x)));
    setSelected({ s, i: sections[s].items.length });
  };
  const removeItem = (s, i) => { setSections((all) => all.map((x, j) => (j === s ? { ...x, items: x.items.filter((_, k) => k !== i) } : x))); setSelected(null); };
  const addSection = () => { setSections((all) => [...all, { key: newKey('section'), title: `Step ${all.length + 1}`, items: [] }]); setSelected({ s: sections.length, i: null }); };

  const save = async () => {
    setSaving(true);
    setError('');
    const definition = { sections };
    try {
      if (isNew) {
        const { data } = await api.post('/forms', { name: meta.name, description: meta.description, usage: meta.usage, definition });
        navigate(`/settings/forms/${data.form.id}`, { replace: true });
      } else {
        const { data } = await api.put(`/forms/${id}`, { name: meta.name, description: meta.description, definition });
        setMeta((m) => ({ ...m, version: data.form.version, inUse: data.form.inUse }));
        setSections(data.form.definition.sections);
      }
    } catch (err) { setError(errMessage(err)); } finally { setSaving(false); }
  };

  const sel = selected && sections[selected.s];
  const selItem = sel && selected.i !== null ? sel.items[selected.i] : null;
  const usageDevice = meta.usage === 'device';

  return (
    <SettingsPage
      title={isNew ? 'New form' : meta.name || 'Form'}
      description={isNew ? 'Build the steps once; playbooks add it to tickets.' : `Version ${meta.version}${meta.inUse ? ` · on ${meta.inUse} open ticket form${meta.inUse === 1 ? '' : 's'}, which keep the version they started with` : ''}.`}
      width="wide"
      actions={<Button variant="primary" onClick={save} disabled={saving || !meta.name.trim()} data-testid="save-form">{saving ? 'Saving…' : isNew ? 'Create form' : `Save as version ${(meta.version || 0) + 1}`}</Button>}
    >
      {error && <div role="alert" className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>{error}</div>}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3">
          <div className="card grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-[minmax(0,1fr)_240px]">
            <Field label="Name"><input className={inputClass} value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} data-testid="form-name" /></Field>
            <Field label="Used" hint={isNew ? 'Per-device forms can use device conditions and device actions.' : "Can't change after the form is made."}>
              <select className={inputClass} value={meta.usage} disabled={!isNew} onChange={(e) => setMeta((m) => ({ ...m, usage: e.target.value }))} data-testid="form-usage">
                <option value="device">Per device</option>
                <option value="ticket">Once per ticket</option>
              </select>
            </Field>
            <Field label="Description" className="sm:col-span-2"><textarea rows={2} className={`${inputClass} h-auto py-2`} value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} /></Field>
          </div>

          {sections.map((section, s) => (
            <section key={section.key} className="card" aria-label={`Section ${section.title}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 px-4 py-3">
                <input className={`${inputClass} flex-1 font-semibold`} value={section.title} onChange={(e) => updateSection(s, { title: e.target.value })} aria-label="Section title" onFocus={() => setSelected({ s, i: null })} />
                {section.showWhen?.length > 0 && <span className="rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-500">{section.showWhen.length} condition{section.showWhen.length === 1 ? '' : 's'}</span>}
                <Button size="sm" variant="quiet" aria-label="Move section up" onClick={() => setSections((all) => moveIn(all, s, -1))} disabled={s === 0}><IconArrowUp size={14} /></Button>
                <Button size="sm" variant="quiet" aria-label="Move section down" onClick={() => setSections((all) => moveIn(all, s, 1))} disabled={s === sections.length - 1}><IconArrowDown size={14} /></Button>
                <Button size="sm" variant="quiet" aria-label="Delete section" onClick={() => { if (window.confirm(`Delete the section "${section.title}" and its items?`)) { setSections((all) => all.filter((_, j) => j !== s)); setSelected(null); } }}><IconTrash size={14} /></Button>
              </div>
              <div className="flex flex-col gap-2 p-3">
                {section.items.map((item, i) => {
                  const Meta = KIND_META[item.kind] || KIND_META.text;
                  const isSel = selected?.s === s && selected?.i === i;
                  return (
                    <div key={item.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border bg-surface px-3 py-2" style={isSel ? { borderColor: 'var(--color-accent)', boxShadow: '0 0 0 3px var(--color-accent-soft)' } : undefined}>
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-navy-50 text-navy-500" title={Meta.label}><Meta.icon size={15} aria-hidden="true" /></span>
                      <button type="button" className="min-w-0 truncate text-left text-sm font-medium text-navy-900" onClick={() => setSelected({ s, i })} aria-label={`Edit ${itemTitle(item)}`}>{itemTitle(item)}</button>
                      <div className="flex items-center gap-1">
                        {item.showWhen?.map((c, k) => <span key={k} className="hidden max-w-[180px] truncate rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-500 sm:inline">{describeCondition(c, conditionFieldsFor({ sections, at: { s, i }, usage: meta.usage, lookups }))}</span>)}
                        {item.required && <span className="font-bold" style={{ color: 'var(--color-danger)' }} aria-label="Required">*</span>}
                        <Button size="sm" variant="quiet" aria-label="Move up" onClick={() => updateSection(s, { items: moveIn(section.items, i, -1) })} disabled={i === 0}><IconArrowUp size={14} /></Button>
                        <Button size="sm" variant="quiet" aria-label="Move down" onClick={() => updateSection(s, { items: moveIn(section.items, i, 1) })} disabled={i === section.items.length - 1}><IconArrowDown size={14} /></Button>
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="mr-1 text-xs text-navy-400">Add</span>
                  {['text', 'step', 'field', 'secure', ...(usageDevice ? ['agent', 'action'] : [])].map((k) => (
                    <Button key={k} size="sm" onClick={() => addItem(s, k)} data-testid={`add-${k}`}>{KIND_META[k].label}</Button>
                  ))}
                </div>
              </div>
            </section>
          ))}
          <Button className="self-start" onClick={addSection}><IconPlus size={15} />Add section</Button>
        </div>

        <aside className="flex flex-[1_1_320px] flex-col gap-3 md:sticky md:top-4 md:max-w-[400px]" aria-label="Selected item">
          {!sel && <div className="card p-4 text-sm text-navy-400">Choose a section or item to edit it and say when it shows.</div>}
          {sel && !selItem && (
            <div className="card">
              <div className="border-b border-navy-100 px-4 py-3"><h3 className="text-sm font-semibold">Section: show when</h3></div>
              <div className="p-4"><ConditionEditor conditions={sel.showWhen || []} options={conditionOptions} onChange={(showWhen) => updateSection(selected.s, { showWhen: showWhen.length ? showWhen : undefined })} /></div>
            </div>
          )}
          {selItem && (
            <>
              <div className="card">
                <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
                  <h3 className="text-sm font-semibold">{KIND_META[selItem.kind].label}</h3>
                  <Button size="sm" variant="quiet" style={{ color: 'var(--color-danger)' }} onClick={() => removeItem(selected.s, selected.i)}>Delete</Button>
                </div>
                <div className="flex flex-col gap-3.5 p-4">
                  {['text', 'step', 'agent'].includes(selItem.kind) && (
                    <Field label="Text"><div key={selItem.key}><RichTextEditor value={selItem.body} onChange={(body) => updateItem(selected.s, selected.i, { body })} /></div></Field>
                  )}
                  {(selItem.kind === 'field' || selItem.kind === 'secure') && (
                    <Field label="Label"><input className={inputClass} value={selItem.label} onChange={(e) => updateItem(selected.s, selected.i, { label: e.target.value })} data-testid="item-label" /></Field>
                  )}
                  {selItem.kind === 'field' && (
                    <Field label="Type">
                      <select className={inputClass} value={selItem.fieldType} onChange={(e) => updateItem(selected.s, selected.i, { fieldType: e.target.value, ...(['choice', 'choices'].includes(e.target.value) && !selItem.options ? { options: ['Option 1'] } : {}) })}>
                        {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                  )}
                  {selItem.kind === 'field' && ['choice', 'choices'].includes(selItem.fieldType) && (
                    <Field label="Options" hint="One per line">
                      <textarea rows={4} className={`${inputClass} h-auto py-2`} value={(selItem.options || []).join('\n')} onChange={(e) => updateItem(selected.s, selected.i, { options: e.target.value.split('\n') })} onBlur={(e) => updateItem(selected.s, selected.i, { options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
                    </Field>
                  )}
                  {selItem.kind === 'action' && (
                    <>
                      <Field label="Action">
                        <select className={inputClass} value={selItem.action} onChange={(e) => updateItem(selected.s, selected.i, { action: e.target.value, ...(e.target.value === 'check_in' ? { statuses: STATUSES.map(([x]) => x) } : { statuses: undefined }) })}>
                          <option value="check_in">Check in this device</option>
                          <option value="check_out">Check out this device</option>
                        </select>
                      </Field>
                      {selItem.action === 'check_in' && (
                        <fieldset className="flex flex-col gap-1.5"><legend className="mb-1 text-[13px] font-medium text-navy-500">Statuses it can be checked in to</legend>
                          {STATUSES.map(([v, l]) => (
                            <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(selItem.statuses || []).includes(v)} onChange={(e) => updateItem(selected.s, selected.i, { statuses: e.target.checked ? [...(selItem.statuses || []), v] : (selItem.statuses || []).filter((x) => x !== v) })} />{l}</label>
                          ))}
                        </fieldset>
                      )}
                      <p className="text-xs text-navy-400">The device action is always required and must be the last item of the form.</p>
                    </>
                  )}
                  {!['text', 'action'].includes(selItem.kind) && (
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!selItem.required} onChange={(e) => updateItem(selected.s, selected.i, { required: e.target.checked })} />Required</label>
                  )}
                  {selItem.kind === 'step' && (
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!selItem.askNote} onChange={(e) => updateItem(selected.s, selected.i, { askNote: e.target.checked })} />Ask for a note when ticked</label>
                  )}
                </div>
              </div>
              <div className="card">
                <div className="border-b border-navy-100 px-4 py-3"><h3 className="text-sm font-semibold">Show when</h3></div>
                <div className="p-4">
                  <ConditionEditor conditions={selItem.showWhen || []} options={conditionOptions} onChange={(showWhen) => updateItem(selected.s, selected.i, { showWhen: showWhen.length ? showWhen : undefined })} />
                  <p className="mt-2 text-xs text-navy-400">Conditions can use the device (type, managed, MDM, cellular, agent, company), the person (company, department), or an earlier answer in this form.</p>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </SettingsPage>
  );
}
