import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import portalApi, { errMessage } from '../api';
import { usePortalAuth } from '../PortalAuth';
import { uploadFiles } from '../format';
import FilePicker from '../FilePicker';
import PageHeader from '../../components/ui/PageHeader';
import Notice from '../../components/ui/Notice';

const PRIORITIES = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const Optional = () => <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>optional</span>;

// Mockup TicketNew: title and description required; files, For (admins),
// category and priority optional.
export default function TicketNew() {
  const { me } = usePortalAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState({ categories: [], priorities: [], forContacts: [] });
  const [form, setForm] = useState({
    title: '', description: '', categoryId: '', priority: '', forContactId: '',
  });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { portalApi.get('/meta').then(({ data }) => setMeta(data)).catch(() => {}); }, []);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const others = meta.forContacts.filter((c) => c.id !== me?.id);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await portalApi.post('/tickets', {
        title: form.title,
        description: form.description,
        ...(form.categoryId ? { categoryId: Number(form.categoryId) } : {}),
        ...(form.priority ? { priority: form.priority } : {}),
        ...(form.forContactId ? { forContactId: Number(form.forContactId) } : {}),
      });
      const failed = files.length ? await uploadFiles(portalApi, data.ticket.id, files) : [];
      navigate(`/portal/tickets/${data.ticket.id}`, { state: failed.length ? { failedUploads: failed } : undefined });
    } catch (err) {
      setError(errMessage(err, 'Could not create the ticket.'));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <PageHeader title="New ticket" crumbs={[{ label: 'Tickets', to: '/portal/tickets' }, { label: 'New ticket' }]} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card flex min-w-0 flex-col gap-4 p-5">
            <div>
              <label htmlFor="nt-title" className="label">Title <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span></label>
              <input id="nt-title" className="input h-11" required maxLength={255} placeholder="A few words about the problem" value={form.title} onChange={set('title')} />
            </div>
            <div>
              <label htmlFor="nt-desc" className="label">Description <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span></label>
              <textarea id="nt-desc" className="input min-h-[160px] py-2.5" required value={form.description} onChange={set('description')} placeholder="What happened, and what have you tried?" />
            </div>
            <div>
              <span className="label">Attachments<Optional /></span>
              <FilePicker files={files} onChange={setFiles} />
            </div>
          </div>
          <div className="card flex min-w-0 flex-col gap-4 p-5">
            {others.length > 0 && (
              <div>
                <label htmlFor="nt-for" className="label">For<Optional /></label>
                <select id="nt-for" className="input h-11" value={form.forContactId} onChange={set('forContactId')}>
                  <option value="">{`Me (${me?.displayName || 'myself'})`}</option>
                  {others.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                </select>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>You can raise tickets for the people you look after.</p>
              </div>
            )}
            <div>
              <label htmlFor="nt-cat" className="label">Category<Optional /></label>
              <select id="nt-cat" className="input h-11" value={form.categoryId} onChange={set('categoryId')}>
                <option value="">Not sure</option>
                {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.path.join(' › ')}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="nt-pri" className="label">Priority<Optional /></label>
              <select id="nt-pri" className="input h-11" value={form.priority} onChange={set('priority')}>
                <option value="">Not sure</option>
                {meta.priorities.map((p) => <option key={p} value={p}>{PRIORITIES[p] || p}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/portal/tickets" className="btn-secondary h-11">Cancel</Link>
          <button type="submit" disabled={busy} className="btn-primary h-11">{busy ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </form>
    </div>
  );
}
