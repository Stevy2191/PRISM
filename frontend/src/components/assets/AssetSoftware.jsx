import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Notice from '../ui/Notice';
import { ago, shortDate } from '../agent/agentFormat';

// Mockup AssetSoftware: the installed programs the PRISM agent reported
// (8a), on their own tab. Searchable; 50 at a time.
const MUTED = { color: 'var(--color-text-muted)' };
const BORDER = { borderColor: 'var(--color-border)' };
const PAGE = 50;

export default function AssetSoftware({ assetId, lastInventoryAt }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setLimit(PAGE); }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    api.get(`/assets/${assetId}/software`, { params: { search: query || undefined, limit } })
      .then(({ data: d }) => setData(d))
      .catch((err) => setError(errMessage(err)));
  }, [assetId, query, limit]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const shown = data.software.length;
  const matching = data.total;
  return (
    <section aria-label="Installed software" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5" style={BORDER}>
        <div>
          <h2 className="text-[15px] font-semibold text-navy-900">Installed software</h2>
          <p className="mt-0.5 text-[12.5px]" style={MUTED}>{data.programs} programs · from the last inventory{lastInventoryAt ? `, ${ago(lastInventoryAt)}` : ''}</p>
        </div>
        <input
          type="search"
          aria-label="Search software"
          placeholder="Search name or publisher"
          className="input h-9 w-full text-sm sm:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="table-th">Name</th><th className="table-th">Version</th><th className="table-th">Publisher</th><th className="table-th">Installed</th></tr></thead>
          <tbody>
            {data.software.map((s) => (
              <tr key={s.id} className="border-t" style={BORDER}>
                <td className="table-td font-medium text-navy-900">{s.name}</td>
                <td className="table-td font-mono text-[12.5px]">{s.version || '—'}</td>
                <td className="table-td">{s.publisher || '—'}</td>
                <td className="table-td whitespace-nowrap">{s.installDate ? shortDate(`${s.installDate}T12:00:00`) : '—'}</td>
              </tr>
            ))}
            {!shown && <tr><td className="table-td" colSpan={4}>{query ? 'No programs match.' : 'No programs reported.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {matching > shown && (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm" style={BORDER}>
          <span style={MUTED}>Showing {shown} of {matching}</span>
          <button type="button" className="btn-secondary h-8 px-3 text-sm" onClick={() => setLimit((l) => l + 200)}>Show more</button>
        </div>
      )}
    </section>
  );
}
