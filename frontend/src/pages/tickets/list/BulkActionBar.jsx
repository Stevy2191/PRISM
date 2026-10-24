// The ticket list's bulk action strip, shown between the toolbar and the table
// while tickets are selected. The page owns all the state; this only renders it.
import { TEXT, MUTED, BLUE } from '../theme';
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
        <option value="reassign">Reassign</option>
        <option value="team">Move to team</option>
        {categories.length > 0 && <option value="category">Set category</option>}
        <option value="add_watcher">Add watcher</option>
        <option value="close">Close selected</option>
        <option value="merge">Merge into…</option>
        <option value="delete">Delete</option>
      </select>
      {bulkActionType === 'status' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="input h-9 max-w-[9rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
          <option value="">Select status…</option>
          {ticketStatuses.filter((s) => s.systemKey !== 'user_responded').map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
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
      {bulkActionType === 'team' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Team" className="input h-9 max-w-[11rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
          <option value="">Select team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {bulkActionType === 'category' && (
        <CategoryPicker categories={categories} value={bulkValue || null} onChange={(v) => setBulkValue(v || '')} id="bulk-category" />
      )}
      {bulkActionType === 'add_watcher' && (
        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Watcher" className="input h-9 max-w-[11rem] flex-shrink-0 text-sm" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}>
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
          className="input h-9 w-36 flex-shrink-0 font-mono text-sm"
          style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }}
        />
      )}
      <button
        type="button"
        onClick={applyBulkAction}
        disabled={bulkSaving || !bulkActionType || (!['close', 'delete'].includes(bulkActionType) && !bulkValue)}
        className="flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: BLUE }}
      >
        Apply
      </button>

      {bulkResult && (
        <span role="status" className="flex-shrink-0 text-xs" style={{ color: bulkResult.failed.length ? 'var(--color-danger)' : MUTED }} data-testid="bulk-result">
          {bulkResult.ok} updated{bulkResult.failed.length ? `, ${bulkResult.failed.length} failed: ` : ''}
          {bulkResult.failed.slice(0, 5).map((f) => `#${String(f.id).padStart(5, '0')} ${f.error}`).join('; ')}
          {bulkResult.failed.length > 5 ? '; …' : ''}
          <button type="button" onClick={() => setBulkResult(null)} className="ml-2 underline">dismiss</button>
        </span>
      )}
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
