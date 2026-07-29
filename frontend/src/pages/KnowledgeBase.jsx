import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconSearch, IconPlus, IconWorld, IconLock, IconUsers, IconFolder, IconDots, IconTrash, IconPencil, IconFileText,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BORDER = 'var(--color-border)';
const CARD = 'var(--color-card)';

function StatusChip({ status }) {
  const published = status === 'published';
  const color = published ? 'var(--color-success)' : 'var(--color-warning)';
  return (
    <span className="chip" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <span className="status-dot" style={{ backgroundColor: color }} />
      {published ? 'Published' : 'Draft'}
    </span>
  );
}

function VisibilityChip({ visibility }) {
  const isEndUsers = visibility === 'public';
  const color = isEndUsers ? 'var(--color-accent)' : MUTED;
  const Icon = isEndUsers ? IconUsers : IconLock;
  return (
    <span className="chip" style={{ backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, color }}>
      <Icon size={12} /> {isEndUsers ? 'End users' : 'Agents only'}
    </span>
  );
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// ---- Category manager ----
function CategoryManager({ categories, onClose, onChanged }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post('/knowledge/categories', { name: name.trim(), icon: icon.trim() || undefined });
      setName(''); setIcon('');
      onChanged();
    } catch (err) { alert(errMessage(err)); } finally { setSaving(false); }
  };
  const saveEdit = async (id) => {
    if (!editName.trim()) return;
    try { await api.patch(`/knowledge/categories/${id}`, { name: editName.trim() }); setEditId(null); onChanged(); }
    catch (err) { alert(errMessage(err)); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"? Its articles will become uncategorized.`)) return;
    try { await api.delete(`/knowledge/categories/${c.id}`); onChanged(); }
    catch (err) { alert(errMessage(err)); }
  };

  return (
    <Modal title="Manage categories" onClose={onClose}>
      <div className="mb-4 flex items-end gap-2">
        <div className="w-16">
          <label className="label">Icon</label>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📁" maxLength={2} className="input text-center" />
        </div>
        <div className="flex-1">
          <label className="label">New category</label>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Onboarding" className="input" />
        </div>
        <button type="button" onClick={add} disabled={saving || !name.trim()} className="btn-primary">Add</button>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {categories.length === 0 && <p className="py-4 text-center text-sm" style={{ color: MUTED }}>No categories yet.</p>}
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2" style={{ borderColor: BORDER }}>
            <span className="w-5 text-center">{c.icon || '📁'}</span>
            {editId === c.id ? (
              <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEdit(c.id)} className="input flex-1 py-1" autoFocus />
            ) : (
              <span className="flex-1 text-sm" style={{ color: TEXT }}>{c.name}<span className="ml-2 text-xs" style={{ color: MUTED }}>{c.articleCount}</span></span>
            )}
            {editId === c.id ? (
              <button type="button" onClick={() => saveEdit(c.id)} className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>Save</button>
            ) : (
              <button type="button" onClick={() => { setEditId(c.id); setEditName(c.name); }} title="Rename" style={{ color: MUTED }}><IconPencil size={15} /></button>
            )}
            <button type="button" onClick={() => remove(c)} title="Delete" style={{ color: 'var(--color-danger)' }}><IconTrash size={15} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function KnowledgeBase() {
  const canManage = usePermission('kb.manage');
  const navigate = useNavigate();

  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(''); // '', 'none', or category id
  const [status, setStatus] = useState('');
  const [audience, setAudience] = useState(''); // '', 'internal' (agents), 'public' (end users)
  const [showCatManager, setShowCatManager] = useState(false);

  const loadCategories = useCallback(() => {
    api.get('/knowledge/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
  }, []);

  const loadArticles = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search.trim()) params.q = search.trim();
    if (activeCat) params.categoryId = activeCat;
    if (status) params.status = status;
    if (audience) params.visibility = audience;
    api.get('/knowledge/articles', { params })
      .then(({ data }) => setArticles(data.articles))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [search, activeCat, status, audience]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => {
    const t = setTimeout(loadArticles, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadArticles, search]);

  const totalArticles = useMemo(() => categories.reduce((n, c) => n + c.articleCount, 0), [categories]);

  const CatButton = ({ value, label, icon, count }) => (
    <button
      type="button"
      onClick={() => setActiveCat(value)}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition"
      style={{
        backgroundColor: activeCat === value ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
        color: activeCat === value ? 'var(--color-accent)' : TEXT,
      }}
    >
      <span className="w-5 text-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="font-mono text-xs" style={{ color: MUTED }}>{count}</span>}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Knowledge</p>
          <h1 className="page-title">Knowledge Base</h1>
        </div>
        <div className="flex items-center gap-2">
          <a href="/kb" target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
            <IconWorld size={16} /> View portal
          </a>
          {canManage && (
            <Link to="/knowledge/new" className="btn-primary text-sm"><IconPlus size={16} /> New article</Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
        {/* Category rail */}
        <aside className="space-y-1">
          <div className="card p-2">
            <CatButton value="" label="All articles" icon="📚" count={totalArticles} />
            <CatButton value="none" label="Uncategorized" icon="🗂" />
            {categories.length > 0 && <div className="my-1.5 border-t" style={{ borderColor: BORDER }} />}
            {categories.map((c) => (
              <CatButton key={c.id} value={String(c.id)} label={c.name} icon={c.icon || '📁'} count={c.articleCount} />
            ))}
          </div>
          {canManage && (
            <button type="button" onClick={() => setShowCatManager(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ color: MUTED }}>
              <IconDots size={15} /> Manage categories
            </button>
          )}
        </aside>

        {/* Articles */}
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search articles…"
                className="input pl-9"
              />
            </div>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className="input sm:w-40">
              <option value="">All audiences</option>
              <option value="internal">Agents only</option>
              <option value="public">End users</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input sm:w-40">
              <option value="">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          {error && (
            <div className="rounded-md p-3 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}>{error}</div>
          )}

          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : articles.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 p-12 text-center">
              <IconFileText size={32} style={{ color: MUTED }} />
              <p className="text-sm" style={{ color: MUTED }}>No articles here yet.</p>
              {canManage && <Link to="/knowledge/new" className="btn-primary text-sm"><IconPlus size={16} /> Write the first one</Link>}
            </div>
          ) : (
            <div className="space-y-2">
              {articles.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/knowledge/${a.id}`)}
                  className="card block w-full p-4 text-left transition hover:border-navy-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold" style={{ color: TEXT }}>{a.title}</h3>
                      {a.excerpt && <p className="mt-1 line-clamp-2 text-sm" style={{ color: MUTED }}>{a.excerpt}</p>}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      <StatusChip status={a.status} />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
                    {a.category && (
                      <span className="chip" style={{ backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 7%, transparent)', color: MUTED }}>
                        <IconFolder size={12} /> {a.category.icon ? `${a.category.icon} ` : ''}{a.category.name}
                      </span>
                    )}
                    <VisibilityChip visibility={a.visibility} />
                    <span>Updated {fmtDate(a.updatedAt)}</span>
                    {a.author && <span>· {a.author.displayName}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCatManager && (
        <CategoryManager
          categories={categories}
          onClose={() => setShowCatManager(false)}
          onChanged={() => { loadCategories(); loadArticles(); }}
        />
      )}
    </div>
  );
}
