import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth, useAnyPermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function Avatar({ name, size = 32 }) {
  if (!name) {
    return (
      <span
        className="flex flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
        style={{ width: size, height: size, backgroundColor: BORDER, color: MUTED }}
      >
        ?
      </span>
    );
  }
  return (
    <span
      title={name}
      className="flex flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: BLUE }}
    >
      {initials(name)}
    </span>
  );
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SORT_COLUMNS = [
  { key: 'lastName', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'createdAt', label: 'Created' },
];

function ContactFormFields({ form, setForm, departments, assignableUsers }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>First name *</label>
          <input className="input" style={fieldStyle} value={form.firstName} onChange={set('firstName')} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Last name *</label>
          <input className="input" style={fieldStyle} value={form.lastName} onChange={set('lastName')} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Email</label>
          <input type="email" className="input" style={fieldStyle} value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Job title</label>
          <input className="input" style={fieldStyle} value={form.jobTitle} onChange={set('jobTitle')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Phone</label>
          <input className="input" style={fieldStyle} value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Mobile</label>
          <input className="input" style={fieldStyle} value={form.mobile} onChange={set('mobile')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Department</label>
          <select className="input" style={fieldStyle} value={form.departmentId} onChange={set('departmentId')}>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Assigned to</label>
          <select className="input" style={fieldStyle} value={form.assignedTo} onChange={set('assignedTo')}>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Notes</label>
        <textarea className="input resize-y" style={{ ...fieldStyle, minHeight: '70px' }} value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}

function NewContactModal({ departments, assignableUsers, currentUserId, onClose, onCreated }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', mobile: '',
    departmentId: '', jobTitle: '', assignedTo: String(currentUserId || ''), notes: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First and last name are required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const { data } = await api.post('/contacts', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        departmentId: form.departmentId || null,
        jobTitle: form.jobTitle || null,
        assignedTo: form.assignedTo || null,
        notes: form.notes || null,
      });
      onCreated(data.contact);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New contact" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <ContactFormFields form={form} setForm={setForm} departments={departments} assignableUsers={assignableUsers} />
        <div className="flex justify-end gap-3 border-t pt-4" style={{ borderColor: BORDER }}>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Contacts() {
  const { user } = useAuth();
  const canEdit = useAnyPermission(['tickets.create', 'people.edit_users']);
  const navigate = useNavigate();

  const [contacts, setContacts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [myContacts, setMyContacts] = useState(false);
  const [noDept, setNoDept] = useState(false);
  const [sortBy, setSortBy] = useState('lastName');
  const [sortDir, setSortDir] = useState('asc');

  const [showNew, setShowNew] = useState(false);

  const rowRefs = useRef(new Map());

  const load = () => {
    setLoading(true);
    const params = { sortBy, sortDir };
    if (search) params.search = search;
    if (departmentId) params.departmentId = departmentId;
    if (assignedTo) params.assignedTo = assignedTo;
    if (myContacts) params.myContacts = 'true';
    if (noDept) params.noDept = 'true';
    api.get('/contacts', { params })
      .then(({ data }) => setContacts(data.contacts))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, departmentId, assignedTo, myContacts, noDept, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  // First contact whose lastName starts with each letter — used by the A-Z
  // quick jump rail. Only meaningful while sorted by name.
  const firstIndexByLetter = useMemo(() => {
    const map = {};
    if (sortBy !== 'lastName') return map;
    contacts.forEach((c, idx) => {
      const letter = (c.lastName || c.displayName || '?').trim()[0]?.toUpperCase();
      if (letter && !(letter in map)) map[letter] = idx;
    });
    return map;
  }, [contacts, sortBy]);

  const jumpTo = (letter) => {
    const idx = firstIndexByLetter[letter];
    if (idx === undefined) return;
    const row = rowRefs.current.get(contacts[idx].id);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCreated = (contact) => {
    setShowNew(false);
    navigate(`/contacts/${contact.id}`);
  };

  return (
    <div style={{ margin: '-2rem -1.5rem', padding: 0, height: '100vh' }} className="flex flex-col overflow-hidden" >
      <div style={{ backgroundColor: BG }} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-shrink-0 space-y-3 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Contacts</h1>
              <p className="text-sm" style={{ color: MUTED }}>{contacts.length} contact{contacts.length === 1 ? '' : 's'}</p>
            </div>
            {canEdit && <button onClick={() => setShowNew(true)} className="btn-primary">+ New contact</button>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or phone…"
              className="input h-9 flex-1 text-sm"
              style={{ ...fieldStyle, minWidth: '14rem' }}
            />
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="input h-9 flex-shrink-0 text-sm"
              style={{ ...fieldStyle, maxWidth: '11rem' }}
            >
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="input h-9 flex-shrink-0 text-sm"
              style={{ ...fieldStyle, maxWidth: '11rem' }}
            >
              <option value="">Assigned to (anyone)</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setMyContacts((v) => !v)}
              className="h-9 flex-shrink-0 rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: myContacts ? BLUE : BORDER, backgroundColor: myContacts ? BLUE : CARD_BG, color: myContacts ? 'white' : TEXT }}
            >
              My contacts
            </button>
            <button
              type="button"
              onClick={() => setNoDept((v) => !v)}
              className="h-9 flex-shrink-0 rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: noDept ? BLUE : BORDER, backgroundColor: noDept ? BLUE : CARD_BG, color: noDept ? 'white' : TEXT }}
            >
              No department
            </button>
          </div>
        </div>

        {error && <div className="mx-6 rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

        <div className="flex flex-1 overflow-hidden px-6 pb-6">
          <div className="flex-1 overflow-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            {loading ? (
              <div className="flex h-full items-center justify-center p-8"><Spinner /></div>
            ) : contacts.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: MUTED }}>No contacts found.</div>
            ) : (
              <table className="min-w-full">
                <thead>
                  <tr>
                    {SORT_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className="cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}
                      >
                        {col.label} {sortBy === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </th>
                    ))}
                    {['Department', 'Phone', 'Assigned to', 'Tickets', 'Last ticket'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr
                      key={c.id}
                      ref={(el) => { if (el) rowRefs.current.set(c.id, el); }}
                      className="border-t hover:bg-[var(--color-hover)]"
                      style={{ borderColor: BORDER }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.displayName} />
                          <Link to={`/contacts/${c.id}`} className="font-semibold hover:underline" style={{ color: TEXT }}>
                            {c.displayName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: MUTED }}>{c.email || '—'}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: MUTED }}>{c.createdAt ? c.createdAt.slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3">
                        {c.department ? (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: BLUE }}>
                            {c.department.name}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: MUTED }}>No department</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: MUTED }}>{c.phone || '—'}</td>
                      <td className="px-4 py-3">
                        {c.assignedToUser ? (
                          <span className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
                            <Avatar name={c.assignedToUser.displayName} size={22} /> {c.assignedToUser.displayName}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: MUTED }}>Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: TEXT }}>{c.ticketCount || 0}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: MUTED }}>{c.lastTicketAt ? c.lastTicketAt.slice(0, 10) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {sortBy === 'lastName' && contacts.length > 0 && (
            <div className="ml-2 flex flex-shrink-0 flex-col items-center justify-center gap-0.5 py-2">
              {ALPHABET.map((letter) => {
                const has = firstIndexByLetter[letter] !== undefined;
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={!has}
                    onClick={() => jumpTo(letter)}
                    className="text-[10px] font-semibold leading-none disabled:cursor-default"
                    style={{ color: has ? BLUE : BORDER, padding: '1px 3px' }}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewContactModal
          departments={departments}
          assignableUsers={assignableUsers}
          currentUserId={user?.id}
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
