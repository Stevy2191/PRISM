// The owner's controls on another administrator's page: mark or unmark them
// as a secondary owner, or hand ownership to them (confirmed with the owner's
// password). The server enforces every rule; this only offers what applies.
import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';

export default function OwnershipPanel({ user, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [handingOver, setHandingOver] = useState(false);
  const [password, setPassword] = useState('');
  const secondary = user.ownerLevel === 'secondary';
  const canHandOver = user.isLocalAccount && user.isActive;

  const mark = async () => {
    setBusy(true);
    setError('');
    try {
      await api.put(`/users/${user.id}/owner`, { secondary: !secondary });
      await onChanged();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handOver = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/users/${user.id}/owner/transfer`, { password });
      // No longer the owner: reload so every screen reflects it.
      window.location.reload();
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3 p-5" aria-label="Ownership">
      <div>
        <h2 className="font-semibold text-navy-900">Ownership</h2>
        <p className="text-sm text-navy-500">
          A secondary owner can do everything you can, except mark owners and hand ownership on.
        </p>
      </div>
      {error && !handingOver && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={busy} onClick={mark}>
          {secondary ? 'Remove secondary owner' : 'Make secondary owner'}
        </button>
        {canHandOver ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setError(''); setPassword(''); setHandingOver(true); }}>
            Hand ownership to {user.displayName}
          </button>
        ) : (
          <p className="text-xs text-navy-400">Ownership can only go to an active local account.</p>
        )}
      </div>

      {handingOver && (
        <Modal title="Hand over ownership" onClose={() => setHandingOver(false)}>
          <form onSubmit={handOver} className="space-y-4">
            <p className="text-sm text-navy-600">
              {user.displayName} becomes the owner. You stay a System Administrator, without the owner powers.
            </p>
            {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div>
              <label className="label" htmlFor="handover-password">Your password</label>
              <input id="handover-password" type="password" className="input" value={password}
                onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setHandingOver(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Handing over…' : 'Hand over ownership'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
