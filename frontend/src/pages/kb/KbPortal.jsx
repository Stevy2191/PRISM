import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { IconSearch, IconFolder, IconFileText, IconChevronRight, IconArrowLeft } from '@tabler/icons-react';
import { useSettings } from '../../context/SettingsContext';

// Public portal uses a bare axios client (no credentials/interceptors) so an
// un-authenticated visitor is never bounced to /login by the app's 401 guard.
const pub = axios.create({ baseURL: '/api/v1/kb' });

const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BORDER = 'var(--color-border)';

function PortalShell({ children, wordmark, logoUrl }) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}>
      <header className="border-b" style={{ borderColor: BORDER, backgroundColor: 'var(--color-card)' }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/kb" className="flex items-center gap-2.5">
            {logoUrl ? <img src={logoUrl} alt={wordmark} className="h-7 w-7 object-contain" /> : (
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <rect x="1" y="1" width="11" height="11" rx="2" fill="#1d3461" stroke="var(--color-accent)" strokeWidth="1.4" />
                <rect x="14" y="1" width="11" height="11" rx="2" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
                <rect x="1" y="14" width="11" height="11" rx="2" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
                <rect x="14" y="14" width="11" height="11" rx="2" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth="1.4" />
              </svg>
            )}
            <span className="font-bold tracking-wide" style={{ color: TEXT }}>{wordmark}</span>
            <span className="hidden text-sm sm:inline" style={{ color: MUTED }}>· Help Center</span>
          </Link>
          <Link to="/login" className="text-sm hover:underline" style={{ color: MUTED }}>Staff sign in →</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
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
        <h1 className="page-title mt-1 text-3xl">How can we help?</h1>
        <div className="relative mx-auto mt-5 max-w-xl">
          <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for answers…"
            className="input py-3 pl-11 text-base"
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
            <div className="space-y-2">
              {articles.map((a) => (
                <Link key={a.id} to={`/kb/a/${a.slug}`} className="card flex items-start gap-3 p-4 transition hover:border-navy-200">
                  <IconFileText size={20} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium" style={{ color: TEXT }}>{a.title}</h3>
                    {a.excerpt && <p className="mt-0.5 line-clamp-2 text-sm" style={{ color: MUTED }}>{a.excerpt}</p>}
                  </div>
                  <IconChevronRight size={18} className="mt-0.5 flex-shrink-0" style={{ color: MUTED }} />
                </Link>
              ))}
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
                  className="card flex items-center gap-3 p-4 text-left transition hover:border-navy-200"
                >
                  <span className="text-2xl">{c.icon || '📁'}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold" style={{ color: TEXT }}>{c.name}</h3>
                    {c.description && <p className="truncate text-sm" style={{ color: MUTED }}>{c.description}</p>}
                  </div>
                  <span className="font-mono text-xs" style={{ color: MUTED }}>{c.articleCount}</span>
                </button>
              ))}
            </div>
          )}

          <h2 className="eyebrow mb-3 flex items-center gap-1.5"><IconFolder size={13} /> All articles</h2>
          {loading ? (
            <p className="py-10 text-center text-sm" style={{ color: MUTED }}>Loading…</p>
          ) : articles.length === 0 ? (
            <div className="card p-10 text-center text-sm" style={{ color: MUTED }}>No published articles yet.</div>
          ) : (
            <div className="space-y-2">
              {articles.map((a) => (
                <Link key={a.id} to={`/kb/a/${a.slug}`} className="card flex items-start gap-3 p-4 transition hover:border-navy-200">
                  <IconFileText size={20} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium" style={{ color: TEXT }}>{a.title}</h3>
                    {a.excerpt && <p className="mt-0.5 line-clamp-2 text-sm" style={{ color: MUTED }}>{a.excerpt}</p>}
                  </div>
                  <IconChevronRight size={18} className="mt-0.5 flex-shrink-0" style={{ color: MUTED }} />
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </PortalShell>
  );
}
