import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { IconFile } from '@tabler/icons-react';
import portalApi, { errMessage } from '../api';
import {
  ticketNo, statusTone, fmtDateTime, fmtSize, uploadFiles,
} from '../format';
import { useNarrow } from '../../hooks/useNarrow';
import FilePicker from '../FilePicker';
import PageHeader from '../../components/ui/PageHeader';
import StatusChip from '../../components/ui/StatusChip';
import Notice from '../../components/ui/Notice';

const PRIORITIES = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const SIDE = { you: 'You', contact: '', support: 'Service desk' };
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

function Files({ ticketId, files }) {
  if (!files?.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {files.map((f) => (
        <li key={f.id} className="flex min-w-0 items-center gap-2 text-sm">
          <IconFile size={16} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
          <a href={`/api/v1/portal/tickets/${ticketId}/attachments/${f.id}/download`} className="min-w-0 truncate hover:underline" style={{ color: 'var(--color-accent)' }}>{f.originalName}</a>
          <span className="num flex-shrink-0 text-xs" style={{ color: 'var(--color-text-muted)' }}>{fmtSize(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}

function Message({
  name, side, note, at, body, files, ticketId,
}) {
  const support = side === 'support';
  return (
    <div className="flex min-w-0 gap-3">
      <span aria-hidden="true" className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold sm:flex" style={support ? { backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg)' } : { backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{initials(name)}</span>
      <div className="card min-w-0 flex-1 px-4 py-3" style={support ? { backgroundColor: 'var(--color-accent-soft)' } : undefined}>
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          <b style={{ color: 'var(--color-text-primary)' }}>{name}</b>
          {(SIDE[side] || note) && <span>{[SIDE[side], note].filter(Boolean).join(' · ')}</span>}
          <span>· {fmtDateTime(at)}</span>
        </div>
        {body && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--color-text-primary)' }}>{body}</p>}
        <Files ticketId={ticketId} files={files} />
      </div>
    </div>
  );
}

// On a phone the reply box is one line until tapped (as on the staff ticket
// page); on a desk it is always open.
function ReplyForm({ ticket, onSent }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const area = useRef(null);
  const expanded = !narrow || open;
  useEffect(() => { if (narrow && open) area.current?.focus(); }, [narrow, open]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await portalApi.post(`/tickets/${ticket.id}/replies`, { body: text });
      const failed = files.length ? await uploadFiles(portalApi, ticket.id, files, data.comment.id) : [];
      setText(''); setFiles([]); setOpen(false);
      if (failed.length) setError(`Your reply was sent, but some files weren't: ${failed.join('; ')}`);
      await onSent();
    } catch (err) {
      setError(errMessage(err, 'Could not send your reply.'));
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <div className="card p-3">
        {error && <Notice tone="bad" className="mb-2">{error}</Notice>}
        <button type="button" aria-expanded="false" aria-label="Reply" onClick={() => setOpen(true)} className="input flex h-11 w-full items-center text-left text-sm" style={{ color: 'var(--color-text-faint)' }}>
          Add details or answer the help desk…
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={send} className="card flex flex-col gap-3 p-4">
      <label htmlFor="portal-reply" className="text-[13.5px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>Reply</label>
      {ticket.statusBehavior === 'closed' && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>This ticket is closed. Your reply goes to the help desk, who decide whether to reopen it.</p>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <textarea id="portal-reply" ref={area} className="input min-h-[110px] py-2.5" placeholder="Add details or answer the help desk…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilePicker files={files} onChange={setFiles} compact />
        <button type="submit" disabled={busy || !text.trim()} className="btn-primary h-11 sm:h-10">{busy ? 'Sending…' : 'Send reply'}</button>
      </div>
    </form>
  );
}

// Mockup Ticket: the conversation (description first, then replies), the
// reply box, and a details card. No editing, closing or reopening.
export default function Ticket() {
  const { id } = useParams();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const failedUploads = location.state?.failedUploads;

  const load = useCallback(async () => {
    try {
      const { data: d } = await portalApi.get(`/tickets/${id}`);
      setData(d);
    } catch {
      setMissing(true);
    }
  }, [id]);
  useEffect(() => { setData(null); setMissing(false); load(); }, [load]);

  if (missing) {
    return (
      <div className="card mx-auto max-w-lg p-10 text-center">
        <h1 className="text-lg font-semibold">Ticket not found</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>It may not be one you can see.</p>
        <Link to="/portal/tickets" className="btn-primary mt-4 inline-flex">Back to tickets</Link>
      </div>
    );
  }
  if (!data) return <p className="py-16 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>;

  const { ticket, comments, attachments } = data;
  const details = [
    ['Status', ticket.status],
    ['For', ticket.contact?.displayName],
    ['Opened', fmtDateTime(ticket.createdAt)],
    ['Category', ticket.category ? ticket.category.path.join(' › ') : null],
    ['Priority', PRIORITIES[ticket.priority] || ticket.priority],
    ['Handled by', ticket.handledBy],
  ].filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={[{ label: 'Tickets', to: '/portal/tickets' }, { label: ticketNo(ticket.id), id: true }]}
        title={ticket.title}
        sub={<span className="flex items-center gap-2"><span className="num font-semibold">{ticketNo(ticket.id)}</span><StatusChip tone={statusTone(ticket.statusBehavior)}>{ticket.status}</StatusChip></span>}
      />
      {failedUploads?.length > 0 && <Notice tone="warn">Your ticket was created, but some files weren&apos;t attached: {failedUploads.join('; ')}</Notice>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Conversation" className="flex min-w-0 flex-col gap-3">
          <Message name={ticket.contact?.displayName} side="contact" note="opened this ticket" at={ticket.createdAt} body={ticket.description} files={attachments} ticketId={ticket.id} />
          {comments.map((c) => (
            <Message key={c.id} name={c.author.displayName} side={c.author.side} at={c.createdAt} body={c.body} files={c.attachments} ticketId={ticket.id} />
          ))}
          <ReplyForm ticket={ticket} onSent={load} />
        </section>
        <aside aria-label="Ticket details" className="card h-fit p-5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt style={{ color: 'var(--color-text-muted)' }}>{k}</dt>
                <dd className="min-w-0 break-words" style={{ color: 'var(--color-text-primary)' }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>Replies here or to our emails both land on this ticket.</p>
        </aside>
      </div>
    </div>
  );
}
