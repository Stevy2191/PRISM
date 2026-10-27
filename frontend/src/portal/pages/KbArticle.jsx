import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconFile } from '@tabler/icons-react';
import portalApi from '../api';
import { fmtSize } from '../format';
import PageHeader from '../../components/ui/PageHeader';

// Mockup KbArticle. The body was sanitized on the server when it was saved.
export default function KbArticle() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setArticle(null); setMissing(false);
    portalApi.get(`/kb/articles/${encodeURIComponent(slug)}`)
      .then(({ data }) => setArticle(data.article))
      .catch(() => setMissing(true));
  }, [slug]);

  if (missing) {
    return (
      <div className="card mx-auto max-w-lg p-10 text-center">
        <h1 className="text-lg font-semibold">Article not found</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>It may have been unpublished or moved.</p>
        <Link to="/portal/kb" className="btn-primary mt-4 inline-flex">Browse the knowledge base</Link>
      </div>
    );
  }
  if (!article) return <p className="py-16 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>;

  const crumbs = [
    { label: 'Knowledge base', to: '/portal/kb' },
    ...(article.category ? [{ label: article.category.name, to: '/portal/kb', current: false }] : []),
    { label: article.title },
  ];
  return (
    <article className="mx-auto flex max-w-[820px] flex-col gap-4">
      <PageHeader
        crumbs={crumbs}
        title={article.title}
        sub={`Updated ${new Date(article.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
      />
      {article.body && (
        <div className="card min-w-0 p-5 sm:px-8 sm:py-7">
          {/* eslint-disable-next-line react/no-danger */}
          <div className="kb-content break-words" dangerouslySetInnerHTML={{ __html: article.body }} />
        </div>
      )}
      {article.attachments?.length > 0 && (
        <section className="card p-5">
          <h2 className="eyebrow mb-3">Attachments</h2>
          <ul className="flex flex-col gap-1.5">
            {article.attachments.map((att) => (
              <li key={att.id} className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <IconFile size={18} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <a href={`/api/v1/portal/kb/articles/${encodeURIComponent(article.slug)}/attachments/${att.id}/download`} className="min-w-0 flex-1 truncate text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>{att.originalName}</a>
                <span className="num flex-shrink-0 text-xs" style={{ color: 'var(--color-text-muted)' }}>{fmtSize(att.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Still stuck? <Link to="/portal/tickets/new" className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>Raise a ticket</Link>
      </p>
    </article>
  );
}
