import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  IconPaperclip, IconTrash, IconUpload, IconFile, IconDeviceFloppy,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Notice from '../components/ui/Notice';
import RichTextEditor from '../components/RichTextEditor';
import AudienceFieldset from '../components/portal/AudienceFieldset';

const MUTED = 'var(--color-text-muted)';
const BORDER = 'var(--color-border)';

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ArticleEditor() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [loading, setLoading] = useState(isEdit);
  const [title, setTitle] = useState('');
  const [savedTitle, setSavedTitle] = useState(''); // for the breadcrumb
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('draft');
  const [visibility, setVisibility] = useState('internal');
  const [audience, setAudience] = useState({ scope: 'all', companyIds: [], departmentIds: [] });
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/knowledge/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
  }, []);

  const loadArticle = useCallback(() => {
    if (!isEdit) return;
    setLoading(true);
    api.get(`/knowledge/articles/${id}`)
      .then(({ data }) => {
        const a = data.article;
        setTitle(a.title); setSavedTitle(a.title); setCategoryId(a.categoryId ? String(a.categoryId) : '');
        setStatus(a.status); setVisibility(a.visibility); setBody(a.body || '');
        setAudience({ scope: a.portalScope || 'all', companyIds: a.audience?.companyIds || [], departmentIds: a.audience?.departmentIds || [] });
        setAttachments(a.attachments || []);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  useEffect(() => { loadArticle(); }, [loadArticle]);

  const save = async () => {
    if (!title.trim()) { setError('A title is required.'); return; }
    setSaving(true); setError('');
    const payload = {
      title, body, categoryId: categoryId || null, status, visibility,
      ...(visibility === 'portal' ? {
        portalScope: audience.scope,
        audience: { companyIds: audience.companyIds, departmentIds: audience.departmentIds },
      } : {}),
    };
    try {
      if (isEdit) {
        await api.patch(`/knowledge/articles/${id}`, payload);
        setSaved(true); setTimeout(() => setSaved(false), 2000);
      } else {
        const { data } = await api.post('/knowledge/articles', payload);
        // Go to edit mode so attachments can be added to the now-persisted article.
        navigate(`/knowledge/${data.article.id}/edit`, { replace: true });
      }
    } catch (err) { setError(errMessage(err)); } finally { setSaving(false); }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isEdit) return;
    setUploading(true); setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/knowledge/articles/${id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAttachments((prev) => [...prev, data.attachment]);
    } catch (err) { setError(errMessage(err)); } finally { setUploading(false); }
  };

  const removeAttachment = async (att) => {
    if (!window.confirm(`Remove "${att.originalName}"?`)) return;
    try {
      await api.delete(`/knowledge/articles/${id}/attachments/${att.id}`);
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    } catch (err) { alert(errMessage(err)); }
  };

  const remove = async () => {
    if (!window.confirm('Delete this article permanently?')) return;
    try { await api.delete(`/knowledge/articles/${id}`); navigate('/knowledge'); }
    catch (err) { alert(errMessage(err)); }
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          className="min-w-0 flex-1"
          items={isEdit
            ? [{ label: 'Knowledge Base', to: '/knowledge' }, { label: savedTitle || 'Article', to: `/knowledge/${id}` }, { label: 'Edit' }]
            : [{ label: 'Knowledge Base', to: '/knowledge' }, { label: 'New article' }]}
        />
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>Saved</span>}
          {isEdit && <button type="button" onClick={remove} className="btn-danger text-sm"><IconTrash size={15} /> Delete</button>}
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm">
            <IconDeviceFloppy size={16} /> {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create article')}
          </button>
        </div>
      </div>

      <div>
        <p className="eyebrow">{isEdit ? 'Edit article' : 'New article'}</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Article title"
          aria-label="Article title"
          className="mt-1 w-full border-0 border-b border-navy-100 bg-transparent px-0 pb-3 text-3xl font-semibold tracking-tight outline-none placeholder:font-normal focus:border-[var(--color-accent)]"
          style={{ color: 'var(--color-text-primary)' }}
        />
      </div>

      {error && (
        <Notice tone="bad">{error}</Notice>
      )}

      {/* Meta row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
            <option value="">Uncategorized</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div>
          <label htmlFor="article-audience" className="label">Audience</label>
          <select id="article-audience" value={visibility} onChange={(e) => setVisibility(e.target.value)} className="input">
            <option value="internal">Agents only</option>
            <option value="portal">Portal</option>
          </select>
        </div>
      </div>
      {visibility === 'portal' ? (
        <p className="text-xs" style={{ color: status === 'published' ? 'var(--color-text-muted)' : 'var(--color-warning)' }}>
          {status === 'published'
            ? 'Agents can always see this here. Contacts can also read it in the client portal.'
            : 'Agents can see this here now. Contacts see it in the client portal once its status is Published.'}
        </p>
      ) : (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Visible to agents only — not shown in the client portal.</p>
      )}
      {visibility === 'portal' && <AudienceFieldset value={audience} onChange={setAudience} />}

      {/* Body editor */}
      <div>
        <label className="label">Content</label>
        <RichTextEditor value={body} onChange={setBody} />
      </div>

      {/* Attachments */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow flex items-center gap-1.5"><IconPaperclip size={13} /> Attachments</h2>
          {isEdit && (
            <>
              <input ref={fileInput} type="file" className="hidden" onChange={onPickFile} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="btn-secondary text-xs">
                <IconUpload size={14} /> {uploading ? 'Uploading…' : 'Upload file'}
              </button>
            </>
          )}
        </div>
        {!isEdit ? (
          <p className="text-sm" style={{ color: MUTED }}>Create the article first, then you can attach PDFs, Word docs, and other files.</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>No attachments. Upload how-to PDFs, Word docs, spreadsheets, or images.</p>
        ) : (
          <ul className="space-y-1.5">
            {attachments.map((att) => (
              <li key={att.id} className="flex items-center gap-3 rounded-md border px-3 py-2" style={{ borderColor: BORDER }}>
                <IconFile size={18} style={{ color: MUTED }} />
                <a href={`/api/v1/knowledge/articles/${id}/attachments/${att.id}/download`} className="min-w-0 flex-1 truncate text-sm hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                  {att.originalName}
                </a>
                <span className="num text-xs" style={{ color: MUTED }}>{fmtSize(att.size)}</span>
                <button type="button" onClick={() => removeAttachment(att)} title="Remove" style={{ color: 'var(--color-danger)' }}><IconTrash size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
