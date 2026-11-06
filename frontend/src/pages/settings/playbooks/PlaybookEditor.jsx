// Settings → Playbooks → a playbook (PB): its forms and how each applies
// (once, per device of the person, per device on the ticket), limits on
// which devices a per-device form is for, and a try-out on a real person.
// A device takes the first per-device form it matches.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconArrowUp, IconArrowDown, IconTrash, IconPlus } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import SettingsPage from '../../../components/settings/SettingsPage';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';

const inputClass = 'h-9 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm';
const TRI = [['', 'Any'], ['true', 'Yes'], ['false', 'No']];
const triValue = (v) => (v === true ? 'true' : v === false ? 'false' : '');
const triParse = (s) => (s === 'true' ? true : s === 'false' ? false : undefined);

function MultiSelect({ label, options, value = [], onChange }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[13px] font-medium text-navy-500">{label}</legend>
      <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-navy-100 p-2">
        {options.length === 0 && <span className="text-xs text-navy-400">None set up.</span>}
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}
          </label>
        ))}
      </div>
      <span className="text-xs text-navy-400">{value.length ? '' : 'Any'}</span>
    </fieldset>
  );
}

function TryIt({ playbookId }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => api.get('/contacts', { params: { search: q.trim(), limit: 6 } }).then(({ data }) => setFound(data.contacts || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const run = async (c) => {
    setError('');
    setFound([]);
    setQ(c.displayName);
    try { const { data } = await api.post(`/playbooks/${playbookId}/preview`, { contactId: c.id }); setResult(data); } catch (err) { setError(errMessage(err)); setResult(null); }
  };
  return (
    <div className="card">
      <div className="border-b border-navy-100 px-4 py-3"><h3 className="text-sm font-semibold">Try it on someone</h3></div>
      <div className="flex flex-col gap-2 p-4 text-sm">
        <input className={inputClass} placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Try on contact" />
        {found.map((c) => <button key={c.id} type="button" className="text-left hover:underline" onClick={() => run(c)}>{c.displayName}</button>)}
        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
        {result && (
          <ul className="flex flex-col gap-1" data-testid="try-result">
            {result.forms.map((f, i) => <li key={i}>{f.formName} <span className="text-navy-400">· {f.asset ? f.asset.name : 'once'}</span></li>)}
            {result.uncovered.map((a) => <li key={a.id} style={{ color: 'var(--color-warning)' }}>Not covered · {a.name}</li>)}
            {result.forms.length === 0 && result.uncovered.length === 0 && <li className="text-navy-400">Nothing would be added.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PlaybookEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  const [pb, setPb] = useState(isNew ? { name: '', description: '', needsPerson: false, companyIds: null, blocks: [], isActive: true } : null);
  const [forms, setForms] = useState([]);
  const [lookups, setLookups] = useState({ categories: [], mdms: [], companies: [] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew) api.get(`/playbooks/${id}`).then(({ data }) => setPb(data.playbook)).catch((err) => setError(errMessage(err)));
    api.get('/forms').then(({ data }) => setForms(data.forms)).catch(() => {});
    Promise.all([
      api.get('/assets/categories').then(({ data }) => data.categories).catch(() => []),
      api.get('/mdms').then(({ data }) => data.mdms).catch(() => []),
      api.get('/companies', { params: { limit: 200 } }).then(({ data }) => data.companies || []).catch(() => []),
    ]).then(([categories, mdms, companies]) => setLookups({ categories, mdms, companies }));
  }, [id, isNew]);

  if (!pb) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  const set = (patch) => setPb((p) => ({ ...p, ...patch }));
  const setBlock = (i, patch) => set({ blocks: pb.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const setLimit = (i, key, v) => setBlock(i, { limits: { ...(pb.blocks[i].limits || {}), [key]: v } });
  const move = (i, by) => { const out = [...pb.blocks]; const j = i + by; if (j < 0 || j >= out.length) return; [out[i], out[j]] = [out[j], out[i]]; set({ blocks: out }); };

  const save = async () => {
    setSaving(true);
    setError('');
    const body = {
      name: pb.name, description: pb.description, needsPerson: pb.needsPerson, companyIds: pb.companyIds,
      blocks: pb.blocks.map((b) => ({ formId: Number(b.formId), applies: b.applies, limits: b.limits || {} })),
    };
    try {
      if (isNew) { const { data } = await api.post('/playbooks', body); navigate(`/settings/playbooks/${data.playbook.id}`, { replace: true }); } else { const { data } = await api.put(`/playbooks/${id}`, body); setPb(data.playbook); }
    } catch (err) { setError(errMessage(err)); } finally { setSaving(false); }
  };

  return (
    <SettingsPage title={isNew ? 'New playbook' : pb.name || 'Playbook'} width="wide"
      actions={<Button variant="primary" onClick={save} disabled={saving || !pb.name.trim()} data-testid="save-playbook">{saving ? 'Saving…' : 'Save'}</Button>}>
      {error && <div role="alert" className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>{error}</div>}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3">
          <div className="card grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">
            <Field label="Name"><input className={inputClass} value={pb.name} onChange={(e) => set({ name: e.target.value })} data-testid="playbook-name" /></Field>
            <Field label="Offered for">
              <select className={inputClass} value={pb.companyIds ? 'some' : 'all'} onChange={(e) => set({ companyIds: e.target.value === 'all' ? null : [] })}>
                <option value="all">All companies</option>
                <option value="some">Some companies…</option>
              </select>
            </Field>
            {pb.companyIds && <div className="sm:col-span-2"><MultiSelect label="Companies" options={lookups.companies} value={pb.companyIds} onChange={(companyIds) => set({ companyIds })} /></div>}
            <Field label="Description" className="sm:col-span-2"><textarea rows={2} className={`${inputClass} h-auto py-2`} value={pb.description || ''} onChange={(e) => set({ description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={pb.needsPerson} onChange={(e) => set({ needsPerson: e.target.checked })} data-testid="needs-person" /><span><b>Needs a person</b> <span className="text-navy-400">· asked when applied, guessed from the ticket&apos;s subject</span></span></label>
          </div>
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Forms</h2><span className="text-xs text-navy-400">A device gets the first per-device form it matches.</span></div>
          {pb.blocks.map((b, i) => {
            const form = forms.find((f) => f.id === Number(b.formId));
            const perDevice = b.applies !== 'once';
            return (
              <div key={i} className="card flex flex-col gap-3 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Field label="Form">
                    <select className={inputClass} value={b.formId || ''} onChange={(e) => setBlock(i, { formId: Number(e.target.value) })} data-testid={`block-form-${i}`}>
                      <option value="">Choose…</option>
                      {forms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.usage === 'device' ? 'per device' : 'once'})</option>)}
                    </select>
                  </Field>
                  <Field label="Applies">
                    <select className={inputClass} value={b.applies} onChange={(e) => setBlock(i, { applies: e.target.value, limits: {} })} data-testid={`block-applies-${i}`}>
                      <option value="once">Once for the ticket</option>
                      <option value="person_devices">Per device: the person&apos;s devices</option>
                      <option value="ticket_devices">Per device: devices on the ticket</option>
                    </select>
                  </Field>
                  <div className="flex items-end gap-1">
                    <Button size="sm" variant="quiet" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><IconArrowUp size={14} /></Button>
                    <Button size="sm" variant="quiet" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === pb.blocks.length - 1}><IconArrowDown size={14} /></Button>
                    <Button size="sm" variant="quiet" aria-label="Remove form" onClick={() => set({ blocks: pb.blocks.filter((_, j) => j !== i) })}><IconTrash size={14} /></Button>
                  </div>
                </div>
                {form && (form.usage === 'device') !== perDevice && <p className="text-xs" style={{ color: 'var(--color-warning)' }}>{form.usage === 'device' ? 'This form is used per device: choose a per-device option.' : 'This form is used once per ticket: choose Once.'}</p>}
                {perDevice && (
                  <div className="grid grid-cols-1 gap-3 border-t border-navy-100 pt-3 sm:grid-cols-2">
                    <MultiSelect label="Only device types" options={lookups.categories} value={b.limits?.categoryIds || []} onChange={(v) => setLimit(i, 'categoryIds', v)} />
                    <MultiSelect label="Only MDMs" options={lookups.mdms} value={b.limits?.mdmIds || []} onChange={(v) => setLimit(i, 'mdmIds', v)} />
                    {[['managed', 'Managed'], ['hasCellular', 'Has cellular'], ['hasAgent', 'Has the PRISM agent']].map(([k, l]) => (
                      <Field key={k} label={l}>
                        <select className={inputClass} value={triValue(b.limits?.[k])} onChange={(e) => setLimit(i, k, triParse(e.target.value))}>
                          {TRI.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                        </select>
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <Button className="self-start" onClick={() => set({ blocks: [...pb.blocks, { formId: '', applies: 'once', limits: {} }] })} data-testid="add-block"><IconPlus size={15} />Add a form</Button>
        </div>
        <aside className="flex flex-[1_1_320px] flex-col gap-3 md:max-w-[380px]">
          {!isNew && <TryIt playbookId={id} />}
        </aside>
      </div>
    </SettingsPage>
  );
}
