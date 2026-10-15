import { useEffect, useRef, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import RichTextEditor from '../../components/RichTextEditor';
import SettingsPage from '../../components/settings/SettingsPage';

// Settings → Email templates (spec 5a). Each email PRISM sends has a
// default; saving creates an override, Reset goes back to the default. The
// server sanitizes bodies on save and renders the preview.
const AUDIENCE = { contact: 'To customers', staff: 'To staff' };

export default function EmailTemplates() {
  const [templates, setTemplates] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null); // { subject, bodyHtml, enabled }
  const [detail, setDetail] = useState(null); // the loaded template + placeholders
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const editorRef = useRef(null);
  const subjectRef = useRef(null);
  const lastFocus = useRef('body');

  const loadList = () => api.get('/settings/email-templates')
    .then(({ data }) => setTemplates(data.templates))
    .catch((err) => setError(errMessage(err)));
  useEffect(() => { loadList(); }, []);

  const open = async (key) => {
    setError(''); setNotice(''); setPreview(null);
    try {
      const { data } = await api.get(`/settings/email-templates/${key}`);
      setSelected(key);
      setDetail(data.template);
      setForm({ subject: data.template.subject, bodyHtml: data.template.bodyHtml, enabled: data.template.enabled });
    } catch (err) {
      setError(errMessage(err));
    }
  };

  // Live preview, a moment after the last keystroke.
  useEffect(() => {
    if (!selected || !form) return undefined;
    const t = setTimeout(() => {
      api.post(`/settings/email-templates/${selected}/preview`, { subject: form.subject || ' ', bodyHtml: form.bodyHtml || '' })
        .then(({ data }) => setPreview(data))
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [selected, form?.subject, form?.bodyHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (name) => {
    const token = `{{${name}}}`;
    if (lastFocus.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? form.subject.length;
      const end = el.selectionEnd ?? start;
      const subject = form.subject.slice(0, start) + token + form.subject.slice(end);
      setForm((f) => ({ ...f, subject }));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
      return;
    }
    editorRef.current?.chain().focus().insertContent(token).run();
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const { data } = await api.put(`/settings/email-templates/${selected}`, form);
      setDetail(data.template);
      setForm({ subject: data.template.subject, bodyHtml: data.template.bodyHtml, enabled: data.template.enabled });
      setNotice('Saved');
      loadList();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Go back to the default text for this email? Your changes to it will be lost.')) return;
    setError(''); setNotice('');
    try {
      const { data } = await api.delete(`/settings/email-templates/${selected}`);
      setDetail(data.template);
      setForm({ subject: data.template.subject, bodyHtml: data.template.bodyHtml, enabled: data.template.enabled });
      setNotice('Back to the default');
      loadList();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  if (!templates) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  return (
    <SettingsPage description="What PRISM's emails say. Click a placeholder to insert it; it is filled in when the email is sent.">
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav className="card divide-y divide-navy-100 self-start" aria-label="Email templates">
          {['contact', 'staff'].map((aud) => (
            <div key={aud} className="p-2">
              <p className="eyebrow px-2 py-1">{AUDIENCE[aud]}</p>
              {templates.filter((t) => t.audience === aud).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => open(t.key)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${selected === t.key ? 'bg-navy-100 font-medium' : 'hover:bg-navy-50'}`}
                >
                  <span className="min-w-0 truncate">{t.name}</span>
                  <span className="flex-shrink-0 text-xs text-navy-500">
                    {!t.enabled ? 'Off' : (t.isDefault ? '' : 'Edited')}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {!selected || !form ? (
          <div className="card p-6 text-sm text-navy-500">Pick an email on the left to edit it.</div>
        ) : (
          <form onSubmit={save} className="card min-w-0 space-y-4 p-4" aria-label={`Edit ${detail.name}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy-900">{detail.name}</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-navy-300 text-prism"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                Send this email
              </label>
            </div>
            <label className="block text-sm font-medium text-navy-700">
              Subject
              <input
                ref={subjectRef}
                className="input mt-1"
                value={form.subject}
                maxLength={255}
                onFocus={() => { lastFocus.current = 'subject'; }}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              />
            </label>
            <div>
              <p className="mb-1 text-sm font-medium text-navy-700">Placeholders</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.placeholders.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.description}
                    onClick={() => insert(p.name)}
                    className="rounded border border-navy-200 bg-navy-50 px-2 py-0.5 font-mono text-xs text-navy-700 hover:bg-navy-100"
                  >
                    {`{{${p.name}}}`}
                  </button>
                ))}
              </div>
            </div>
            <div onFocus={() => { lastFocus.current = 'body'; }}>
              <p className="mb-1 text-sm font-medium text-navy-700">Body</p>
              <RichTextEditor
                value={form.bodyHtml}
                onChange={(bodyHtml) => setForm((f) => ({ ...f, bodyHtml }))}
                onReady={(ed) => { editorRef.current = ed; }}
              />
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-navy-700">Preview <span className="font-normal text-navy-500">(sample ticket)</span></p>
              {preview?.unknownPlaceholders?.length > 0 && (
                <p className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-800">
                  Not a placeholder for this email, so it will be blank: {preview.unknownPlaceholders.map((n) => `{{${n}}}`).join(', ')}
                </p>
              )}
              {preview ? (
                <>
                  <p className="mb-1 truncate text-sm"><span className="text-navy-500">Subject:</span> {preview.subject}</p>
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={preview.html}
                    className="h-96 w-full rounded border border-navy-200 bg-white"
                  />
                </>
              ) : <p className="text-sm text-navy-500">…</p>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {notice && <span role="status" className="text-sm" style={{ color: 'var(--color-success)' }}>{notice}</span>}
              {!detail.isDefault && <button type="button" className="btn-secondary" onClick={reset}>Reset to default</button>}
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </div>
    </SettingsPage>
  );
}
