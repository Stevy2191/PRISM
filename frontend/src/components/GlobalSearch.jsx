import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconSearch, IconTicket, IconFolder, IconUser } from '@tabler/icons-react';
import api from '../api/api';
import { formatTicketId } from '../utils/ticketId';

const GROUPS = [
  { key: 'tickets', label: 'Tickets', icon: IconTicket },
  { key: 'projects', label: 'Projects', icon: IconFolder },
  { key: 'contacts', label: 'Contacts', icon: IconUser },
];

export default function GlobalSearch({ onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ tickets: [], projects: [], contacts: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults({ tickets: [], projects: [], contacts: [] });
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/search', { params: { q: query.trim() } })
        .then(({ data }) => setResults(data))
        .catch(() => setResults({ tickets: [], projects: [], contacts: [] }))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const go = (path) => {
    onClose();
    navigate(path);
  };

  const hasAny = results.tickets.length || results.projects.length || results.contacts.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 sm:p-4 sm:pt-24" onClick={onClose}>
      <div
        className="flex max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-none border shadow-2xl sm:max-h-[80vh] sm:rounded-lg"
        style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <IconSearch size={18} stroke={2} style={{ color: 'var(--color-text-muted)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets, projects, contacts…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--color-text-primary)' }}
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>Esc</kbd>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {!query.trim() ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Search across tickets, projects, and contacts.
            </p>
          ) : loading ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Searching…</p>
          ) : !hasAny ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No results for &quot;{query}&quot;.</p>
          ) : (
            GROUPS.map((g) => {
              const rows = results[g.key];
              if (!rows.length) return null;
              const Icon = g.icon;
              return (
                <div key={g.key} className="py-2">
                  <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{g.label}</p>
                  {rows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => go(
                        g.key === 'tickets' ? `/tickets/${r.id}`
                          : g.key === 'projects' ? `/projects/${r.id}`
                          : `/contacts/${r.id}`
                      )}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      <Icon size={16} stroke={1.8} style={{ color: 'var(--color-text-muted)' }} />
                      {g.key === 'tickets' && <span>{formatTicketId(r)} {r.title}</span>}
                      {g.key === 'projects' && <span>{r.projectCode} — {r.name}</span>}
                      {g.key === 'contacts' && <span>{r.displayName} <span style={{ color: 'var(--color-text-muted)' }}>· {r.email}</span></span>}
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
