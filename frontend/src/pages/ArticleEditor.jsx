import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  IconArrowLeft, IconPaperclip, IconTrash, IconUpload, IconFile, IconDeviceFloppy,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';
import RichTextEditor from '../components/RichTextEditor';

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
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('draft');
  const [visibility, setVisibility] = useState('internal');
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
        setTitle(a.title); setCategoryId(a.categoryId ? String(a.categoryId) : '');
        setStatus(a.status); setVisibility(a.visibility); setBody(a.body || '');
        setAttachments(a.attachments || []);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  useEffect(() => { loadArticle(); }, [loadArticle]);

  const save = async () => {
    if (!title.trim()) { setError('A title is required.'); return; }
    setSaving(true); setError('');
    const payload = { title, body, categoryId: categoryId || null, status, visibility };
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
      <div className="flex items-center justify-between gap-3">
        <Link to={isEdit ? `/knowledge/${id}` : '/knowledge'} className="flex items-center gap-1.5 text-sm" style={{ color: MUTED }}>
          <IconArrowLeft size={16} /> {isEdit ? 'Back to article' : 'Back to Knowledge Base'}
        </Link>
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
          className="mt-1 w-full border-none bg-transparent p-0 text-2xl font-bold tracking-tight outline-none placeholder:font-normal"
          style={{ color: 'var(--color-text-primary)' }}
        />
      </div>

      {error && (
        <div className="rounded-md p-3 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}>{error}</div>
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
          <label className="label">Audience</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="input">
            <option value="internal">Agents only</option>
            <option value="public">End users</option>
          </select>
        </div>
      </div>
      {visibility === 'public' ? (
        <p className="text-xs" style={{ color: status === 'published' ? 'var(--color-text-muted)' : 'var(--color-warning)' }}>
          {status === 'published'
            ? 'Agents can always see this here. It’s also visible to end users in the end-user portal.'
            : 'Agents can see this here now. It appears in the end-user portal once its status is Published.'}
        </p>
      ) : (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Visible to agents only — not shown in the end-user portal.</p>
      )}

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
                <span className="font-mono text-xs" style={{ color: MUTED }}>{fmtSize(att.size)}</span>
                <button type="button" onClick={() => removeAttachment(att)} title="Remove" style={{ color: 'var(--color-danger)' }}><IconTrash size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
