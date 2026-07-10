import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconChevronLeft, IconChevronRight, IconX, IconTicket, IconFolder, IconChecklist,
  IconCalendar, IconExternalLink, IconCalendarEvent, IconRefresh, IconAlertTriangle,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useAuth, usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const BG = 'var(--color-bg)';
const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const DANGER = 'var(--color-danger)';

// ==================== Date helpers ====================
// Ticket/Project/ProjectTask dueDate is a Sequelize DATEONLY string
// ("2026-07-08") with no time/timezone component — every comparison below
// works on that plain string form (fmtLocal) rather than constructing Date
// objects from it, which would risk a UTC-parsing day-shift in negative
// UTC-offset timezones.
function fmtLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function parseLocal(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(y, m - 1, d); }

// External events come back keyed by `startDate`, not `dueDate` — normalize
// so the day-grouping logic (which keys everything off `dueDate`) works
// uniformly across PRISM and external events without special-casing.
function normalizeExternal(events) {
  return events.map((ev) => ({ ...ev, dueDate: ev.startDate }));
}

function monthGridDays(anchor) {
  const gridStart = startOfWeek(startOfMonth(anchor));
  const gridEnd = addDays(startOfWeek(endOfMonth(anchor)), 6);
  const days = [];
  for (let cur = gridStart; cur <= gridEnd; cur = addDays(cur, 1)) days.push(cur);
  return days;
}

function visibleRangeFor(view, anchor) {
  if (view === 'month') return { start: startOfWeek(startOfMonth(anchor)), end: addDays(startOfWeek(endOfMonth(anchor)), 6) };
  if (view === 'week') { const s = startOfWeek(anchor); return { start: s, end: addDays(s, 6) }; }
  return { start: anchor, end: anchor };
}

function periodLabel(view, anchor) {
  if (view === 'month') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (view === 'week') {
    const { start, end } = visibleRangeFor('week', anchor);
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    // Intl's day+year-only skeleton (no month) renders a broken string in
    // this environment's ICU build — e.g. "2026 (day: 11)" instead of
    // "11, 2026" — so the same-month case is built by hand instead of
    // relying on toLocaleDateString with an underspecified options object.
    const endStr = sameMonth
      ? `${end.getDate()}, ${end.getFullYear()}`
      : end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }
  return anchor.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ==================== Event styling ====================
const TYPE_META = {
  ticket: { icon: IconTicket, label: 'Ticket' },
  project: { icon: IconFolder, label: 'Project' },
  task: { icon: IconChecklist, label: 'Task' },
  external: { icon: IconCalendarEvent, label: 'External' },
};

function eventColor(ev) {
  if (ev.type === 'external') return ev.color || '#64748b';
  if (ev.type === 'project') return '#7c3aed';
  return ev.priorityColor || '#64748b';
}

// Event pill backgrounds are hardcoded (not CSS variables) and always paired
// with white text — unlike eventColor() above (used for icons/badges
// elsewhere, which follows theme/admin-configured priority colors), pills
// need a guaranteed-readable combination regardless of theme or admin color
// settings, since they're small and text-dense.
const TICKET_PRIORITY_PILL_BG = {
  urgent: '#dc2626',
  critical: '#dc2626',
  high: '#d97706',
  medium: '#2563eb',
  low: '#475569',
};
function pillBackground(ev) {
  if (ev.type === 'external') return ev.color || '#64748b';
  if (ev.type === 'project') return '#7c3aed';
  if (ev.type === 'task') return '#0891b2';
  return TICKET_PRIORITY_PILL_BG[ev.priority] || TICKET_PRIORITY_PILL_BG.medium;
}

// The Tickets/Projects/Tasks filter toggles in FilterBar need a single swatch
// each, but ticket pills vary by priority (see TICKET_PRIORITY_PILL_BG above)
// — there's no one "the ticket color" the way there is for projects/tasks.
// Medium priority's blue is used as tickets' representative shade since it's
// the default priority for new tickets; projects/tasks reuse their exact
// (single, fixed) pill color so those two always match precisely.
const TYPE_TOGGLE_COLOR = {
  tickets: TICKET_PRIORITY_PILL_BG.medium,
  projects: '#7c3aed',
  tasks: '#0891b2',
};

function eventLabel(ev) {
  const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
  if (ev.type === 'ticket') return `${ev.ticketNumber} ${truncate(ev.title, 40)}`;
  if (ev.type === 'project') return `[${ev.projectCode}] ${truncate(ev.title, 30)}`;
  return truncate(ev.title, 40);
}

// Ticket/project status names are admin-editable, so "is this status still
// open" can't be a hardcoded name list — openStatusNames is built once from
// the real /ticket-statuses + /project-statuses data (behaviorType==='open')
// and threaded through every call site below, same idea as the backend's
// getTicketStatusBuckets()/getProjectStatusBuckets().
function isOpenish(status, openStatusNames) {
  return openStatusNames.has(status);
}
function overduePill(ev, todayStr, openStatusNames) {
  return ev.dueDate < todayStr && isOpenish(ev.status, openStatusNames);
}

// Avoids threading openStatusNames through every intermediate component
// prop signature — child components that need it (EventPill, EventPopover)
// just read it here instead.
const OpenStatusContext = createContext(new Set(['Open', 'In Progress', 'Pending', 'On Hold', 'Active']));

// ==================== Event pill (month/week views) ====================
function EventPill({ event, todayStr, onClick }) {
  const openStatusNames = useContext(OpenStatusContext);
  const bg = pillBackground(event);
  const isExternal = event.type === 'external';
  const overdue = !isExternal && overduePill(event, todayStr, openStatusNames);
  const Icon = TYPE_META[event.type].icon;
  const title = isExternal
    ? `${eventLabel(event)} — ${event.integrationName}${event.startDate ? ` — ${event.startDate}` : ''}`
    : eventLabel(event);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(event); }}
      title={title}
      className="flex items-center gap-1 text-left"
      style={{
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        backgroundColor: bg,
        color: '#ffffff',
        fontSize: '11px',
        fontWeight: 500,
        padding: '2px 6px',
        borderRadius: '4px',
        border: overdue ? '1px dashed #ffffff' : '1px solid transparent',
      }}
    >
      <Icon size={11} className="flex-shrink-0" style={{ color: '#ffffff' }} />
      {/* min-width: 0 is required for a flex child's text to actually
          ellipsize instead of forcing the row (and its parent day column)
          wider — flex items default to min-width: auto (their content
          size), which nowrap text with no wrap points prevents shrinking. */}
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {eventLabel(event)}
      </span>
    </button>
  );
}

// ==================== Event detail popover ====================
function EventPopover({ event, onClose }) {
  const navigate = useNavigate();
  const openStatusNames = useContext(OpenStatusContext);
  if (!event) return null;
  const isExternal = event.type === 'external';
  const Icon = TYPE_META[event.type].icon;
  const overdue = !isExternal && overduePill(event, fmtLocal(new Date()), openStatusNames);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-[10px] border p-5" style={{ backgroundColor: CARD_BG, borderColor: BORDER }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon size={18} style={{ color: eventColor(event) }} />
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `color-mix(in srgb, ${eventColor(event)} 15%, transparent)`, color: eventColor(event) }}
            >
              {TYPE_META[event.type].label}
            </span>
          </div>
          <button type="button" onClick={onClose} style={{ color: MUTED }}><IconX size={18} /></button>
        </div>

        <h3 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>{event.title}</h3>

        {isExternal ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt style={{ color: MUTED }}>Date</dt>
              <dd style={{ color: TEXT }}>
                {parseLocal(event.startDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </dd>
            </div>
            {event.location && (
              <div className="flex justify-between gap-3">
                <dt className="flex-shrink-0" style={{ color: MUTED }}>Location</dt>
                <dd className="text-right" style={{ color: TEXT }}>{event.location}</dd>
              </div>
            )}
            {event.description && (
              <div>
                <dt className="mb-1" style={{ color: MUTED }}>Description</dt>
                <dd className="whitespace-pre-wrap" style={{ color: TEXT }}>{event.description}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt style={{ color: MUTED }}>Calendar</dt>
              <dd className="flex items-center gap-1.5" style={{ color: TEXT }}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: event.color }} />
                {event.integrationName}
              </dd>
            </div>
          </dl>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt style={{ color: MUTED }}>Due date</dt>
              <dd style={{ color: overdue ? DANGER : TEXT }}>
                {parseLocal(event.dueDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                {overdue && ' (overdue)'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt style={{ color: MUTED }}>Status</dt>
              <dd>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${event.statusColor} 15%, transparent)`, color: event.statusColor }}>
                  {event.status}
                </span>
              </dd>
            </div>
            {event.priority && (
              <div className="flex justify-between">
                <dt style={{ color: MUTED }}>Priority</dt>
                <dd className="capitalize" style={{ color: event.priorityColor }}>{event.priority === 'critical' || event.priority === 'urgent' ? 'Urgent' : event.priority}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt style={{ color: MUTED }}>Assignee</dt>
              <dd style={{ color: TEXT }}>{event.assigneeName || 'Unassigned'}</dd>
            </div>
            {event.projectCode && event.type === 'task' && (
              <div className="flex justify-between">
                <dt style={{ color: MUTED }}>Project</dt>
                <dd style={{ color: TEXT }}>{event.projectCode}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
            Close
          </button>
          {!isExternal && (
            <button
              type="button"
              onClick={() => navigate(event.url)}
              className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: BLUE }}
            >
              <IconExternalLink size={15} />
              Open {TYPE_META[event.type].label.toLowerCase()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== "+N more" day overflow modal ====================
function DayOverflowModal({ date, events, todayStr, onClose, onEventClick }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-[10px] border p-5" style={{ backgroundColor: CARD_BG, borderColor: BORDER }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold" style={{ color: TEXT }}>
            {date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          <button type="button" onClick={onClose} style={{ color: MUTED }}><IconX size={18} /></button>
        </div>
        <div className="space-y-1.5">
          {events.map((ev) => <EventPill key={ev.id} event={ev} todayStr={todayStr} onClick={onEventClick} />)}
        </div>
      </div>
    </div>
  );
}

// ==================== Month view ====================
function MonthView({ anchor, eventsByDay, todayStr, onDayClick, onEventClick }) {
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const [overflowDay, setOverflowDay] = useState(null);
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MAX_VISIBLE = 3;

  return (
    <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      <div className="grid grid-cols-7 border-b" style={{ borderColor: BORDER }}>
        {weekdayLabels.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ gridAutoRows: '1fr' }}>
        {days.map((day) => {
          const key = fmtLocal(day);
          const dayEvents = eventsByDay.get(key) || [];
          const inMonth = day.getMonth() === anchor.getMonth();
          const isToday = key === todayStr;
          const visible = dayEvents.slice(0, MAX_VISIBLE);
          const extra = dayEvents.length - MAX_VISIBLE;
          return (
            <div
              key={key}
              onClick={() => onDayClick(day)}
              className="flex min-h-[104px] min-w-0 cursor-pointer flex-col gap-1 overflow-hidden border-b border-r p-1.5 last:border-r-0"
              style={{ borderColor: BORDER, backgroundColor: inMonth ? CARD_BG : BG, opacity: inMonth ? 1 : 0.55 }}
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
                style={isToday ? { backgroundColor: BLUE, color: 'white' } : { color: inMonth ? TEXT : MUTED }}
              >
                {day.getDate()}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                {visible.map((ev) => <EventPill key={ev.id} event={ev} todayStr={todayStr} onClick={onEventClick} />)}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOverflowDay(day); }}
                    className="px-1.5 text-left text-[11px] font-medium hover:underline"
                    style={{ color: BLUE }}
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {overflowDay && (
        <DayOverflowModal
          date={overflowDay}
          events={eventsByDay.get(fmtLocal(overflowDay)) || []}
          todayStr={todayStr}
          onClose={() => setOverflowDay(null)}
          onEventClick={onEventClick}
        />
      )}
    </div>
  );
}

// ==================== Week / Day shared time-grid ====================
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am - 8pm

function TimeGrid({ days, eventsByDay, todayStr, onEventClick }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    // Scroll roughly to 8am on mount so the default view starts near the workday.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const gridTopMinutes = HOURS[0] * 60;
  const gridBottomMinutes = (HOURS[HOURS.length - 1] + 1) * 60;
  const nowOffsetPct = ((nowMinutes - gridTopMinutes) / (gridBottomMinutes - gridTopMinutes)) * 100;
  const showNowLine = nowMinutes >= gridTopMinutes && nowMinutes <= gridBottomMinutes;

  // Every stored dueDate is a plain date (no time-of-day anywhere in the
  // schema) — every event is effectively "all-day" today. The all-day row
  // is where all events actually render; the hourly grid below is kept so
  // the layout is ready if a future dueTime ever gets populated.
  return (
    <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      <div className="grid border-b" style={{ borderColor: BORDER, gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((day) => {
          const isToday = fmtLocal(day) === todayStr;
          return (
            <div key={fmtLocal(day)} className="border-l px-2 py-2 text-center" style={{ borderColor: BORDER, backgroundColor: isToday ? `color-mix(in srgb, ${BLUE} 8%, transparent)` : undefined }}>
              <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{day.toLocaleDateString(undefined, { weekday: 'short' })}</p>
              <span
                className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold"
                style={isToday ? { backgroundColor: BLUE, color: 'white' } : { color: TEXT }}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid" style={{ borderColor: BORDER, gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div className="border-r px-2 py-1.5 text-xs font-semibold" style={{ borderColor: BORDER, color: MUTED }}>All-day</div>
        {days.map((day) => {
          const key = fmtLocal(day);
          const dayEvents = eventsByDay.get(key) || [];
          return (
            <div key={key} className="min-w-0 space-y-1 overflow-hidden border-l p-1.5" style={{ borderColor: BORDER, minHeight: 40 }}>
              {dayEvents.map((ev) => <EventPill key={ev.id} event={ev} todayStr={todayStr} onClick={onEventClick} />)}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="relative max-h-[480px] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
          <div>
            {HOURS.map((h) => (
              <div key={h} className="flex h-14 items-start justify-end border-r border-t pr-2 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
                <span className="-mt-2">{h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}</span>
              </div>
            ))}
          </div>
          {days.map((day) => {
            const isToday = fmtLocal(day) === todayStr;
            return (
              <div key={fmtLocal(day)} className="relative border-l" style={{ borderColor: BORDER, backgroundColor: isToday ? `color-mix(in srgb, ${BLUE} 4%, transparent)` : undefined }}>
                {HOURS.map((h) => <div key={h} className="h-14 border-t" style={{ borderColor: BORDER }} />)}
                {isToday && showNowLine && (
                  <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: `${nowOffsetPct}%` }}>
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: DANGER, marginLeft: -4 }} />
                    <div className="h-px flex-1" style={{ backgroundColor: DANGER }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({ anchor, eventsByDay, todayStr, onEventClick }) {
  const { start } = visibleRangeFor('week', anchor);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  return <TimeGrid days={days} eventsByDay={eventsByDay} todayStr={todayStr} onEventClick={onEventClick} />;
}

const TYPE_ORDER = { ticket: 0, project: 1, task: 2 };
function DayView({ anchor, eventsByDay, todayStr, onEventClick }) {
  // No dueTime exists anywhere in the schema (see TimeGrid comment above),
  // so there's no real "time order" to sort by — group by type, then title,
  // for a stable and at-a-glance-scannable order instead.
  const dayEvents = (eventsByDay.get(fmtLocal(anchor)) || []).slice().sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.title.localeCompare(b.title));
  return (
    <div className="space-y-4">
      <TimeGrid days={[anchor]} eventsByDay={eventsByDay} todayStr={todayStr} onEventClick={onEventClick} />
      <div className="rounded-[10px] border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: TEXT }}>All events this day</h3>
        {dayEvents.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>Nothing due this day.</p>
        ) : (
          <ul className="space-y-2">
            {dayEvents.map((ev) => {
              const Icon = TYPE_META[ev.type].icon;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => onEventClick(ev)}
                    className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:opacity-80"
                    style={{ borderColor: BORDER }}
                  >
                    <Icon size={15} style={{ color: eventColor(ev), flexShrink: 0 }} />
                    <span className="min-w-0 flex-1 truncate" style={{ color: TEXT }}>{eventLabel(ev)}</span>
                    <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${ev.statusColor} 15%, transparent)`, color: ev.statusColor }}>
                      {ev.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ==================== Mini calendar ====================
function MiniCalendar({ anchor, eventsByDay, onSelectDate }) {
  const [miniAnchor, setMiniAnchor] = useState(startOfMonth(anchor));
  useEffect(() => setMiniAnchor(startOfMonth(anchor)), [anchor]);
  const days = useMemo(() => monthGridDays(miniAnchor), [miniAnchor]);
  const todayStr = fmtLocal(new Date());

  return (
    <div className="rounded-[10px] border p-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setMiniAnchor((d) => addMonths(d, -1))} style={{ color: MUTED }}><IconChevronLeft size={16} /></button>
        <p className="text-xs font-semibold" style={{ color: TEXT }}>{miniAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        <button type="button" onClick={() => setMiniAnchor((d) => addMonths(d, 1))} style={{ color: MUTED }}><IconChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={`${w}${i}`} className="text-[10px] font-semibold" style={{ color: MUTED }}>{w}</span>
        ))}
        {days.map((day) => {
          const key = fmtLocal(day);
          const inMonth = day.getMonth() === miniAnchor.getMonth();
          const isToday = key === todayStr;
          const hasEvents = (eventsByDay.get(key) || []).length > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(day)}
              className="mx-auto flex h-6 w-6 flex-col items-center justify-center rounded-full text-[11px]"
              style={{
                backgroundColor: isToday ? BLUE : 'transparent',
                color: isToday ? 'white' : inMonth ? TEXT : MUTED,
                opacity: inMonth ? 1 : 0.45,
              }}
            >
              {day.getDate()}
              {hasEvents && !isToday && <span className="-mt-0.5 h-1 w-1 rounded-full" style={{ backgroundColor: BLUE }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==================== Filter bar ====================
function FilterBar({
  showTickets, setShowTickets, showProjects, setShowProjects, showTasks, setShowTasks,
  assigneeId, setAssigneeId, departmentId, setDepartmentId, statusFilter, setStatusFilter,
  myItemsOnly, setMyItemsOnly, assignableUsers, departments, canFilterDept, overdueCount,
  integrations, activeIntegrationIds, toggleIntegration,
}) {
  const toggle = (active, label, onClick, color = BLUE, inactiveBorder = BORDER) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-medium"
      style={active
        ? { backgroundColor: color, color: 'white' }
        : { backgroundColor: 'transparent', color: MUTED, border: `1px solid ${inactiveBorder}` }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border p-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      {toggle(showTickets, 'Tickets', () => setShowTickets((v) => !v), TYPE_TOGGLE_COLOR.tickets, 'var(--color-border-strong)')}
      {toggle(showProjects, 'Projects', () => setShowProjects((v) => !v), TYPE_TOGGLE_COLOR.projects, 'var(--color-border-strong)')}
      {toggle(showTasks, 'Tasks', () => setShowTasks((v) => !v), TYPE_TOGGLE_COLOR.tasks, 'var(--color-border-strong)')}

      <span className="mx-1 h-5 w-px" style={{ backgroundColor: BORDER }} />

      <select className="input h-8 max-w-[10rem] flex-shrink-0 text-xs" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
        <option value="">All assignees</option>
        {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
      </select>

      {canFilterDept && (
        <select className="input h-8 max-w-[10rem] flex-shrink-0 text-xs" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}

      <select className="input h-8 max-w-[10rem] flex-shrink-0 text-xs" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="all">All statuses</option>
        <option value="open">Open only</option>
        <option value="overdue">Overdue only{overdueCount > 0 ? ` (${overdueCount})` : ''}</option>
      </select>

      <span className="mx-1 h-5 w-px" style={{ backgroundColor: BORDER }} />

      {toggle(myItemsOnly, 'My items only', () => setMyItemsOnly((v) => !v))}

      {integrations.length > 0 && (
        <>
          <span className="mx-1 h-5 w-px" style={{ backgroundColor: BORDER }} />
          {integrations.map((integ) => {
            const active = activeIntegrationIds.has(integ.id);
            return (
              <button
                key={integ.id}
                type="button"
                onClick={() => toggleIntegration(integ.id)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                style={active
                  ? { backgroundColor: `color-mix(in srgb, ${integ.color} 20%, transparent)`, color: integ.color, border: `1px solid ${integ.color}` }
                  : { backgroundColor: 'transparent', color: MUTED, border: `1px solid ${BORDER}` }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: integ.color }} />
                {integ.name}
                {integ.needsReconnect && (
                  <span className="flex items-center gap-0.5 text-amber-600" title="This calendar's connection expired — reconnect in Account Preferences">
                    <IconAlertTriangle size={11} />
                    Reconnect
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

// ==================== Main page ====================
export default function Calendar() {
  const { user } = useAuth();
  const canViewAll = usePermission('tickets.view_all') || usePermission('projects.view_all');

  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [fetchedRange, setFetchedRange] = useState(null); // { start: Date, end: Date }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showTickets, setShowTickets] = useState(true);
  const [showProjects, setShowProjects] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [myItemsOnly, setMyItemsOnly] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [departments, setDepartments] = useState([]);

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [miniOpen, setMiniOpen] = useState(true);
  const [openStatusNames, setOpenStatusNames] = useState(new Set(['Open', 'In Progress', 'Pending', 'On Hold', 'Active']));

  const [integrations, setIntegrations] = useState([]);
  const [externalEvents, setExternalEvents] = useState([]);
  const [activeIntegrationIds, setActiveIntegrationIds] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
  }, []);
  useEffect(() => {
    if (canViewAll) api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, [canViewAll]);
  const loadIntegrations = () => {
    api.get('/calendar/integrations')
      .then(({ data }) => {
        setIntegrations(data.integrations);
        // Default every active integration's pill on, the first time the
        // list loads — afterwards leave whatever the user has toggled alone.
        setActiveIntegrationIds((prev) => (prev.size ? prev : new Set(data.integrations.filter((i) => i.isActive).map((i) => i.id))));
      })
      .catch(() => {});
  };
  useEffect(loadIntegrations, []);
  const toggleIntegration = (id) => setActiveIntegrationIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Status names are admin-editable — resolve "open" ones for real instead
  // of hardcoding the seeded defaults, same idea as the backend's
  // getTicketStatusBuckets()/getProjectStatusBuckets().
  useEffect(() => {
    Promise.all([api.get('/ticket-statuses'), api.get('/project-statuses')])
      .then(([t, p]) => {
        const names = [...t.data.statuses, ...p.data.statuses].filter((s) => s.behaviorType === 'open').map((s) => s.name);
        setOpenStatusNames(new Set(names));
      })
      .catch(() => {});
  }, []);

  const todayStr = fmtLocal(new Date());
  const visible = useMemo(() => visibleRangeFor(view, anchor), [view, anchor]);

  // Fetch the visible range + 1 month buffer on each side, but only when the
  // currently cached range doesn't already cover it — switching views or
  // navigating within the same buffered window never refetches.
  useEffect(() => {
    const needStart = addMonths(visible.start, -1);
    const needEnd = addMonths(visible.end, 1);
    const covered = fetchedRange && needStart >= fetchedRange.start && needEnd <= fetchedRange.end;
    if (covered) return;

    setLoading(true);
    setError('');
    Promise.all([
      api.get('/calendar/events', {
        params: { startDate: fmtLocal(needStart), endDate: fmtLocal(needEnd), types: 'tickets,projects,tasks' },
      }),
      api.get('/calendar/external-events', {
        params: { startDate: fmtLocal(needStart), endDate: fmtLocal(needEnd) },
      }).catch(() => ({ data: { events: [] } })), // external calendars are optional — never block PRISM events on them
    ])
      .then(([prismRes, externalRes]) => {
        setEvents(prismRes.data.events);
        setExternalEvents(normalizeExternal(externalRes.data.events));
        setFetchedRange({ start: needStart, end: needEnd });
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.start.getTime(), visible.end.getTime()]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all(integrations.filter((i) => i.isActive).map((i) => api.post(`/calendar/integrations/${i.id}/sync`).catch(() => {})));
      const { data } = await api.get('/calendar/external-events', {
        params: { startDate: fmtLocal(addMonths(visible.start, -1)), endDate: fmtLocal(addMonths(visible.end, 1)) },
      });
      setExternalEvents(normalizeExternal(data.events));
      loadIntegrations(); // pick up any lastSynced/needsReconnect changes
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const filteredEvents = useMemo(() => {
    const effectiveAssignee = myItemsOnly ? String(user.id) : assigneeId;
    const prismFiltered = events.filter((ev) => {
      if (ev.type === 'ticket' && !showTickets) return false;
      if (ev.type === 'project' && !showProjects) return false;
      if (ev.type === 'task' && !showTasks) return false;
      if (effectiveAssignee && String(ev.assigneeId) !== String(effectiveAssignee)) return false;
      if (departmentId && !(ev.departmentIds || []).map(String).includes(String(departmentId))) return false;
      if (statusFilter === 'open' && !isOpenish(ev.status, openStatusNames)) return false;
      if (statusFilter === 'overdue' && !overduePill(ev, todayStr, openStatusNames)) return false;
      return true;
    });
    // PRISM events always shown first, external calendar events layered on
    // top — array order here is what eventsByDay's per-day grouping renders in.
    const externalFiltered = externalEvents.filter((ev) => activeIntegrationIds.has(ev.integrationId));
    return [...prismFiltered, ...externalFiltered];
  }, [events, externalEvents, activeIntegrationIds, showTickets, showProjects, showTasks, assigneeId, departmentId, statusFilter, myItemsOnly, user.id, todayStr, openStatusNames]);

  const overdueCount = useMemo(() => events.filter((ev) => overduePill(ev, todayStr, openStatusNames)
    && ((ev.type === 'ticket' && showTickets) || (ev.type === 'project' && showProjects) || (ev.type === 'task' && showTasks))).length, [events, todayStr, showTickets, showProjects, showTasks, openStatusNames]);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    filteredEvents.forEach((ev) => {
      if (!map.has(ev.dueDate)) map.set(ev.dueDate, []);
      map.get(ev.dueDate).push(ev);
    });
    return map;
  }, [filteredEvents]);

  const eventsByDayForMini = useMemo(() => {
    const map = new Map();
    [...events, ...externalEvents].forEach((ev) => {
      if (!map.has(ev.dueDate)) map.set(ev.dueDate, []);
      map.get(ev.dueDate).push(ev);
    });
    return map;
  }, [events, externalEvents]);

  const goPrev = () => {
    if (view === 'month') setAnchor((d) => addMonths(d, -1));
    else if (view === 'week') setAnchor((d) => addDays(d, -7));
    else setAnchor((d) => addDays(d, -1));
  };
  const goNext = () => {
    if (view === 'month') setAnchor((d) => addMonths(d, 1));
    else if (view === 'week') setAnchor((d) => addDays(d, 7));
    else setAnchor((d) => addDays(d, 1));
  };
  const goToday = () => setAnchor(new Date());

  const goToDay = (day) => { setAnchor(day); setView('day'); };

  return (
    <OpenStatusContext.Provider value={openStatusNames}>
    <div className="space-y-4" style={{ backgroundColor: BG }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCalendar size={24} style={{ color: BLUE }} />
          <h1 className="text-2xl font-bold" style={{ color: TEXT }}>{periodLabel(view, anchor)}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={goPrev} className="rounded-md border p-1.5" style={{ borderColor: BORDER, color: TEXT }}><IconChevronLeft size={16} /></button>
            <button type="button" onClick={goToday} className="rounded-md border px-3 py-1.5 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>Today</button>
            <button type="button" onClick={goNext} className="rounded-md border p-1.5" style={{ borderColor: BORDER, color: TEXT }}><IconChevronRight size={16} /></button>
          </div>
          <div className="flex rounded-md border p-0.5" style={{ borderColor: BORDER }}>
            {['month', 'week', 'day'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className="rounded px-3 py-1 text-sm font-medium capitalize"
                style={view === v ? { backgroundColor: BLUE, color: 'white' } : { color: MUTED }}
              >
                {v}
              </button>
            ))}
          </div>
          {integrations.length > 0 && (
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              title="Re-sync all connected calendars now"
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              <IconRefresh size={15} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      <FilterBar
        showTickets={showTickets} setShowTickets={setShowTickets}
        showProjects={showProjects} setShowProjects={setShowProjects}
        showTasks={showTasks} setShowTasks={setShowTasks}
        assigneeId={assigneeId} setAssigneeId={setAssigneeId}
        departmentId={departmentId} setDepartmentId={setDepartmentId}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        myItemsOnly={myItemsOnly} setMyItemsOnly={setMyItemsOnly}
        assignableUsers={assignableUsers} departments={departments}
        canFilterDept={canViewAll} overdueCount={overdueCount}
        integrations={integrations} activeIntegrationIds={activeIntegrationIds} toggleIntegration={toggleIntegration}
      />

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {loading && !fetchedRange ? (
            <Spinner />
          ) : (
            <>
              {view === 'month' && <MonthView anchor={anchor} eventsByDay={eventsByDay} todayStr={todayStr} onDayClick={goToDay} onEventClick={setSelectedEvent} />}
              {view === 'week' && <WeekView anchor={anchor} eventsByDay={eventsByDay} todayStr={todayStr} onEventClick={setSelectedEvent} />}
              {view === 'day' && <DayView anchor={anchor} eventsByDay={eventsByDay} todayStr={todayStr} onEventClick={setSelectedEvent} />}
            </>
          )}
        </div>

        {miniOpen ? (
          <div className="hidden w-64 flex-shrink-0 space-y-2 lg:block">
            <div className="flex justify-end">
              <button type="button" onClick={() => setMiniOpen(false)} className="text-xs" style={{ color: MUTED }}>Hide</button>
            </div>
            <MiniCalendar anchor={anchor} eventsByDay={eventsByDayForMini} onSelectDate={(d) => setAnchor(d)} />
          </div>
        ) : (
          <button type="button" onClick={() => setMiniOpen(true)} className="hidden flex-shrink-0 rounded-md border px-2 py-1 text-xs lg:block" style={{ borderColor: BORDER, color: MUTED }}>
            Show calendar
          </button>
        )}
      </div>

      {selectedEvent && <EventPopover event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
    </OpenStatusContext.Provider>
  );
}
