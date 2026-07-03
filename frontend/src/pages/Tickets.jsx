import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { formatTicketId } from '../utils/ticketId';

const BG = '#080b12';
const CARD_BG = '#0d1120';
const BORDER = '#1a2235';
const TEXT = '#e2e8f0';
const MUTED = '#64748b';
const BLUE = '#3b82f6';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PRIORITY_META = {
  critical: { label: 'Urgent', color: '#f87171' },
  high: { label: 'High', color: '#fbbf24' },
  medium: { label: 'Medium', color: '#3b82f6' },
  low: { label: 'Low', color: '#94a3b8' },
};

const DISPLAY_STATUS_META = {
  open: { label: 'Open', cls: 'bg-[#0d2847] text-[#60a5fa]' },
  in_progress: { label: 'In Progress', cls: 'bg-[#0c2a1a] text-[#4ade80]' },
  pending: { label: 'Pending', cls: 'bg-[#2d1f00] text-[#fbbf24]' },
  overdue: { label: 'Overdue', cls: 'bg-[#2d0f0f] text-[#f87171]' },
  closed: { label: 'Closed', cls: 'bg-[#1a2235] text-[#94a3b8]' },
};

// Real backend status enum values, used by the quick-action status picker.
const REAL_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const FIXED_COLUMNS = ['id', 'title'];
const DEFAULT_COLUMN_ORDER = [
  'priority', 'status', 'dueDate', 'assignee', 'type', 'team', 'timeLogged', 'createdDate', 'actions',
];
const COLUMN_LABELS = {
  id: '#',
  title: 'Title',
  priority: 'Priority',
  status: 'Status',
  dueDate: 'Due date',
  assignee: 'Assignee',
  type: 'Type',
  team: 'Team',
  timeLogged: 'Time logged',
  createdDate: 'Created date',
  actions: 'Actions',
};
const SORTABLE_COLUMNS = { id: 'id', title: 'title', priority: 'priority', status: 'status', dueDate: 'dueDate', createdDate: 'createdAt' };
const COLUMN_STORAGE_KEY = 'prism.tickets.columns.v1';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function computeDisplayStatus(t) {
  if (t.status === 'resolved' || t.status === 'closed') return 'closed';
  if (t.dueDate && t.dueDate < todayStr()) return 'overdue';
  if (t.status === 'on_hold') return 'pending';
  if (t.status === 'in_progress') return 'in_progress';
  return 'open';
}

function ageDays(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function formatMinutes(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

function loadColumnPrefs() {
  const defaults = { order: DEFAULT_COLUMN_ORDER, visible: Object.fromEntries(DEFAULT_COLUMN_ORDER.map((k) => [k, true])) };
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k) => DEFAULT_COLUMN_ORDER.includes(k)) : DEFAULT_COLUMN_ORDER;
    const missing = DEFAULT_COLUMN_ORDER.filter((k) => !order.includes(k));
    return { order: [...order, ...missing], visible: { ...defaults.visible, ...(parsed.visible || {}) } };
  } catch {
    return defaults;
  }
}

// Closes an open popover/menu when the user clicks outside of it.
function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, onOutside]);
}

function Avatar({ name }) {
  if (!name) {
    return <span className="text-sm" style={{ color: MUTED }}>Unassigned</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={{ backgroundColor: BORDER, color: '#93c5fd' }}
      >
        {initials(name)}
      </span>
      <span className="truncate text-sm" style={{ color: TEXT }}>{name}</span>
    </span>
  );
}

function PriorityCell({ priority }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.medium;
  return (
    <span className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

function StatusBadge({ ticket }) {
  const meta = DISPLAY_STATUS_META[computeDisplayStatus(ticket)];
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>;
}

function DueDateCell({ dueDate }) {
  if (!dueDate) return <span className="text-sm" style={{ color: MUTED }}>—</span>;
  const today = todayStr();
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);
  let color = MUTED;
  if (dueDate < today) color = '#f87171';
  else if (dueDate <= soonStr) color = '#fbbf24';
  return <span className="text-sm" style={{ color }}>{dueDate}</span>;
}

function AgeLine({ ticket }) {
  if (computeDisplayStatus(ticket) === 'closed') return null;
  const days = ageDays(ticket.createdAt);
  let color = MUTED;
  if (days > 10) color = '#f87171';
  else if (days > 5) color = '#fbbf24';
  return <p className="text-xs" style={{ color }}>Open {days} day{days === 1 ? '' : 's'}</p>;
}

function SortIcon({ active, dir }) {
  if (!active) return null;
  return <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>;
}

// ---- Toolbar sub-menus ----

function SavedFiltersMenu({ savedFilters, activeId, onApply, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useClickOutside(ref, () => { setOpen(false); setShowSave(false); });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Saved filters"
        className="flex h-9 w-9 items-center justify-center rounded-md border text-sm"
        style={{ borderColor: BORDER, backgroundColor: CARD_BG, color: TEXT }}
      >
        🔖
      </button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1 w-64 rounded-md border p-1 shadow-lg"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        >
          {savedFilters.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: MUTED }}>No saved filters yet.</p>
          )}
          {savedFilters.map((f) => (
            <div key={f.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { onApply(f); setOpen(false); }}
                className="flex flex-1 items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-white/5"
                style={{ color: TEXT }}
              >
                <span className="truncate">{f.name}</span>
                {activeId === f.id && <span style={{ color: BLUE }}>✓</span>}
              </button>
              <button
                type="button"
                onClick={() => onDelete(f)}
                title="Delete saved filter"
                className="px-2 text-xs"
                style={{ color: MUTED }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="mt-1 border-t pt-1" style={{ borderColor: BORDER }}>
            {showSave ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Filter name"
                  className="input h-8 flex-1 text-sm"
                  style={{ backgroundColor: BG, borderColor: BORDER, color: TEXT }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); setName(''); setShowSave(false); }
                  }}
                />
                <button
                  type="button"
                  onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); setShowSave(false); } }}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{ backgroundColor: BLUE, color: '#fff' }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSave(true)}
                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/5"
                style={{ color: BLUE }}
              >
                + Save current filter
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnsMenu({ order, visible, onChange }) {
  const [open, setOpen] = useState(false);
  const dragIndex = useRef(null);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));

  const toggle = (key) => {
    if (FIXED_COLUMNS.includes(key)) return;
    onChange({ order, visible: { ...visible, [key]: !visible[key] } });
  };

  const onDrop = (index) => {
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = null;
    onChange({ order: next, visible });
  };

  const reset = () => onChange({ order: DEFAULT_COLUMN_ORDER, visible: Object.fromEntries(DEFAULT_COLUMN_ORDER.map((k) => [k, true])) });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Columns"
        className="flex h-9 w-9 items-center justify-center rounded-md border text-sm"
        style={{ borderColor: BORDER, backgroundColor: CARD_BG, color: TEXT }}
      >
        ☰
      </button>
      {open && (
        <div
          className="absolute left-0 z-20 mt-1 w-60 rounded-md border p-1 shadow-lg"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        >
          {FIXED_COLUMNS.map((key) => (
            <div key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm" style={{ color: MUTED }}>
              <input type="checkbox" checked disabled className="accent-blue-500" />
              <span className="flex-1">{COLUMN_LABELS[key]}</span>
              <span title="Always visible">🔒</span>
            </div>
          ))}
          {order.map((key, index) => (
            <div
              key={key}
              draggable
              onDragStart={() => { dragIndex.current = index; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              onClick={() => toggle(key)}
              className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-white/5"
              style={{ color: TEXT }}
            >
              <span className="cursor-grab text-xs" style={{ color: MUTED }}>⠿</span>
              <input
                type="checkbox"
                checked={!!visible[key]}
                onChange={() => toggle(key)}
                onClick={(e) => e.stopPropagation()}
                className="accent-blue-500"
              />
              <span className="flex-1">{COLUMN_LABELS[key]}</span>
            </div>
          ))}
          <div className="mt-1 border-t pt-1" style={{ borderColor: BORDER }}>
            <button
              type="button"
              onClick={reset}
              className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/5"
              style={{ color: MUTED }}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickActionMenu({ field, ticket, assignableUsers, onChange, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);

  let options = [];
  if (field === 'status') options = REAL_STATUSES;
  else if (field === 'priority') options = PRIORITY_OPTIONS.filter((o) => o.value);
  else if (field === 'assignee') {
    options = [{ value: '', label: 'Unassigned' }, ...assignableUsers.map((u) => ({ value: String(u.id), label: u.displayName }))];
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border p-1 shadow-lg"
      style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5"
          style={{ color: TEXT }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Main page ----

export default function Tickets() {
  const { isStaff } = useAuth();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [activeSavedFilterId, setActiveSavedFilterId] = useState(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [myTickets, setMyTickets] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' });

  const [view, setView] = useState('table');
  const [columnPrefs, setColumnPrefs] = useState(loadColumnPrefs);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [quickAction, setQuickAction] = useState(null); // { ticketId, field }
  const [bulkActionType, setBulkActionType] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnPrefs));
  }, [columnPrefs]);

  useEffect(() => {
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    api.get('/saved-filters').then(({ data }) => setSavedFilters(data.savedFilters)).catch(() => {});
  }, []);

  const clearActiveSavedFilter = () => setActiveSavedFilterId(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (status) params.status = status;
    if (priority) params.priority = priority;
    if (assignee) params.assignee = assignee;
    if (myTickets) params.myTickets = 'true';
    if (overdue) params.overdue = 'true';
    if (unassigned) params.unassigned = 'true';
    params.sortBy = SORTABLE_COLUMNS[sort.key] || 'updatedAt';
    params.sortDir = sort.dir;

    api
      .get('/tickets', { params })
      .then(({ data }) => setTickets(data.tickets))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [search, status, priority, assignee, myTickets, overdue, unassigned, sort]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const toggleSort = (colKey) => {
    if (!SORTABLE_COLUMNS[colKey]) return;
    setSort((s) => ({ key: colKey, dir: s.key === colKey && s.dir === 'asc' ? 'desc' : 'asc' }));
  };

  const applySavedFilter = (f) => {
    const fj = f.filterJson || {};
    setSearch(fj.search || '');
    setStatus(fj.status || '');
    setPriority(fj.priority || '');
    setAssignee(fj.assignee || '');
    setMyTickets(!!fj.myTickets);
    setOverdue(!!fj.overdue);
    setUnassigned(!!fj.unassigned);
    if (fj.sortKey) setSort({ key: fj.sortKey, dir: fj.sortDir || 'desc' });
    setActiveSavedFilterId(f.id);
  };

  const saveCurrentFilter = async (name) => {
    const filterJson = { search, status, priority, assignee, myTickets, overdue, unassigned, sortKey: sort.key, sortDir: sort.dir };
    try {
      const { data } = await api.post('/saved-filters', { name, filterJson });
      setSavedFilters((prev) => [...prev, data.savedFilter]);
      setActiveSavedFilterId(data.savedFilter.id);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteSavedFilter = async (f) => {
    try {
      await api.delete(`/saved-filters/${f.id}`);
      setSavedFilters((prev) => prev.filter((sf) => sf.id !== f.id));
      if (activeSavedFilterId === f.id) setActiveSavedFilterId(null);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  // Any manual filter change invalidates the "active saved filter" checkmark.
  const wrapFilterSetter = (setter) => (value) => { clearActiveSavedFilter(); setter(value); };
  const setSearchTracked = wrapFilterSetter(setSearch);
  const setStatusTracked = wrapFilterSetter(setStatus);
  const setPriorityTracked = wrapFilterSetter(setPriority);
  const setAssigneeTracked = wrapFilterSetter(setAssignee);
  const toggleMyTickets = () => { clearActiveSavedFilter(); setMyTickets((v) => !v); };
  const toggleOverdue = () => { clearActiveSavedFilter(); setOverdue((v) => !v); };
  const toggleUnassigned = () => { clearActiveSavedFilter(); setUnassigned((v) => !v); };

  const patchTicket = async (ticketId, changes) => {
    try {
      const { data } = await api.patch(`/tickets/${ticketId}`, changes);
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? data.ticket : t)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === tickets.length ? new Set() : new Set(tickets.map((t) => t.id))));
  };
  const clearSelection = () => { setSelectedIds(new Set()); setBulkActionType(''); setBulkValue(''); };

  const applyBulkAction = async () => {
    const ids = [...selectedIds];
    if (!ids.length || !bulkActionType) return;
    if (bulkActionType !== 'close' && !bulkValue) return;
    setBulkSaving(true);
    try {
      let changes;
      if (bulkActionType === 'status') changes = { status: bulkValue };
      else if (bulkActionType === 'priority') changes = { priority: bulkValue };
      else if (bulkActionType === 'reassign') changes = { assigneeId: bulkValue || null };
      else changes = { status: 'closed' };
      await Promise.all(ids.map((id) => api.patch(`/tickets/${id}`, changes)));
      clearSelection();
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBulkSaving(false);
    }
  };

  const visibleColumns = useMemo(
    () => columnPrefs.order.filter((key) => columnPrefs.visible[key] !== false),
    [columnPrefs]
  );

  const boardColumns = useMemo(() => {
    const buckets = { open: [], in_progress: [], pending: [], overdue: [] };
    tickets.forEach((t) => {
      const d = computeDisplayStatus(t);
      if (buckets[d]) buckets[d].push(t);
    });
    return buckets;
  }, [tickets]);

  const filterButtonCls = (active) =>
    `rounded-md border px-3 py-2 text-sm font-medium transition ${active ? 'text-white' : ''}`;

  return (
    <div style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: '2rem 1.5rem' }} className="min-h-full space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Tickets</h1>
        <Link to="/tickets/new" className="btn-primary">+ New Ticket</Link>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearchTracked(e.target.value)}
          placeholder="Search by ticket number, title, or keyword…"
          className="input h-9 min-w-[220px] flex-1 text-sm"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: TEXT }}
        />
        <select
          value={status}
          onChange={(e) => setStatusTracked(e.target.value)}
          className="input h-9 max-w-[10rem] text-sm"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: TEXT }}
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriorityTracked(e.target.value)}
          className="input h-9 max-w-[10rem] text-sm"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: TEXT }}
        >
          {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={assignee}
          onChange={(e) => setAssigneeTracked(e.target.value)}
          className="input h-9 max-w-[11rem] text-sm"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: TEXT }}
        >
          <option value="">All assignees</option>
          {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>

        <button
          type="button"
          onClick={toggleMyTickets}
          className={filterButtonCls(myTickets)}
          style={{ borderColor: myTickets ? BLUE : BORDER, backgroundColor: myTickets ? BLUE : CARD_BG, color: myTickets ? '#fff' : TEXT }}
        >
          My tickets
        </button>
        <button
          type="button"
          onClick={toggleOverdue}
          className={filterButtonCls(overdue)}
          style={{ borderColor: overdue ? '#f87171' : BORDER, backgroundColor: overdue ? '#f87171' : CARD_BG, color: overdue ? '#fff' : TEXT }}
        >
          Overdue
        </button>
        <button
          type="button"
          onClick={toggleUnassigned}
          className={filterButtonCls(unassigned)}
          style={{ borderColor: unassigned ? BLUE : BORDER, backgroundColor: unassigned ? BLUE : CARD_BG, color: unassigned ? '#fff' : TEXT }}
        >
          Unassigned
        </button>

        <SavedFiltersMenu
          savedFilters={savedFilters}
          activeId={activeSavedFilterId}
          onApply={applySavedFilter}
          onSave={saveCurrentFilter}
          onDelete={deleteSavedFilter}
        />
        <ColumnsMenu order={columnPrefs.order} visible={columnPrefs.visible} onChange={setColumnPrefs} />

        <div className="flex rounded-md border" style={{ borderColor: BORDER }}>
          <button
            type="button"
            onClick={() => setView('table')}
            className="rounded-l-md px-3 py-2 text-sm font-medium"
            style={{ backgroundColor: view === 'table' ? BLUE : CARD_BG, color: view === 'table' ? '#fff' : TEXT }}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setView('board')}
            className="rounded-r-md px-3 py-2 text-sm font-medium"
            style={{ backgroundColor: view === 'board' ? BLUE : CARD_BG, color: view === 'board' ? '#fff' : TEXT }}
          >
            Board
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md p-4 text-sm" style={{ backgroundColor: '#1a0a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
          {error}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : view === 'board' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {['open', 'in_progress', 'pending', 'overdue'].map((key) => {
            const meta = DISPLAY_STATUS_META[key];
            const isOverdueCol = key === 'overdue';
            return (
              <div
                key={key}
                className="rounded-[10px] border"
                style={{ backgroundColor: CARD_BG, borderColor: isOverdueCol ? '#7f1d1d' : BORDER }}
              >
                <div
                  className="flex items-center justify-between border-b px-4 py-3"
                  style={{ borderColor: isOverdueCol ? '#7f1d1d' : BORDER }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: isOverdueCol ? '#f87171' : TEXT }}>{meta.label}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{boardColumns[key].length}</span>
                </div>
                <div className="space-y-2 p-3">
                  {boardColumns[key].length === 0 && <p className="text-xs" style={{ color: MUTED }}>No tickets.</p>}
                  {boardColumns[key].map((t) => (
                    <div
                      key={t.id}
                      onClick={() => navigate(`/tickets/${t.id}`)}
                      className="cursor-pointer rounded-md border p-3 transition hover:opacity-90"
                      style={{ backgroundColor: BG, borderColor: isOverdueCol ? '#7f1d1d' : BORDER }}
                    >
                      <p className="font-mono text-xs" style={{ color: isOverdueCol ? '#f87171' : MUTED }}>{formatTicketId(t)}</p>
                      <p className="mt-1 truncate text-sm font-medium" style={{ color: isOverdueCol ? '#f87171' : TEXT }}>{t.title}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <PriorityCell priority={t.priority} />
                        <Avatar name={t.assignee?.displayName} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {isStaff && selectedIds.size > 0 && (
            <div
              className="mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border p-3"
              style={{ backgroundColor: CARD_BG, borderColor: BLUE }}
            >
              <span className="text-sm font-medium" style={{ color: TEXT }}>{selectedIds.size} selected</span>
              <select
                value={bulkActionType}
                onChange={(e) => { setBulkActionType(e.target.value); setBulkValue(''); }}
                className="input h-9 max-w-[11rem] text-sm"
                style={{ backgroundColor: BG, borderColor: BORDER, color: TEXT }}
              >
                <option value="">Choose action…</option>
                <option value="status">Change status</option>
                <option value="priority">Change priority</option>
                <option value="reassign">Reassign</option>
                <option value="close">Close selected</option>
              </select>
              {bulkActionType === 'status' && (
                <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[9rem] text-sm" style={{ backgroundColor: BG, borderColor: BORDER, color: TEXT }}>
                  <option value="">Select status…</option>
                  {REAL_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {bulkActionType === 'priority' && (
                <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[9rem] text-sm" style={{ backgroundColor: BG, borderColor: BORDER, color: TEXT }}>
                  <option value="">Select priority…</option>
                  {PRIORITY_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {bulkActionType === 'reassign' && (
                <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[11rem] text-sm" style={{ backgroundColor: BG, borderColor: BORDER, color: TEXT }}>
                  <option value="">Select assignee…</option>
                  {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              )}
              <button
                type="button"
                onClick={applyBulkAction}
                disabled={bulkSaving || !bulkActionType || (bulkActionType !== 'close' && !bulkValue)}
                className="rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                style={{ backgroundColor: BLUE }}
              >
                Apply
              </button>
              <button type="button" onClick={clearSelection} className="text-sm hover:underline" style={{ color: MUTED }}>
                Clear selection
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <table className="min-w-full">
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {isStaff && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={tickets.length > 0 && selectedIds.size === tickets.length}
                        onChange={toggleSelectAll}
                        className="accent-blue-500"
                      />
                    </th>
                  )}
                  {['id', 'title'].map((key) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className="cursor-pointer whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: MUTED }}
                    >
                      {COLUMN_LABELS[key]}
                      <SortIcon active={sort.key === key} dir={sort.dir} />
                    </th>
                  ))}
                  {visibleColumns.map((key) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide ${SORTABLE_COLUMNS[key] ? 'cursor-pointer' : ''}`}
                      style={{ color: MUTED }}
                    >
                      {COLUMN_LABELS[key]}
                      <SortIcon active={sort.key === key} dir={sort.dir} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-sm" style={{ color: MUTED }} colSpan={(isStaff ? 1 : 0) + 2 + visibleColumns.length}>
                      No tickets found.
                    </td>
                  </tr>
                )}
                {tickets.map((t) => (
                  <tr key={t.id} className="group relative" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} className="accent-blue-500" />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm" style={{ color: MUTED }}>{formatTicketId(t)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/tickets/${t.id}`} className="font-medium hover:underline" style={{ color: TEXT }}>{t.title}</Link>
                      <AgeLine ticket={t} />
                    </td>
                    {visibleColumns.map((key) => (
                      <td key={key} className="relative whitespace-nowrap px-4 py-3">
                        {key === 'priority' && <PriorityCell priority={t.priority} />}
                        {key === 'status' && <StatusBadge ticket={t} />}
                        {key === 'dueDate' && <DueDateCell dueDate={t.dueDate} />}
                        {key === 'assignee' && <Avatar name={t.assignee?.displayName} />}
                        {key === 'type' && <span className="text-sm capitalize" style={{ color: TEXT }}>{t.type}</span>}
                        {key === 'team' && <span className="text-sm" style={{ color: TEXT }}>{t.team?.name || '—'}</span>}
                        {key === 'timeLogged' && <span className="text-sm" style={{ color: TEXT }}>{formatMinutes(t.timeLoggedMinutes)}</span>}
                        {key === 'createdDate' && <span className="text-sm" style={{ color: MUTED }}>{new Date(t.createdAt).toLocaleDateString()}</span>}
                        {key === 'actions' && (
                          <Link to={`/tickets/${t.id}`} className="text-sm" style={{ color: '#93c5fd' }}>Open →</Link>
                        )}

                        {isStaff && key === 'status' && (
                          <span className="relative ml-2 hidden group-hover:inline-block">
                            <button
                              type="button"
                              onClick={() => setQuickAction((q) => (q?.ticketId === t.id && q.field === 'status' ? null : { ticketId: t.id, field: 'status' }))}
                              className="rounded px-1 text-xs"
                              style={{ color: MUTED }}
                              title="Quick change status"
                            >
                              ▾
                            </button>
                            {quickAction?.ticketId === t.id && quickAction.field === 'status' && (
                              <QuickActionMenu
                                field="status"
                                ticket={t}
                                assignableUsers={assignableUsers}
                                onClose={() => setQuickAction(null)}
                                onChange={(v) => { patchTicket(t.id, { status: v }); setQuickAction(null); }}
                              />
                            )}
                          </span>
                        )}
                        {isStaff && key === 'assignee' && (
                          <span className="relative ml-2 hidden group-hover:inline-block">
                            <button
                              type="button"
                              onClick={() => setQuickAction((q) => (q?.ticketId === t.id && q.field === 'assignee' ? null : { ticketId: t.id, field: 'assignee' }))}
                              className="rounded px-1 text-xs"
                              style={{ color: MUTED }}
                              title="Quick reassign"
                            >
                              ▾
                            </button>
                            {quickAction?.ticketId === t.id && quickAction.field === 'assignee' && (
                              <QuickActionMenu
                                field="assignee"
                                ticket={t}
                                assignableUsers={assignableUsers}
                                onClose={() => setQuickAction(null)}
                                onChange={(v) => { patchTicket(t.id, { assigneeId: v || null }); setQuickAction(null); }}
                              />
                            )}
                          </span>
                        )}
                        {key === 'priority' && (
                          <span className="relative ml-2 hidden group-hover:inline-block">
                            <button
                              type="button"
                              onClick={() => setQuickAction((q) => (q?.ticketId === t.id && q.field === 'priority' ? null : { ticketId: t.id, field: 'priority' }))}
                              className="rounded px-1 text-xs"
                              style={{ color: MUTED }}
                              title="Quick change priority"
                            >
                              ▾
                            </button>
                            {quickAction?.ticketId === t.id && quickAction.field === 'priority' && (
                              <QuickActionMenu
                                field="priority"
                                ticket={t}
                                assignableUsers={assignableUsers}
                                onClose={() => setQuickAction(null)}
                                onChange={(v) => { patchTicket(t.id, { priority: v }); setQuickAction(null); }}
                              />
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
