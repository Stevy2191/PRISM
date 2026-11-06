// A ticket form (PB): the steps, fields and secure values of one form on a
// ticket, for one device or for the ticket. The server works out what shows;
// every change is saved as it's made and the page redraws from the answer.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconLock, IconArrowBarToRight, IconExternalLink } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { usePermission } from '../../../context/AuthContext';
import Breadcrumbs from '../../../components/ui/Breadcrumbs';
import Button from '../../../components/ui/Button';
import Notice from '../../../components/ui/Notice';
import Modal from '../../../components/Modal';
import Spinner from '../../../components/Spinner';
import { formatTicketId } from '../../../utils/ticketId';

const inputClass = 'h-10 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm text-navy-900 disabled:bg-navy-50';
const STATUS_LABELS = {
  ready_to_issue: 'Ready to issue', in_repair: 'In repair', on_hold: 'On hold', retired: 'Retired',
};
const REVEAL_MS = 30000;

function Rich({ html, className = '' }) {
  // Form text is sanitized on the server when the form is saved.
  return <div className={`form-rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />; // eslint-disable-line react/no-danger
}

function ByLine({ answer }) {
  if (!answer?.done) return null;
  return <div className="mt-0.5 text-xs text-navy-400">{answer.byAgent ? 'Confirmed by the PRISM agent' : 'Done'} · {new Date(answer.at).toLocaleString()}</div>;
}

function FieldInput({ item, value, disabled, onSave, ticket }) {
  const [draft, setDraft] = useState(value ?? '');
  const [staff, setStaff] = useState([]);
  const [contacts, setContacts] = useState([]);
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => {
    if (item.fieldType === 'staff') api.get('/users/directory').then(({ data }) => setStaff(data.users)).catch(() => {});
    if (item.fieldType === 'contact') api.get('/contacts', { params: { companyId: ticket.companyId, limit: 100 } }).then(({ data }) => setContacts(data.contacts || [])).catch(() => {});
  }, [item.fieldType, ticket.companyId]);
  const id = `f-${item.key}`;
  switch (item.fieldType) {
    case 'yesno':
      return (
        <div role="group" aria-labelledby={`${id}-l`} className="inline-flex overflow-hidden rounded-md border border-navy-100">
          {[['Yes', true], ['No', false]].map(([t, v]) => (
            <button key={t} type="button" disabled={disabled} aria-pressed={value === v} onClick={() => onSave(v)} className={`h-9 px-4 text-sm ${value === v ? 'font-semibold' : 'text-navy-500'}`} style={value === v ? { backgroundColor: 'var(--color-accent-soft)' } : undefined}>{t}</button>
          ))}
        </div>
      );
    case 'choice':
      return (
        <select id={id} className={inputClass} disabled={disabled} value={value ?? ''} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">Choose…</option>
          {item.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'choices':
      return (
        <div className="flex flex-col gap-1.5">
          {item.options.map((o) => {
            const on = Array.isArray(value) && value.includes(o);
            return (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={disabled} checked={on} onChange={() => onSave(on ? value.filter((x) => x !== o) : [...(value || []), o])} />{o}
              </label>
            );
          })}
        </div>
      );
    case 'staff':
      return (
        <select id={id} className={inputClass} disabled={disabled} value={value ?? ''} onChange={(e) => onSave(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Choose a staff member…</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      );
    case 'contact':
      return (
        <select id={id} className={inputClass} disabled={disabled} value={value ?? ''} onChange={(e) => onSave(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Choose a contact…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
        </select>
      );
    case 'longtext':
      return <textarea id={id} rows={3} className={`${inputClass} h-auto py-2`} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (value ?? '') && onSave(draft)} />;
    default: {
      const type = item.fieldType === 'number' ? 'number' : item.fieldType === 'date' ? 'date' : 'text';
      return <input id={id} type={type} className={inputClass} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => String(draft) !== String(value ?? '') && onSave(draft === '' ? null : draft)} />;
    }
  }
}

function SecureItem({ item, secret, disabled, onSet, onReveal }) {
  const canReveal = usePermission('tickets.view_secure_fields');
  const [shown, setShown] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (shown === null) return undefined;
    const t = setTimeout(() => setShown(null), REVEAL_MS);
    return () => clearTimeout(t);
  }, [shown]);
  const reveal = async () => { try { setShown(await onReveal(item.key)); } catch (err) { alert(errMessage(err)); } };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-navy-500">{item.label} <span className="font-normal text-navy-400">· secure</span></span>
      {editing ? (
        <div className="flex gap-2">
          <input type="password" autoComplete="off" className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={item.label} />
          <Button size="sm" variant="primary" disabled={!draft} onClick={async () => { await onSet(item.key, draft); setDraft(''); setEditing(false); }}>Save</Button>
          <Button size="sm" onClick={() => { setDraft(''); setEditing(false); }}>Cancel</Button>
        </div>
      ) : (
        <div className="flex h-10 items-center gap-2 rounded-md border border-navy-200 bg-navy-50 pl-3 pr-1.5">
          <IconLock size={15} className="text-navy-400" aria-hidden="true" />
          <span className={`flex-1 ${shown === null ? 'tracking-[3px] text-navy-500' : 'font-mono text-navy-900'}`} data-testid={`secure-${item.key}`}>
            {shown !== null ? shown : secret ? '••••••••••' : <span className="tracking-normal text-navy-400">Not recorded</span>}
          </span>
          {secret && canReveal && shown === null && <Button size="sm" onClick={reveal}>Reveal</Button>}
          {!disabled && <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>{secret ? 'Replace' : 'Record'}</Button>}
        </div>
      )}
      {secret && <span className="text-xs text-navy-400">Recorded{secret.setBy ? ` by ${secret.setBy}` : ''}, {new Date(secret.setAt).toLocaleDateString()}. Each reveal is logged on the ticket.</span>}
    </div>
  );
}

function ActionItem({ item, form, disabled, onRun }) {
  const canRevoke = usePermission('devices.manage');
  const [status, setStatus] = useState(item.statuses?.[0] || 'ready_to_issue');
  const [holdReason, setHoldReason] = useState('');
  const hasAgent = form.device?.agent && !form.device.agent.revoked;
  const [revoke, setRevoke] = useState(!!hasAgent);
  const done = !!form.actionDoneAt;
  const ready = form.evaluation.actionReady;
  const checkIn = item.action === 'check_in';
  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-dashed px-4 py-3.5" style={{ borderColor: 'var(--color-accent)', backgroundColor: 'var(--color-accent-soft)' }}>
      <IconArrowBarToRight size={20} aria-hidden="true" />
      <div className="min-w-[240px] flex-1">
        <b>{checkIn ? 'Check in this device' : 'Check out this device'}</b>
        <div className="text-[12.5px] text-navy-500">
          {done ? `Done ${new Date(form.actionDoneAt).toLocaleString()}.`
            : checkIn ? `Checks ${form.device?.assetTag} in and sets its status. Available once the required steps above are done.`
              : `Checks ${form.device?.assetTag} out to ${form.person?.displayName || 'the person'}. Available once the required steps above are done.`}
        </div>
        {checkIn && hasAgent && !done && (
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={revoke} disabled={!canRevoke} onChange={(e) => setRevoke(e.target.checked)} />
            Revoke its PRISM agent, so the next install claims this asset instead of making a new one
            {!canRevoke && <span className="text-navy-400">(needs Manage devices)</span>}
          </label>
        )}
      </div>
      {checkIn && !done && (
        <div className="flex min-w-[200px] flex-col gap-1">
          <label htmlFor="action-status" className="text-xs text-navy-500">Status after check-in</label>
          <select id="action-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {item.statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
          </select>
          {status === 'on_hold' && <input className={inputClass} placeholder="Why it's on hold" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} aria-label="Hold reason" />}
        </div>
      )}
      {!done && (
        <Button
          variant="primary"
          disabled={disabled || !ready || (status === 'on_hold' && checkIn && !holdReason.trim())}
          onClick={() => onRun(checkIn ? { status, holdReason, revokeAgent: revoke && hasAgent } : {})}
          data-testid="form-action"
        >
          {checkIn ? 'Check in' : 'Check out'}
        </Button>
      )}
    </div>
  );
}

function SkipDialog({ notReturned, onClose, onSkip }) {
  const [reason, setReason] = useState('');
  const [markLost, setMarkLost] = useState(true);
  return (
    <Modal title={notReturned ? 'Device not returned' : 'Skip this form'} onClose={onClose}>
      <label htmlFor="skip-reason" className="text-[13px] font-medium text-navy-500">{notReturned ? 'Anything to add' : 'Reason'}</label>
      <textarea id="skip-reason" rows={3} className="mt-1 w-full rounded-md border border-navy-200 bg-surface px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
      {notReturned && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={markLost} onChange={(e) => setMarkLost(e.target.checked)} /> Set the device to Lost</label>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!notReturned && !reason.trim()} onClick={() => onSkip({ reason, notReturned, markLost: notReturned && markLost })}>{notReturned ? 'Mark not returned' : 'Skip form'}</Button>
      </div>
    </Modal>
  );
}

export default function TicketFormPage() {
  const { id, formId } = useParams();
  const [ticket, setTicket] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHidden, setShowHidden] = useState({});
  const [skipping, setSkipping] = useState(null);

  const load = useCallback(async () => {
    try {
      const [t, f] = await Promise.all([api.get(`/tickets/${id}`), api.get(`/tickets/${id}/forms/${formId}`)]);
      setTicket(t.data.ticket);
      setForm(f.data.form);
    } catch (err) { setError(errMessage(err)); }
  }, [id, formId]);
  useEffect(() => { load(); }, [load]);

  const call = async (fn) => {
    setSaving(true);
    try { const { data } = await fn(); if (data.form) setForm(data.form); return data; } catch (err) { alert(errMessage(err)); return null; } finally { setSaving(false); }
  };
  const save = (key, value) => call(() => api.patch(`/tickets/${id}/forms/${formId}`, { answers: { [key]: value } }));
  const setSecret = (key, value) => call(() => api.put(`/tickets/${id}/forms/${formId}/secrets/${key}`, { value }));
  const reveal = async (key) => (await api.post(`/tickets/${id}/forms/${formId}/secrets/${key}/reveal`)).data.value;
  const runAction = (body) => call(() => api.post(`/tickets/${id}/forms/${formId}/action`, body));
  const skip = async (body) => { setSkipping(null); await call(() => api.post(`/tickets/${id}/forms/${formId}/skip`, body)); };
  const scan = async () => { try { await api.post(`/devices/${form.device.agent.id}/scan`); load(); } catch (err) { alert(errMessage(err)); } };

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!form || !ticket) return <Spinner />;

  const canEdit = !!ticket.access?.edit && form.state === 'open';
  const ev = form.evaluation;
  const evalItems = new Map(ev.sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  const evalSections = new Map(ev.sections.map((s) => [s.key, s]));
  const title = form.device ? `${form.form?.name}: ${form.device.name}` : form.form?.name;

  return (
    <div className="mx-auto max-w-[1400px]">
      <Breadcrumbs items={[{ label: 'Tickets', to: '/tickets' }, { label: formatTicketId(ticket), to: `/tickets/${ticket.id}`, id: true }, { label: 'Tasks' }]} />
      <div className="mt-2.5 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: form.state === 'open' ? 'var(--color-accent-soft)' : 'var(--color-success-bg, #E5F5EC)' }}>
              {form.state === 'open' ? 'In progress' : form.state === 'finished' ? 'Finished' : 'Skipped'}
            </span>
            {form.playbook && <span className="rounded-full border border-navy-100 px-2 text-xs text-navy-500">{form.playbook.name}{form.person ? ` · for ${form.person.displayName}` : ''}</span>}
          </div>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-navy-900">{title}</h1>
        </div>
        <div className="w-64">
          <div className="flex justify-between text-[13px]"><span className="text-navy-500">Required steps</span><b className="num">{ev.done} of {ev.required}</b></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-navy-100"><i className="block h-full rounded-full" style={{ width: `${ev.required ? Math.round((ev.done / ev.required) * 100) : 100}%`, backgroundColor: 'var(--color-accent)' }} /></div>
        </div>
      </div>
      {form.state === 'skipped' && <Notice tone="warn" className="mt-4">Skipped: {form.skipReason}</Notice>}
      {ev.ignored?.length > 0 && <Notice tone="info" className="mt-4">Some answers belong to steps that no longer apply. They are kept but don&apos;t count.</Notice>}

      <div className="mt-5 flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3">
          {form.definition.sections.map((section) => {
            const es = evalSections.get(section.key);
            if (!es?.shown) return null;
            const required = section.items.filter((i) => evalItems.get(i.key)?.required);
            const doneCount = required.filter((i) => evalItems.get(i.key)?.done).length;
            const hidden = section.items.filter((i) => !evalItems.get(i.key)?.shown && i.kind !== 'text');
            return (
              <section key={section.key} className="rounded-xl border border-navy-100 bg-surface" aria-labelledby={`sec-${section.key}`}>
                <div className="flex items-center gap-2.5 border-b border-navy-100 px-4 py-3.5">
                  <h2 id={`sec-${section.key}`} className="flex-1 text-[15px] font-semibold text-navy-900">{section.title}</h2>
                  {required.length > 0 && <span className={`text-[13px] ${doneCount === required.length ? 'font-semibold' : 'text-navy-500'}`} style={doneCount === required.length ? { color: 'var(--color-success)' } : undefined}>{doneCount} of {required.length}</span>}
                </div>
                <div className="flex flex-col px-4 pb-3 pt-1">
                  {section.items.map((item) => {
                    const ei = evalItems.get(item.key);
                    if (!ei?.shown && !showHidden[section.key]) return null;
                    const muted = !ei?.shown;
                    const answer = form.answers[item.key];
                    const req = ei?.required ? <span className="ml-0.5 font-bold" style={{ color: 'var(--color-danger)' }}>*</span> : null;
                    const wrap = (children) => <div key={item.key} className={`border-b border-navy-50 py-2.5 last:border-b-0 ${muted ? 'opacity-50' : ''}`}>{children}</div>;
                    if (item.kind === 'text') return wrap(<Rich html={item.body} className="rounded-md border border-navy-100 bg-navy-50 px-3 py-2 text-[13.5px] text-navy-600" />);
                    if (item.kind === 'step' || item.kind === 'agent') {
                      return wrap(
                        <label className="flex items-start gap-3">
                          <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] max-sm:h-[22px] max-sm:w-[22px]" disabled={!canEdit || muted || saving} checked={!!answer?.done} onChange={(e) => save(item.key, e.target.checked)} />
                          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-1"><Rich html={item.body} />{req}</div>{item.kind === 'agent' && !answer?.done && <div className="text-xs text-navy-400">Ticks itself when the PRISM agent reports in.</div>}<ByLine answer={answer} /></div>
                        </label>,
                      );
                    }
                    if (item.kind === 'field') {
                      return wrap(
                        <div className="flex max-w-[480px] flex-col gap-1.5">
                          <label id={`f-${item.key}-l`} htmlFor={`f-${item.key}`} className="text-[13px] font-medium text-navy-500">{item.label}{req}</label>
                          <FieldInput item={item} value={answer} ticket={ticket} disabled={!canEdit || muted || saving} onSave={(v) => save(item.key, v)} />
                        </div>,
                      );
                    }
                    if (item.kind === 'secure') return wrap(<SecureItem item={item} secret={form.secrets[item.key]} disabled={!canEdit || muted} onSet={setSecret} onReveal={reveal} />);
                    if (item.kind === 'action') return wrap(<ActionItem item={item} form={form} disabled={!canEdit || saving || muted} onRun={runAction} />);
                    return null;
                  })}
                  {hidden.length > 0 && (
                    <p className="pt-2 text-xs text-navy-400">
                      {hidden.length} step{hidden.length === 1 ? '' : 's'} hidden: {hidden.length === 1 ? "it doesn't" : "they don't"} apply to this device or answer.{' '}
                      <button type="button" className="font-medium" style={{ color: 'var(--color-accent)' }} onClick={() => setShowHidden((s) => ({ ...s, [section.key]: !s[section.key] }))}>
                        {showHidden[section.key] ? 'Hide' : 'Show anyway'}
                      </button>
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="flex flex-[1_1_320px] flex-col gap-3 md:max-w-[380px]" aria-label="Form details">
          {form.device && (
            <div className="rounded-xl border border-navy-100 bg-surface">
              <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3"><h3 className="text-sm font-semibold">Device</h3><Link to={`/assets/${form.device.id}`} className="text-[13px]" style={{ color: 'var(--color-accent)' }}>Open asset</Link></div>
              <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 py-3 text-[13.5px]">
                <dt className="text-navy-400">Device</dt><dd>{form.device.name}</dd>
                <dt className="text-navy-400">Asset tag</dt><dd className="num">{form.device.assetTag}</dd>
                {form.device.serialNumber && <><dt className="text-navy-400">Serial</dt><dd className="num">{form.device.serialNumber}</dd></>}
                <dt className="text-navy-400">Managed</dt><dd>{form.device.isManaged ? `Yes · ${form.device.mdm?.name || ''}` : 'No'}</dd>
                {form.device.mdmLink && <><dt className="text-navy-400">MDM</dt><dd><a href={form.device.mdmLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>Open in {form.device.mdm?.name} <IconExternalLink size={12} className="inline" /></a></dd></>}
                {form.device.agent && <><dt className="text-navy-400">PRISM agent</dt><dd>{form.device.agent.revoked ? 'Revoked' : form.device.agent.online ? <span style={{ color: 'var(--color-success)' }}>Online</span> : 'Offline'}{form.device.agent.lastSeenAt && !form.device.agent.revoked ? ` · seen ${new Date(form.device.agent.lastSeenAt).toLocaleString()}` : ''}</dd></>}
              </dl>
              {form.device.agent && !form.device.agent.revoked && form.state === 'open' && (
                <div className="px-4 pb-3"><Button size="sm" onClick={scan} disabled={form.device.agent.scanRequested}>{form.device.agent.scanRequested ? 'Scan requested' : 'Scan now'}</Button></div>
              )}
            </div>
          )}
          <div className="rounded-xl border border-navy-100 bg-surface">
            <div className="border-b border-navy-100 px-4 py-3"><h3 className="text-sm font-semibold">This form</h3></div>
            <div className="flex flex-col gap-2.5 px-4 py-3 text-[13.5px]">
              {form.playbook && <div><span className="text-navy-400">Playbook</span> · {form.playbook.name}</div>}
              <div><span className="text-navy-400">Form</span> · {form.form?.name} · version {form.version}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {canEdit && form.device && <Button size="sm" onClick={() => setSkipping('notReturned')}>Not returned…</Button>}
                {canEdit && <Button size="sm" onClick={() => setSkipping('skip')}>Skip with reason…</Button>}
                <Button size="sm" disabled={form.state === 'open'} onClick={() => window.open(`/api/v1/tickets/${id}/forms/${formId}/pdf`, '_blank', 'noopener')}>Download PDF</Button>
              </div>
              <p className="text-xs text-navy-400">The PDF is ready once the form is finished or skipped. Secure values are never in it.</p>
            </div>
          </div>
          <Link to={`/tickets/${id}`} className="text-sm" style={{ color: 'var(--color-accent)' }}>← Back to {formatTicketId(ticket)}</Link>
        </aside>
      </div>
      {skipping && <SkipDialog notReturned={skipping === 'notReturned'} onClose={() => setSkipping(null)} onSkip={skip} />}
    </div>
  );
}
