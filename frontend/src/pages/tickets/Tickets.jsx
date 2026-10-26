// Ticket list page: filters, table, board and bulk actions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CompanyFilter from '../../components/companies/CompanyFilter';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  IconAdjustmentsHorizontal, IconMail, IconPlus, IconSearch,
} from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { useAuth, usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import SlaBadge from '../../components/SlaBadge';
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
import CategoryPicker from '../../components/CategoryPicker';
import { TicketBoard } from './list/TicketBoard';
import FiltersSheet from '../../components/ui/FiltersSheet';
import PillRow from '../../components/ui/PillRow';
import { useFullPageHeight } from '../../hooks/useFullPageHeight';
import PageHeader from '../../components/ui/PageHeader';
import Pill from '../../components/ui/Pill';
import SelectChip from '../../components/ui/SelectChip';
import { ViewToggle } from './list/ViewToggle';
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
  const { isStaff, user } = useAuth();
  const canCreateTickets = usePermission('tickets.create');
  const canViewAllTickets = usePermission('tickets.view_all');
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
  const [category, setCategory] = useState(null);
  const [categories, setCategories] = useState([]);
  const [assignee, setAssignee] = useState('');
  const [myTickets, setMyTickets] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [slaFilter, setSlaFilter] = useState(''); // '' | 'breached' | 'at_risk'
  const [newFromEmail, setNewFromEmail] = useState(false);
  const [searchParams] = useSearchParams();
  const [companyId, setCompanyId] = useState(searchParams.get('companyId') || '');
  // Queue view (5b): '' = no queue, 'mine' = every team I'm in, or a team id.
  // A queue sorts unassigned first, then earliest SLA due (server side), until
  // a column header is clicked.
  const [queue, setQueue] = useState(searchParams.get('queue') || '');
  const [teams, setTeams] = useState([]);
  const [sort, setSort] = useState(() => (searchParams.get('queue') ? { key: 'queue', dir: 'asc' } : { key: 'updatedAt', dir: 'desc' }));

  // Any change to a filter has to send the table back to page 1 — otherwise
  // narrowing the results while on page 5 shows an empty table.
  const filterKey = JSON.stringify([search, status, priority, category, assignee, companyId, myTickets, overdue, unassigned, slaFilter, newFromEmail, queue, sort]);
  const pager = usePagination({ filterKey, storageKey: 'prism.tickets.pageSize' });

  const [view, setView] = useState('table');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pageHeight = useFullPageHeight();
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
    api.get('/teams').then(({ data }) => setTeams(data.teams || [])).catch(() => {});
    api.get('/ticket-categories').then(({ data }) => setCategories(data.categories || [])).catch(() => {});
  }, []);
  const myTeams = useMemo(
    () => teams.filter((t) => (t.memberships || []).some((m) => m.userId === user?.id)),
    [teams, user]
  );
  // A single team can be picked if I'm in it, or if I can see every ticket.
  const queueTeams = canViewAllTickets ? teams : myTeams;

  const clearActiveSavedFilter = () => setActiveSavedFilterId(null);

  // Filters shared by the table listing and the board.
  const filterParams = useCallback(() => {
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (status) params.status = status;
    if (priority) params.priority = priority;
    // A category includes everything below it (server side).
    if (category) params.category = category;
    if (assignee) params.assignee = assignee;
    if (companyId) params.companyId = companyId;
    if (myTickets) params.myTickets = 'true';
    if (overdue) params.overdue = 'true';
    if (unassigned) params.unassigned = 'true';
    if (slaFilter) params.sla = slaFilter;
    if (newFromEmail) { params.source = 'email'; params.unassigned = 'true'; }
    if (queue) params.queue = queue;
    // A `cf:`-prefixed key is passed through as-is — the server resolves it
    // to the custom field and sorts on its value in SQL. (This used to be
    // sorted in the browser, which only works while the whole result set is
    // in memory.)
    if (sort.key !== 'queue') {
      params.sortBy = sort.key.startsWith('cf:') ? sort.key : (SORTABLE_COLUMNS[sort.key] || 'updatedAt');
      params.sortDir = sort.dir;
    }
    return params;
  }, [search, status, priority, category, assignee, companyId, myTickets, overdue, unassigned, slaFilter, newFromEmail, queue, sort]);

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
    setCategory(fj.category || null);
    setAssignee(fj.assignee || '');
    setMyTickets(!!fj.myTickets);
    setOverdue(!!fj.overdue);
    setUnassigned(!!fj.unassigned);
    setSlaFilter(fj.sla || '');
    setNewFromEmail(!!fj.newFromEmail);
    if (fj.sortKey) setSort({ key: fj.sortKey, dir: fj.sortDir || 'desc' });
    setActiveSavedFilterId(f.id);
  };

  const saveCurrentFilter = async (name) => {
    const filterJson = { search, status, priority, category, assignee, myTickets, overdue, unassigned, sla: slaFilter, newFromEmail, sortKey: sort.key, sortDir: sort.dir };
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
  const setCategoryTracked = wrapFilterSetter(setCategory);
  const toggleMyTickets = () => { clearActiveSavedFilter(); setMyTickets((v) => !v); };
  const toggleOverdue = () => { clearActiveSavedFilter(); setOverdue((v) => !v); };
  const toggleUnassigned = () => { clearActiveSavedFilter(); setUnassigned((v) => !v); };
  const toggleSla = (kind) => () => { clearActiveSavedFilter(); setSlaFilter((v) => (v === kind ? '' : kind)); };
  const toggleNewFromEmail = () => { clearActiveSavedFilter(); setNewFromEmail((v) => !v); };
  const pickQueue = (value) => {
    clearActiveSavedFilter();
    setQueue(value);
    setSort(value ? { key: 'queue', dir: 'asc' } : { key: 'updatedAt', dir: 'desc' });
  };

  // Take it (5b): claim an unassigned queue ticket. A lost race shows the
  // server's "Already taken by X" and refreshes the list.
  const [taking, setTaking] = useState(null);
  const takeTicket = async (id) => {
    setTaking(id);
    try {
      await api.post(`/tickets/${id}/take`);
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setTaking(null);
      load();
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

  // Bulk actions run on the server (5b): one call per 100 tickets, each
  // ticket checked and logged like a single edit, with a result per ticket.
  const [bulkResult, setBulkResult] = useState(null);
  const applyBulkAction = async () => {
    if (!selectedIds.size || !bulkActionType) return;
    if (!['close', 'delete'].includes(bulkActionType) && !bulkValue) return;
    setBulkSaving(true);
    setBulkResult(null);
    try {
      // When the user opted into "all N matching", the ids beyond the current
      // page have to be fetched before anything is changed — the page only
      // holds the rows on screen.
      let ids = [...selectedIds];
      if (selectAllMatching) {
        const { data } = await api.get('/tickets', { params: { ...filterParams(), limit: 'all' } });
        ids = data.tickets.map((t) => t.id);
      }
      const action = bulkActionType === 'reassign' ? 'assign' : bulkActionType;
      let value = bulkValue || null;
      // "Remove the category" is sent as null.
      if (action === 'category' && bulkValue === 'none') value = null;
      if (action === 'merge') {
        const target = Number(String(bulkValue).replace(/[^0-9]/g, ''));
        if (!target) { alert('Enter the ticket number to merge into'); return; }
        value = target;
        ids = ids.filter((id) => id !== target);
        // A merge is all or nothing, so it can't be split into batches.
        if (ids.length > 100) { alert('Merge at most 100 tickets at once'); return; }
        if (!confirm(`Merge ${ids.length} ticket(s) into #${String(target).padStart(5, '0')}? Their comments, files, time and tasks move there, and they are closed.`)) return;
      }
      if (action === 'delete' && !confirm(`Delete ${ids.length} ticket(s)? This cannot be undone.`)) return;
      const results = [];
      for (let i = 0; i < ids.length; i += 100) {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await api.post('/tickets/bulk', { ids: ids.slice(i, i + 100), action, value });
        results.push(...data.results);
      }
      const failed = results.filter((r) => !r.ok);
      setBulkResult({ ok: results.length - failed.length, failed });
      if (!failed.length) clearSelection();
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

  const ticketCount = view === 'board' ? boardColumns.reduce((n, c) => n + c.total, 0) : pager.total;

  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;
  // The whole page is ticked and there are more matches behind it — offer to
  // extend the selection rather than pretending the page is everything.
  const canOfferSelectAllMatching = allSelected && pager.total > tickets.length;
  const selectionCount = selectAllMatching ? pager.total : selectedIds.size;
  const activeFilterCount = [status, priority, category, assignee].filter(Boolean).length;

  return (
    <div style={{ padding: 0, height: pageHeight }} className="-mx-3 -my-4 flex flex-col overflow-hidden bg-navy-50 sm:-mx-6 sm:-my-8">
      <div className="flex-shrink-0 space-y-3 px-4 pb-4 pt-5 sm:px-6 lg:px-12 lg:pt-8">
        <PageHeader
          title="Tickets"
          sub={loading ? undefined : `${ticketCount.toLocaleString()} ticket${ticketCount === 1 ? '' : 's'}`}
          actions={(
            <>
              <ViewToggle view={view} setView={setView} />
              <span className="hidden lg:contents">
                <ColumnsMenu order={columnPrefs.order} visible={columnPrefs.visible} customFields={customFieldDefs} onChange={setColumnPrefs} />
              </span>
              {canCreateTickets && (
                <Link to="/tickets/new" className="btn-primary hidden h-10 lg:inline-flex">
                  <IconPlus size={15} stroke={2.5} aria-hidden="true" />
                  New Ticket
                </Link>
              )}
            </>
          )}
        />

        {/* One wrapping row, reordered by width. Desktop: quick filters and
            saved filters, then search and the filter selects. Phone: search
            and the Filters button, then the quick filters scrolling
            sideways; the selects live in the Filters sheet. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <label className="relative order-1 min-w-0 flex-1 lg:order-4 lg:w-80 lg:flex-none">
            <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
            <input
              value={search}
              onChange={(e) => setSearchTracked(e.target.value)}
              placeholder="Search by ticket number, title, or keyword…"
              aria-label="Search tickets"
              className="input h-11 pl-9 text-sm lg:h-8 lg:pl-8 lg:text-[13px]"
            />
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="order-2 inline-flex h-11 flex-shrink-0 items-center gap-2 rounded-md border border-navy-100 bg-surface px-3 text-sm font-semibold text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent lg:hidden"
          >
            <IconAdjustmentsHorizontal size={16} aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-semibold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <div className="order-3 w-full min-w-0 lg:order-1 lg:w-auto lg:flex-1">
            <PillRow label="Quick filters" className="lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
              <Pill on={myTickets} onClick={toggleMyTickets}>My tickets</Pill>
              <Pill on={overdue} onClick={toggleOverdue}>Overdue</Pill>
              <Pill on={unassigned} onClick={toggleUnassigned}>Unassigned</Pill>
              <Pill on={slaFilter === 'breached'} onClick={toggleSla('breached')}>SLA breached</Pill>
              <Pill on={slaFilter === 'at_risk'} onClick={toggleSla('at_risk')}>SLA at risk</Pill>
              <Pill on={newFromEmail} onClick={toggleNewFromEmail} title="Unassigned tickets created from inbound email" className="inline-flex items-center gap-1.5">
                <IconMail size={14} aria-hidden="true" />
                New from email
              </Pill>
            </PillRow>
          </div>
          <div className="hidden lg:order-2 lg:block">
            <SavedFiltersMenu
              savedFilters={savedFilters}
              activeId={activeSavedFilterId}
              onApply={applySavedFilter}
              onSave={saveCurrentFilter}
              onDelete={deleteSavedFilter}
            />
          </div>
          <span aria-hidden="true" className="hidden lg:order-3 lg:block lg:basis-full" />
          <SelectChip label="Status" value={status} onChange={(e) => setStatusTracked(e.target.value)} className="max-lg:hidden lg:order-5">
            {buildStatusFilterOptions(ticketStatuses).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectChip>
          <SelectChip label="Priority" value={priority} onChange={(e) => setPriorityTracked(e.target.value)} className="max-lg:hidden lg:order-5">
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectChip>
          {categories.length > 0 && (
            <span className="contents max-lg:hidden" data-testid="filter-category-inline-box">
              <CategoryPicker categories={categories} value={category} onChange={setCategoryTracked} id="filter-category-inline" emptyLabel="All categories" compact includeRetiredValue />
            </span>
          )}
          <span className="contents max-lg:hidden">
            <CompanyFilter value={companyId} onChange={setCompanyId} className="sel lg:order-5" />
          </span>
          <SelectChip label="Assignee" value={assignee} onChange={(e) => setAssigneeTracked(e.target.value)} className="max-lg:hidden lg:order-5">
            <option value="">All assignees</option>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </SelectChip>
          {(myTeams.length > 0 || canViewAllTickets) && (
            // A scope rather than a filter, so it stays out of the sheet.
            <SelectChip label="Queue" value={queue} onChange={(e) => pickQueue(e.target.value)} data-testid="queue-picker" active={!!queue} showLabel={false} className="order-4 lg:order-5">
              <option value="">All tickets</option>
              {myTeams.length > 0 && <option value="mine">My queues</option>}
              {queueTeams.map((t) => <option key={t.id} value={String(t.id)}>Queue: {t.name}</option>)}
            </SelectChip>
          )}
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
      {isStaff && view === 'table' && !showBulkBar && bulkResult && (
        <div role="status" data-testid="bulk-result" className="mx-4 mb-3 flex flex-shrink-0 items-center gap-2 text-xs sm:mx-6 lg:mx-12" style={{ color: MUTED }}>
          {bulkResult.ok} updated.
          <button type="button" onClick={() => setBulkResult(null)} className="underline">dismiss</button>
        </div>
      )}
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
          teams={teams}
          categories={categories}
          bulkResult={bulkResult}
          setBulkResult={setBulkResult}
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
      <div className="px-4 pb-6 sm:px-6 lg:px-12" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
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
              {sortedTickets.map((t) => {
                const prio = PRIORITY_META[t.priority] || PRIORITY_META.medium;
                return (
                  <div
                    key={t.id}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                    className="cursor-pointer rounded-xl border border-navy-100 bg-surface p-3"
                    style={selectedIds.has(t.id) ? { borderColor: 'var(--color-accent)' } : undefined}
                  >
                    <div className="flex items-start gap-3">
                      {isStaff && (
                        <label className="-m-2 flex h-11 w-11 flex-shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            aria-label={`Select ${formatTicketId(t)}`}
                            className="h-5 w-5 accent-[var(--color-accent)]"
                          />
                        </label>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="num text-xs" style={{ color: MUTED }}>{formatTicketId(t)}</span>
                          <span className="flex items-center gap-1.5 text-xs" style={{ color: TEXT }}>
                            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: prio.color }} />
                            {prio.label}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: TEXT }}>{t.title}</p>
                        {canViewAllTickets && t.department?.name && <DeptPill name={t.department.name} className="ml-0 mt-1" />}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <StatusBadge ticket={t} ticketStatuses={ticketStatuses} />
                          <div className="flex items-center gap-2">
                            {t.sla?.worst && <SlaBadge sla={t.sla} />}
                            <DueDateCell dueDate={t.dueDate} />
                          </div>
                        </div>
                        <div className="mt-2">
                          <Avatar name={t.assignee?.displayName} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Table view — desktop/laptop (md: 768px+) */}
            <div className="hidden overflow-hidden rounded-xl border border-navy-100 bg-surface md:block">
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
                        className="accent-[var(--color-accent)]"
                      />
                    </th>
                  )}
                  {['id', 'title'].map((key) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className="cursor-pointer whitespace-nowrap px-4 py-3 text-left text-xs font-semibold"
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
                      className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold ${SORTABLE_COLUMNS[key] ? 'cursor-pointer' : ''}`}
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
                        className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold ${sortable ? 'cursor-pointer' : ''}`}
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
                  <tr key={t.id} className={selectedIds.has(t.id) ? '' : 'hover:bg-[var(--color-hover)]'} style={{ borderBottom: `1px solid ${BORDER}`, backgroundColor: selectedIds.has(t.id) ? 'var(--color-accent-soft)' : undefined }}>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} className="accent-[var(--color-accent)]" />
                      </td>
                    )}
                    <td className="num whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{formatTicketId(t)}</td>
                    <td className="min-w-[18rem] max-w-[28rem] px-4 py-3">
                      {t.queueOnly ? (
                        // Seen only as queue work: it opens once taken.
                        <span className="break-words font-semibold" style={{ color: TEXT }} title="Take it to open this ticket">{t.title}</span>
                      ) : (
                        <Link to={`/tickets/${t.id}`} className="break-words font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>{t.title}</Link>
                      )}
                      {canViewAllTickets && <DeptPill name={t.department?.name} />}
                      <AgeLine ticket={t} behaviorByName={behaviorByName} />
                    </td>
                    {visibleColumns.map((key) => (
                      <td key={key} className="whitespace-nowrap px-4 py-3">
                        {key === 'priority' && <PriorityCell priority={t.priority} />}
                        {key === 'status' && <StatusBadge ticket={t} ticketStatuses={ticketStatuses} />}
                        {key === 'dueDate' && <DueDateCell dueDate={t.dueDate} />}
                        {key === 'sla' && <SlaBadge sla={t.sla} />}
                        {key === 'assignee' && (queue && !t.assigneeId ? (
                          <button
                            type="button"
                            onClick={() => takeTicket(t.id)}
                            disabled={taking === t.id}
                            className="btn-primary h-7 px-2.5 text-xs"
                          >
                            {taking === t.id ? 'Taking…' : 'Take it'}
                          </button>
                        ) : <Avatar name={t.assignee?.displayName} />)}
                        {key === 'type' && <span className="text-sm capitalize" style={{ color: TEXT }}>{t.type}</span>}
                        {key === 'source' && <SourceCell source={t.source} />}
                        {key === 'team' && <span className="text-sm" style={{ color: TEXT }}>{t.team?.name || '—'}</span>}
                        {key === 'timeLogged' && <span className="text-sm" style={{ color: TEXT }}>{formatMinutes(t.timeLoggedMinutes)}</span>}
                        {key === 'createdDate' && <span className="text-sm" style={{ color: MUTED }}>{new Date(t.createdAt).toLocaleDateString()}</span>}
                        {key === 'actions' && (
                          <Link to={`/tickets/${t.id}`} className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>Open →</Link>
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
          className="fixed bottom-6 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold shadow-lg lg:hidden"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
          aria-label="New ticket"
        >
          +
        </Link>
      )}

      <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        <div>
          <label className="label" htmlFor="sheet-status">Status</label>
          <select id="sheet-status" value={status} onChange={(e) => setStatusTracked(e.target.value)} className="input h-11 text-sm">
            {buildStatusFilterOptions(ticketStatuses).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sheet-priority">Priority</label>
          <select id="sheet-priority" value={priority} onChange={(e) => setPriorityTracked(e.target.value)} className="input h-11 text-sm">
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {categories.length > 0 && (
          <div data-testid="filter-category">
            <label className="label" htmlFor="filter-category">Category</label>
            <CategoryPicker categories={categories} value={category} onChange={setCategoryTracked} id="filter-category" emptyLabel="All categories" includeRetiredValue />
          </div>
        )}
        <div>
          <label className="label" htmlFor="sheet-assignee">Assignee</label>
          <select id="sheet-assignee" value={assignee} onChange={(e) => setAssigneeTracked(e.target.value)} className="input h-11 text-sm">
            <option value="">All assignees</option>
            {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </div>
        <SavedFiltersMenu
          savedFilters={savedFilters}
          activeId={activeSavedFilterId}
          onApply={applySavedFilter}
          onSave={saveCurrentFilter}
          onDelete={deleteSavedFilter}
          align="left"
        />
      </FiltersSheet>
    </div>
  );
}
