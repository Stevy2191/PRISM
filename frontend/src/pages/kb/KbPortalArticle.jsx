import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { IconArrowLeft, IconFile, IconFolder } from '@tabler/icons-react';
import { useSettings } from '../../context/SettingsContext';

const pub = axios.create({ baseURL: '/api/v1/kb' });

const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BORDER = 'var(--color-border)';

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
}

export default function KbPortalArticle() {
  const { slug } = useParams();
  const { settings } = useSettings();
  const wordmark = settings.appName || settings.branding?.appName || 'PRISM';
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true); setNotFound(false);
    pub.get(`/articles/${slug}`)
      .then(({ data }) => setArticle(data.article))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}>
      <header className="border-b" style={{ borderColor: BORDER, backgroundColor: 'var(--color-card)' }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/kb" className="flex items-center gap-2.5">
            {settings.logoUrl ? <img src={settings.logoUrl} alt={wordmark} className="h-7 w-7 object-contain" /> : (
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

      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link to="/kb" className="mb-5 flex items-center gap-1.5 text-sm" style={{ color: MUTED }}>
          <IconArrowLeft size={16} /> Back to Help Center
        </Link>

        {loading ? (
          <p className="py-16 text-center text-sm" style={{ color: MUTED }}>Loading…</p>
        ) : notFound || !article ? (
          <div className="card p-12 text-center">
            <h1 className="text-lg font-semibold" style={{ color: TEXT }}>Article not found</h1>
            <p className="mt-2 text-sm" style={{ color: MUTED }}>This article may have been unpublished or moved.</p>
            <Link to="/kb" className="btn-primary mt-4 inline-flex text-sm">Browse the Help Center</Link>
          </div>
        ) : (
          <article>
            {article.category && (
              <span className="chip mb-3" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}>
                <IconFolder size={12} /> {article.category.icon ? `${article.category.icon} ` : ''}{article.category.name}
              </span>
            )}
            <h1 className="page-title text-3xl">{article.title}</h1>
            <p className="mt-2 text-xs" style={{ color: MUTED }}>Updated {fmtDate(article.updatedAt)}</p>

            {article.body ? (
              <div className="kb-content mt-6" dangerouslySetInnerHTML={{ __html: article.body }} />
            ) : (
              <p className="mt-6 text-sm" style={{ color: MUTED }}>This article has attachments below.</p>
            )}

            {article.attachments?.length > 0 && (
              <div className="card mt-8 p-4">
                <h2 className="eyebrow mb-3">Attachments</h2>
                <ul className="space-y-1.5">
                  {article.attachments.map((att) => (
                    <li key={att.id} className="flex items-center gap-3 rounded-md border px-3 py-2" style={{ borderColor: BORDER }}>
                      <IconFile size={18} style={{ color: MUTED }} />
                      <a href={`/api/v1/kb/articles/${article.slug}/attachments/${att.id}/download`} className="min-w-0 flex-1 truncate text-sm hover:underline" style={{ color: TEXT }}>
                        {att.originalName}
                      </a>
                      <span className="font-mono text-xs" style={{ color: MUTED }}>{fmtSize(att.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
