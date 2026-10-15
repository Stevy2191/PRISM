// Merge other tickets into this one (5b). Only tickets of this ticket's
// company are offered; the server re-checks access and company anyway.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import { formatTicketId } from '../../../utils/ticketId';
import { Modal } from './Modal';
import { BORDER, TEXT, MUTED, fieldStyle } from '../theme';

export function MergeDialog({ ticket, onClose, onMerged }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = { companyId: ticket.companyId, limit: 10 };
      if (search.trim()) params.search = search.trim();
      api.get('/tickets', { params })
        .then(({ data }) => setResults(data.tickets.filter((x) => x.id !== ticket.id && !x.mergedIntoId)))
        .catch(() => setResults([]));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, ticket.id, ticket.companyId]);

  const toggle = (t) => setChosen((c) => (c.some((x) => x.id === t.id) ? c.filter((x) => x.id !== t.id) : [...c, t]));

  const merge = async () => {
    setSaving(true);
    try {
      await api.post(`/tickets/${ticket.id}/merge`, { sourceIds: chosen.map((t) => t.id) });
      onMerged();
      onClose();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Merge tickets into ${formatTicketId(ticket)}`} onClose={onClose}>
      <div className="space-y-3" data-testid="merge-dialog">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search this company's tickets by number or title…"
          aria-label="Search tickets to merge"
          className="input h-9 text-sm"
          style={fieldStyle}
        />
        <ul className="max-h-56 overflow-y-auto rounded-md border" style={{ borderColor: BORDER }}>
          {results.map((t) => (
            <li key={t.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm" style={{ color: TEXT }}>
                <input type="checkbox" checked={chosen.some((x) => x.id === t.id)} onChange={() => toggle(t)} />
                <span className="font-mono text-xs" style={{ color: MUTED }}>{formatTicketId(t)}</span>
                <span className="truncate">{t.title}</span>
              </label>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-xs" style={{ color: MUTED }}>No tickets found.</li>}
        </ul>
        {chosen.length > 0 && (
          <div className="rounded-md border p-3 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
            <p className="font-medium" style={{ color: TEXT }}>
              {chosen.map(formatTicketId).join(', ')} will move into {formatTicketId(ticket)}:
            </p>
            <p className="mt-1">
              comments, attachments, time, tasks, watchers, CCs, linked assets and links. Each one is then closed and
              points here; replies to it by email land here too. This can't be undone.
            </p>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
          Cancel
        </button>
        <button type="button" onClick={merge} disabled={!chosen.length || saving} className="btn-primary">
          {saving ? 'Merging…' : `Merge ${chosen.length || ''} into this ticket`}
        </button>
      </div>
    </Modal>
  );
}
