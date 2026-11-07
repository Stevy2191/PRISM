// Try a bundle on someone (PB): what it would add for that person's devices,
// and the devices nothing covers.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';

const inputClass = 'h-9 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm';

export default function TryOnSomeone({ playbookId }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => api.get('/contacts', { params: { search: q.trim(), limit: 6 } }).then(({ data }) => setFound(data.contacts || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const run = async (c) => {
    setError('');
    setFound([]);
    setQ(c.displayName);
    try { const { data } = await api.post(`/playbooks/${playbookId}/preview`, { contactId: c.id }); setResult(data); } catch (err) { setError(errMessage(err)); setResult(null); }
  };
  return (
    <div className="card">
      <div className="border-b border-navy-100 px-4 py-3"><h3 className="text-sm font-semibold">Try it on someone</h3></div>
      <div className="flex flex-col gap-2 p-4 text-sm">
        <input className={inputClass} placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Try on contact" />
        {found.map((c) => <button key={c.id} type="button" className="text-left hover:underline" onClick={() => run(c)}>{c.displayName}</button>)}
        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
        {result && (
          <ul className="flex flex-col gap-1" data-testid="try-result">
            {result.forms.map((f, i) => <li key={i}>{f.formName} <span className="text-navy-400">· {f.asset ? f.asset.name : 'once'}</span></li>)}
            {result.uncovered.map((a) => <li key={a.id} style={{ color: 'var(--color-warning)' }}>Not covered · {a.name}</li>)}
            {result.forms.length === 0 && result.uncovered.length === 0 && <li className="text-navy-400">Nothing would be added.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
