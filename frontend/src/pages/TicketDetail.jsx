import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { useTimer } from '../context/TimerContext';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import TimerButton from '../components/TimerButton';
import { formatTicketId } from '../utils/ticketId';

const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['incident', 'request', 'problem', 'task', 'change'];

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function TicketDetail() {
  const { id } = useParams();
  const { user, isStaff, isAdmin } = useAuth();
  const { logVersion } = useTimer();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [time, setTime] = useState({ entries: [], totalMinutes: 0 });
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editInfo, setEditInfo] = useState(null); // { title, description } when editing
  const [newComment, setNewComment] = useState('');
  const [timeForm, setTimeForm] = useState({ minutes: '', note: '', date: '' });
  const [relations, setRelations] = useState([]);
  const [allTickets, setAllTickets] = useState([]);
  const [relForm, setRelForm] = useState({ relatedTicketId: '', relationType: 'related' });
  const [teams, setTeams] = useState([]);
  const [csatForm, setCsatForm] = useState({ rating: '', comment: '' });
  const [customFields, setCustomFields] = useState([]);
  const [cfValues, setCfValues] = useState({}); // { customFieldId: value }
  const [savingFields, setSavingFields] = useState(false);
  const fileRef = useRef();

  const load = async () => {
    try {
      const [t, c, a, tm, rel] = await Promise.all([
        api.get(`/tickets/${id}`),
        api.get(`/tickets/${id}/comments`),
        api.get(`/tickets/${id}/attachments`),
        api.get(`/tickets/${id}/time`),
        api.get(`/tickets/${id}/relations`),
      ]);
      setTicket(t.data.ticket);
      setComments(c.data.comments);
      setAttachments(a.data.attachments);
      setTime(tm.data);
      setRelations(rel.data.relations);
      // Seed admin custom field values from the ticket.
      const seeded = {};
      (t.data.ticket.fieldValues || []).forEach((fv) => { seeded[fv.customFieldId] = fv.value; });
      setCfValues(seeded);
      api.get('/custom-fields').then(({ data }) => setCustomFields(data.customFields)).catch(() => {});
      if (isStaff) {
        api.get('/users/assignable').then(({ data }) => setUsers(data.users)).catch(() => {});
        api.get('/tickets').then(({ data }) => setAllTickets(data.tickets)).catch(() => {});
        api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
        api.get('/projects').then(({ data }) => setProjects(data.projects)).catch(() => {});
        api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const addRelation = async (e) => {
    e.preventDefault();
    if (!relForm.relatedTicketId) return;
    try {
      const { data } = await api.post(`/tickets/${id}/relations`, relForm);
      setRelations((r) => [data.relation, ...r]);
      setRelForm({ relatedTicketId: '', relationType: 'related' });
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const removeRelation = async (relationId) => {
    try {
      await api.delete(`/tickets/${id}/relations/${relationId}`);
      setRelations((r) => r.filter((x) => x.id !== relationId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const submitCsat = async (rating) => {
    try {
      const { data } = await api.post(`/tickets/${id}/csat`, { rating, comment: csatForm.comment });
      setTicket((t) => ({ ...t, csat: data.csat }));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveFields = async (applicable) => {
    setSavingFields(true);
    try {
      const fieldValues = applicable.map((cf) => ({ customFieldId: cf.id, value: cfValues[cf.id] ?? '' }));
      const { data } = await api.patch(`/tickets/${id}`, { fieldValues });
      setTicket(data.ticket);
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSavingFields(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patchTicket = async (changes) => {
    try {
      const { data } = await api.patch(`/tickets/${id}`, changes);
      setTicket(data.ticket);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveInfo = async (e) => {
    e.preventDefault();
    if (!editInfo.title.trim()) return;
    try {
      const { data } = await api.patch(`/tickets/${id}`, {
        title: editInfo.title,
        description: editInfo.description,
      });
      setTicket(data.ticket);
      setEditInfo(null);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const { data } = await api.post(`/tickets/${id}/comments`, { body: newComment });
      setComments((c) => [...c, data.comment]);
      setNewComment('');
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteComment = async (commentId) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.delete(`/tickets/${id}/comments/${commentId}`);
      setComments((c) => c.filter((x) => x.id !== commentId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const uploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/tickets/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachments((a) => [data.attachment, ...a]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteAttachment = async (attId) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/tickets/${id}/attachments/${attId}`);
      setAttachments((a) => a.filter((x) => x.id !== attId));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const addTime = async (e) => {
    e.preventDefault();
    const minutes = parseInt(timeForm.minutes, 10);
    if (!minutes) return;
    try {
      // Backfill: if a date is chosen, log against noon that day; else now.
      const loggedAt = timeForm.date ? new Date(`${timeForm.date}T12:00:00`).toISOString() : undefined;
      const { data } = await api.post(`/tickets/${id}/time`, { minutes, note: timeForm.note, loggedAt });
      setTime((t) => ({
        entries: [data.entry, ...t.entries],
        totalMinutes: t.totalMinutes + data.entry.minutes,
      }));
      setTimeForm({ minutes: '', note: '', date: '' });
    } catch (err) {
      alert(errMessage(err));
    }
  };

  // Refresh the time log whenever the global timer logs an entry.
  useEffect(() => {
    if (logVersion === 0) return;
    api.get(`/tickets/${id}/time`).then(({ data }) => setTime(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logVersion]);

  const deleteTime = async (entryId, minutes) => {
    try {
      await api.delete(`/tickets/${id}/time/${entryId}`);
      setTime((t) => ({
        entries: t.entries.filter((x) => x.id !== entryId),
        totalMinutes: t.totalMinutes - minutes,
      }));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteTicket = async () => {
    if (!confirm('Delete this ticket permanently?')) return;
    try {
      await api.delete(`/tickets/${id}`);
      navigate('/tickets');
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const downloadUrl = (att) => `/api/v1/tickets/${id}/attachments/${att.id}/download`;

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!ticket) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/tickets" className="text-sm text-prism hover:underline">← Back to tickets</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold text-navy-900">
            <span>
              <span className="font-mono text-navy-400">{formatTicketId(ticket)}</span> {ticket.title}
            </span>
            <span className="badge bg-prism/10 text-prism" title="Total time logged">
              ⏱ {formatMinutes(time.totalMinutes)}
            </span>
          </h1>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* Prominent timer at the top so technicians actually start it. */}
          {isStaff && (
            <TimerButton type="ticket" id={ticket.id} label={`${formatTicketId(ticket)} ${ticket.title}`} className="px-3 py-2 text-sm" />
          )}
          {isAdmin && <button onClick={deleteTicket} className="btn-danger">Delete</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">Description</h2>
              {isStaff && editInfo === null && (
                <button
                  onClick={() => setEditInfo({ title: ticket.title, description: ticket.description || '' })}
                  className="text-xs text-prism hover:underline"
                >
                  edit
                </button>
              )}
            </div>
            {editInfo ? (
              <form onSubmit={saveInfo} className="space-y-3">
                <div>
                  <label className="label">Title</label>
                  <input
                    className="input"
                    value={editInfo.title}
                    onChange={(e) => setEditInfo((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea
                    className="input min-h-[8rem]"
                    value={editInfo.description}
                    onChange={(e) => setEditInfo((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button type="button" className="btn-secondary" onClick={() => setEditInfo(null)}>Cancel</button>
                  <button type="submit" className="btn-primary">Save</button>
                </div>
              </form>
            ) : (
              <p className="whitespace-pre-wrap text-navy-800">{ticket.description || 'No description provided.'}</p>
            )}
          </div>

          {/* Custom fields (from blueprint) */}
          {Array.isArray(ticket.customFields) && ticket.customFields.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">Details</h2>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ticket.customFields.map((cf, i) => (
                  <div key={i}>
                    <dt className="text-xs font-medium text-navy-400">{cf.label}</dt>
                    <dd className="text-sm text-navy-800">
                      {cf.type === 'checkbox'
                        ? (cf.value ? 'Yes' : 'No')
                        : (cf.value === '' || cf.value === null || cf.value === undefined ? '—' : String(cf.value))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Customer satisfaction (CSAT) */}
          <CsatCard
            ticket={ticket}
            csat={ticket.csat}
            isOwner={user.id === ticket.requesterId}
            isAdmin={isAdmin}
            csatForm={csatForm}
            setCsatForm={setCsatForm}
            onSubmit={submitCsat}
          />

          {/* Admin-defined custom fields (Layouts & Fields) */}
          <AdditionalFieldsCard
            ticket={ticket}
            customFields={customFields}
            values={cfValues}
            setValues={setCfValues}
            canEdit={isStaff}
            saving={savingFields}
            onSave={saveFields}
          />

          {/* Related tickets */}
          <div className="card">
            <div className="border-b border-navy-100 px-5 py-3">
              <h2 className="font-semibold text-navy-900">Related Tickets ({relations.length})</h2>
            </div>
            <ul className="divide-y divide-navy-100">
              {relations.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/tickets/${r.ticket?.id}`} className="font-medium text-navy-800 hover:text-prism">
                      {r.ticket ? formatTicketId(r.ticket) : ''} {r.ticket?.title}
                    </Link>
                    <p className="text-xs text-navy-400">
                      {r.direction === 'incoming' ? 'inbound' : 'outbound'} · {r.relationType.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {r.ticket && <Badge value={r.ticket.status} />}
                    {isStaff && (
                      <button onClick={() => removeRelation(r.id)} className="text-xs text-red-500 hover:underline">
                        unlink
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {relations.length === 0 && <li className="px-5 py-4 text-sm text-navy-400">No related tickets.</li>}
            </ul>
            {isStaff && (
              <form onSubmit={addRelation} className="flex flex-wrap gap-2 border-t border-navy-100 p-4">
                <select
                  className="input flex-1"
                  value={relForm.relatedTicketId}
                  onChange={(e) => setRelForm((f) => ({ ...f, relatedTicketId: e.target.value }))}
                >
                  <option value="">Select a ticket…</option>
                  {allTickets
                    .filter((t) => t.id !== ticket.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>{formatTicketId(t)} {t.title}</option>
                    ))}
                </select>
                <select
                  className="input w-40"
                  value={relForm.relationType}
                  onChange={(e) => setRelForm((f) => ({ ...f, relationType: e.target.value }))}
                >
                  <option value="related">related</option>
                  <option value="caused_by">caused by</option>
                  <option value="duplicates">duplicates</option>
                </select>
                <button type="submit" className="btn-primary">Link</button>
              </form>
            )}
          </div>

          {/* Comments */}
          <div className="card">
            <div className="border-b border-navy-100 px-5 py-3">
              <h2 className="font-semibold text-navy-900">Comments ({comments.length})</h2>
            </div>
            <ul className="divide-y divide-navy-100">
              {comments.map((c) => (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-navy-800">{c.author?.displayName}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-navy-400">{new Date(c.createdAt).toLocaleString()}</span>
                      {(c.authorId === user.id || isStaff) && (
                        <button onClick={() => deleteComment(c.id)} className="text-xs text-red-500 hover:underline">
                          delete
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-navy-700">{c.body}</p>
                </li>
              ))}
              {comments.length === 0 && <li className="px-5 py-4 text-sm text-navy-400">No comments yet.</li>}
            </ul>
            <form onSubmit={addComment} className="border-t border-navy-100 p-4">
              <textarea
                className="input min-h-[5rem]"
                placeholder="Add a comment…"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <button type="submit" className="btn-primary">Comment</button>
              </div>
            </form>
          </div>

          {/* Attachments */}
          <div className="card">
            <div className="flex items-center justify-between border-b border-navy-100 px-5 py-3">
              <h2 className="font-semibold text-navy-900">Attachments ({attachments.length})</h2>
              {isStaff && (
                <label className="btn-secondary cursor-pointer text-xs">
                  Upload
                  <input ref={fileRef} type="file" className="hidden" onChange={uploadFile} />
                </label>
              )}
            </div>
            <ul className="divide-y divide-navy-100">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <a href={downloadUrl(a)} className="font-medium text-prism hover:underline">
                      {a.originalName}
                    </a>
                    <p className="text-xs text-navy-400">
                      {(a.size / 1024).toFixed(1)} KB · {a.uploadedBy?.displayName || ''}
                    </p>
                  </div>
                  {isStaff && (
                    <button onClick={() => deleteAttachment(a.id)} className="text-xs text-red-500 hover:underline">
                      delete
                    </button>
                  )}
                </li>
              ))}
              {attachments.length === 0 && <li className="px-5 py-4 text-sm text-navy-400">No attachments.</li>}
            </ul>
          </div>
        </div>

        {/* Sidebar column */}
        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <Field label="Status">
              {isStaff ? (
                <select className="input" value={ticket.status} onChange={(e) => patchTicket({ status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              ) : (
                <Badge value={ticket.status} />
              )}
            </Field>
            <Field label="Priority">
              {isStaff ? (
                <select className="input" value={ticket.priority} onChange={(e) => patchTicket({ priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <Badge value={ticket.priority} />
              )}
            </Field>
            <Field label="Type">
              {isStaff ? (
                <select className="input" value={ticket.type} onChange={(e) => patchTicket({ type: e.target.value })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : (
                <Badge value={ticket.type} />
              )}
            </Field>
            <Field label="Requester">
              <span className="text-sm text-navy-800">{ticket.requester?.displayName || '—'}</span>
            </Field>
            <Field label="Assignee">
              {isStaff ? (
                <select
                  className="input"
                  value={ticket.assigneeId || ''}
                  onChange={(e) => patchTicket({ assigneeId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              ) : (
                <span className="text-sm text-navy-800">{ticket.assignee?.displayName || 'Unassigned'}</span>
              )}
            </Field>
            <Field label="Team">
              {isStaff ? (
                <select
                  className="input"
                  value={ticket.teamId || ''}
                  onChange={(e) => patchTicket({ teamId: e.target.value || null })}
                >
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : (
                <span className="text-sm text-navy-800">{ticket.team?.name || '—'}</span>
              )}
            </Field>
            <Field label="Project">
              {isStaff ? (
                <>
                  <select
                    className="input"
                    value={ticket.projectId || ''}
                    onChange={(e) => patchTicket({ projectId: e.target.value || null })}
                  >
                    <option value="">No project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {ticket.project && (
                    <Link to={`/projects/${ticket.project.id}`} className="mt-1 inline-block text-xs text-prism hover:underline">
                      open project →
                    </Link>
                  )}
                </>
              ) : ticket.project ? (
                <Link to={`/projects/${ticket.project.id}`} className="text-sm text-prism hover:underline">
                  {ticket.project.name}
                </Link>
              ) : (
                <span className="text-sm text-navy-400">—</span>
              )}
            </Field>
            <Field label="Department">
              {isStaff ? (
                <select
                  className="input"
                  value={ticket.departmentId || ''}
                  onChange={(e) => patchTicket({ departmentId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              ) : (
                <span className="text-sm text-navy-800">{ticket.department?.name || '—'}</span>
              )}
            </Field>
            <Field label="Due date">
              {isStaff ? (
                <input
                  type="date"
                  className="input"
                  value={ticket.dueDate || ''}
                  onChange={(e) => patchTicket({ dueDate: e.target.value || null })}
                />
              ) : (
                <span className="text-sm text-navy-800">{ticket.dueDate || '—'}</span>
              )}
            </Field>
          </div>

          {/* Time log */}
          <div className="card">
            <div className="flex items-center justify-between border-b border-navy-100 px-5 py-3">
              <h2 className="font-semibold text-navy-900">Time Log</h2>
              <div className="flex items-center gap-3">
                {isStaff && <TimerButton type="ticket" id={ticket.id} label={`${formatTicketId(ticket)} ${ticket.title}`} />}
                <span className="text-sm font-medium text-prism">{formatMinutes(time.totalMinutes)}</span>
              </div>
            </div>
            <ul className="divide-y divide-navy-100">
              {time.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <div>
                    <span className="font-medium text-navy-800">{formatMinutes(entry.minutes)}</span>
                    <span className="text-navy-500"> · {entry.user?.displayName}</span>
                    {entry.note && <p className="text-xs text-navy-400">{entry.note}</p>}
                  </div>
                  {(entry.userId === user.id || isAdmin) && (
                    <button onClick={() => deleteTime(entry.id, entry.minutes)} className="text-xs text-red-500 hover:underline">
                      delete
                    </button>
                  )}
                </li>
              ))}
              {time.entries.length === 0 && <li className="px-5 py-3 text-sm text-navy-400">No time logged.</li>}
            </ul>
            {isStaff && (
              <form onSubmit={addTime} className="flex flex-wrap gap-2 border-t border-navy-100 p-4">
                <input
                  type="number"
                  min="1"
                  placeholder="min"
                  className="input w-20"
                  value={timeForm.minutes}
                  onChange={(e) => setTimeForm((f) => ({ ...f, minutes: e.target.value }))}
                />
                <input
                  placeholder="note"
                  className="input min-w-[8rem] flex-1"
                  value={timeForm.note}
                  onChange={(e) => setTimeForm((f) => ({ ...f, note: e.target.value }))}
                />
                <input
                  type="date"
                  className="input w-40"
                  title="Date (optional — leave blank for today)"
                  value={timeForm.date}
                  onChange={(e) => setTimeForm((f) => ({ ...f, date: e.target.value }))}
                />
                <button type="submit" className="btn-primary">Log</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">{label}</p>
      {children}
    </div>
  );
}

// Admin-defined custom fields applicable to this ticket (by type + department).
function AdditionalFieldsCard({ ticket, customFields, values, setValues, canEdit, saving, onSave }) {
  const applicable = (customFields || []).filter(
    (cf) =>
      (!cf.ticketType || cf.ticketType === ticket.type) &&
      (!cf.departmentId || cf.departmentId === ticket.departmentId)
  );
  if (applicable.length === 0) return null;

  const set = (id, v) => setValues((prev) => ({ ...prev, [id]: v }));
  const renderInput = (cf) => {
    const v = values[cf.id] ?? '';
    if (!canEdit) {
      if (cf.fieldType === 'checkbox') return <span className="text-sm text-navy-800">{v === 'true' ? 'Yes' : 'No'}</span>;
      if (cf.fieldType === 'url' && v) return <a href={v} className="text-sm text-prism hover:underline">{v}</a>;
      return <span className="text-sm text-navy-800">{v || '—'}</span>;
    }
    switch (cf.fieldType) {
      case 'textarea': return <textarea className="input min-h-[4rem]" value={v} onChange={(e) => set(cf.id, e.target.value)} />;
      case 'number': return <input type="number" className="input" value={v} onChange={(e) => set(cf.id, e.target.value)} />;
      case 'date': return <input type="date" className="input" value={v} onChange={(e) => set(cf.id, e.target.value)} />;
      case 'url': return <input type="url" className="input" value={v} onChange={(e) => set(cf.id, e.target.value)} />;
      case 'select': return (
        <select className="input" value={v} onChange={(e) => set(cf.id, e.target.value)}>
          <option value="">Select…</option>
          {(cf.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      case 'checkbox': return (
        <input type="checkbox" checked={v === 'true'} onChange={(e) => set(cf.id, e.target.checked ? 'true' : '')}
          className="h-4 w-4 rounded border-navy-300 text-prism" />
      );
      default: return <input className="input" value={v} onChange={(e) => set(cf.id, e.target.value)} />;
    }
  };

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">Additional Fields</h2>
      <div className="space-y-3">
        {applicable.map((cf) => (
          <div key={cf.id}>
            <p className="mb-1 text-xs font-medium text-navy-400">{cf.name}{cf.required && <span className="text-red-500"> *</span>}</p>
            {renderInput(cf)}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button onClick={() => onSave(applicable)} className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save fields'}
          </button>
        </div>
      )}
    </div>
  );
}

const CSAT_EMOJI = { happy: '😀', neutral: '😐', unhappy: '☹️' };

// Shows a CSAT result if rated; otherwise lets the requester rate a
// resolved/closed ticket, or tells staff a rating is pending.
function CsatCard({ ticket, csat, isOwner, isAdmin, csatForm, setCsatForm, onSubmit }) {
  const closed = ticket.status === 'resolved' || ticket.status === 'closed';

  if (csat) {
    return (
      <div className="card p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-500">Customer Satisfaction</h2>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{CSAT_EMOJI[csat.rating]}</span>
          <div>
            <p className="font-medium capitalize text-navy-800">{csat.rating}</p>
            {csat.comment && <p className="text-sm text-navy-600">“{csat.comment}”</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!closed) return null;

  if (isOwner || isAdmin) {
    return (
      <div className="card p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-500">How was your experience?</h2>
        <div className="flex gap-3">
          {['happy', 'neutral', 'unhappy'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onSubmit(r)}
              className="flex flex-col items-center rounded-md border border-navy-200 px-5 py-3 transition hover:border-prism hover:bg-navy-50"
            >
              <span className="text-3xl">{CSAT_EMOJI[r]}</span>
              <span className="mt-1 text-xs capitalize text-navy-600">{r}</span>
            </button>
          ))}
        </div>
        <input
          className="input mt-3"
          placeholder="Optional comment"
          value={csatForm.comment}
          onChange={(e) => setCsatForm((f) => ({ ...f, comment: e.target.value }))}
        />
      </div>
    );
  }

  return (
    <div className="card p-5 text-sm text-navy-400">Awaiting customer satisfaction rating.</div>
  );
}
