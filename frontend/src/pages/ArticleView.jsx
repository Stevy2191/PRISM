import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  IconArrowLeft, IconPencil, IconTrash, IconFile, IconWorld, IconLock, IconFolder, IconEye, IconExternalLink,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const MUTED = 'var(--color-text-muted)';
const BORDER = 'var(--color-border)';

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export default function ArticleView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canManage = usePermission('kb.manage');
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/knowledge/articles/${id}`)
      .then(({ data }) => setArticle(data.article))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    if (!window.confirm('Delete this article permanently?')) return;
    try { await api.delete(`/knowledge/articles/${id}`); navigate('/knowledge'); }
    catch (err) { alert(errMessage(err)); }
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error) return (
    <div className="mx-auto max-w-3xl">
      <Link to="/knowledge" className="flex items-center gap-1.5 text-sm" style={{ color: MUTED }}><IconArrowLeft size={16} /> Back</Link>
      <div className="mt-4 rounded-md p-3 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}>{error}</div>
    </div>
  );
  if (!article) return null;

  const published = article.status === 'published';
  const isPublic = article.visibility === 'public';
  const onPortal = published && isPublic;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link to="/knowledge" className="flex items-center gap-1.5 text-sm" style={{ color: MUTED }}><IconArrowLeft size={16} /> Knowledge Base</Link>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link to={`/knowledge/${id}/edit`} className="btn-secondary text-sm"><IconPencil size={15} /> Edit</Link>
            <button type="button" onClick={remove} className="btn-danger text-sm"><IconTrash size={15} /> Delete</button>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="chip" style={{ backgroundColor: `color-mix(in srgb, ${published ? 'var(--color-success)' : 'var(--color-warning)'} 14%, transparent)`, color: published ? 'var(--color-success)' : 'var(--color-warning)' }}>
            <span className="status-dot" style={{ backgroundColor: published ? 'var(--color-success)' : 'var(--color-warning)' }} />
            {published ? 'Published' : 'Draft'}
          </span>
          <span className="chip" style={{ backgroundColor: `color-mix(in srgb, ${isPublic ? 'var(--color-accent)' : MUTED} 13%, transparent)`, color: isPublic ? 'var(--color-accent)' : MUTED }}>
            {isPublic ? <IconWorld size={12} /> : <IconLock size={12} />} {isPublic ? 'Public' : 'Internal'}
          </span>
          {article.category && (
            <span className="chip" style={{ backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 7%, transparent)', color: MUTED }}>
              <IconFolder size={12} /> {article.category.icon ? `${article.category.icon} ` : ''}{article.category.name}
            </span>
          )}
        </div>
        <h1 className="page-title text-3xl">{article.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: MUTED }}>
          {article.author && <span>By {article.author.displayName}</span>}
          <span>· Updated {fmtDate(article.updatedAt)}</span>
          <span className="flex items-center gap-1"><IconEye size={13} /> {article.viewCount}</span>
          {onPortal && (
            <a href={`/kb/a/${article.slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline" style={{ color: 'var(--color-accent)' }}>
              <IconExternalLink size={13} /> View on portal
            </a>
          )}
        </div>
      </div>

      {/* Body */}
      {article.body ? (
        <div className="kb-content" dangerouslySetInnerHTML={{ __html: article.body }} />
      ) : (
        <p className="text-sm italic" style={{ color: MUTED }}>This article has no written content yet.</p>
      )}

      {/* Attachments */}
      {article.attachments?.length > 0 && (
        <div className="card p-4">
          <h2 className="eyebrow mb-3">Attachments</h2>
          <ul className="space-y-1.5">
            {article.attachments.map((att) => (
              <li key={att.id} className="flex items-center gap-3 rounded-md border px-3 py-2" style={{ borderColor: BORDER }}>
                <IconFile size={18} style={{ color: MUTED }} />
                <a href={`/api/v1/knowledge/articles/${id}/attachments/${att.id}/download`} className="min-w-0 flex-1 truncate text-sm hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                  {att.originalName}
                </a>
                <span className="font-mono text-xs" style={{ color: MUTED }}>{fmtSize(att.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
