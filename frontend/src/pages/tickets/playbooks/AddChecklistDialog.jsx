// Add checklist (PB2): one dialog for everything a ticket can be given.
// Step 1 picks: suggested bundles, bundles, checklists for the ticket,
// checklists for devices. A ticket checklist is added at once. A device
// checklist or a bundle goes to step 2, "Who is it for?": the person guessed
// from the subject, their devices ticked with what each gets, "+ Another
// device", and a button saying what will be added. Nothing changes in other
// systems.
import { useEffect, useMemo, useState } from 'react';
import { IconChecklist, IconStack2, IconDeviceLaptop } from '@tabler/icons-react';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import api, { errMessage } from '../../../api/api';

const inputClass = 'h-10 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm text-navy-900';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const FINISH = { check_in: 'Checks the device in when finished', check_out: 'Checks the device out when finished' };

function PersonPicker({ ticketCompanyId, value, guesses, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/contacts', { params: { search: q.trim(), companyId: ticketCompanyId, limit: 8 } })
        .then(({ data }) => setResults(data.contacts || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, ticketCompanyId]);
  if (value) {
    return (
      <div className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-md border border-navy-200 px-3 text-sm">
        <b>{value.displayName}</b>
        {value.email && <span className="truncate text-navy-400">{value.email}</span>}
        <Button size="sm" variant="quiet" className="ml-auto" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {guesses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {guesses.map((g) => <Button key={g.id} size="sm" onClick={() => onChange(g)} data-testid="person-guess">{g.displayName}</Button>)}
        </div>
      )}
      <input className={inputClass} placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
      {results.map((c) => (
        <button key={c.id} type="button" onClick={() => { onChange(c); setQ(''); }} className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]">
          {c.displayName} <span className="text-navy-400">{c.email}</span>
        </button>
      ))}
    </div>
  );
}

function AnotherDevice({ ticketCompanyId, exclude, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/assets', { params: { search: q.trim(), companyId: ticketCompanyId, limit: 8 } })
        .then(({ data }) => setFound((data.assets || []).filter((a) => !exclude.has(a.id))))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [open, q, ticketCompanyId, exclude]);
  if (!open) return <Button size="sm" variant="quiet" className="self-start" style={{ color: 'var(--color-accent)' }} onClick={() => setOpen(true)}>+ Another device</Button>;
  return (
    <div className="flex flex-col gap-1">
      <input className={inputClass} autoFocus placeholder="Search devices by name, tag or serial…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
      {found.map((a) => (
        <button key={a.id} type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]" onClick={() => { onPick(a); setOpen(false); setQ(''); }}>
          {a.name} <span className="num text-navy-400">{a.assetTag}</span>
        </button>
      ))}
    </div>
  );
}

function Pick({
  icon: Icon, title, hint, tag, onClick, testId,
}) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--color-hover)]">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-500" aria-hidden="true"><Icon size={18} /></span>
      <span className="min-w-0"><b className="block text-sm text-navy-900">{title}</b>{hint && <span className="block text-[12.5px] text-navy-500">{hint}</span>}</span>
      {tag && <span className="text-[12px] text-navy-400">{tag}</span>}
    </button>
  );
}

function Group({ title, children }) {
  if (!children.length) return null;
  return (
    <div>
      <div className="px-3 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-navy-400">{title}</div>
      {children}
    </div>
  );
}

export default function AddChecklistDialog({
  ticket, initialPlaybookId = null, onClose, onAdded,
}) {
  const [options, setOptions] = useState(null);
  const [q, setQ] = useState('');
  const [choice, setChoice] = useState(null); // { kind: 'bundle' | 'checklist', item }
  const [person, setPerson] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ticked, setTicked] = useState(new Set());
  const [extra, setExtra] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/tickets/${ticket.id}/playbooks/options`)
      .then(({ data }) => {
        setOptions(data);
        if (data.guesses.length === 1) setPerson(data.guesses[0]);
        const initial = initialPlaybookId && data.playbooks.find((p) => p.id === initialPlaybookId);
        if (initial) setChoice({ kind: 'bundle', item: initial });
      })
      .catch((err) => setError(errMessage(err)));
  }, [ticket.id, initialPlaybookId]);

  // Step 2's preview: the person's devices and what each gets.
  useEffect(() => {
    if (!choice) { setPreview(null); return; }
    const params = choice.kind === 'bundle' ? { playbookId: choice.item.id } : { formId: choice.item.id };
    if (person) params.contactId = person.id;
    api.get(`/tickets/${ticket.id}/playbooks/options`, { params })
      .then(({ data }) => {
        setPreview(data);
        setTicked(new Set(data.personDevices.filter((d) => d.form).map((d) => d.asset.id)));
      })
      .catch((err) => setError(errMessage(err)));
  }, [ticket.id, choice, person]);

  const suggestedIds = useMemo(() => new Set((options?.suggestedPlaybookIds) || []), [options]);
  const match = (name) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase());

  const add = async (body, endpoint) => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/${endpoint}`, body);
      onAdded(data);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  const pickChecklist = (c) => {
    if (c.usage === 'ticket') add({ formId: c.id }, 'checklists');
    else setChoice({ kind: 'checklist', item: c });
  };

  // ---- Step 1 ----
  if (!choice) {
    const bundles = options ? options.playbooks.filter((p) => match(p.name)) : [];
    const checklists = options ? options.checklists.filter((c) => match(c.name)) : [];
    const suggested = options ? (options.suggestions || []).filter((s) => match(s.name)) : [];
    return (
      <Modal title="Add a checklist" onClose={onClose} wide>
        {!options ? <p className="text-sm text-navy-400">Loading…</p> : (
          <div className="flex flex-col gap-1">
            <input className={inputClass} placeholder="Search checklists" aria-label="Search checklists" value={q} onChange={(e) => setQ(e.target.value)} />
            <Group title="Suggested for this ticket">
              {suggested.map((s) => <Pick key={`s${s.id}`} icon={IconStack2} title={s.name} hint={s.description || 'A bundle'} tag="Bundle" onClick={() => setChoice({ kind: 'bundle', item: s })} />)}
            </Group>
            <Group title="Bundles">
              {bundles.filter((b) => !suggestedIds.has(b.id)).map((b) => <Pick key={`b${b.id}`} icon={IconStack2} title={b.name} hint={b.description || 'Adds several checklists'} tag="Bundle" onClick={() => setChoice({ kind: 'bundle', item: b })} />)}
            </Group>
            <Group title="For the ticket">
              {checklists.filter((c) => c.usage === 'ticket').map((c) => <Pick key={`c${c.id}`} icon={IconChecklist} title={c.name} hint={plural(c.steps, 'step', 'steps')} tag={saving ? 'Adding…' : 'Adds at once'} onClick={() => pickChecklist(c)} testId={`add-checklist-${c.id}`} />)}
            </Group>
            <Group title="For devices">
              {checklists.filter((c) => c.usage === 'device').map((c) => <Pick key={`c${c.id}`} icon={IconDeviceLaptop} title={c.name} hint={FINISH[c.finish] || plural(c.steps, 'step', 'steps')} tag="Choose devices next" onClick={() => pickChecklist(c)} testId={`add-checklist-${c.id}`} />)}
            </Group>
            {!bundles.length && !checklists.length && !suggested.length && (
              <p className="px-3 py-4 text-sm text-navy-500">{q ? 'Nothing matches.' : 'No checklists yet. People who manage checklists set them up in Settings › Checklists.'}</p>
            )}
            {error && <p role="alert" className="px-3 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            <div className="mt-2 flex justify-end border-t border-navy-100 pt-3"><Button onClick={onClose}>Cancel</Button></div>
          </div>
        )}
      </Modal>
    );
  }

  // ---- Step 2: who it's for, and which devices ----
  const isBundle = choice.kind === 'bundle';
  const needsPerson = isBundle && choice.item.needsPerson;
  const devices = preview ? [
    ...preview.personDevices,
    ...extra.filter((a) => !preview.personDevices.some((d) => d.asset.id === a.id)).map((a) => ({ asset: a, form: isBundle ? null : { id: choice.item.id, name: choice.item.name }, extra: true })),
  ] : [];
  const toggle = (id) => setTicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const chosen = devices.filter((d) => ticked.has(d.asset.id) && d.form);
  const count = isBundle ? (preview?.onceForms.length || 0) + chosen.length + (preview?.ticketDeviceForms?.length || 0) : chosen.length;
  const branch = (d) => {
    if (!d.form) return null;
    const where = d.asset.mdmName ? `, the ${d.asset.mdmName} steps` : (d.asset.isManaged === false ? ', not managed' : '');
    const steps = d.steps ? ` · ${plural(d.steps.shown, 'step', 'steps')}` : '';
    return <>Gets <b className="text-navy-700">{d.form.name}</b>{where}{steps}</>;
  };
  const submit = () => {
    const assetIds = [...ticked].filter((id) => devices.some((d) => d.asset.id === id && d.form));
    if (isBundle) add({ playbookId: choice.item.id, ...(person ? { contactId: person.id } : {}), ...(devices.length ? { assetIds } : {}) }, 'playbooks');
    else add({ formId: choice.item.id, ...(person ? { contactId: person.id } : {}), assetIds }, 'checklists');
  };

  return (
    <Modal title="Who is it for?" onClose={onClose} wide>
      <p className="-mt-2 mb-4 text-sm text-navy-500">{choice.item.name}</p>
      <div className="flex flex-col gap-4">
        <PersonPicker ticketCompanyId={ticket.companyId} value={person} guesses={options.guesses} onChange={(p) => { setPerson(p); setExtra([]); }} />
        {(person || !isBundle || preview?.personDevices.length > 0) && (
          <div className="flex flex-col gap-2">
            {(person || extra.length > 0) && <div className="text-[13px] font-medium text-navy-500">{person ? `${person.displayName}'s devices` : 'Devices'}</div>}
            {person && preview && preview.personDevices.length === 0 && <p className="text-sm text-navy-400">No devices are assigned to them.</p>}
            {devices.map((d) => (
              <label key={d.asset.id} className="flex items-start gap-3 rounded-lg border px-3.5 py-3"
                style={d.form ? undefined : { borderColor: 'var(--color-warning)', backgroundColor: 'var(--color-waiting-bg)' }}>
                <input type="checkbox" className="mt-1 h-4 w-4" checked={ticked.has(d.asset.id)} disabled={!d.form} onChange={() => toggle(d.asset.id)} aria-label={`${d.asset.name} ${d.asset.assetTag}`} />
                <div className="min-w-0">
                  <b>{d.asset.name}</b> <span className="num text-navy-400">{d.asset.assetTag}</span>
                  <div className="text-[12.5px] text-navy-500">
                    {d.form ? branch(d) : (
                      <span style={{ color: 'var(--color-warning-ink, var(--color-warning))' }}>
                        No checklist fits it{d.asset.isManaged && !d.asset.mdmId ? ': it has no MDM set' : ''}. It will be listed on the ticket so it isn&apos;t missed.{' '}
                        <a href={`/assets/${d.asset.id}`} className="font-semibold underline">Open device</a>
                      </span>
                    )}
                    {d.assignedByAgent && ' · assigned by the PRISM agent'}
                  </div>
                </div>
              </label>
            ))}
            {!isBundle && (
              <AnotherDevice ticketCompanyId={ticket.companyId} exclude={new Set(devices.map((d) => d.asset.id))}
                onPick={(a) => { setExtra((x) => [...x, a]); setTicked((t) => new Set([...t, a.id])); }} />
            )}
          </div>
        )}
        {isBundle && preview && preview.onceForms.length > 0 && (
          <p className="text-sm text-navy-500">Also adds {preview.onceForms.map((f) => f.name).join(', ')} for the ticket.</p>
        )}
        {error && <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-navy-100 pt-3">
          <Button variant="quiet" className="mr-auto" onClick={() => { setChoice(null); setExtra([]); setError(''); }}>Back</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} data-testid="add-checklists"
            disabled={saving || (needsPerson && !person) || count === 0}>
            {saving ? 'Adding…' : `Add ${plural(count, 'checklist', 'checklists')}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
