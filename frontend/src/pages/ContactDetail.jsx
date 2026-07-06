import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAnyPermission, usePermission } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/Spinner';
import { formatTicketId } from '../utils/ticketId';

const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

const PRIORITY_META = {
  critical: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Deterministic accent color per department id, so a contact's avatar hints
// at their department at a glance (per the "colored by department" spec).
const DEPT_COLORS = ['var(--color-accent)', 'var(--color-relation-accent)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)'];
function deptColor(departmentId) {
  if (!departmentId) return MUTED;
  return DEPT_COLORS[departmentId % DEPT_COLORS.length];
}

function Avatar({ name, size = 32, color }) {
  if (!name) {
    return (
      <span className="flex flex-shrink-0 items-center justify-center rounded-full text-xs font-medium" style={{ width: size, height: size, backgroundColor: BORDER, color: MUTED }}>?</span>
    );
  }
  return (
    <span
      title={name}
      className="flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || BLUE, fontSize: size > 48 ? '1.25rem' : '0.75rem' }}
    >
      {initials(name)}
    </span>
  );
}

function StatusBadge({ status, statuses }) {
  const meta = statuses.find((s) => s.name === status);
  const color = meta?.color || MUTED;
  return (
    <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, color }}>
      {status}
    </span>
  );
}

function formatHours(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ==================== Left rail: contact list ====================
function ContactRail({ contacts, currentId, collapsed, onToggle }) {
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? contacts.filter((c) => c.displayName.toLowerCase().includes(search.trim().toLowerCase()))
    : contacts;

  if (collapsed) {
    return (
      <div className="flex w-11 flex-shrink-0 flex-col items-center border-r py-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
        <button type="button" onClick={onToggle} className="mb-3 text-sm" style={{ color: MUTED }} title="Expand contact list">›</button>
        {filtered.slice(0, 20).map((c) => (
          <Link key={c.id} to={`/contacts/${c.id}`} className="mb-2">
            <Avatar name={c.displayName} size={28} color={deptColor(c.departmentId)} />
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-64 flex-shrink-0 flex-col border-r" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: BORDER }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts…"
          className="input h-8 flex-1 text-sm"
          style={fieldStyle}
        />
        <button type="button" onClick={onToggle} className="flex-shrink-0 text-sm" style={{ color: MUTED }} title="Collapse">‹</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((c) => (
          <Link
            key={c.id}
            to={`/contacts/${c.id}`}
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm"
            style={{
              backgroundColor: c.id === Number(currentId) ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
              borderLeft: c.id === Number(currentId) ? `3px solid ${BLUE}` : '3px solid transparent',
            }}
          >
            <Avatar name={c.displayName} size={26} color={deptColor(c.departmentId)} />
            <div className="min-w-0">
              <p className="truncate font-medium" style={{ color: c.id === Number(currentId) ? BLUE : TEXT }}>{c.displayName}</p>
              <p className="truncate text-xs" style={{ color: MUTED }}>{c.department?.name || 'No department'}</p>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && <p className="px-3 py-4 text-sm" style={{ color: MUTED }}>No matches.</p>}
      </div>
    </div>
  );
}

// ==================== Center: properties panel ====================
function PropertiesPanel({ contact, departments, assignableUsers, canEdit, onSave, onAssignDepartment, onCreateTicket }) {
  const [name, setName] = useState(contact.displayName);
  const [editingName, setEditingName] = useState(false);
  const [fields, setFields] = useState({
    email: contact.email || '', phone: contact.phone || '', mobile: contact.mobile || '', jobTitle: contact.jobTitle || '',
  });
  const [notes, setNotes] = useState(contact.notes || '');
  const [notesSaved, setNotesSaved] = useState(true);
  const notesTimer = useRef(null);

  useEffect(() => {
    setName(contact.displayName);
    setFields({ email: contact.email || '', phone: contact.phone || '', mobile: contact.mobile || '', jobTitle: contact.jobTitle || '' });
    setNotes(contact.notes || '');
  }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveName = () => {
    setEditingName(false);
    if (name.trim() && name.trim() !== contact.displayName) onSave({ displayName: name.trim() });
  };

  const saveField = (key) => {
    if (fields[key] !== (contact[key] || '')) onSave({ [key]: fields[key] || null });
  };

  const handleNotesChange = (value) => {
    setNotes(value);
    setNotesSaved(false);
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      onSave({ notes: value || null });
      setNotesSaved(true);
    }, 800);
  };

  return (
    <div className="w-80 flex-shrink-0 space-y-5 overflow-y-auto border-r p-5" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={contact.displayName} size={72} color={deptColor(contact.departmentId)} />
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(contact.displayName); setEditingName(false); } }}
            className="input mt-3 text-center text-lg font-bold"
            style={fieldStyle}
          />
        ) : (
          <h2
            className={canEdit ? 'mt-3 cursor-pointer text-lg font-bold hover:opacity-80' : 'mt-3 text-lg font-bold'}
            style={{ color: TEXT }}
            onClick={() => canEdit && setEditingName(true)}
            title={canEdit ? 'Click to rename' : undefined}
          >
            {contact.displayName}
          </h2>
        )}
        <div className="mt-2">
          <select
            value={contact.departmentId || ''}
            onChange={(e) => onAssignDepartment(e.target.value)}
            disabled={!canEdit}
            className="rounded-full border-0 px-3 py-1 text-xs font-medium disabled:cursor-default"
            style={{ backgroundColor: contact.department ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : BORDER, color: contact.department ? BLUE : MUTED }}
          >
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Assigned to</label>
        <select
          value={contact.assignedTo || ''}
          onChange={(e) => onSave({ assignedTo: e.target.value || null })}
          disabled={!canEdit}
          className="input h-9 w-full text-sm"
          style={fieldStyle}
        >
          <option value="">Unassigned</option>
          {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      </div>

      <div className="space-y-3 border-t pt-4" style={{ borderColor: BORDER }}>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Contact details</p>
        <div>
          <label className="mb-1 block text-xs" style={{ color: MUTED }}>Email</label>
          <input disabled={!canEdit} className="input h-9 text-sm" style={fieldStyle} value={fields.email} onChange={(e) => setFields((f) => ({ ...f, email: e.target.value }))} onBlur={() => saveField('email')} />
        </div>
        <div>
          <label className="mb-1 block text-xs" style={{ color: MUTED }}>Phone</label>
          <input disabled={!canEdit} className="input h-9 text-sm" style={fieldStyle} value={fields.phone} onChange={(e) => setFields((f) => ({ ...f, phone: e.target.value }))} onBlur={() => saveField('phone')} />
        </div>
        <div>
          <label className="mb-1 block text-xs" style={{ color: MUTED }}>Mobile</label>
          <input disabled={!canEdit} className="input h-9 text-sm" style={fieldStyle} value={fields.mobile} onChange={(e) => setFields((f) => ({ ...f, mobile: e.target.value }))} onBlur={() => saveField('mobile')} />
        </div>
        <div>
          <label className="mb-1 block text-xs" style={{ color: MUTED }}>Job title</label>
          <input disabled={!canEdit} className="input h-9 text-sm" style={fieldStyle} value={fields.jobTitle} onChange={(e) => setFields((f) => ({ ...f, jobTitle: e.target.value }))} onBlur={() => saveField('jobTitle')} />
        </div>
      </div>

      <div className="border-t pt-4" style={{ borderColor: BORDER }}>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Notes</label>
          <span className="text-xs" style={{ color: MUTED }}>{notesSaved ? 'Saved' : 'Saving…'}</span>
        </div>
        <textarea
          disabled={!canEdit}
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          className="input resize-y text-sm"
          style={{ ...fieldStyle, minHeight: '90px' }}
        />
      </div>

      <div className="space-y-1 border-t pt-4 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
        <p>Created {contact.createdAt ? contact.createdAt.slice(0, 10) : '—'}</p>
        <p>Last updated {contact.updatedAt ? contact.updatedAt.slice(0, 10) : '—'}</p>
      </div>

      <button type="button" onClick={onCreateTicket} className="btn-primary w-full">
        Create ticket for this contact
      </button>
    </div>
  );
}

// ==================== Right: tabs ====================
function OverviewTab({ stats, recentTickets, statuses }) {
  const cards = [
    { label: 'Total tickets', value: stats.totalTickets },
    { label: 'Open tickets', value: stats.openTickets },
    { label: 'Overdue tickets', value: stats.overdueTickets },
    { label: 'Avg resolution time', value: formatHours(stats.avgResolutionHours) },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <p className="text-xs" style={{ color: MUTED }}>{c.label}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: TEXT }}>{c.value}</p>
          </div>
        ))}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold" style={{ color: TEXT }}>Recent tickets</h3>
        <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
          <ul className="divide-y" style={{ borderColor: BORDER }}>
            {recentTickets.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link to={`/tickets/${t.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                  <span className="font-mono text-xs" style={{ color: MUTED }}>{formatTicketId(t)}</span>
                  <span className="truncate" style={{ color: TEXT }}>{t.title}</span>
                </Link>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <StatusBadge status={t.status} statuses={statuses} />
                  <span style={{ color: MUTED }}>{t.createdAt?.slice(0, 10)}</span>
                  <Avatar name={t.assignee?.displayName} size={22} />
                </div>
              </li>
            ))}
            {recentTickets.length === 0 && <li className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No tickets yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

const TICKET_FILTERS = ['All', 'Open', 'Closed', 'On Hold'];

function TicketsTab({ tickets, statuses }) {
  const [filter, setFilter] = useState('All');
  const behaviorByName = new Map(statuses.map((s) => [s.name, s.behaviorType]));
  const filtered = tickets.filter((t) => {
    if (filter === 'All') return true;
    if (filter === 'Open') return behaviorByName.get(t.status) === 'open';
    if (filter === 'Closed') return behaviorByName.get(t.status) === 'closed';
    if (filter === 'On Hold') return t.status === 'On Hold';
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b" style={{ borderColor: BORDER }}>
        {TICKET_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="border-b-2 px-3 py-2 text-sm font-medium"
            style={{ borderColor: filter === f ? BLUE : 'transparent', color: filter === f ? BLUE : MUTED }}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
        <table className="min-w-full">
          <thead>
            <tr>
              {['#', 'Title', 'Status', 'Priority', 'Assignee', 'Created', 'Updated'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const priorityMeta = PRIORITY_META[t.priority] || PRIORITY_META.medium;
              return (
                <tr key={t.id} className="cursor-pointer border-t hover:bg-[var(--color-hover)]" style={{ borderColor: BORDER }}>
                  <td className="px-4 py-2.5 text-xs font-mono" style={{ color: MUTED }}>
                    <Link to={`/tickets/${t.id}`} className="hover:underline">{formatTicketId(t)}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    <Link to={`/tickets/${t.id}`} className="hover:underline" style={{ color: TEXT }}>{t.title}</Link>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={t.status} statuses={statuses} /></td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priorityMeta.color }} /> {priorityMeta.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><Avatar name={t.assignee?.displayName} size={22} /></td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: MUTED }}>{t.createdAt?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: MUTED }}>{t.updatedAt?.slice(0, 10)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No tickets.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACTIVITY_LABELS = {
  created: 'created this contact',
  updated: 'updated contact details',
  department_assigned: 'assigned a department',
};

function ActivityTab({ activity }) {
  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {activity.map((a) => (
          <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span style={{ color: TEXT }}>
              <strong>{a.user?.displayName || 'System'}</strong> {ACTIVITY_LABELS[a.action] || a.action}
              {a.detail?.departmentName && <> — {a.detail.departmentName}</>}
            </span>
            <span style={{ color: MUTED }}>{new Date(a.createdAt).toLocaleString()}</span>
          </li>
        ))}
        {activity.length === 0 && <li className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No activity yet.</li>}
      </ul>
    </div>
  );
}

// ==================== Page ====================
export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canEdit = useAnyPermission(['tickets.create', 'people.edit_users']);
  const canDelete = usePermission('people.edit_users');
  const { showToast } = useToast();

  const [contact, setContact] = useState(null);
  const [stats, setStats] = useState(null);
  const [recentTickets, setRecentTickets] = useState([]);
  const [contactsList, setContactsList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activity, setActivity] = useState([]);
  const [tab, setTab] = useState('Overview');
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDetail = () => {
    api.get(`/contacts/${id}`)
      .then(({ data }) => { setContact(data.contact); setStats(data.stats); setRecentTickets(data.recentTickets); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    loadDetail();
    api.get(`/contacts/${id}/tickets`).then(({ data }) => setTickets(data.tickets)).catch(() => {});
    api.get(`/contacts/${id}/activity`).then(({ data }) => setActivity(data.activity)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    api.get('/contacts').then(({ data }) => setContactsList(data.contacts)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    api.get('/ticket-statuses').then(({ data }) => setStatuses(data.statuses)).catch(() => {});
  }, []);

  const saveContact = async (changes) => {
    try {
      const { data } = await api.patch(`/contacts/${id}`, changes);
      setContact(data.contact);
      setContactsList((prev) => prev.map((c) => (c.id === data.contact.id ? { ...c, ...data.contact } : c)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const assignDepartment = async (departmentId) => {
    if (!departmentId) {
      await saveContact({ departmentId: null });
      return;
    }
    try {
      const { data } = await api.patch(`/contacts/${id}/department`, { departmentId });
      setContact(data.contact);
      showToast(`Department assigned — ${data.ticketsUpdated} ticket${data.ticketsUpdated === 1 ? '' : 's'} updated`);
      api.get(`/contacts/${id}/tickets`).then(({ data: td }) => setTickets(td.tickets)).catch(() => {});
      api.get(`/contacts/${id}/activity`).then(({ data: ad }) => setActivity(ad.activity)).catch(() => {});
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteContact = async (force) => {
    try {
      await api.delete(`/contacts/${id}${force ? '?force=true' : ''}`);
      navigate('/contacts');
    } catch (err) {
      if (err?.response?.data?.code === 'HAS_OPEN_TICKETS') {
        if (confirm(err.response.data.message)) deleteContact(true);
        return;
      }
      alert(errMessage(err));
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (error) return <div className="m-6 rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!contact) return null;

  return (
    <div style={{ margin: '-2rem -1.5rem', padding: 0, height: '100vh', backgroundColor: BG }} className="flex overflow-hidden">
      <ContactRail contacts={contactsList} currentId={id} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <PropertiesPanel
        contact={contact}
        departments={departments}
        assignableUsers={assignableUsers}
        canEdit={canEdit}
        onSave={saveContact}
        onAssignDepartment={assignDepartment}
        onCreateTicket={() => navigate(`/tickets/new?contactId=${contact.id}`)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b px-6 py-4" style={{ borderColor: BORDER }}>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {['Overview', 'Tickets', 'Activity'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className="rounded-md px-3 py-1.5 text-sm font-medium"
                  style={{ backgroundColor: tab === t ? BLUE : 'transparent', color: tab === t ? 'white' : MUTED }}
                >
                  {t}
                </button>
              ))}
            </div>
            {canDelete && (
              <button type="button" onClick={() => deleteContact(false)} className="btn-danger">Delete</button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'Overview' && stats && <OverviewTab stats={stats} recentTickets={recentTickets} statuses={statuses} />}
          {tab === 'Tickets' && <TicketsTab tickets={tickets} statuses={statuses} />}
          {tab === 'Activity' && <ActivityTab activity={activity} />}
        </div>
      </div>
    </div>
  );
}
