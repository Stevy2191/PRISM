import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { IconArrowUp, IconArrowDown, IconX, IconUpload } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { formatTicketId } from '../utils/ticketId';
import TagInput from '../components/TagInput';

// Colors read from the admin-customizable theme CSS variables (Settings -> Appearance).
const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const PURPLE = 'var(--color-relation-accent)';
const PURPLE_LIGHT = 'var(--color-relation-accent-light)';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const TYPE_OPTIONS = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'problem', label: 'Problem' },
  { value: 'change', label: 'Change' },
];

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

function Required() {
  return <span style={{ color: 'var(--color-danger)' }}> *</span>;
}

function OptionalPill() {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: BORDER, color: MUTED }}
    >
      Optional
    </span>
  );
}

function Card({ title, optional, children }) {
  return (
    <div className="rounded-[10px] border p-6" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {optional && <OptionalPill />}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Label({ children, required }) {
  return (
    <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }}>
      {children}
      {required && <Required />}
    </label>
  );
}

const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Search-as-you-type contact picker for the Customer field. Falls back to a
// quick inline "create new contact" form when no existing contact matches.
function ContactPicker({ selectedContact, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/contacts', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.contacts.slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function handleOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const pick = (contact) => {
    onSelect(contact);
    setQuery('');
    setOpen(false);
  };

  const startCreate = () => {
    setShowCreate(true);
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      {selectedContact ? (
        <div className="flex items-center justify-between rounded-md border p-2.5" style={{ borderColor: BORDER, backgroundColor: BG }}>
          <div>
            <p className="text-sm font-medium" style={{ color: TEXT }}>{selectedContact.displayName}</p>
            <p className="text-xs" style={{ color: MUTED }}>
              {selectedContact.department?.name || 'No department'}{selectedContact.email ? ` · ${selectedContact.email}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => onSelect(null)} style={{ color: MUTED }}>
            <IconX size={14} />
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search contacts by name or email…"
            className="input"
            style={fieldStyle}
          />
          {open && query.trim() && (
            <div className="absolute z-20 mt-1 w-full rounded-md border shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c)}
                  className="block w-full px-3 py-2 text-left hover:bg-[var(--color-hover)]"
                >
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{c.displayName}</p>
                  <p className="text-xs" style={{ color: MUTED }}>{c.department?.name || 'No department'}{c.email ? ` · ${c.email}` : ''}</p>
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-3 py-2 text-sm" style={{ color: MUTED }}>No contact found for "{query.trim()}".</p>
              )}
              <button
                type="button"
                onClick={startCreate}
                className="block w-full border-t px-3 py-2 text-left text-sm font-medium"
                style={{ borderColor: BORDER, color: BLUE }}
              >
                + Create new contact "{query.trim()}"
              </button>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <QuickCreateContact
          initialName={query}
          error={createError}
          creating={creating}
          onCancel={() => { setShowCreate(false); setCreateError(''); }}
          onCreate={async (form) => {
            setCreating(true);
            setCreateError('');
            try {
              const { data } = await api.post('/contacts', form);
              setShowCreate(false);
              pick(data.contact);
            } catch (err) {
              setCreateError(errMessage(err));
            } finally {
              setCreating(false);
            }
          }}
        />
      )}
    </div>
  );
}

function QuickCreateContact({ initialName, error, creating, onCancel, onCreate }) {
  const parts = String(initialName || '').trim().split(/\s+/).filter(Boolean);
  const [firstName, setFirstName] = useState(parts[0] || '');
  const [lastName, setLastName] = useState(parts.slice(1).join(' '));
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    onCreate({ firstName: firstName.trim(), lastName: lastName.trim(), email: email || null, phone: phone || null });
  };

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border p-3" style={{ borderColor: BORDER, backgroundColor: BG }}>
      <p className="text-sm font-medium" style={{ color: TEXT }}>New contact</p>
      {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" required className="input h-9 text-sm" style={fieldStyle} />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" required className="input h-9 text-sm" style={fieldStyle} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="input h-9 text-sm" style={fieldStyle} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="input h-9 text-sm" style={fieldStyle} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary h-8 px-3 text-xs">Cancel</button>
        <button type="submit" disabled={creating} className="btn-primary h-8 px-3 text-xs">{creating ? 'Creating…' : 'Create contact'}</button>
      </div>
    </form>
  );
}

function WatchersField({ directory, watchers, onChange }) {
  const [query, setQuery] = useState('');
  const results = query.trim()
    ? directory
        .filter(
          (u) =>
            u.displayName.toLowerCase().includes(query.trim().toLowerCase()) &&
            !watchers.some((w) => w.id === u.id)
        )
        .slice(0, 8)
    : [];

  const addWatcher = (u) => { onChange([...watchers, u]); setQuery(''); };
  const removeWatcher = (id) => onChange(watchers.filter((w) => w.id !== id));

  return (
    <div>
      <Label>Watchers</Label>
      <div className="relative flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any user by name…"
          className="input flex-1"
          style={fieldStyle}
        />
        <button
          type="button"
          onClick={() => results.length && addWatcher(results[0])}
          disabled={!results.length}
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          Add
        </button>
        {results.length > 0 && (
          <div
            className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => addWatcher(u)}
                className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5"
                style={{ color: TEXT }}
              >
                {u.displayName}
              </button>
            ))}
          </div>
        )}
      </div>
      {watchers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {watchers.map((w) => (
            <span
              key={w.id}
              className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-xs font-medium"
              style={{ backgroundColor: BORDER, color: TEXT }}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{ backgroundColor: CARD_BG, color: 'var(--color-accent)' }}
              >
                {initials(w.displayName)}
              </span>
              {w.displayName}
              <button type="button" onClick={() => removeWatcher(w.id)} style={{ color: MUTED }}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Watchers receive a notification when the ticket is updated or commented on.
      </p>
    </div>
  );
}

function TicketLinker({ title, accent, accentLight, Icon, buttonLabel, helperText, multiple, selected, onAdd, onRemove }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api
        .get('/tickets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.tickets.slice(0, 8)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const pick = (ticket) => {
    onAdd(ticket);
    setQuery('');
    setResults([]);
  };

  const hideInput = !multiple && selected;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: accent }}>
        <Icon size={16} />
        {title}
      </div>

      {!hideInput && (
        <div className="relative mt-2 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ticket number or title…"
            className="input flex-1"
            style={fieldStyle}
          />
          <button
            type="button"
            onClick={() => results.length && pick(results[0])}
            disabled={!results.length}
            className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40"
            style={{ borderColor: accent, color: accentLight }}
          >
            {buttonLabel}
          </button>
          {results.length > 0 && (
            <div
              className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg"
              style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
            >
              {results.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t)}
                  className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5"
                  style={{ color: TEXT }}
                >
                  {formatTicketId(t)} {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {helperText && <p className="mt-1.5 text-xs" style={{ color: MUTED }}>{helperText}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        {(multiple ? selected : selected ? [selected] : []).map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-xs font-medium"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)`, color: accentLight }}
          >
            <Icon size={12} />
            {formatTicketId(t)} {t.title}
            <button type="button" onClick={() => onRemove(t)} style={{ color: accentLight }}>
              <IconX size={12} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function Dropzone({ files, onFiles, onRemove }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (list) => {
    const accepted = [];
    Array.from(list).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} is larger than 25MB and was not added.`);
        return;
      }
      accepted.push(file);
    });
    if (accepted.length) onFiles(accepted);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : BG }}
      >
        <IconUpload size={28} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm font-medium" style={{ color: TEXT }}>
          Drag &amp; drop files here or browse
        </p>
        <p className="mt-1 text-xs" style={{ color: MUTED }}>
          PNG, JPG, PDF, ZIP — max 25MB per file
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.pdf,.zip"
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f) => (
            <span
              key={f.id}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: BORDER, color: TEXT }}
            >
              {f.file.name}
              <button type="button" onClick={() => onRemove(f.id)} style={{ color: MUTED }}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TicketNew() {
  const { isStaff } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('request');
  const [priority, setPriority] = useState('medium');
  const [tags, setTags] = useState([]);

  const [directory, setDirectory] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [contactId, setContactId] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [customerDeptId, setCustomerDeptId] = useState('');
  const [assignPrompt, setAssignPrompt] = useState({ show: false, deptId: '', saving: false, done: false, doneText: '' });
  const [watchers, setWatchers] = useState([]);

  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [teamId, setTeamId] = useState('');

  const [dueDate, setDueDate] = useState('');

  const [parentTicket, setParentTicket] = useState(null);
  const [childTickets, setChildTickets] = useState([]);
  const [relatedTickets, setRelatedTickets] = useState([]);

  const [files, setFiles] = useState([]);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    if (isStaff) {
      api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
      api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    }
  }, [isStaff]);

  // Pre-fills the contact when arriving from a contact's "Create ticket" button.
  useEffect(() => {
    const preselect = searchParams.get('contactId');
    if (!preselect) return;
    api.get(`/contacts/${preselect}`).then(({ data }) => selectContact(data.contact)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectContact = (contact) => {
    if (!contact) {
      setContactId('');
      setSelectedContact(null);
      setCustomerDeptId('');
      setAssignPrompt({ show: false, deptId: '', saving: false, done: false, doneText: '' });
      return;
    }
    setContactId(contact.id);
    setSelectedContact(contact);
    if (contact.departmentId) {
      setCustomerDeptId(String(contact.departmentId));
      setAssignPrompt({ show: false, deptId: '', saving: false, done: false, doneText: '' });
    } else {
      setCustomerDeptId('');
      setAssignPrompt({ show: true, deptId: '', saving: false, done: false, doneText: '' });
    }
  };

  const handleAssignDepartment = async () => {
    if (!assignPrompt.deptId) return;
    setAssignPrompt((p) => ({ ...p, saving: true }));
    try {
      await api.patch(`/contacts/${contactId}/department`, { departmentId: assignPrompt.deptId });
      const deptName = departments.find((d) => d.id === Number(assignPrompt.deptId))?.name || 'the department';
      setSelectedContact((prev) => (prev ? { ...prev, departmentId: Number(assignPrompt.deptId) } : prev));
      setCustomerDeptId(assignPrompt.deptId);
      setAssignPrompt((p) => ({
        ...p,
        saving: false,
        done: true,
        doneText: `${selectedContact?.displayName} assigned to ${deptName} — all tickets updated`,
      }));
    } catch (err) {
      setAssignPrompt((p) => ({ ...p, saving: false }));
      alert(errMessage(err));
    }
  };

  const handleSkipAssign = () => setAssignPrompt({ show: false, deptId: '', saving: false, done: false, doneText: '' });

  const addFiles = (list) => setFiles((prev) => [...prev, ...list.map((file) => ({ file, id: `${file.name}-${file.size}-${prev.length}-${Math.random()}` }))]);
  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isStaff && !contactId) {
      setError('Customer is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description || undefined,
        type,
        priority,
        tags: tags.length ? tags : undefined,
        departmentId: customerDeptId || undefined,
        dueDate: dueDate || undefined,
        watcherIds: watchers.map((w) => w.id),
        parentTicketId: parentTicket ? parentTicket.id : undefined,
        childTicketIds: childTickets.map((t) => t.id),
        relatedTicketIds: relatedTickets.map((t) => t.id),
      };
      if (isStaff) {
        payload.contactId = contactId;
        payload.assigneeId = assigneeId || undefined;
        payload.teamId = teamId || undefined;
      }
      const { data } = await api.post('/tickets', payload);
      const ticketId = data.ticket.id;

      // eslint-disable-next-line no-restricted-syntax
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f.file);
        // eslint-disable-next-line no-await-in-loop
        await api.post(`/tickets/${ticketId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }

      navigate(`/tickets/${ticketId}`);
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <div style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: '2rem 1.5rem' }} className="min-h-full">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: TEXT }}>New Ticket</h1>
        </div>

        {error && (
          <div
            className="rounded-md p-4 text-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))',
              color: 'var(--color-danger)',
              border: '1px solid var(--color-danger)',
            }}
          >
            {error}
          </div>
        )}

        <Card title="Core Info">
          <div>
            <Label required>Title</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="input"
              style={fieldStyle}
            />
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input resize-y"
              style={{ ...fieldStyle, minHeight: '90px' }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Type</Label>
              <select value={type} onChange={(e) => setType(e.target.value)} required className="input" style={fieldStyle}>
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label required>Priority</Label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} required className="input" style={fieldStyle}>
                {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>Tags</Label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </Card>

        <Card title="People">
          {isStaff && (
            <>
              <div>
                <Label required>Customer</Label>
                <ContactPicker selectedContact={selectedContact} onSelect={selectContact} />

                {assignPrompt.done && (
                  <p className="mt-2 text-sm font-medium" style={{ color: 'var(--color-success)' }}>{assignPrompt.doneText}</p>
                )}
                {assignPrompt.show && !assignPrompt.done && selectedContact && (
                  <div className="mt-2 rounded-md border p-3" style={{ borderColor: BORDER, backgroundColor: BG }}>
                    <p className="text-sm" style={{ color: TEXT }}>
                      {selectedContact.displayName} has no department assigned
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={assignPrompt.deptId}
                        onChange={(e) => setAssignPrompt((p) => ({ ...p, deptId: e.target.value }))}
                        className="input h-9 max-w-[10rem] text-sm"
                        style={fieldStyle}
                      >
                        <option value="">Select department…</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={handleAssignDepartment}
                        disabled={!assignPrompt.deptId || assignPrompt.saving}
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: BLUE }}
                      >
                        {assignPrompt.saving ? 'Assigning…' : 'Assign'}
                      </button>
                      <button type="button" onClick={handleSkipAssign} className="text-sm hover:underline" style={{ color: MUTED }}>
                        Skip
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label>Customer Department</Label>
                <select
                  value={customerDeptId}
                  onChange={(e) => setCustomerDeptId(e.target.value)}
                  className="input"
                  style={fieldStyle}
                >
                  <option value="">None</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}

          {!isStaff && (
            <div>
              <Label>Department</Label>
              <select
                value={customerDeptId}
                onChange={(e) => setCustomerDeptId(e.target.value)}
                className="input"
                style={fieldStyle}
              >
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          <WatchersField directory={directory} watchers={watchers} onChange={setWatchers} />

          {isStaff && (
            <div className="border-t pt-4" style={{ borderColor: BORDER }}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Assignee</Label>
                  <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input" style={fieldStyle}>
                    <option value="">Unassigned</option>
                    {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Team</Label>
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="input" style={fieldStyle}>
                    <option value="">No team</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card title="Scheduling">
          <div>
            <Label>Due date</Label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input max-w-[12rem]"
              style={fieldStyle}
            />
          </div>
        </Card>

        <Card title="Ticket Relationships" optional>
          <TicketLinker
            title="Parent ticket"
            accent={PURPLE}
            accentLight={PURPLE_LIGHT}
            Icon={IconArrowUp}
            buttonLabel="Link parent"
            multiple={false}
            selected={parentTicket}
            onAdd={setParentTicket}
            onRemove={() => setParentTicket(null)}
            helperText={
              parentTicket
                ? `This ticket will roll up to ${formatTicketId(parentTicket)}. The parent stays open until all children are resolved.`
                : null
            }
          />
          <div className="border-t pt-4" style={{ borderColor: BORDER }}>
            <TicketLinker
              title="Child tickets"
              accent={BLUE}
              accentLight={BLUE}
              Icon={IconArrowDown}
              buttonLabel="Link child"
              multiple
              selected={childTickets}
              onAdd={(t) => setChildTickets((prev) => (prev.some((c) => c.id === t.id) ? prev : [...prev, t]))}
              onRemove={(t) => setChildTickets((prev) => prev.filter((c) => c.id !== t.id))}
              helperText="Child tickets are tracked under this ticket. Progress shown as closed children vs total."
            />
          </div>
          <div className="border-t pt-4" style={{ borderColor: BORDER }}>
            <TicketLinker
              title="Related tickets"
              accent={MUTED}
              accentLight={MUTED}
              Icon={() => null}
              buttonLabel="Link"
              multiple
              selected={relatedTickets}
              onAdd={(t) => setRelatedTickets((prev) => (prev.some((r) => r.id === t.id) ? prev : [...prev, t]))}
              onRemove={(t) => setRelatedTickets((prev) => prev.filter((r) => r.id !== t.id))}
            />
          </div>
        </Card>

        <Card title="Attachments" optional>
          <Dropzone files={files} onFiles={addFiles} onRemove={removeFile} />
        </Card>

        <div className="flex justify-between pt-2">
          <Link
            to="/tickets"
            className="rounded-md border px-4 py-2 text-sm font-medium"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {saving ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
