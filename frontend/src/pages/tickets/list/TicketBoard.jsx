// The ticket list's board view: one column per status, each capped (see
// BOARD_COLUMN_LIMIT on the API).
import { formatTicketId } from '../../../utils/ticketId';
import { TEXT, MUTED } from '../theme';
import { todayStr } from './listHelpers';
import { Avatar, PriorityCell, DeptPill } from './Cells';

export function TicketBoard({
  boardColumns,
  canViewAllTickets,
  navigate,
}) {
  return (
    <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
      {boardColumns.map((col) => (
        <section
          key={col.id}
          aria-label={col.name}
          className="w-[85vw] max-w-[320px] flex-shrink-0 snap-start self-start rounded-xl border border-navy-100 bg-surface md:w-auto md:max-w-none"
        >
          <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
              <span className="truncate">{col.name}</span>
            </h2>
            <span className="num rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}>
              {col.total}
            </span>
          </div>
          <div className="space-y-2 px-2.5 pb-2.5">
            {col.tickets.length === 0 && <p className="px-1 pb-1 text-xs" style={{ color: MUTED }}>No tickets.</p>}
            {col.tickets.map((t) => {
              // Overdue is shown as a highlight on the card, not a
              // separate column — a ticket keeps its real status column
              // and is flagged red only while that status is still open.
              const isOverdue = (col.behaviorType === 'open' || col.behaviorType === 'on_hold') && t.dueDate && t.dueDate < todayStr();
              return (
                <div
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className="cursor-pointer rounded-lg border p-3 transition hover:bg-[var(--color-hover)]"
                  style={{ backgroundColor: 'var(--color-bg)', borderColor: isOverdue ? 'var(--color-danger)' : 'var(--color-border)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="num text-xs font-semibold" style={{ color: isOverdue ? 'var(--color-danger)' : MUTED }}>{formatTicketId(t)}</span>
                    {canViewAllTickets && t.department?.name && <DeptPill name={t.department.name} className="" />}
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold" style={{ color: isOverdue ? 'var(--color-danger)' : TEXT }}>{t.title}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <PriorityCell priority={t.priority} />
                    <span className="min-w-0 max-w-[55%] text-xs"><Avatar name={t.assignee?.displayName} /></span>
                  </div>
                </div>
              );
            })}
            {col.total > col.tickets.length && (
              // The board shows a whole pipeline at once, so it can't be
              // paged — each column is capped instead, and says so.
              <p className="pt-1 text-center text-xs" style={{ color: MUTED }}>
                +{(col.total - col.tickets.length).toLocaleString()} more — narrow the filters to see them
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
