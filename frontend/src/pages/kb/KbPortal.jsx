import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { IconSearch, IconFileText, IconChevronRight, IconArrowLeft } from '@tabler/icons-react';
import { useSettings } from '../../context/SettingsContext';
import PortalShell from './PortalShell';

// Public portal uses a bare axios client (no credentials/interceptors) so an
// un-authenticated visitor is never bounced to /login by the app's 401 guard.
const pub = axios.create({ baseURL: '/api/v1/kb' });

const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';

function ArticleCard({ article }) {
  return (
    <Link to={`/kb/a/${article.slug}`} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-[var(--color-hover)] sm:px-5">
      <IconFileText size={20} aria-hidden="true" className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold" style={{ color: TEXT }}>{article.title}</h3>
        {article.excerpt && <p className="mt-0.5 line-clamp-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{article.excerpt}</p>}
      </div>
      <IconChevronRight size={18} className="mt-0.5 flex-shrink-0" style={{ color: MUTED }} />
    </Link>
  );
}

export default function KbPortal() {
  const { settings } = useSettings();
  const wordmark = settings.appName || settings.branding?.appName || 'PRISM';

  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(null); // {slug,name} or null
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pub.get('/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
  }, []);

  const loadArticles = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search.trim()) params.q = search.trim();
    if (activeCat) params.category = activeCat.slug;
    pub.get('/articles', { params })
      .then(({ data }) => setArticles(data.articles))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [search, activeCat]);

  useEffect(() => {
    const t = setTimeout(loadArticles, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadArticles, search]);

  const browsing = !!activeCat || !!search.trim();

  return (
    <PortalShell wordmark={wordmark} logoUrl={settings.logoUrl}>
      {/* Hero search */}
      <div className="mb-8 text-center">
        <p className="eyebrow">Knowledge Base</p>
        <h1 className="page-title mt-1">How can we help?</h1>
        <div className="relative mx-auto mt-5 max-w-xl">
          <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for answers…"
            aria-label="Search for answers"
            className="input h-12 pl-11 text-base"
            autoFocus
          />
        </div>
      </div>

      {browsing ? (
        <div>
          <button type="button" onClick={() => { setActiveCat(null); setSearch(''); }} className="mb-4 flex items-center gap-1.5 text-sm" style={{ color: MUTED }}>
            <IconArrowLeft size={16} /> All categories
          </button>
          <h2 className="mb-3 text-lg font-semibold" style={{ color: TEXT }}>
            {activeCat ? `${activeCat.icon ? `${activeCat.icon} ` : ''}${activeCat.name}` : `Results for “${search.trim()}”`}
          </h2>
          {loading ? (
            <p className="py-10 text-center text-sm" style={{ color: MUTED }}>Searching…</p>
          ) : articles.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: MUTED }}>No articles found.</p>
          ) : (
            <div className="card divide-y divide-navy-100 overflow-hidden">
              {articles.map((a) => <ArticleCard key={a.id} article={a} />)}
            </div>
          )}
        </div>
      ) : (
        <>
          {categories.length > 0 && (
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCat({ slug: c.slug, name: c.name, icon: c.icon })}
                  className="card flex items-center gap-3 p-4 text-left transition hover:bg-[var(--color-hover)]"
                >
                  <span aria-hidden="true" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-navy-100 text-xl" style={{ backgroundColor: 'var(--color-bg)' }}>{c.icon || '📁'}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold" style={{ color: TEXT }}>{c.name}</h3>
                    {c.description && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{c.description}</p>}
                  </div>
                  <span className="num text-xs" style={{ color: MUTED }}>{c.articleCount}</span>
                </button>
              ))}
            </div>
          )}

          <h2 className="eyebrow mb-3">All articles</h2>
          {loading ? (
            <p className="py-10 text-center text-sm" style={{ color: MUTED }}>Loading…</p>
          ) : articles.length === 0 ? (
            <div className="card p-10 text-center text-sm" style={{ color: MUTED }}>No published articles yet.</div>
          ) : (
            <div className="card divide-y divide-navy-100 overflow-hidden">
              {articles.map((a) => <ArticleCard key={a.id} article={a} />)}
            </div>
          )}
        </>
      )}
    </PortalShell>
  );
}
