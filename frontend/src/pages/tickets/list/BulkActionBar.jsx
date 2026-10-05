// The ticket list's bulk action strip, shown between the toolbar and the table
// while tickets are selected. The page owns all the state; this only renders it.
import { TEXT, MUTED, BLUE } from '../theme';
import { PRIORITY_OPTIONS } from './listHelpers';

export function BulkActionBar({
  bulkBarClosing,
  allSelected,
  toggleSelectAll,
  selectionCount,
  canOfferSelectAllMatching,
  selectAllMatching,
  setSelectAllMatching,
  pager,
  bulkActionType,
  setBulkActionType,
  bulkValue,
  setBulkValue,
  ticketStatuses,
  assignableUsers,
  canAssignTickets,
  canCloseTickets,
  applyBulkAction,
  bulkSaving,
  clearSelection,
}) {
  return (
    <div
      className={`flex flex-shrink-0 flex-wrap items-center ${bulkBarClosing ? 'bulk-bar--closing' : 'bulk-bar--opening'}`}
      style={{
        gap: '12px',
        padding: '8px 16px',
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
      }}
    >
      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4 flex-shrink-0 accent-blue-500" />
      <span className="flex-shrink-0 whitespace-nowrap font-medium" style={{ color: BLUE, fontSize: '13px' }}>
        {selectionCount.toLocaleString()} selected
      </span>
      {canOfferSelectAllMatching && !selectAllMatching && (
        <button
          type="button"
          onClick={() => setSelectAllMatching(true)}
          className="flex-shrink-0 whitespace-nowrap underline"
          style={{ color: BLUE, fontSize: '12px' }}
        >
          Select all {pager.total.toLocaleString()} matching
        </button>
      )}
      {selectAllMatching && (
        <button
          type="button"
          onClick={() => setSelectAllMatching(false)}
          className="flex-shrink-0 whitespace-nowrap underline"
          style={{ color: BLUE, fontSize: '12px' }}
        >
          Just this page
        </button>
      )}

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
  );
}
