import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Picks a vendor company (GET /companies/vendors). Holders of
// companies.manage can add a missing vendor inline. `value` is the chosen
// { id, name } or null.
export default function VendorPicker({ value, onChange, style }) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('companies.manage');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.get('/companies/vendors', { params: { search: term } })
        .then(({ data }) => setResults(data.vendors))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (vendor) => { onChange(vendor); setQuery(''); setError(''); };
  const create = async () => {
    try {
      const { data } = await api.post('/companies', { name: query.trim(), isVendor: true, isClient: false });
      choose({ id: data.company.id, name: data.company.name });
    } catch (err) {
      setError(errMessage(err));
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="input flex-1" style={style} data-testid="vendor-chosen">{value.name}</span>
        <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  const term = query.trim();
  const exact = results.some((v) => v.name.toLowerCase() === term.toLowerCase());
  return (
    <div className="relative">
      <input aria-label="Vendor" className="input" style={style} value={query} placeholder="Search vendors…" onChange={(e) => setQuery(e.target.value)} />
      {term && (
        <div className="card absolute z-20 mt-1 w-full p-1">
          {results.map((v) => (
            <button key={v.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-hover)]" onClick={() => choose(v)}>{v.name}</button>
          ))}
          {!exact && canCreate && (
            <button type="button" className="block w-full rounded px-2 py-1 text-left text-sm text-prism hover:bg-[var(--color-hover)]" onClick={create}>+ Add vendor &quot;{term}&quot;</button>
          )}
          {!results.length && !canCreate && <p className="px-2 py-1 text-sm">No vendor found.</p>}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
