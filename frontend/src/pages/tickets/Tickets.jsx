// Ticket list page: filters, table, board and bulk actions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CompanyFilter from '../../components/companies/CompanyFilter';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconMail } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { useAuth, usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import { formatTicketId } from '../../utils/ticketId';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/Pagination';
import {
  buildStatusFilterOptions,
  PRIORITY_OPTIONS,
  PRIORITY_META,
  COLUMN_LABELS,
  SORTABLE_COLUMNS,
  COLUMN_STORAGE_KEY,
  SORTABLE_CUSTOM_FIELD_TYPES,
  formatCustomFieldValue,
  formatMinutes,
  loadColumnPrefs,
} from './list/listHelpers';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE } from './theme';
import { SavedFiltersMenu } from './list/SavedFiltersMenu';
import { ColumnsMenu } from './list/ColumnsMenu';
import { BulkActionBar } from './list/BulkActionBar';
import { TicketBoard } from './list/TicketBoard';
import {
  Avatar,
  PriorityCell,
  SourceCell,
  StatusBadge,
  DueDateCell,
  AgeLine,
  DeptPill,
  SortIcon,
} from './list/Cells';

// ---- Main page ----

export default function Tickets() {
  const { isStaff } = useAuth();
  const canCreateTickets = usePermission('tickets.create');
  const canViewAllTickets = usePermission('tickets.view_all');
  const canAssignTickets = usePermission('tickets.assign');
  const canCloseTickets = usePermission('tickets.close');
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  // Board columns come from the server pre-grouped (GET /tickets/board) — the
  // browser only ever holds one page of the table, so it can't group the whole
  // pipeline itself any more.
  const [boardData, setBoardData] = useState([]);
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
  const [searchParams] = useSearchParams();
  const [companyId, setCompanyId] = useState(searchParams.get('companyId') || '');
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' });

  // Any change to a filter has to send the table back to page 1 — otherwise
  // narrowing the results while on page 5 shows an empty table.
  const filterKey = JSON.stringify([search, status, priority, assignee, companyId, myTickets, overdue, unassigned, newFromEmail, sort]);
  const pager = usePagination({ filterKey, storageKey: 'prism.tickets.pageSize' });

  const [view, setView] = useState('table');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnPrefs, setColumnPrefs] = useState(loadColumnPrefs);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // "Select all" on a paginated table selects the visible page. This flag is
  // the explicit opt-in to act on every ticket matching the current filters,
  // including the ones not on screen — an unmissable second step, because a
  // bulk edit that silently covers more than you can see is the dangerous
  // version of this feature.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
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

  // Filters shared by the table listing and the board.
  const filterParams = useCallback(() => {
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (status) params.status = status;
    if (priority) params.priority = priority;
    if (assignee) params.assignee = assignee;
    if (companyId) params.companyId = companyId;
    if (myTickets) params.myTickets = 'true';
    if (overdue) params.overdue = 'true';
    if (unassigned) params.unassigned = 'true';
    if (newFromEmail) { params.source = 'email'; params.unassigned = 'true'; }
    // A `cf:`-prefixed key is passed through as-is — the server resolves it
    // to the custom field and sorts on its value in SQL. (This used to be
    // sorted in the browser, which only works while the whole result set is
    // in memory.)
    params.sortBy = sort.key.startsWith('cf:') ? sort.key : (SORTABLE_COLUMNS[sort.key] || 'updatedAt');
    params.sortDir = sort.dir;
    return params;
  }, [search, status, priority, assignee, companyId, myTickets, overdue, unassigned, newFromEmail, sort]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = filterParams();

    if (view === 'board') {
      api
        .get('/tickets/board', { params })
        .then(({ data }) => setBoardData(data.columns))
        .catch((err) => setError(errMessage(err)))
        .finally(() => setLoading(false));
      return;
    }

    api
      .get('/tickets', { params: { ...params, ...pager.params } })
      .then(({ data }) => {
        setTickets(data.tickets);
        pager.applyMeta(data);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParams, view, pager.page, pager.limit]);

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
    // Always operates on the visible page. Extending to every match is a
    // separate, explicit action (see selectAllMatching).
    setSelectAllMatching(false);
    setSelectedIds((prev) => (prev.size === tickets.length ? new Set() : new Set(tickets.map((t) => t.id))));
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
    setBulkActionType('');
    setBulkValue('');
  };

  const applyBulkAction = async () => {
    if (!selectedIds.size || !bulkActionType) return;
    if (bulkActionType !== 'close' && !bulkValue) return;
    setBulkSaving(true);
    try {
      // When the user opted into "all N matching", the ids beyond the current
      // page have to be fetched before anything is patched — the page only
      // holds the rows on screen.
      let ids = [...selectedIds];
      if (selectAllMatching) {
        const { data } = await api.get('/tickets', { params: { ...filterParams(), limit: 'all' } });
        ids = data.tickets.map((t) => t.id);
      }
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
  // Every sort — plain columns and custom fields alike — is resolved by the
  // server across the whole result set. Sorting here would only ever reorder
  // the page on screen, which looks like a broken sort.
  const sortedTickets = tickets;

  const behaviorByName = useMemo(
    () => new Map(ticketStatuses.map((s) => [s.name, s.behaviorType])),
    [ticketStatuses]
  );

  // One column per ticket status (ordered by its admin-configured position),
  // grouped by the ticket's actual status — not a fixed set of derived
  // buckets. Archived statuses are hidden from this default board view.
  // Shaped by the server: one entry per non-archived status, each carrying
  // its capped ticket list plus the true total behind it.
  const boardColumns = useMemo(
    () => boardData.map((c) => ({ ...c.status, tickets: c.tickets, total: c.total, cap: c.limit })),
    [boardData]
  );

  const filterButtonCls = (active) =>
    `rounded-md border px-3 py-2 text-sm font-medium transition ${active ? 'text-white' : ''}`;

  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;
  // The whole page is ticked and there are more matches behind it — offer to
  // extend the selection rather than pretending the page is everything.
  const canOfferSelectAllMatching = allSelected && pager.total > tickets.length;
  const selectionCount = selectAllMatching ? pager.total : selectedIds.size;
  const activeFilterCount = [status, priority, assignee].filter(Boolean).length;

  return (
    <div style={{ padding: 0, height: '100vh' }} className="-mx-3 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8">
      <div className="flex-shrink-0 space-y-3 px-3 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }}>Tickets</h1>
          {canCreateTickets && <Link to="/tickets/new" className="btn-primary hidden lg:inline-flex">+ New Ticket</Link>}
        </div>

        {/* Toolbar — single row on desktop (lg: 1024px+); search gets its own
            full-width row and filters collapse into a bottom-sheet button on
            mobile/tablet. */}
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          <input
            value={search}
            onChange={(e) => setSearchTracked(e.target.value)}
            placeholder="Search by ticket number, title, or keyword…"
            className="input h-9 w-full text-sm lg:min-w-[220px] lg:max-w-none lg:flex-1"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
          />

          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex h-10 flex-shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: BORDER, backgroundColor: CARD_BG, color: TEXT }}
            >
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-[3px] px-1 text-xs font-semibold text-white" style={{ backgroundColor: BLUE }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
            <div className="flex flex-shrink-0 rounded-md border" style={{ borderColor: BORDER }}>
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

          {/* Desktop-inline filter selects (1024px+) */}
          <div className="hidden lg:contents">
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
            <CompanyFilter value={companyId} onChange={setCompanyId} style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }} />
            <select
              value={assignee}
              onChange={(e) => setAssigneeTracked(e.target.value)}
              className="input h-9 max-w-[11rem] flex-shrink-0 text-sm"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
            >
              <option value="">All assignees</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>

          {/* Quick-filter chips — horizontally scrollable on mobile/tablet, inline on desktop. */}
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:contents lg:overflow-visible lg:px-0 lg:pb-0">
            <button
              type="button"
              onClick={toggleMyTickets}
              className={`${filterButtonCls(myTickets)} flex-shrink-0 whitespace-nowrap`}
              style={{ borderColor: myTickets ? BLUE : BORDER, backgroundColor: myTickets ? BLUE : CARD_BG, color: myTickets ? 'white' : TEXT }}
            >
              My tickets
            </button>
            <button
              type="button"
              onClick={toggleOverdue}
              className={`${filterButtonCls(overdue)} flex-shrink-0 whitespace-nowrap`}
              style={{ borderColor: overdue ? 'var(--color-danger)' : BORDER, backgroundColor: overdue ? 'var(--color-danger)' : CARD_BG, color: overdue ? 'white' : TEXT }}
            >
              Overdue
            </button>
            <button
              type="button"
              onClick={toggleUnassigned}
              className={`${filterButtonCls(unassigned)} flex-shrink-0 whitespace-nowrap`}
              style={{ borderColor: unassigned ? BLUE : BORDER, backgroundColor: unassigned ? BLUE : CARD_BG, color: unassigned ? 'white' : TEXT }}
            >
              Unassigned
            </button>
            <button
              type="button"
              onClick={toggleNewFromEmail}
              title="Unassigned tickets created from inbound email"
              className={`${filterButtonCls(newFromEmail)} flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap`}
              style={{ borderColor: newFromEmail ? '#2563eb' : BORDER, backgroundColor: newFromEmail ? '#2563eb' : CARD_BG, color: newFromEmail ? 'white' : TEXT }}
            >
              <IconMail size={13} />
              New from email
            </button>
          </div>

          <div className="hidden flex-shrink-0 items-center gap-2 lg:flex">
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
        <BulkActionBar
          bulkBarClosing={bulkBarClosing}
          allSelected={allSelected}
          toggleSelectAll={toggleSelectAll}
          selectionCount={selectionCount}
          canOfferSelectAllMatching={canOfferSelectAllMatching}
          selectAllMatching={selectAllMatching}
          setSelectAllMatching={setSelectAllMatching}
          pager={pager}
          bulkActionType={bulkActionType}
          setBulkActionType={setBulkActionType}
          bulkValue={bulkValue}
          setBulkValue={setBulkValue}
          ticketStatuses={ticketStatuses}
          assignableUsers={assignableUsers}
          canAssignTickets={canAssignTickets}
          canCloseTickets={canCloseTickets}
          applyBulkAction={applyBulkAction}
          bulkSaving={bulkSaving}
          clearSelection={clearSelection}
        />
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
          <TicketBoard
            boardColumns={boardColumns}
            canViewAllTickets={canViewAllTickets}
            navigate={navigate}
          />
        ) : (
          <>
            {/* Card view — mobile/tablet (below md: 768px) */}
            <div className="space-y-2 md:hidden">
              {tickets.length === 0 && (
                <p className="px-1 py-6 text-center text-sm" style={{ color: MUTED }}>No tickets found.</p>
              )}
              {sortedTickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className="cursor-pointer rounded-[10px] border p-3"
                  style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
                >
                  <div className="flex items-start gap-2">
                    {isStaff && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 h-5 w-5 flex-shrink-0 accent-blue-500"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs" style={{ color: MUTED }}>{formatTicketId(t)}</span>
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: (PRIORITY_META[t.priority] || PRIORITY_META.medium).color }} title={(PRIORITY_META[t.priority] || PRIORITY_META.medium).label} />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-medium" style={{ color: TEXT }}>{t.title}</p>
                      {canViewAllTickets && t.department?.name && <DeptPill name={t.department.name} />}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <StatusBadge ticket={t} ticketStatuses={ticketStatuses} />
                        <DueDateCell dueDate={t.dueDate} />
                      </div>
                      <div className="mt-2">
                        <Avatar name={t.assignee?.displayName} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Table view — desktop/laptop (md: 768px+) */}
            <div className="hidden rounded-[10px] border md:block" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
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
          </>
        )}
      </div>

      {/* Outside the scrolling region so the controls stay put while the table
          scrolls. Hidden on the board, which is capped per column instead. */}
      {!loading && view !== 'board' && (
        <div style={{ backgroundColor: CARD_BG, flex: '0 0 auto' }}>
          <Pagination
            page={pager.page}
            limit={pager.limit}
            total={pager.total}
            totalPages={pager.totalPages}
            onPageChange={(next) => { pager.setPage(next); clearSelection(); }}
            onLimitChange={(next) => { pager.setLimit(next); clearSelection(); }}
          />
        </div>
      )}

      {canCreateTickets && (
        <Link
          to="/tickets/new"
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold text-white shadow-lg lg:hidden"
          style={{ backgroundColor: BLUE }}
          aria-label="New ticket"
        >
          +
        </Link>
      )}

      {filtersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setFiltersOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t p-4"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: TEXT }}>Filters</h3>
              <button type="button" onClick={() => setFiltersOpen(false)} className="text-sm font-medium" style={{ color: BLUE }}>
                Done
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatusTracked(e.target.value)}
                  className="input h-11 text-sm"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
                >
                  {buildStatusFilterOptions(ticketStatuses).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriorityTracked(e.target.value)}
                  className="input h-11 text-sm"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
                >
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Assignee</label>
                <select
                  value={assignee}
                  onChange={(e) => setAssigneeTracked(e.target.value)}
                  className="input h-11 text-sm"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
                >
                  <option value="">All assignees</option>
                  {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <SavedFiltersMenu
                  savedFilters={savedFilters}
                  activeId={activeSavedFilterId}
                  onApply={applySavedFilter}
                  onSave={saveCurrentFilter}
                  onDelete={deleteSavedFilter}
                />
                <span className="text-xs" style={{ color: MUTED }}>Saved filters</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
