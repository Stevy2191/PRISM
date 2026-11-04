import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import StatusChip from '../ui/StatusChip';
import { ago } from './agentFormat';
import { scanState } from './scanState';

// Scan now: asks the computer for a fresh inventory. It answers at its next
// check-in (every 5 minutes), so a request shows as pending until then; a
// long wait means it's off, or its agent is too old to scan on request.
export default function ScanNow({ device, onRequested, size = 'sm' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!device || device.status === 'revoked') return null;
  const state = scanState(device);
  if (state === 'waiting') {
    return (
      <StatusChip tone="info">
        <span title="The computer sends a fresh inventory at its next check-in, within 5 minutes.">Scan requested {ago(device.scanRequestedAt)}</span>
      </StatusChip>
    );
  }
  if (state === 'late') {
    return (
      <StatusChip tone="waiting">
        <span title="Asked more than 15 minutes ago. The computer may be off or offline, or its agent too old to scan on request; it will scan when it next checks in.">
          Scan requested {ago(device.scanRequestedAt)} · no answer yet
        </span>
      </StatusChip>
    );
  }
  const ask = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/devices/${device.id}/scan`);
      onRequested?.(data.device);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={`btn-secondary ${size === 'sm' ? 'h-8 px-3 text-sm' : ''}`} onClick={ask} disabled={busy}>
        {busy ? 'Asking…' : 'Scan now'}
      </button>
      {error && <span role="alert" className="text-[12.5px]" style={{ color: 'var(--color-danger)' }}>{error}</span>}
    </span>
  );
}
