// Closing a ticket that still has unfinished forms, or devices no form
// covers (PB). Unfinished forms block, unless someone with "Close tickets
// with unfinished forms" closes anyway with a reason; uncovered devices are
// only a warning.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconAlertTriangle } from '@tabler/icons-react';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import Notice from '../../../components/ui/Notice';
import { usePermission } from '../../../context/AuthContext';

export default function CloseBlockedDialog({ ticketId, check, onClose, onCloseAnyway }) {
  const canOverride = usePermission('tickets.override_checklist');
  const [reason, setReason] = useState('');
  const blocking = check.blocking || [];
  const warnings = check.warnings || [];
  const blocked = blocking.length > 0;
  return (
    <Modal title={blocked ? "This ticket can't be closed yet" : 'Before you close this ticket'} onClose={onClose} wide>
      {blocked && (
        <>
          <p className="-mt-2 mb-3 text-sm text-navy-500">{blocking.length} form{blocking.length === 1 ? ' still has' : 's still have'} required steps. Finish {blocking.length === 1 ? 'it' : 'them'}, skip with a reason, or close anyway.</p>
          <div className="mb-3 rounded-xl border border-navy-100">
            {blocking.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 border-b border-navy-100 px-3.5 py-3 last:border-b-0">
                <div className="min-w-0">
                  <div className="font-semibold text-navy-900">{f.asset ? `${f.formName}: ${f.asset.name}` : f.formName}</div>
                  {f.asset && <div className="num text-[12.5px] text-navy-500">{f.asset.assetTag}</div>}
                </div>
                <Link to={`/tickets/${ticketId}/forms/${f.id}`} className="inline-flex h-8 items-center rounded-md border border-navy-100 px-3 text-[13px] font-semibold" onClick={onClose}>Open</Link>
              </div>
            ))}
          </div>
        </>
      )}
      {warnings.length > 0 && (
        <Notice tone="warn" className="mb-3">
          <IconAlertTriangle size={18} aria-hidden="true" />
          <span className="min-w-0 flex-1"><b>Warning, won&apos;t stop closing:</b> {warnings.map((d) => `${d.name} · ${d.assetTag}`).join(', ')} {warnings.length === 1 ? "isn't" : "aren't"} covered by any form.</span>
        </Notice>
      )}
      {blocked && canOverride && (
        <div className="flex flex-col gap-2 border-t border-navy-100 pt-3">
          <div><b>Close anyway</b> <span className="text-navy-400">· you can override this</span></div>
          <label htmlFor="close-reason" className="text-[13px] font-medium text-navy-500">Reason</label>
          <textarea id="close-reason" rows={3} className="rounded-md border border-navy-200 bg-surface px-3 py-2 text-sm" placeholder="Why is it OK to close with these steps unfinished?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-[12.5px] text-navy-400">The override and your reason are recorded on the ticket.</p>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-navy-100 pt-3">
        <Button onClick={onClose}>Keep it open</Button>
        {blocked && canOverride && (
          <Button onClick={() => onCloseAnyway({ reason: reason.trim() })} disabled={!reason.trim()} style={{ color: 'var(--color-danger)' }} data-testid="close-anyway">Close anyway</Button>
        )}
        {!blocked && <Button variant="primary" onClick={() => onCloseAnyway(null)} data-testid="close-confirm">Close ticket</Button>}
      </div>
    </Modal>
  );
}
