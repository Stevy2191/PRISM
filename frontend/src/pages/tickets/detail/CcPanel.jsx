// The ticket's CC list (spec 5a): these addresses get every public reply.
// Anyone who can see the ticket sees it; editors add and remove.
import { useEffect, useState } from 'react';
import { IconX, IconMail } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { BORDER, TEXT, MUTED, fieldStyle } from '../theme';

export default function CcPanel({ ticketId, canEdit, collapsed }) {
  const [ccs, setCcs] = useState([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/tickets/${ticketId}/ccs`).then(({ data }) => setCcs(data.ccs)).catch(() => setCcs([]));
  }, [ticketId]);

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/tickets/${ticketId}/ccs`, { email: email.trim() });
      setCcs((prev) => [...prev, data.cc]);
      setEmail('');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (cc) => {
    setError('');
    try {
      await api.delete(`/tickets/${ticketId}/ccs/${cc.id}`);
      setCcs((prev) => prev.filter((c) => c.id !== cc.id));
    } catch (err) {
      setError(errMessage(err));
    }
  };

  if (collapsed) return <span title={ccs.map((c) => c.email).join(', ') || 'No CCs'}><IconMail size={14} /></span>;

  return (
    <div data-testid="cc-panel">
      <div className="space-y-1.5">
        {ccs.map((cc) => (
          <span key={cc.id} className="flex min-w-0 items-center gap-1.5 rounded-full py-1 pl-2 pr-2 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
            <span className="min-w-0 flex-1 truncate" title={cc.email}>{cc.contact ? `${cc.contact.name} · ${cc.email}` : cc.email}</span>
            {canEdit && (
              <button type="button" aria-label={`Remove ${cc.email}`} onClick={() => remove(cc)} style={{ color: MUTED }}><IconX size={11} /></button>
            )}
          </span>
        ))}
        {ccs.length === 0 && <p className="text-xs" style={{ color: MUTED }}>No one is CC'd.</p>}
      </div>
      {canEdit && (
        <form onSubmit={add} className="mt-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="+ Add CC email…"
            aria-label="Add CC email"
            className="input h-8 text-xs"
            style={fieldStyle}
            disabled={busy}
          />
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
