// Checklists on the ticket's Tasks tab (PB, words from PB2): the suggested
// bundles, each bundle added with its checklists (one task each) and their
// progress, checklists added on their own, the ticket's devices, and the
// devices no checklist covers.
import { Link } from 'react-router-dom';
import {
  IconChecklist, IconAlertTriangle, IconDeviceLaptop, IconCheck, IconMinus, IconPlus, IconX,
} from '@tabler/icons-react';
import Button from '../../../components/ui/Button';
import Notice from '../../../components/ui/Notice';

export function FormProgress({ progress, state }) {
  if (state === 'skipped') return <span className="text-[12.5px] text-navy-500">Skipped</span>;
  const { required = 0, done = 0 } = progress || {};
  const pct = required ? Math.round((done / required) * 100) : 100;
  return (
    <div className="flex min-w-[110px] flex-col gap-1">
      <span className="num text-[12.5px] text-navy-500">{state === 'finished' ? 'Done' : `${done} of ${required}`}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-navy-100" aria-hidden="true">
        <i className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: state === 'finished' ? 'var(--color-success)' : 'var(--color-accent)' }} />
      </div>
    </div>
  );
}

function StateIcon({ state, progress }) {
  if (state === 'finished') {
    return <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--color-success)', color: '#fff' }} aria-label="Done"><IconCheck size={12} stroke={3} /></span>;
  }
  if (state === 'skipped') {
    return <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-navy-200 bg-navy-50 text-navy-400" aria-label="Skipped"><IconMinus size={12} stroke={3} /></span>;
  }
  const started = progress && progress.done > 0;
  return <span className="h-5 w-5 rounded-full border-2" style={{ borderColor: started ? 'var(--color-accent)' : 'var(--color-border-strong, #CBD2DA)' }} aria-label={started ? 'In progress' : 'Not started'} />;
}

function MdmChip({ asset }) {
  if (!asset) return null;
  if (!asset.isManaged) return <span className="rounded-md bg-navy-50 px-1.5 py-px text-[11.5px] font-semibold text-navy-500">Not managed</span>;
  return <span className="rounded-md px-1.5 py-px text-[11.5px] font-semibold" style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent-ink, var(--color-accent))' }}>{asset.mdmName || 'Managed'}</span>;
}

function FormRow({ ticketId, form }) {
  const title = form.asset ? `${form.formName}: ${form.asset.name}` : form.formName;
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b border-navy-100 px-4 py-3 last:border-b-0 sm:grid-cols-[20px_minmax(0,1fr)_140px]">
      <StateIcon state={form.state} progress={form.progress} />
      <div className="min-w-0">
        <Link to={`/tickets/${ticketId}/forms/${form.id}`} className="font-semibold text-navy-900 hover:underline" data-testid={`ticket-form-${form.id}`}>{title}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-navy-500">
          {form.asset && <span className="num">{form.asset.assetTag}</span>}
          {form.asset && <MdmChip asset={form.asset} />}
          {form.contact && <span>for {form.contact.displayName}</span>}
          {form.state === 'skipped' && form.skipReason && <span>· Skipped: <b className="font-medium">{form.skipReason}</b></span>}
        </div>
      </div>
      <FormProgress progress={form.progress} state={form.state} />
    </div>
  );
}

export function SuggestionBanner({ suggestions, canEdit, onApply, onDismiss }) {
  if (!suggestions?.length || !canEdit) return null;
  return suggestions.map((s) => (
    <Notice tone="info" key={s.id} className="mb-3">
      <IconChecklist size={18} aria-hidden="true" />
      <span className="min-w-0 flex-1">Suggested: <b>{s.playbook.name}</b></span>
      <Button size="sm" variant="primary" onClick={() => onApply(s.playbook.id)}>Add</Button>
      <Button size="sm" variant="quiet" onClick={() => onDismiss(s.id)}>Dismiss</Button>
    </Notice>
  ));
}

function Totals({ forms }) {
  const required = forms.reduce((n, f) => n + (f.state === 'skipped' ? 0 : f.progress.required), 0);
  const done = forms.reduce((n, f) => n + (f.state === 'skipped' ? 0 : f.progress.done), 0);
  return (
    <div className="w-48">
      <div className="flex justify-between text-[12.5px]"><span className="text-navy-500">Required steps</span><b className="num">{done} of {required}</b></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy-100"><i className="block h-full rounded-full" style={{ width: `${required ? Math.round((done / required) * 100) : 100}%`, backgroundColor: 'var(--color-accent)' }} /></div>
    </div>
  );
}

const untouchedForm = (f) => f.state === 'open' && f.progress.done === 0;

export default function PlaybookPanel({
  ticketId, view, canEdit, onApply, onAddDevice, onUnlinkDevice, onRemovePlaybook, onRemoveChecklist,
}) {
  if (!view) return null;
  const {
    applied = [], uncovered = [], devices = [], otherForms = [],
  } = view;
  return (
    <div className="mb-4 flex flex-col gap-3" data-testid="playbook-panel">
      {applied.map((tp) => {
        const untouched = tp.forms.every(untouchedForm);
        return (
          <section key={tp.id} className="rounded-xl border border-navy-100 bg-surface" aria-label={`Bundle ${tp.name}`}>
            <div className="flex flex-wrap items-center gap-3 border-b border-navy-100 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-navy-900">{tp.name}</h3>
                  {tp.contact && <span className="text-navy-500">for <Link to={`/contacts/${tp.contact.id}`} className="font-semibold" style={{ color: 'var(--color-accent)' }}>{tp.contact.displayName}</Link></span>}
                </div>
                <p className="mt-0.5 text-[12.5px] text-navy-400">
                  Added{tp.appliedBy ? ` by ${tp.appliedBy.displayName}` : ''} · {new Date(tp.appliedAt).toLocaleString()} · {tp.forms.length} checklist{tp.forms.length === 1 ? '' : 's'}
                </p>
              </div>
              <Totals forms={tp.forms} />
              {canEdit && untouched && (
                <Button size="sm" variant="quiet" onClick={() => onRemovePlaybook(tp)} aria-label={`Remove bundle ${tp.name}`}><IconX size={14} /></Button>
              )}
            </div>
            {tp.forms.map((f) => <FormRow key={f.id} ticketId={ticketId} form={f} />)}
          </section>
        );
      })}

      {otherForms.length > 0 && (
        <section className="rounded-xl border border-navy-100 bg-surface" aria-label="Checklists">
          <div className="flex flex-wrap items-center gap-3 border-b border-navy-100 px-4 py-3">
            <h3 className="min-w-0 flex-1 text-[15px] font-semibold text-navy-900">Checklists</h3>
            <Totals forms={otherForms} />
          </div>
          {otherForms.map((f) => (
            <div key={f.id} className="flex items-center">
              <div className="min-w-0 flex-1"><FormRow ticketId={ticketId} form={f} /></div>
              {canEdit && untouchedForm(f) && onRemoveChecklist && (
                <Button size="sm" variant="quiet" className="mr-2" onClick={() => onRemoveChecklist(f)} aria-label={`Remove checklist ${f.formName}${f.asset ? ` for ${f.asset.name}` : ''}`}><IconX size={14} /></Button>
              )}
            </div>
          ))}
        </section>
      )}

      {uncovered.length > 0 && (
        <Notice tone="warn">
          <IconAlertTriangle size={18} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <b>{uncovered.length === 1 ? '1 device isn\'t covered.' : `${uncovered.length} devices aren't covered.`}</b>{' '}
            {uncovered.map((d) => `${d.name} · ${d.assetTag}`).join(', ')}: no checklist fits {uncovered.length === 1 ? 'it' : 'them'}. This won&apos;t stop the ticket closing.
          </span>
          {uncovered.length === 1 && <Link to={`/assets/${uncovered[0].id}`} className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>Open device</Link>}
        </Notice>
      )}

      <section className="rounded-xl border border-navy-100 bg-surface" aria-label="Devices">
        <div className="flex items-center justify-between gap-2 border-b border-navy-100 px-4 py-3">
          <h3 className="text-[14px] font-semibold text-navy-900">Devices <span className="font-medium text-navy-400">{devices.length}</span></h3>
          <div className="flex gap-1">
            {canEdit && <Button size="sm" variant="quiet" onClick={onApply}><IconChecklist size={15} />Add checklist</Button>}
            {canEdit && <Button size="sm" variant="quiet" onClick={onAddDevice} data-testid="add-device"><IconPlus size={15} />Add device</Button>}
          </div>
        </div>
        <div className="px-4 py-1">
          {devices.length === 0 && <p className="py-3 text-sm text-navy-400">No devices on this ticket.</p>}
          {devices.map((d) => (
            <div key={d.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-navy-100 py-2.5 last:border-b-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-navy-500" aria-hidden="true"><IconDeviceLaptop size={17} /></span>
              <div className="min-w-0">
                <Link to={`/assets/${d.id}`} className="font-semibold text-navy-900 hover:underline">{d.name}</Link>
                <div className="text-[12.5px] text-navy-500"><span className="num">{d.assetTag}</span>{d.hasCellular ? ' · cellular' : ''}{d.hasAgent ? ' · PRISM agent' : ''}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <MdmChip asset={d} />
                {canEdit && <Button size="sm" variant="quiet" aria-label={`Remove ${d.name} from this ticket`} onClick={() => onUnlinkDevice(d)}><IconX size={14} /></Button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
