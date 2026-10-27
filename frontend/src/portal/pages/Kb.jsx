import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconSearch, IconFileText, IconChevronRight, IconArrowLeft,
} from '@tabler/icons-react';
import portalApi from '../api';

function ArticleRow({ article }) {
  return (
    <Link to={`/portal/kb/a/${article.slug}`} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-[var(--color-hover)] sm:px-5">
      <IconFileText size={20} aria-hidden="true" className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold" style={{ color: 'var(--color-text-primary)' }}>{article.title}</span>
        {article.excerpt && <span className="mt-0.5 line-clamp-2 block break-words text-sm" style={{ color: 'var(--color-text-secondary)' }}>{article.excerpt}</span>}
      </span>
      <IconChevronRight size={18} aria-hidden="true" className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
    </Link>
  );
}

// Mockup Kb: search, categories, the articles meant for me.
export default function Kb() {
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { portalApi.get('/kb/categories').then(({ data }) => setCategories(data.categories)).catch(() => {}); }, []);
  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search.trim()) params.q = search.trim();
    if (activeCat) params.category = activeCat.slug;
    portalApi.get('/kb/articles', { params })
      .then(({ data }) => setArticles(data.articles))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [search, activeCat]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const browsing = !!activeCat || !!search.trim();
  const list = loading ? (
    <p className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
  ) : articles.length === 0 ? (
    <div className="card p-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>{browsing ? 'No articles found.' : 'No articles yet.'}</div>
  ) : (
    <div className="card divide-y divide-navy-100 overflow-hidden">{articles.map((a) => <ArticleRow key={a.id} article={a} />)}</div>
  );

  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-6">
      <section className="text-center">
        <h1 className="page-title text-[28px] sm:text-[34px]">How can we help?</h1>
        <label className="relative mx-auto mt-5 block max-w-xl">
          <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search for answers…" aria-label="Search for answers" className="input h-12 pl-11 text-base" />
        </label>
      </section>
      {browsing ? (
        <div>
          <button type="button" onClick={() => { setActiveCat(null); setSearch(''); }} className="mb-4 flex h-11 items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <IconArrowLeft size={16} aria-hidden="true" /> All categories
          </button>
          <h2 className="mb-3 break-words text-lg font-semibold">{activeCat ? `${activeCat.icon ? `${activeCat.icon} ` : ''}${activeCat.name}` : `Results for “${search.trim()}”`}</h2>
          {list}
        </div>
      ) : (
        <>
          {categories.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {categories.map((c) => (
                <button key={c.id} type="button" onClick={() => setActiveCat(c)} className="card flex min-w-0 items-center gap-3 p-4 text-left transition hover:bg-[var(--color-hover)]">
                  <span aria-hidden="true" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-navy-100 text-xl" style={{ backgroundColor: 'var(--color-bg)' }}>{c.icon || '📁'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold">{c.name}</span>
                    {c.description && <span className="block break-words text-sm" style={{ color: 'var(--color-text-secondary)' }}>{c.description}</span>}
                  </span>
                  <span className="num text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.articleCount}</span>
                </button>
              ))}
            </div>
          )}
          <div>
            <h2 className="eyebrow mb-3">Articles for you</h2>
            {list}
          </div>
        </>
      )}
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Can&apos;t find it? <Link to="/portal/tickets/new" className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>Raise a ticket</Link>
      </p>
    </div>
  );
}
