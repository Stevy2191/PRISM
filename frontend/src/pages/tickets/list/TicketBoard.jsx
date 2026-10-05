// The ticket list's board view: one column per status, each capped (see
// BOARD_COLUMN_LIMIT on the API).
import { formatTicketId } from '../../../utils/ticketId';
import { BG, CARD_BG, BORDER, TEXT, MUTED } from '../theme';
import { todayStr } from './listHelpers';
import { Avatar, PriorityCell, DeptPill } from './Cells';

export function TicketBoard({
  boardColumns,
  canViewAllTickets,
  navigate,
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible md:pb-0">
      {boardColumns.map((col) => (
        <div
          key={col.id}
          className="w-[85vw] max-w-[320px] flex-shrink-0 rounded-[10px] border md:w-auto md:max-w-none"
          style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: BORDER }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
              {col.name}
            </h2>
            <span
              className="rounded-[3px] px-2 py-0.5 font-mono text-xs font-semibold"
              style={{ backgroundColor: `color-mix(in srgb, ${col.color} 13%, transparent)`, color: col.color }}
            >
              {col.total}
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
            {col.total > col.tickets.length && (
              // The board shows a whole pipeline at once, so it can't be
              // paged — each column is capped instead, and says so.
              <p className="pt-1 text-center text-xs" style={{ color: MUTED }}>
                +{(col.total - col.tickets.length).toLocaleString()} more — narrow the filters to see them
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
