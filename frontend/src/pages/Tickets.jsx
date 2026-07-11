import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconMail, IconPhone, IconWorld } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { initials } from '../utils/userDisplay';
import { useAuth, usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { formatTicketId } from '../utils/ticketId';
import { useClickOutside } from '../hooks/useClickOutside';

// Colors read from the admin-customizable theme CSS variables (Settings -> Appearance).
const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';

// 'closed' is a special client-side aggregate keyword (the backend maps it
// to every behaviorType:'closed' status), not a literal status name — the
// real per-status options are appended dynamically from the fetched
// ticket-statuses list (see buildStatusFilterOptions below).
const BASE_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
];
function buildStatusFilterOptions(ticketStatuses) {
  const openOnes = ticketStatuses.filter((s) => s.behaviorType !== 'closed').map((s) => ({ value: s.name, label: s.name }));
  return [...BASE_STATUS_OPTIONS, ...openOnes, { value: 'closed', label: 'Closed' }];
}

const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PRIORITY_META = {
  critical: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};
// Hardcoded colors (not theme CSS variables) per spec — identifies how a
// ticket entered the system, should read the same regardless of theme.
const SOURCE_META = {
  manual: { label: 'Manual', color: '#64748b', icon: null },
  email: { label: 'Email', color: '#2563eb', icon: IconMail },
  phone: { label: 'Phone', color: '#16a34a', icon: IconPhone },
  portal: { label: 'Portal', color: '#7c3aed', icon: IconWorld },
};

const FIXED_COLUMNS = ['id', 'title'];
const DEFAULT_COLUMN_ORDER = [
  'priority', 'status', 'dueDate', 'assignee', 'type', 'source', 'team', 'timeLogged', 'createdDate', 'actions',
];
const COLUMN_LABELS = {
  id: '#',
  title: 'Title',
  priority: 'Priority',
  status: 'Status',
  dueDate: 'Due date',
  assignee: 'Assignee',
  type: 'Type',
  source: 'Source',
  team: 'Team',
  timeLogged: 'Time logged',
  createdDate: 'Created date',
  actions: 'Actions',
};
const SORTABLE_COLUMNS = { id: 'id', title: 'title', priority: 'priority', status: 'status', dueDate: 'dueDate', createdDate: 'createdAt' };
const COLUMN_STORAGE_KEY = 'prism.tickets.columns.v1';
// Custom field columns (prefixed "cf:") are only sortable when the
// underlying value is a simple, comparable scalar.
const SORTABLE_CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'dropdown'];

function formatCustomFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field.fieldType === 'checkbox') return value === 'true' ? 'Yes' : 'No';
  if (field.fieldType === 'multiselect') return Array.isArray(value) ? value.join(', ') : String(value);
  if (field.fieldType === 'datetime') return new Date(value).toLocaleString();
  return String(value);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// `behaviorByName` is a Map<statusName, behaviorType> built from the
// fetched ticket-statuses list — a custom or renamed status is classified
// correctly immediately, since this reads live data rather than a fixed
// list of status name strings.
function isClosedStatus(status, behaviorByName) {
  return behaviorByName.get(status) === 'closed';
}

function ageDays(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
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

function Avatar({ name }) {
  if (!name) {
    return <span className="text-sm" style={{ color: MUTED }}>Unassigned</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={{ backgroundColor: BORDER, color: 'var(--color-accent)' }}
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

function SourceCell({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.manual;
  const Icon = meta.icon;
  return (
    <span
      className="flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, transparent)`, color: meta.color }}
    >
      {Icon && <Icon size={11} />}
      {meta.label}
    </span>
  );
}

// Colored from the status's own `color` field (set on Settings -> Statuses),
// not a hardcoded name-to-color map — so a custom status renders correctly
// with no code change.
function StatusBadge({ ticket, ticketStatuses }) {
  const meta = ticketStatuses.find((s) => s.name === ticket.status);
  const color = meta?.color || MUTED;
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, color }}
    >
      {ticket.status}
    </span>
  );
}

function DueDateCell({ dueDate }) {
  if (!dueDate) return <span className="text-sm" style={{ color: MUTED }}>—</span>;
  const today = todayStr();
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonStr = soon.toISOString().slice(0, 10);
  let color = MUTED;
  if (dueDate < today) color = 'var(--color-danger)';
  else if (dueDate <= soonStr) color = 'var(--color-warning)';
  return <span className="text-sm" style={{ color }}>{dueDate}</span>;
}

function AgeLine({ ticket, behaviorByName }) {
  if (isClosedStatus(ticket.status, behaviorByName)) return null;
  const days = ageDays(ticket.createdAt);
  let color = MUTED;
  if (days > 10) color = 'var(--color-danger)';
  else if (days > 5) color = 'var(--color-warning)';
  return <p className="text-xs" style={{ color }}>Open {days} day{days === 1 ? '' : 's'}</p>;
}

// Small colored pill showing which department a ticket belongs to — only
// rendered for tickets.view_all users (dept-scoped users already know
// they're only seeing their own department's tickets).
function DeptPill({ name }) {
  if (!name) return null;
  return (
    <span
      className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}
    >
      {name}
    </span>
  );
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
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); setName(''); setShowSave(false); }
                  }}
                />
                <button
                  type="button"
                  onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); setShowSave(false); } }}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{ backgroundColor: BLUE, color: 'white' }}
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

function ColumnsMenu({ order, visible, customFields, onChange }) {
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
          {customFields.length > 0 && (
            <>
              <p className="mt-1 border-t px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide" style={{ borderColor: BORDER, color: MUTED }}>
                Custom fields
              </p>
              {customFields.map((f) => {
                const key = `cf:${f.fieldKey}`;
                return (
                  <div
                    key={key}
                    onClick={() => toggle(key)}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-white/5"
                    style={{ color: TEXT }}
                  >
                    <input
                      type="checkbox"
                      checked={!!visible[key]}
                      onChange={() => toggle(key)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-blue-500"
                    />
                    <span className="flex-1">{f.label}</span>
                  </div>
                );
              })}
            </>
          )}
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

// ---- Main page ----

export default function Tickets() {
  const { isStaff } = useAuth();
  const canCreateTickets = usePermission('tickets.create');
  const canViewAllTickets = usePermission('tickets.view_all');
  const canAssignTickets = usePermission('tickets.assign');
  const canCloseTickets = usePermission('tickets.close');
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [ticketStatuses, setTicketStatuses] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [activeSavedFilterId, setActiveSavedFilterId] = useState(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [myTickets, setMyTickets] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [newFromEmail, setNewFromEmail] = useState(false);
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' });

  const [view, setView] = useState('table');
  const [columnPrefs, setColumnPrefs] = useState(loadColumnPrefs);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkActionType, setBulkActionType] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Bulk bar mount/unmount is delayed slightly on the way out so the
  // slide-out/fade-out CSS animation gets a chance to play before the
  // element actually leaves the DOM.
  const [showBulkBar, setShowBulkBar] = useState(false);
  const [bulkBarClosing, setBulkBarClosing] = useState(false);
  const bulkBarCloseTimer = useRef(null);
  useEffect(() => {
    if (selectedIds.size > 0) {
      clearTimeout(bulkBarCloseTimer.current);
      setBulkBarClosing(false);
      setShowBulkBar(true);
    } else if (showBulkBar) {
      setBulkBarClosing(true);
      bulkBarCloseTimer.current = setTimeout(() => {
        setShowBulkBar(false);
        setBulkBarClosing(false);
      }, 180);
    }
    return () => clearTimeout(bulkBarCloseTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.size]);

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnPrefs));
  }, [columnPrefs]);

  // Active custom fields, offered as optional table columns (Columns menu ->
  // "Custom fields" section) regardless of the viewer's own admin status —
  // GET /custom-fields returns inactive fields too for admins, so filter
  // client-side to active-only here.
  useEffect(() => {
    api.get('/custom-fields').then(({ data }) => setCustomFieldDefs(data.customFields.filter((f) => f.isActive))).catch(() => {});
  }, []);
  const sortableCustomFieldKeys = useMemo(
    () => new Set(customFieldDefs.filter((f) => SORTABLE_CUSTOM_FIELD_TYPES.includes(f.fieldType)).map((f) => `cf:${f.fieldKey}`)),
    [customFieldDefs]
  );

  useEffect(() => {
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    api.get('/saved-filters').then(({ data }) => setSavedFilters(data.savedFilters)).catch(() => {});
    api.get('/ticket-statuses').then(({ data }) => setTicketStatuses(data.statuses)).catch(() => {});
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
    if (newFromEmail) { params.source = 'email'; params.unassigned = 'true'; }
    params.sortBy = SORTABLE_COLUMNS[sort.key] || 'updatedAt';
    params.sortDir = sort.dir;

    api
      .get('/tickets', { params })
      .then(({ data }) => setTickets(data.tickets))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [search, status, priority, assignee, myTickets, overdue, unassigned, newFromEmail, sort]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const toggleSort = (colKey) => {
    if (!SORTABLE_COLUMNS[colKey] && !sortableCustomFieldKeys.has(colKey)) return;
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
    setNewFromEmail(!!fj.newFromEmail);
    if (fj.sortKey) setSort({ key: fj.sortKey, dir: fj.sortDir || 'desc' });
    setActiveSavedFilterId(f.id);
  };

  const saveCurrentFilter = async (name) => {
    const filterJson = { search, status, priority, assignee, myTickets, overdue, unassigned, newFromEmail, sortKey: sort.key, sortDir: sort.dir };
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
  const toggleNewFromEmail = () => { clearActiveSavedFilter(); setNewFromEmail((v) => !v); };

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
      else changes = { status: 'Closed' };
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
  const visibleCustomFieldColumns = useMemo(
    () => customFieldDefs.filter((f) => columnPrefs.visible[`cf:${f.fieldKey}`]),
    [customFieldDefs, columnPrefs]
  );

  // The backend only understands built-in sort columns, so a custom-field
  // sort is applied client-side to the already-fetched list instead of
  // round-tripping with a ?sortBy it wouldn't recognize.
  const sortedTickets = useMemo(() => {
    if (!sort.key.startsWith('cf:')) return tickets;
    const fieldKey = sort.key.slice(3);
    const field = customFieldDefs.find((f) => f.fieldKey === fieldKey);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...tickets].sort((a, b) => {
      const av = a.customFields?.[fieldKey];
      const bv = b.customFields?.[fieldKey];
      if (field?.fieldType === 'number') return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });
  }, [tickets, sort, customFieldDefs]);

  const behaviorByName = useMemo(
    () => new Map(ticketStatuses.map((s) => [s.name, s.behaviorType])),
    [ticketStatuses]
  );

  // One column per ticket status (ordered by its admin-configured position),
  // grouped by the ticket's actual status — not a fixed set of derived
  // buckets. Archived statuses are hidden from this default board view.
  const boardColumns = useMemo(() => {
    const cols = ticketStatuses
      .filter((s) => s.behaviorType !== 'archived')
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ ...s, tickets: [] }));
    const byName = new Map(cols.map((c) => [c.name, c]));
    tickets.forEach((t) => {
      const col = byName.get(t.status);
      if (col) col.tickets.push(t);
    });
    return cols;
  }, [tickets, ticketStatuses]);

  const filterButtonCls = (active) =>
    `rounded-md border px-3 py-2 text-sm font-medium transition ${active ? 'text-white' : ''}`;

  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;

  return (
    <div style={{ margin: '-2rem -1.5rem', padding: 0, height: '100vh' }} className="flex flex-col overflow-hidden bg-navy-50">
      <div className="flex-shrink-0 space-y-3 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Tickets</h1>
          {canCreateTickets && <Link to="/tickets/new" className="btn-primary">+ New Ticket</Link>}
        </div>

        {/* Toolbar — single row on desktop (lg: 1024px+), wraps on tablet/mobile. */}
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <input
            value={search}
            onChange={(e) => setSearchTracked(e.target.value)}
            placeholder="Search by ticket number, title, or keyword…"
            className="input h-9 min-w-[220px] flex-1 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          />
          <select
            value={status}
            onChange={(e) => setStatusTracked(e.target.value)}
            className="input h-9 max-w-[10rem] flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          >
            {buildStatusFilterOptions(ticketStatuses).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriorityTracked(e.target.value)}
            className="input h-9 max-w-[10rem] flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          >
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={assignee}
            onChange={(e) => setAssigneeTracked(e.target.value)}
            className="input h-9 max-w-[11rem] flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          >
            <option value="">All assignees</option>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>

          <button
            type="button"
            onClick={toggleMyTickets}
            className={`${filterButtonCls(myTickets)} flex-shrink-0`}
            style={{ borderColor: myTickets ? BLUE : BORDER, backgroundColor: myTickets ? BLUE : CARD_BG, color: myTickets ? 'white' : TEXT }}
          >
            My tickets
          </button>
          <button
            type="button"
            onClick={toggleOverdue}
            className={`${filterButtonCls(overdue)} flex-shrink-0`}
            style={{ borderColor: overdue ? 'var(--color-danger)' : BORDER, backgroundColor: overdue ? 'var(--color-danger)' : CARD_BG, color: overdue ? 'white' : TEXT }}
          >
            Overdue
          </button>
          <button
            type="button"
            onClick={toggleUnassigned}
            className={`${filterButtonCls(unassigned)} flex-shrink-0`}
            style={{ borderColor: unassigned ? BLUE : BORDER, backgroundColor: unassigned ? BLUE : CARD_BG, color: unassigned ? 'white' : TEXT }}
          >
            Unassigned
          </button>
          <button
            type="button"
            onClick={toggleNewFromEmail}
            title="Unassigned tickets created from inbound email"
            className={`${filterButtonCls(newFromEmail)} flex-shrink-0 flex items-center gap-1.5`}
            style={{ borderColor: newFromEmail ? '#2563eb' : BORDER, backgroundColor: newFromEmail ? '#2563eb' : CARD_BG, color: newFromEmail ? 'white' : TEXT }}
          >
            <IconMail size={13} />
            New from email
          </button>

          <div className="flex flex-shrink-0 items-center gap-2">
            <SavedFiltersMenu
              savedFilters={savedFilters}
              activeId={activeSavedFilterId}
              onApply={applySavedFilter}
              onSave={saveCurrentFilter}
              onDelete={deleteSavedFilter}
            />
            <ColumnsMenu order={columnPrefs.order} visible={columnPrefs.visible} customFields={customFieldDefs} onChange={setColumnPrefs} />

            <div className="flex rounded-md border" style={{ borderColor: BORDER }}>
              <button
                type="button"
                onClick={() => setView('table')}
                className="rounded-l-md px-3 py-2 text-sm font-medium"
                style={{ backgroundColor: view === 'table' ? BLUE : CARD_BG, color: view === 'table' ? 'white' : TEXT }}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setView('board')}
                className="rounded-r-md px-3 py-2 text-sm font-medium"
                style={{ backgroundColor: view === 'board' ? BLUE : CARD_BG, color: view === 'board' ? 'white' : TEXT }}
              >
                Board
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md p-4 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Bulk action bar — a full-width strip flush between the toolbar and
          the table (no rounded corners, no floating card). Tinted with the
          accent color at low opacity so it reads as distinct from both. */}
      {isStaff && view === 'table' && showBulkBar && (
        <div
          className={`flex flex-shrink-0 items-center ${bulkBarClosing ? 'bulk-bar--closing' : 'bulk-bar--opening'}`}
          style={{
            gap: '12px',
            padding: '8px 16px',
            backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
          }}
        >
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4 flex-shrink-0 accent-blue-500" />
          <span className="flex-shrink-0 whitespace-nowrap font-medium" style={{ color: BLUE, fontSize: '13px' }}>
            {selectedIds.size} selected
          </span>

          <span className="flex-shrink-0 whitespace-nowrap" style={{ color: MUTED, fontSize: '12px' }}>Action:</span>
          <select
            value={bulkActionType}
            onChange={(e) => { setBulkActionType(e.target.value); setBulkValue(''); }}
            className="input h-9 max-w-[11rem] flex-shrink-0 text-sm"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          >
            <option value="">Choose action…</option>
            <option value="status">Change status</option>
            <option value="priority">Change priority</option>
            {canAssignTickets && <option value="reassign">Reassign</option>}
            {canCloseTickets && <option value="close">Close selected</option>}
          </select>
          {bulkActionType === 'status' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[9rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
              <option value="">Select status…</option>
              {ticketStatuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          )}
          {bulkActionType === 'priority' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[9rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
              <option value="">Select priority…</option>
              {PRIORITY_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {bulkActionType === 'reassign' && (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[11rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
              <option value="">Select assignee…</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={applyBulkAction}
            disabled={bulkSaving || !bulkActionType || (bulkActionType !== 'close' && !bulkValue)}
            className="flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: BLUE }}
          >
            Apply
          </button>

          <button
            type="button"
            onClick={clearSelection}
            className="flex-shrink-0 whitespace-nowrap text-sm hover:underline"
            style={{ color: MUTED, marginLeft: 'auto' }}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Scrollable content — the page itself never scrolls; this region does.
          overflow (both axes) lives on this single element, not a nested
          wrapper — CSS computes overflow-x/overflow-y as a pair, so an inner
          `overflow-x-auto` div would silently become its own scrolling
          context and break the table header's `position: sticky`, which
          resolves against the *nearest* scrolling ancestor. */}
      <div className="px-6 pb-6" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : view === 'board' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {boardColumns.map((col) => (
              <div
                key={col.id}
                className="rounded-[10px] border"
                style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
              >
                <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: BORDER }}>
                  <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
                    {col.name}
                  </h2>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: `color-mix(in srgb, ${col.color} 13%, transparent)`, color: col.color }}
                  >
                    {col.tickets.length}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  {col.tickets.length === 0 && <p className="text-xs" style={{ color: MUTED }}>No tickets.</p>}
                  {col.tickets.map((t) => {
                    // Overdue is shown as a highlight on the card, not a
                    // separate column — a ticket keeps its real status column
                    // and is flagged red only while that status is still open.
                    const isOverdue = col.behaviorType === 'open' && t.dueDate && t.dueDate < todayStr();
                    return (
                      <div
                        key={t.id}
                        onClick={() => navigate(`/tickets/${t.id}`)}
                        className="cursor-pointer rounded-md border p-3 transition hover:opacity-90"
                        style={{ backgroundColor: BG, borderColor: isOverdue ? 'var(--color-danger)' : BORDER }}
                      >
                        <p className="font-mono text-xs" style={{ color: isOverdue ? 'var(--color-danger)' : MUTED }}>{formatTicketId(t)}</p>
                        <p className="mt-1 truncate text-sm font-medium" style={{ color: isOverdue ? 'var(--color-danger)' : TEXT }}>{t.title}</p>
                        {canViewAllTickets && t.department?.name && <DeptPill name={t.department.name} />}
                        <div className="mt-2 flex items-center justify-between">
                          <PriorityCell priority={t.priority} />
                          <Avatar name={t.assignee?.displayName} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <table className="min-w-full">
              <thead>
                <tr>
                  {isStaff && (
                    <th
                      className="w-10 px-4 py-3"
                      style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}` }}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
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
                      style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}
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
                      style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}
                    >
                      {COLUMN_LABELS[key]}
                      <SortIcon active={sort.key === key} dir={sort.dir} />
                    </th>
                  ))}
                  {visibleCustomFieldColumns.map((f) => {
                    const key = `cf:${f.fieldKey}`;
                    const sortable = sortableCustomFieldKeys.has(key);
                    return (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide ${sortable ? 'cursor-pointer' : ''}`}
                        style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: CARD_BG, borderBottom: `1px solid ${BORDER}`, color: MUTED }}
                      >
                        {f.label}
                        {sortable && <SortIcon active={sort.key === key} dir={sort.dir} />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-sm" style={{ color: MUTED }} colSpan={(isStaff ? 1 : 0) + 2 + visibleColumns.length + visibleCustomFieldColumns.length}>
                      No tickets found.
                    </td>
                  </tr>
                )}
                {sortedTickets.map((t) => (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} className="accent-blue-500" />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm" style={{ color: MUTED }}>{formatTicketId(t)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/tickets/${t.id}`} className="font-medium hover:underline" style={{ color: TEXT }}>{t.title}</Link>
                      {canViewAllTickets && <DeptPill name={t.department?.name} />}
                      <AgeLine ticket={t} behaviorByName={behaviorByName} />
                    </td>
                    {visibleColumns.map((key) => (
                      <td key={key} className="whitespace-nowrap px-4 py-3">
                        {key === 'priority' && <PriorityCell priority={t.priority} />}
                        {key === 'status' && <StatusBadge ticket={t} ticketStatuses={ticketStatuses} />}
                        {key === 'dueDate' && <DueDateCell dueDate={t.dueDate} />}
                        {key === 'assignee' && <Avatar name={t.assignee?.displayName} />}
                        {key === 'type' && <span className="text-sm capitalize" style={{ color: TEXT }}>{t.type}</span>}
                        {key === 'source' && <SourceCell source={t.source} />}
                        {key === 'team' && <span className="text-sm" style={{ color: TEXT }}>{t.team?.name || '—'}</span>}
                        {key === 'timeLogged' && <span className="text-sm" style={{ color: TEXT }}>{formatMinutes(t.timeLoggedMinutes)}</span>}
                        {key === 'createdDate' && <span className="text-sm" style={{ color: MUTED }}>{new Date(t.createdAt).toLocaleDateString()}</span>}
                        {key === 'actions' && (
                          <Link to={`/tickets/${t.id}`} className="text-sm" style={{ color: 'var(--color-accent)' }}>Open →</Link>
                        )}
                      </td>
                    ))}
                    {visibleCustomFieldColumns.map((f) => (
                      <td key={f.fieldKey} className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>
                        {formatCustomFieldValue(f, t.customFields?.[f.fieldKey])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
