import { useEffect, useState } from 'react';
import api from '../../api/api';

// Type to find an active contact of one company (and, optionally, one
// department); picking one calls onPick(contact) and clears the box.
export default function ContactPicker({
  companyId, departmentId, exclude = [], onPick, label, placeholder = 'Add a contact…', autoFocus = false,
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/contacts', {
        params: {
          companyId, search: q.trim(), status: 'active', limit: 8, ...(departmentId ? { departmentId } : {}),
        },
      })
        .then(({ data }) => setResults((data.contacts || []).filter((c) => !exclude.includes(c.id))))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, companyId, departmentId, exclude.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative min-w-0">
      <input aria-label={label} autoFocus={autoFocus} className="input h-9 text-sm" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <div role="listbox" aria-label="Matches" className="absolute left-0 top-full z-20 mt-1 w-full min-w-[220px] rounded-md border p-1 shadow-lg" style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => { onPick(c); setQ(''); setResults([]); }}
              className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
            >
              <span className="min-w-0 truncate">{c.displayName}</span>
              <span className="flex-shrink-0 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
