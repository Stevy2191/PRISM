// "Insert" picker for the reply box (5b): search my canned responses, pick
// one, and the server fills its placeholders from this ticket. Also saves the
// reply box's current text as a new personal response.
import { useEffect, useRef, useState } from 'react';
import { IconMessageDots } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';

export default function CannedPicker({ ticketId, onInsert, currentText }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [responses, setResponses] = useState([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      api.get('/canned-responses', { params: search.trim() ? { search: search.trim() } : {} })
        .then(({ data }) => setResponses(data.responses))
        .catch(() => setResponses([]));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, search]);

  const pick = async (r) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tickets/${ticketId}/canned/${r.id}/render`);
      onInsert(data.text);
      setOpen(false);
      setSearch('');
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveCurrent = async () => {
    const title = prompt('Name this canned response');
    if (!title || !title.trim()) return;
    try {
      await api.post('/canned-responses', { title: title.trim(), body: currentText, visibility: 'personal' });
      setSearch('');
      const { data } = await api.get('/canned-responses');
      setResponses(data.responses);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Insert a canned response"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-navy-500 hover:bg-[var(--color-hover)] hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:h-11"
      >
        <IconMessageDots size={15} aria-hidden="true" /> Insert
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-30 mb-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border shadow-lg"
          style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
          data-testid="canned-picker"
        >
          <div className="p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search canned responses…"
              aria-label="Search canned responses"
              className="input h-8 text-sm"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {responses.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pick(r)}
                  className="block w-full px-3 py-2 text-left hover:bg-[var(--color-hover)]"
                >
                  <span className="block truncate text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{r.title}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.body}</span>
                </button>
              </li>
            ))}
            {responses.length === 0 && <li className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>No canned responses found.</li>}
          </ul>
          <div className="border-t p-2" style={{ borderColor: 'var(--color-border)' }}>
            <button
              type="button"
              disabled={!currentText || !currentText.trim()}
              onClick={saveCurrent}
              className="text-xs font-medium hover:underline disabled:opacity-50"
              style={{ color: 'var(--color-accent)' }}
            >
              Save current text as a personal response
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
