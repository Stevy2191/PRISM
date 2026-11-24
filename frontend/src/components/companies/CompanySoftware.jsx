import { useCallback, useEffect, useState } from 'react';
import Notice from '../ui/Notice';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Software tab (9): the apps a company's people use. A category that "asks
// which app" offers these (active ones) when someone raises a ticket. Apps
// are added by hand, or picked from what the PRISM agent found on this
// company's computers. Turning one off keeps it on old tickets.
export default function CompanySoftware({ company }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tickets.categories.manage');
  const canSeeComputers = canManage && hasPermission('assets.view');
  const base = `/companies/${company.id}/catalog`;
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ name: '', publisher: '', notes: '' });
  const [editing, setEditing] = useState(null); // { id, name, publisher, notes }
  const [error, setError] = useState('');
  const [finding, setFinding] = useState(false);

  const load = useCallback(() => {
    api.get(base, { params: { kind: 'software' } }).then(({ data }) => setItems(data.items)).catch((err) => setError(errMessage(err)));
  }, [base]);
  useEffect(load, [load]);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      load();
      return true;
    } catch (err) {
      setError(errMessage(err));
      return false;
    }
  };
  const add = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post(base, { kind: 'software', name: form.name, publisher: form.publisher || null, notes: form.notes || null }));
    if (ok) setForm({ name: '', publisher: '', notes: '' });
  };
  const save = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.patch(`${base}/${editing.id}`, { name: editing.name, publisher: editing.publisher || null, notes: editing.notes || null }));
    if (ok) setEditing(null);
  };
  const remove = (item) => {
    if (!confirm(`Remove ${item.name} from ${company.name}'s list? Tickets that named it keep the ticket but lose the app. To keep it on them, turn it off instead.`)) return;
    run(() => api.delete(`${base}/${item.id}`));
  };

  if (!items) return error ? <Notice tone="bad">{error}</Notice> : null;
  return (
    <div className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        The apps {company.name}&apos;s people use. A ticket category set to <strong>asks which app</strong> offers this list, with Not listed as the way out.
      </p>
      <table className="min-w-full text-sm" data-testid="software-list">
        <thead><tr>{['App', 'Publisher', 'Notes', 'Status', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {items.map((i) => (editing?.id === i.id ? (
            <tr key={i.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className="table-td" colSpan={5}>
                <form onSubmit={save} className="flex flex-wrap items-center gap-2">
                  <input className="input w-auto" aria-label="App name" maxLength={255} required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <input className="input w-auto" aria-label="Publisher" maxLength={255} value={editing.publisher || ''} onChange={(e) => setEditing({ ...editing, publisher: e.target.value })} />
                  <input className="input w-auto min-w-[14rem]" aria-label="Notes" maxLength={2000} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                  <button type="submit" className="btn-primary">Save</button>
                  <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              </td>
            </tr>
          ) : (
            <tr key={i.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className="table-td font-medium" style={{ color: i.active ? undefined : 'var(--color-text-muted)' }}>{i.name}</td>
              <td className="table-td">{i.publisher || '—'}</td>
              <td className="table-td">{i.notes || '—'}</td>
              <td className="table-td">{i.active ? 'Active' : 'Off'}</td>
              <td className="table-td whitespace-nowrap text-right">
                {canManage && (
                  <span className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setEditing({ id: i.id, name: i.name, publisher: i.publisher, notes: i.notes })}>Edit</button>
                    <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => run(() => api.patch(`${base}/${i.id}`, { active: !i.active }))}>{i.active ? 'Turn off' : 'Turn on'}</button>
                    <button type="button" className="h-8 px-2 text-xs text-red-500 hover:underline" onClick={() => remove(i)}>Remove</button>
                  </span>
                )}
              </td>
            </tr>
          )))}
          {!items.length && <tr><td className="table-td" colSpan={5}>No apps yet. Add the ones {company.name}&apos;s people ask about.</td></tr>}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={add} className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-4" aria-label="Add an app">
          <input className="input" placeholder="App name" aria-label="New app name" maxLength={255} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Publisher (optional)" aria-label="New app publisher" maxLength={255} value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
          <input className="input" placeholder="Notes (optional)" aria-label="New app notes" maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Add app</button>
            {canSeeComputers && <button type="button" className="btn-secondary" onClick={() => setFinding(true)}>From their computers</button>}
          </div>
        </form>
      )}
      {finding && <FoundSoftware base={base} company={company} onClose={() => setFinding(false)} onAdded={load} />}
    </div>
  );
}

// "Add from this company's computers": what the agent found, ticked and added.
function FoundSoftware({ base, company, onClose, onAdded }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`${base}/found-software`, { params: search ? { search } : {} })
        .then(({ data }) => setFound(data.software))
        .catch((err) => setError(errMessage(err)));
    }, 250);
    return () => clearTimeout(t);
  }, [base, search]);
  const toggle = (name) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const addPicked = async () => {
    setBusy(true);
    setError('');
    const chosen = (found || []).filter((s) => picked.has(s.name));
    const failed = [];
    for (const s of chosen) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.post(base, { kind: 'software', name: s.name, publisher: s.publisher || null });
      } catch (err) {
        failed.push(`${s.name}: ${errMessage(err)}`);
      }
    }
    setBusy(false);
    onAdded();
    if (failed.length) setError(failed.join('; '));
    else onClose();
  };
  return (
    <section className="card space-y-3 p-4" aria-label={`Software found on ${company.name}'s computers`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-900">Found on {company.name}&apos;s computers</h3>
        <input className="input w-auto" placeholder="Search" aria-label="Search found software" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {!found ? <p className="text-sm">Loading…</p> : !found.length ? (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nothing more found. The agent lists what&apos;s installed once it runs on their computers.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-navy-100 overflow-y-auto text-sm">
          {found.map((s) => (
            <li key={s.name}>
              <label className="flex items-center gap-3 px-1 py-2">
                <input type="checkbox" checked={picked.has(s.name)} onChange={() => toggle(s.name)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.name}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {s.publisher ? ` · ${s.publisher}` : ''} · on {s.computers} {s.computers === 1 ? 'computer' : 'computers'}{s.versions.length ? ` · ${s.versions.slice(-3).join(', ')}` : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn-primary" disabled={busy || !picked.size} onClick={addPicked}>Add {picked.size || ''} {picked.size === 1 ? 'app' : 'apps'}</button>
      </div>
    </section>
  );
}
