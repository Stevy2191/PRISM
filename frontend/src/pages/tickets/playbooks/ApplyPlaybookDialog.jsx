// Apply a playbook to the ticket (PB). Picks the playbook; when it's for a
// person, who (guessed from the subject), then that person's devices with the
// form each will get, all ticked. Nothing changes in other systems.
import { useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import api, { errMessage } from '../../../api/api';

const inputClass = 'h-10 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm text-navy-900';

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
      <div className="flex h-10 items-center gap-2 rounded-md border border-navy-200 px-3 text-sm">
        <b>{value.displayName}</b>
        {value.email && <span className="truncate text-navy-400">· {value.email}</span>}
        <Button size="sm" variant="quiet" className="ml-auto" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {guesses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {guesses.map((g) => (
            <Button key={g.id} size="sm" onClick={() => onChange(g)} data-testid="person-guess">{g.displayName}</Button>
          ))}
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

export default function ApplyPlaybookDialog({ ticket, initialPlaybookId = null, onClose, onApplied }) {
  const [options, setOptions] = useState(null);
  const [playbookId, setPlaybookId] = useState(initialPlaybookId ? String(initialPlaybookId) : '');
  const [person, setPerson] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ticked, setTicked] = useState(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/tickets/${ticket.id}/playbooks/options`)
      .then(({ data }) => {
        setOptions(data);
        if (!initialPlaybookId && data.playbooks.length === 1) setPlaybookId(String(data.playbooks[0].id));
        if (data.guesses.length === 1) setPerson(data.guesses[0]);
      })
      .catch((err) => setError(errMessage(err)));
  }, [ticket.id, initialPlaybookId]);

  const playbook = options?.playbooks.find((p) => String(p.id) === playbookId) || null;

  useEffect(() => {
    if (!playbook) { setPreview(null); return; }
    const params = { playbookId: playbook.id, ...(person ? { contactId: person.id } : {}) };
    api.get(`/tickets/${ticket.id}/playbooks/options`, { params })
      .then(({ data }) => {
        setPreview(data);
        setTicked(new Set(data.personDevices.map((d) => d.asset.id)));
      })
      .catch((err) => setError(errMessage(err)));
  }, [ticket.id, playbook, person]);

  const apply = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/playbooks`, {
        playbookId: playbook.id,
        ...(person ? { contactId: person.id } : {}),
        ...(preview?.personDevices.length ? { assetIds: [...ticked] } : {}),
      });
      onApplied(data);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  const toggle = (id) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const needsPerson = playbook?.needsPerson;
  const formCount = (preview?.onceForms.length || 0)
    + (preview?.personDevices.filter((d) => d.form && ticked.has(d.asset.id)).length || 0);

  return (
    <Modal title="Apply a playbook" onClose={onClose} wide>
      <p className="-mt-2 mb-4 text-sm text-navy-500">Its forms are added to this ticket as tasks. Nothing changes in other systems.</p>
      {!options ? <p className="text-sm text-navy-400">Loading…</p> : (
        <div className="flex flex-col gap-4">
          {options.playbooks.length === 0 && <p className="text-sm text-navy-500">No playbooks are offered for this ticket&apos;s company. Playbook managers set them up in Settings › Playbooks.</p>}
          {options.playbooks.length > 0 && (
            <Field label="Playbook">
              <select className={inputClass} value={playbookId} onChange={(e) => setPlaybookId(e.target.value)} data-testid="playbook-select">
                <option value="">Choose…</option>
                {options.playbooks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          {playbook?.description && <p className="-mt-2 text-[12.5px] text-navy-400">{playbook.description}</p>}
          {needsPerson && (
            <Field label="Who is it for?" hint={options.guesses.length ? 'Guessed from the subject. Pick someone else if it\'s wrong.' : undefined}>
              <PersonPicker ticketCompanyId={ticket.companyId} value={person} guesses={options.guesses} onChange={setPerson} />
            </Field>
          )}
          {preview && preview.onceForms.length > 0 && (
            <div>
              <div className="mb-2 text-[13px] font-medium text-navy-500">Forms to add</div>
              {preview.onceForms.map((f) => (
                <div key={f.id} className="mb-2 flex items-center gap-3 rounded-lg border px-3.5 py-3" style={{ borderColor: 'var(--color-accent)', backgroundColor: 'var(--color-accent-soft)' }}>
                  <input type="checkbox" checked disabled aria-label={`${f.name}, once`} />
                  <div><b>{f.name}</b><div className="text-[12.5px] text-navy-500">Once for the ticket</div></div>
                </div>
              ))}
            </div>
          )}
          {preview && person && (
            <div>
              <div className="mb-2 text-[13px] font-medium text-navy-500">{person.displayName}&apos;s devices <span className="font-normal text-navy-400">· one form each</span></div>
              {preview.personDevices.length === 0 && <p className="text-sm text-navy-400">No devices are assigned to them.</p>}
              {preview.personDevices.map((d) => (
                <label key={d.asset.id} className="mb-2 flex items-start gap-3 rounded-lg border px-3.5 py-3" style={d.form ? undefined : { borderColor: 'var(--color-warning)', backgroundColor: 'var(--color-waiting-bg)' }}>
                  <input type="checkbox" checked={ticked.has(d.asset.id)} onChange={() => toggle(d.asset.id)} className="mt-1" />
                  <div className="min-w-0">
                    <b>{d.asset.name}</b> <span className="num text-navy-400">{d.asset.assetTag}</span>
                    <div className="text-[12.5px] text-navy-500">
                      {d.form ? <>{d.form.name}{d.asset.mdmName ? ` · ${d.asset.mdmName} steps` : (d.asset.isManaged ? '' : ' · not managed')}</>
                        : 'No form matches this device. It will be listed on the ticket as not covered.'}
                      {d.assignedByAgent && ' · assigned by the PRISM agent, no check-out'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          {error && <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-navy-100 pt-3">
            {preview && <span className="mr-auto text-[12.5px] text-navy-400">{formCount} form{formCount === 1 ? '' : 's'}</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={apply} disabled={!playbook || (needsPerson && !person) || saving} data-testid="apply-playbook">
              {saving ? 'Applying…' : 'Apply playbook'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
