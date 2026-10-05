// Watchers picker on the new-ticket form.
import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { initials } from '../../../utils/userDisplay';
import { Label } from './FormBits';
import { CARD_BG, BORDER, TEXT, MUTED, fieldStyle } from '../theme';

export function WatchersField({ directory, watchers, onChange }) {
  const [query, setQuery] = useState('');
  const results = query.trim()
    ? directory
        .filter(
          (u) =>
            u.displayName.toLowerCase().includes(query.trim().toLowerCase()) &&
            !watchers.some((w) => w.id === u.id)
        )
        .slice(0, 8)
    : [];

  const addWatcher = (u) => { onChange([...watchers, u]); setQuery(''); };
  const removeWatcher = (id) => onChange(watchers.filter((w) => w.id !== id));

  return (
    <div>
      <Label>Watchers</Label>
      <div className="relative flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any user by name…"
          className="input flex-1"
          style={fieldStyle}
        />
        <button
          type="button"
          onClick={() => results.length && addWatcher(results[0])}
          disabled={!results.length}
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          Add
        </button>
        {results.length > 0 && (
          <div
            className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => addWatcher(u)}
                className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5"
                style={{ color: TEXT }}
              >
                {u.displayName}
              </button>
            ))}
          </div>
        )}
      </div>
      {watchers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {watchers.map((w) => (
            <span
              key={w.id}
              className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-xs font-medium"
              style={{ backgroundColor: BORDER, color: TEXT }}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{ backgroundColor: CARD_BG, color: 'var(--color-accent)' }}
              >
                {initials(w.displayName)}
              </span>
              {w.displayName}
              <button type="button" onClick={() => removeWatcher(w.id)} style={{ color: MUTED }}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Watchers receive a notification when the ticket is updated or commented on.
      </p>
    </div>
  );
}
