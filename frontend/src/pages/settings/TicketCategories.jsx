// Settings → Ticket categories (5c). The global category tree, up to 5
// levels: add, rename, reorder (drag or arrows), move, retire/restore,
// "must choose a sub-category", delete when unused. The server enforces
// every rule (depth, unique names, in-use); this page shows its messages.
import { useEffect, useMemo, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Switch from '../../components/Switch';
import SettingsPage, { SettingsPanel } from '../../components/settings/SettingsPage';
import {
  buildIndex, childrenOf, pathIds, pathLabel,
} from '../../components/categoryTree';

const MAX_DEPTH = 5;

function usageText(u) {
  if (!u) return '';
  const parts = [];
  if (u.tickets) parts.push(`${u.tickets} ticket${u.tickets === 1 ? '' : 's'}`);
  if (u.fields) parts.push(`${u.fields} field${u.fields === 1 ? '' : 's'}`);
  if (u.rules) parts.push(`${u.rules} rule${u.rules === 1 ? '' : 's'}`);
  if (u.recurring) parts.push(`${u.recurring} recurring`);
  return parts.join(' · ');
}

function inUseMessage(err) {
  const usage = err?.response?.data?.usage;
  const text = usageText(usage);
  return text ? `${errMessage(err)} (used by ${text})` : errMessage(err);
}

export default function TicketCategories() {
  const [categories, setCategories] = useState([]);
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(null); // { parentId } while the add form is open
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [dragId, setDragId] = useState(null);
  const [busy, setBusy] = useState(false);

  const index = useMemo(() => buildIndex(categories), [categories]);

  const load = () => api.get('/ticket-categories', { params: { usage: '1' } })
    .then(({ data }) => { setCategories(data.categories); setRequired(data.categoryRequired); setError(''); })
    .catch((err) => setError(errMessage(err)))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  // Every change goes through here: show the server's message, then reload.
  const run = async (fn, format = errMessage) => {
    setBusy(true);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(format(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post('/ticket-categories', { name: newName, parentId: adding.parentId }));
    if (ok) { setAdding(null); setNewName(''); }
  };
  const rename = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.patch(`/ticket-categories/${renaming.id}`, { name: renaming.name }));
    if (ok) setRenaming(null);
  };
  const patch = (id, body) => run(() => api.patch(`/ticket-categories/${id}`, body));
  const remove = (c) => {
    if (!confirm(`Delete "${c.name}" and everything under it?`)) return;
    run(() => api.delete(`/ticket-categories/${c.id}`), inUseMessage);
  };
  const reorder = (parentId, orderedIds) => run(() => api.post('/ticket-categories/reorder', { parentId, orderedIds }));
  const shift = (c, by) => {
    const sibs = childrenOf(index, c.parentId, { includeRetired: true }).map((s) => s.id);
    const i = sibs.indexOf(c.id);
    const j = i + by;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    reorder(c.parentId ?? null, sibs);
  };
  const dropOn = (target) => {
    const dragged = index.get(dragId);
    setDragId(null);
    if (!dragged || dragged.id === target.id || (dragged.parentId ?? null) !== (target.parentId ?? null)) return;
    const sibs = childrenOf(index, target.parentId, { includeRetired: true }).map((s) => s.id).filter((id) => id !== dragged.id);
    sibs.splice(sibs.indexOf(target.id), 0, dragged.id);
    reorder(target.parentId ?? null, sibs);
  };
  const toggleRequired = (value) => run(() => api.put('/ticket-categories/settings', { categoryRequired: value }));

  // Possible new parents for a move: not itself or anything below it.
  const moveTargets = (c) => [...index.values()]
    .filter((n) => !pathIds(index, n.id).includes(c.id) && pathIds(index, n.id).length < MAX_DEPTH)
    .sort((a, b) => pathLabel(index, a.id).localeCompare(pathLabel(index, b.id)));

  const addForm = (parentId) => (
    <form onSubmit={add} className="flex flex-wrap items-center gap-2 py-2" data-testid="category-add-form">
      <input
        className="input w-auto min-w-[14rem]"
        aria-label={parentId ? 'New sub-category name' : 'New category name'}
        maxLength={100}
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        autoFocus
        required
      />
      <button type="submit" className="btn-primary" disabled={busy}>Add</button>
      <button type="button" className="btn-secondary" onClick={() => { setAdding(null); setNewName(''); }}>Cancel</button>
    </form>
  );

  const renderNode = (c, depth) => {
    const kids = childrenOf(index, c.id, { includeRetired: true });
    const effective = c.effectiveActive;
    return (
      <li key={c.id} data-testid={`category-${c.id}`}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--color-border)', paddingLeft: `${0.75 + depth * 1.5}rem`, opacity: dragId === c.id ? 0.5 : 1 }}
          draggable
          onDragStart={() => setDragId(c.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropOn(c)}
          onDragEnd={() => setDragId(null)}
        >
          <div className="flex min-w-0 items-center gap-2">
            {renaming?.id === c.id ? (
              <form onSubmit={rename} className="flex items-center gap-2">
                <input className="input w-auto" aria-label="Category name" maxLength={100} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus required />
                <button type="submit" className="btn-primary" disabled={busy}>Save</button>
                <button type="button" className="btn-secondary" onClick={() => setRenaming(null)}>Cancel</button>
              </form>
            ) : (
              <span className="truncate font-medium" style={{ color: effective ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{c.name}</span>
            )}
            {!c.active && <span className="eyebrow">retired</span>}
            {c.active && !effective && <span className="eyebrow">hidden (parent retired)</span>}
            {c.requireChild && <span className="eyebrow">sub-category required</span>}
            {usageText(c.usage) && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{usageText(c.usage)}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" aria-label={`Move ${c.name} up`} onClick={() => shift(c, -1)} disabled={busy}>↑</button>
            <button type="button" aria-label={`Move ${c.name} down`} onClick={() => shift(c, 1)} disabled={busy}>↓</button>
            {depth + 1 < MAX_DEPTH && (
              <button type="button" className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => { setAdding({ parentId: c.id }); setNewName(''); }}>
                add sub-category
              </button>
            )}
            <button type="button" className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => setRenaming({ id: c.id, name: c.name })}>rename</button>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={c.requireChild} onChange={(e) => patch(c.id, { requireChild: e.target.checked })} disabled={busy} />
              must choose a sub-category
            </label>
            <select
              className="input w-auto py-0.5 text-xs"
              aria-label={`Move ${c.name} to`}
              value=""
              onChange={(e) => { if (e.target.value !== '') patch(c.id, { parentId: e.target.value === 'root' ? null : Number(e.target.value) }); }}
              disabled={busy}
            >
              <option value="">Move to…</option>
              {c.parentId != null && <option value="root">Top level</option>}
              {moveTargets(c).filter((n) => n.id !== c.parentId).map((n) => <option key={n.id} value={n.id}>{pathLabel(index, n.id)}</option>)}
            </select>
            <button type="button" className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => patch(c.id, { active: !c.active })} disabled={busy}>
              {c.active ? 'retire' : 'restore'}
            </button>
            <button type="button" className="text-red-500 hover:underline" onClick={() => remove(c)} disabled={busy}>delete</button>
          </div>
        </div>
        {adding?.parentId === c.id && <div style={{ paddingLeft: `${2.25 + depth * 1.5}rem` }}>{addForm(c.id)}</div>}
        {kids.length > 0 && <ul>{kids.map((k) => renderNode(k, depth + 1))}</ul>}
      </li>
    );
  };

  if (loading) return <Spinner />;
  const roots = childrenOf(index, null, { includeRetired: true });

  return (
    <SettingsPage description="Categories narrow as you pick them on a ticket. Up to 5 levels. Retired categories are hidden from pickers, but tickets keep them.">
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <SettingsPanel title="New tickets">
        <div className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <span>Require a category on new tickets (staff form only; email and recurring tickets may leave it empty)</span>
          <Switch checked={required} onChange={toggleRequired} disabled={busy} label="Require a category on new tickets" />
        </div>
      </SettingsPanel>
      <SettingsPanel
        title="Categories"
        actions={<button type="button" className="btn-primary" onClick={() => { setAdding({ parentId: null }); setNewName(''); }}>Add category</button>}
      >
        {adding?.parentId === null && <div className="px-3">{addForm(null)}</div>}
        {roots.length ? <ul data-testid="category-tree">{roots.map((c) => renderNode(c, 0))}</ul>
          : <p className="p-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>No categories yet.</p>}
      </SettingsPanel>
    </SettingsPage>
  );
}
