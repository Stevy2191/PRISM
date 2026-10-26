import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconSearch, IconPlus, IconWorld, IconLock, IconUsers, IconFolder, IconDots, IconTrash, IconPencil, IconFileText,
  IconAdjustmentsHorizontal,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import { usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';
import PageHeader from '../components/ui/PageHeader';
import PillRow from '../components/ui/PillRow';
import Pill from '../components/ui/Pill';
import SelectChip from '../components/ui/SelectChip';
import FiltersSheet from '../components/ui/FiltersSheet';
import Notice from '../components/ui/Notice';

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

  const filterKey = JSON.stringify([search, activeCat, status, audience]);
  const pager = usePagination({ filterKey, storageKey: 'prism.kb.pageSize' });
  const [showCatManager, setShowCatManager] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    api.get('/knowledge/articles', { params: { ...params, ...pager.params } })
      .then(({ data }) => { setArticles(data.articles); pager.applyMeta(data); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeCat, status, audience, pager.page, pager.limit]);

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
      aria-pressed={activeCat === value}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition hover:bg-[var(--color-hover)]"
      style={{
        backgroundColor: activeCat === value ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
        color: activeCat === value ? 'var(--color-accent)' : TEXT,
      }}
    >
      <span className="w-5 text-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="num text-xs" style={{ color: MUTED }}>{count}</span>}
    </button>
  );

  const catOptions = [
    { value: '', label: 'All articles', icon: '📚', count: totalArticles },
    { value: 'none', label: 'Uncategorized', icon: '🗂' },
    ...categories.map((c) => ({ value: String(c.id), label: c.name, icon: c.icon || '📁', count: c.articleCount })),
  ];
  const filterCount = [audience, status].filter(Boolean).length;
  const filterSelects = (as) => [
    ['Audience', audience, setAudience, [['', 'All audiences'], ['internal', 'Agents only'], ['public', 'End users']]],
    ['Status', status, setStatus, [['', 'All statuses'], ['published', 'Published'], ['draft', 'Draft']]],
  ].map(([label, value, set, options]) => {
    const opts = options.map(([v, l]) => <option key={v} value={v}>{l}</option>);
    if (as === 'chip') return <SelectChip key={label} label={label} value={value} onChange={(e) => set(e.target.value)} className="max-lg:hidden">{opts}</SelectChip>;
    const fid = `kb-filter-${label.toLowerCase()}`;
    return (
      <div key={label}>
        <label className="label" htmlFor={fid}>{label}</label>
        <select id={fid} value={value} onChange={(e) => set(e.target.value)} className="input h-11 text-sm">{opts}</select>
      </div>
    );
  });

  return (
    <div className="mx-auto max-w-[1280px] space-y-5 lg:px-6">
      <PageHeader
        title="Knowledge Base"
        sub={loading ? undefined : `${pager.total.toLocaleString()} article${pager.total === 1 ? '' : 's'}`}
        actions={(
          <>
            <a href="/kb" target="_blank" rel="noopener noreferrer" className="btn-secondary h-10 text-sm max-sm:min-h-[44px]">
              <IconWorld size={16} aria-hidden="true" /> View portal
            </a>
            {canManage && (
              <Link to="/knowledge/new" className="btn-primary h-10 text-sm max-lg:hidden"><IconPlus size={16} aria-hidden="true" /> New article</Link>
            )}
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Category rail (desktop); a row of pills on a phone */}
        <aside className="hidden space-y-1 lg:block">
          <nav aria-label="Categories" className="card p-2">
            <CatButton value="" label="All articles" icon="📚" count={totalArticles} />
            <CatButton value="none" label="Uncategorized" icon="🗂" />
            {categories.length > 0 && <div className="my-1.5 border-t" style={{ borderColor: BORDER }} />}
            {categories.map((c) => (
              <CatButton key={c.id} value={String(c.id)} label={c.name} icon={c.icon || '📁'} count={c.articleCount} />
            ))}
          </nav>
          {canManage && (
            <button type="button" onClick={() => setShowCatManager(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-[var(--color-hover)]" style={{ color: MUTED }}>
              <IconDots size={15} aria-hidden="true" /> Manage categories
            </button>
          )}
        </aside>

        {/* Articles */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 lg:max-w-md">
              <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search articles…"
                aria-label="Search articles"
                className="input h-11 pl-9 text-sm lg:h-8 lg:pl-8 lg:text-[13px]"
              />
            </label>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex h-11 flex-shrink-0 items-center gap-2 rounded-md border border-navy-100 bg-surface px-3 text-sm font-semibold text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent lg:hidden"
            >
              <IconAdjustmentsHorizontal size={16} aria-hidden="true" />
              Filters
              {filterCount > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-semibold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
                  {filterCount}
                </span>
              )}
            </button>
            {filterSelects('chip')}
          </div>

          <div className="lg:hidden">
            <PillRow label="Categories">
              {catOptions.map((c) => (
                <Pill key={c.value || 'all'} on={activeCat === c.value} onClick={() => setActiveCat(c.value)}>
                  <span aria-hidden="true">{c.icon}</span> {c.label}{c.count !== undefined ? ` · ${c.count}` : ''}
                </Pill>
              ))}
            </PillRow>
            {canManage && (
              <button type="button" onClick={() => setShowCatManager(true)} className="mt-1 flex min-h-[44px] items-center gap-2 rounded-md px-1 text-sm hover:underline" style={{ color: MUTED }}>
                <IconDots size={15} aria-hidden="true" /> Manage categories
              </button>
            )}
          </div>

          {error && <Notice tone="bad">{error}</Notice>}

          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : articles.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 p-12 text-center">
              <IconFileText size={32} style={{ color: MUTED }} />
              <p className="text-sm" style={{ color: MUTED }}>No articles here yet.</p>
              {canManage && <Link to="/knowledge/new" className="btn-primary text-sm"><IconPlus size={16} /> Write the first one</Link>}
            </div>
          ) : (
            <div className="card divide-y divide-navy-100 overflow-hidden">
              {articles.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/knowledge/${a.id}`)}
                  className="block w-full px-4 py-3.5 text-left transition hover:bg-[var(--color-hover)] sm:px-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold" style={{ color: TEXT }}>{a.title}</h3>
                      {a.excerpt && <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{a.excerpt}</p>}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      <StatusChip status={a.status} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: MUTED }}>
                    {a.category && (
                      <span className="chip border border-navy-100" style={{ color: 'var(--color-text-secondary)' }}>
                        {a.category.icon ? `${a.category.icon} ` : <IconFolder size={12} aria-hidden="true" />}{a.category.name}
                      </span>
                    )}
                    <VisibilityChip visibility={a.visibility} />
                    <span>Updated {fmtDate(a.updatedAt)}</span>
                    {a.author && <span>· {a.author.displayName}</span>}
                  </div>
                </button>
              ))}
              <Pagination
                page={pager.page}
                limit={pager.limit}
                total={pager.total}
                totalPages={pager.totalPages}
                onPageChange={pager.setPage}
                onLimitChange={pager.setLimit}
              />
            </div>
          )}
        </div>
      </div>

      <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        {filterSelects('sheet')}
      </FiltersSheet>

      {canManage && (
        <Link
          to="/knowledge/new"
          aria-label="New article"
          className="fixed bottom-6 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold shadow-lg lg:hidden"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
        >
          +
        </Link>
      )}

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
