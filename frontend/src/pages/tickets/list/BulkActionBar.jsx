// The ticket list's bulk action strip, shown between the toolbar and the table
// while tickets are selected. The page owns all the state; this only renders it.
import { PRIORITY_OPTIONS } from './listHelpers';
import CategoryPicker from '../../../components/CategoryPicker';

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
  teams = [],
  categories = [],
  bulkResult = null,
  setBulkResult = () => {},
  applyBulkAction,
  bulkSaving,
  clearSelection,
}) {
  return (
    <div
      className={`mx-4 mb-3 flex flex-shrink-0 flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] shadow-sm sm:mx-6 lg:mx-12 ${bulkBarClosing ? 'bulk-bar--closing' : 'bulk-bar--opening'}`}
      style={{ backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg)' }}
    >
      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all on this page" className="h-4 w-4 flex-shrink-0 accent-[var(--color-accent)]" />
      <span className="num flex-shrink-0 whitespace-nowrap font-bold">
        {selectionCount.toLocaleString()} selected
      </span>
      {canOfferSelectAllMatching && !selectAllMatching && (
        <button
          type="button"
          onClick={() => setSelectAllMatching(true)}
          className="flex-shrink-0 whitespace-nowrap underline"
        >
          Select all {pager.total.toLocaleString()} matching
        </button>
      )}
      {selectAllMatching && (
        <button
          type="button"
          onClick={() => setSelectAllMatching(false)}
          className="flex-shrink-0 whitespace-nowrap underline"
        >
          Just this page
        </button>
      )}

      <span className="ml-2 flex-shrink-0 whitespace-nowrap opacity-75">Action:</span>
      <select
        value={bulkActionType}
        onChange={(e) => { setBulkActionType(e.target.value); setBulkValue(''); }}
        className="sel max-w-[11rem]"
       
      >
        <option value="">Choose action…</option>
        <option value="status">Change status</option>
        <option value="priority">Change priority</option>
        <option value="reassign">Reassign</option>
        <option value="team">Move to team</option>
        {categories.length > 0 && <option value="category">Set category</option>}
        <option value="add_watcher">Add watcher</option>
        <option value="close">Close selected</option>
        <option value="merge">Merge into…</option>
        <option value="delete">Delete</option>
      </select>
      {bulkActionType === 'status' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="sel max-w-[9rem]">
          <option value="">Select status…</option>
          {ticketStatuses.filter((s) => s.systemKey !== 'user_responded').map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      )}
      {bulkActionType === 'priority' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="sel max-w-[9rem]">
          <option value="">Select priority…</option>
          {PRIORITY_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {bulkActionType === 'reassign' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="sel max-w-[11rem]">
          <option value="">Select assignee…</option>
          {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      )}
      {bulkActionType === 'team' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Team" className="sel max-w-[11rem]">
          <option value="">Select team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {bulkActionType === 'category' && (
        <>
          {bulkValue !== 'none' && (
            <CategoryPicker categories={categories} value={bulkValue || null} onChange={(v) => setBulkValue(v || '')} id="bulk-category" emptyLabel="Select category…" compact />
          )}
          <label className="flex flex-shrink-0 items-center gap-1 text-xs">
            <input type="checkbox" checked={bulkValue === 'none'} onChange={(e) => setBulkValue(e.target.checked ? 'none' : '')} />
            Remove the category
          </label>
        </>
      )}
      {bulkActionType === 'add_watcher' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Watcher" className="sel max-w-[11rem]">
          <option value="">Select person…</option>
          {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
      )}
      {bulkActionType === 'merge' && (
        <input
          value={bulkValue}
          onChange={(e) => setBulkValue(e.target.value)}
          placeholder="Target ticket #"
          aria-label="Merge into ticket number"
          title="The selected tickets move into this one. It can be one of the selected tickets."
          className="input num h-8 w-36 flex-shrink-0 text-[13px]"
         
        />
      )}
      <button
        type="button"
        onClick={applyBulkAction}
        disabled={bulkSaving || !bulkActionType || (!['close', 'delete'].includes(bulkActionType) && !bulkValue)}
        className="h-8 flex-shrink-0 rounded-md px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
      >
        Apply
      </button>

      {bulkResult && (
        <span role="status" className="flex-shrink-0 text-xs font-semibold" data-testid="bulk-result">
          {bulkResult.ok} updated{bulkResult.failed.length ? `, ${bulkResult.failed.length} failed: ` : ''}
          {bulkResult.failed.slice(0, 5).map((f) => `#${String(f.id).padStart(5, '0')} ${f.error}`).join('; ')}
          {bulkResult.failed.length > 5 ? '; …' : ''}
          <button type="button" onClick={() => setBulkResult(null)} className="ml-2 underline">dismiss</button>
        </span>
      )}
      <button
        type="button"
        onClick={clearSelection}
        className="ml-auto flex-shrink-0 whitespace-nowrap underline"
      >
        Clear selection
      </button>
    </div>
  );
}
