// Assets picker on the new-ticket form.
import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api from '../../../api/api';
import { Label } from './FormBits';
import { CARD_BG, BORDER, TEXT, MUTED, fieldStyle } from '../theme';

// Live search against /assets (asset tag or name), chip-based multi-select
// — modeled on WatchersField's add/remove-chip UI, but with a real per-
// keystroke API search (like ContactPicker) since assets aren't pre-fetched
// into a local directory anywhere in this app.
export function AssetsField({ assets, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/assets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.assets.filter((a) => !assets.some((s) => s.id === a.id)).slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const addAsset = (a) => { onChange([...assets, a]); setQuery(''); setResults([]); };
  const removeAsset = (id) => onChange(assets.filter((a) => a.id !== id));

  return (
    <div>
      <Label>Related asset</Label>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search assets by tag or name…"
          className="input"
          style={fieldStyle}
        />
        {results.length > 0 && (
          <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            {results.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => addAsset(a)}
                className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5"
                style={{ color: TEXT }}
              >
                <span className="font-mono text-xs" style={{ color: MUTED }}>{a.assetTag}</span> — {a.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {assets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {assets.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-xs font-medium" style={{ backgroundColor: BORDER, color: TEXT }}>
              <span className="font-mono">{a.assetTag}</span> — {a.name}
              <button type="button" onClick={() => removeAsset(a.id)} style={{ color: MUTED }}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
