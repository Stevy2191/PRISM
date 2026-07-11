import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconMessageReply,
  IconUserCheck,
  IconAlertTriangle,
  IconMessageCircle,
  IconHourglass,
  IconRefresh,
  IconPlus,
  IconTicket,
  IconFolder,
  IconChartBar,
  IconUsers,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import AccessRestricted, { isForbidden } from '../components/AccessRestricted';
import { formatTicketId } from '../utils/ticketId';

// Colors read from the light/dark theme's CSS variables (see index.css).
const CARD_BG = 'var(--color-card)';
const CARD_BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';

// Tints a semantic color into a readable pill background against the
// current theme's page background.
function tint(color) {
  return `color-mix(in srgb, ${color} 18%, var(--color-bg))`;
}

const DUE_BADGE = {
  green: { color: 'var(--color-success)' },
  amber: { color: 'var(--color-warning)' },
  red: { color: 'var(--color-danger)' },
  none: { color: 'var(--color-text-muted)', bar: 'var(--color-accent)' },
};

const TICKET_STATUS = {
  open: { label: 'Open', color: 'var(--color-accent)' },
  in_progress: { label: 'In Progress', color: 'var(--color-success)' },
  overdue: { label: 'Overdue', color: 'var(--color-danger)' },
  closed: { label: 'Closed', color: 'var(--color-text-muted)' },
};

const NOTIF_TYPE = {
  reply: { Icon: IconMessageReply, color: 'var(--color-accent)' },
  assigned: { Icon: IconUserCheck, color: 'var(--color-relation-accent)' },
  overdue: { Icon: IconAlertTriangle, color: 'var(--color-danger)' },
  comment: { Icon: IconMessageCircle, color: 'var(--color-accent)' },
  due_soon: { Icon: IconHourglass, color: 'var(--color-warning)' },
  status_change: { Icon: IconRefresh, color: 'var(--color-success)' },
};

// Activity feed action-type colors (see ACTIVITY CLEANUP spec).
const ACTIVITY_COLOR = {
  created: 'var(--color-accent)',
  status: 'var(--color-success)',
  assigned: 'var(--color-relation-accent)',
  priority: 'var(--color-warning)',
  closed: 'var(--color-text-muted)',
  comment: '#0d9488',
};

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || name;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

function dueBadgeLabel(dueBadge, dueDate) {
  if (dueBadge === 'none') return 'No due date';
  if (dueBadge === 'red') return `Overdue · ${formatDate(dueDate)}`;
  return formatDate(dueDate);
}

function Card({ children, className = '' }) {
  return (
    <div
      className={`h-full rounded-[10px] border p-5 ${className}`}
      style={{ backgroundColor: CARD_BG, borderColor: CARD_BORDER }}
    >
      {children}
    </div>
  );
}

function StatCard({ label, value, color, delta }) {
  return (
    <Card>
      <p className="text-sm font-medium" style={{ color: MUTED }}>{label}</p>
      <p className="mt-2 text-3xl font-bold" style={{ color }}>{value}</p>
      {delta !== undefined && (
        <p className="mt-1 text-xs" style={{ color: delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
          {delta >= 0 ? '+' : ''}
          {delta} vs last week
        </p>
      )}
    </Card>
  );
}

function ProgressBar({ percent, color }) {
  return (
    <div className="h-[5px] w-full rounded-[3px]" style={{ backgroundColor: 'var(--color-border)' }}>
      <div
        className="h-full rounded-[3px]"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function ProjectHealthPanel({ projects, title = 'Project Health', emptyText = 'No projects to show.' }) {
  return (
    <Card className="!p-0">
      <div className="border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>{title}</h2>
      </div>
      {projects.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>{emptyText}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: CARD_BORDER }}>
          {projects.map((p) => {
            const badge = DUE_BADGE[p.dueBadge] || DUE_BADGE.none;
            return (
              <li key={p.id} className="px-5 py-4" style={{ borderColor: CARD_BORDER }}>
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/projects/${p.id}`} className="min-w-0 truncate font-medium hover:underline" style={{ color: TEXT }}>
                    {p.name}
                  </Link>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: tint(badge.color), color: badge.color }}
                  >
                    {dueBadgeLabel(p.dueBadge, p.dueDate)}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {p.totalTasks} tasks · {p.closedTasks} closed · {p.openTasks} open
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1"><ProgressBar percent={p.percent} color={badge.bar || badge.color} /></div>
                  <span className="w-10 text-right text-xs font-semibold" style={{ color: TEXT }}>{p.percent}%</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TicketsPanel({ tickets }) {
  return (
    <Card className="!p-0">
      <div className="border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>My Tickets</h2>
      </div>
      {tickets.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No assigned tickets.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: CARD_BORDER }}>
          {tickets.map((t) => {
            const status = TICKET_STATUS[t.displayStatus] || TICKET_STATUS.open;
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/tickets/${t.id}`} className="truncate font-medium hover:underline" style={{ color: TEXT }}>
                    {formatTicketId(t)} {t.title}
                  </Link>
                  <p className="text-xs" style={{ color: MUTED }} title={new Date(t.updatedAt).toLocaleString()}>
                    Updated {timeAgo(t.updatedAt)}
                  </p>
                </div>
                <span
                  className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: tint(status.color), color: status.color }}
                >
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function NotificationsPanel({ notifications, onMarkAllRead, marking }) {
  const hasUnread = notifications.some((n) => !n.isRead);
  return (
    <Card className="!p-0">
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Notifications</h2>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={!hasUnread || marking}
          className="rounded-md border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: CARD_BORDER, color: 'var(--color-accent)' }}
        >
          Mark all read
        </button>
      </div>
      {notifications.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>You&apos;re all caught up.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: CARD_BORDER }}>
          {notifications.map((n) => {
            const type = NOTIF_TYPE[n.type] || NOTIF_TYPE.comment;
            const Icon = type.Icon;
            const unread = !n.isRead;
            return (
              <li
                key={n.id}
                className="flex items-start gap-3 px-5 py-3"
                style={
                  unread
                    ? { borderLeft: '2px solid var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' }
                    : { borderLeft: '2px solid transparent' }
                }
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px]"
                  style={{ backgroundColor: tint(type.color), color: type.color }}
                >
                  <Icon size={18} stroke={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm" style={{ color: TEXT }}>{n.message}</p>
                  <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{timeAgo(n.createdAt)}</p>
                </div>
                {unread && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function HoursPanel({ hours }) {
  const maxHours = Math.max(1, ...hours.byDay.map((d) => d.hours));
  return (
    <Card>
      <h2 className="font-semibold" style={{ color: TEXT }}>My Hours This Week</h2>
      <p className="mt-2 text-3xl font-bold" style={{ color: TEXT }}>{hours.total}h</p>
      <div className="mt-5 space-y-3">
        {hours.byDay.map((d) => (
          <div key={d.day} className="flex items-center gap-3">
            <span className="w-8 text-xs font-medium" style={{ color: MUTED }}>{d.day}</span>
            <div className="h-3 flex-1 rounded-[3px]" style={{ backgroundColor: 'var(--color-border)' }}>
              <div
                className="h-full rounded-[3px]"
                style={{ width: `${(d.hours / maxHours) * 100}%`, backgroundColor: 'var(--color-accent)' }}
              />
            </div>
            <span className="w-10 text-right text-xs" style={{ color: TEXT }}>{d.hours}h</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TeamWorkloadPanel({ workload }) {
  const maxCount = Math.max(1, ...workload.map((w) => w.openCount));
  const colorFor = (count) => (count > 25 ? 'var(--color-danger)' : count > 15 ? 'var(--color-warning)' : 'var(--color-accent)');
  return (
    <Card className="!p-0">
      <div className="border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Team Workload</h2>
      </div>
      {workload.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No staff members yet.</p>
      ) : (
        <div className="space-y-3 px-5 py-4">
          {workload.map((w) => (
            <div key={w.userId} className="flex items-center gap-3">
              <span className="w-32 flex-shrink-0 truncate text-sm" style={{ color: TEXT }}>{w.displayName}</span>
              <div className="h-3 flex-1 rounded-[3px]" style={{ backgroundColor: 'var(--color-border)' }}>
                <div
                  className="h-full rounded-[3px]"
                  style={{ width: `${(w.openCount / maxCount) * 100}%`, backgroundColor: colorFor(w.openCount) }}
                />
              </div>
              <span className="w-8 text-right text-xs font-semibold" style={{ color: TEXT }}>{w.openCount}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuickActionsPanel() {
  const navigate = useNavigate();
  const shortcuts = [
    { label: 'My Tickets', to: '/tickets', Icon: IconTicket },
    { label: 'Projects', to: '/projects', Icon: IconFolder },
    { label: 'Reports', to: '/reports', Icon: IconChartBar },
    { label: 'Contacts', to: '/contacts', Icon: IconUsers },
  ];
  return (
    <Card>
      <h2 className="mb-4 font-semibold" style={{ color: TEXT }}>Quick Actions</h2>
      <button
        type="button"
        onClick={() => navigate('/tickets/new')}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white"
        style={{ backgroundColor: 'var(--color-accent)' }}
      >
        <IconPlus size={16} stroke={2.5} /> New Ticket
      </button>
      <div className="grid grid-cols-2 gap-2">
        {shortcuts.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-[var(--color-hover)]"
            style={{ borderColor: CARD_BORDER, color: TEXT }}
          >
            <s.Icon size={16} stroke={1.8} style={{ color: MUTED }} />
            {s.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ==================== Activity feed (cleaned up) ====================

function ActivityFeedPanel({ activity, hasMore, onLoadMore, loadingMore }) {
  return (
    <Card className="!p-0">
      <div className="border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Activity Feed</h2>
      </div>
      {activity.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No recent activity.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: CARD_BORDER }}>
          {activity.map((a) => {
            const color = ACTIVITY_COLOR[a.colorKey] || 'var(--color-accent)';
            const to = a.targetType === 'project' ? `/projects/${a.targetId}` : `/tickets/${a.targetId}`;
            return (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <div className="min-w-0 flex-1">
                  <span style={{ color: TEXT }}>
                    <strong>{a.actorName}</strong> {a.verb}{' '}
                    <Link to={to} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                      {a.targetLabel}
                    </Link>
                    {a.suffix && <> {a.suffix}</>}
                    {a.count > 1 && <span style={{ color: MUTED }}> ({a.count} times)</span>}
                  </span>
                  <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{timeAgo(a.occurredAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="border-t px-5 py-3 text-center" style={{ borderColor: CARD_BORDER }}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-xs font-medium hover:underline disabled:opacity-50"
            style={{ color: 'var(--color-accent)' }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </Card>
  );
}

// ==================== Customizable panel grid ====================

// Panel catalogs per dashboard mode. `full`/`half` here is only the
// *default* size — the saved layout's per-panel size always wins once one exists.
const TECH_CATALOG = {
  tickets: { label: 'My Tickets', defaultSize: 'half' },
  notifications: { label: 'Notifications', defaultSize: 'half' },
  projectHealth: { label: 'Project Health', defaultSize: 'half' },
  hours: { label: 'Hours This Week', defaultSize: 'half' },
  quickActions: { label: 'Quick Actions', defaultSize: 'half' },
};
const ADMIN_CATALOG = {
  teamWorkload: { label: 'Team Workload', defaultSize: 'half' },
  activityFeed: { label: 'Activity Feed', defaultSize: 'half' },
  projectHealth: { label: 'Project Health', defaultSize: 'full' },
  quickActions: { label: 'Quick Actions', defaultSize: 'half' },
};

const TECH_DEFAULT_PANELS = [
  { key: 'tickets', size: 'half', hidden: false },
  { key: 'notifications', size: 'half', hidden: false },
  { key: 'projectHealth', size: 'half', hidden: false },
  { key: 'hours', size: 'half', hidden: false },
  { key: 'quickActions', size: 'half', hidden: true },
];
const ADMIN_DEFAULT_PANELS = [
  { key: 'teamWorkload', size: 'half', hidden: false },
  { key: 'activityFeed', size: 'half', hidden: false },
  { key: 'projectHealth', size: 'full', hidden: false },
  { key: 'quickActions', size: 'half', hidden: true },
];

// Reconciles a saved layout (which may be null, or may only cover the OTHER
// dashboard mode's panels — see the module-level note in Dashboard()) against
// the current mode's catalog: preserves saved order/size/hidden for known
// keys, appends any catalog keys the saved layout doesn't know about yet
// (hidden by default) so a newly introduced panel type doesn't just vanish.
function reconcilePanels(savedPanels, catalog, defaults) {
  const catalogKeys = Object.keys(catalog);
  const savedByKey = new Map((savedPanels || []).map((p) => [p.key, p]));
  const orderedKnown = (savedPanels || []).map((p) => p.key).filter((k) => catalogKeys.includes(k));
  const missing = catalogKeys.filter((k) => !orderedKnown.includes(k));
  return [...orderedKnown, ...missing].map((key) => {
    const saved = savedByKey.get(key);
    if (saved) return { key, size: saved.size === 'full' ? 'full' : 'half', hidden: !!saved.hidden };
    const def = defaults.find((d) => d.key === key);
    return def ? { ...def } : { key, size: catalog[key].defaultSize, hidden: true };
  });
}

function PanelSlot({ label, size, editMode, dragging, onDragStart, onDragOver, onDrop, onDragEnd, onHide, onToggleSize, children }) {
  const spanClass = size === 'full' ? 'md:col-span-2' : 'md:col-span-1';

  if (!editMode) {
    return <div className={spanClass}>{children}</div>;
  }

  return (
    <div
      className={`${spanClass} rounded-[12px] border-2 border-dashed p-2`}
      style={{ borderColor: 'var(--color-border-strong)', opacity: dragging ? 0.4 : 1 }}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex cursor-grab items-center gap-1.5 text-xs font-medium select-none" style={{ color: MUTED }}>
          <span aria-hidden="true">⠿</span> {label}
        </span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onToggleSize} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>
            {size === 'full' ? 'Make half-width' : 'Make full-width'}
          </button>
          <button type="button" onClick={onHide} className="flex h-5 w-5 items-center justify-center rounded-full text-xs" style={{ color: 'var(--color-danger)', backgroundColor: tint('var(--color-danger)') }} title="Hide panel">
            ✕
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function AddPanelMenu({ hiddenPanels, onAdd }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (hiddenPanels.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary text-sm">+ Add panel</button>
      {open && (
        <div
          className="absolute left-0 z-20 mt-1 w-52 overflow-hidden rounded-md border shadow-lg"
          style={{ backgroundColor: CARD_BG, borderColor: CARD_BORDER }}
        >
          {hiddenPanels.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { onAdd(p.key); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
              style={{ color: TEXT }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GreetingBar({ title, subtitleName }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: TEXT }}>{title}</h1>
        {subtitleName && <p className="text-sm" style={{ color: MUTED }}>Here is what&apos;s happening with {subtitleName}&apos;s work.</p>}
      </div>
      <p className="text-sm" style={{ color: MUTED }}>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { hasAnyPermission } = useAuth();
  // System-wide viewers (tickets.view_all or projects.view_all) see every
  // user/dept; department viewers (view_department but not view_all) get the
  // same admin-style layout narrowed to their own department (see
  // dashboardController's admin_department mode).
  const isSystemViewer = hasAnyPermission(['tickets.view_all', 'projects.view_all']);
  const isDepartmentViewer = !isSystemViewer && hasAnyPermission(['tickets.view_department', 'projects.view_department']);
  const canFilterByUser = isSystemViewer || isDepartmentViewer;

  const [selectedUserId, setSelectedUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [marking, setMarking] = useState(false);

  const [activityMore, setActivityMore] = useState([]);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState(false);

  // Full raw saved layout (both modes' entries, if any) + this mode's
  // reconciled, editable panel list. See reconcilePanels' note on why the
  // raw blob is kept around: an admin/department viewer can see BOTH an
  // admin-mode layout ("viewing all") and a tech-mode layout (filtered to a
  // specific user) from the same account, and saving one shouldn't clobber
  // the other's customization within the single DB row.
  const [rawLayout, setRawLayout] = useState(null);
  const [panels, setPanels] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const dragIndex = useRef(null);
  const [draggingIndex, setDraggingIndex] = useState(null);

  useEffect(() => {
    if (!canFilterByUser) return;
    // scope=department: dept managers should only filter within their own
    // department; system admins (people.view_all) still see everyone — see
    // usersController.list.
    api.get('/users', { params: { scope: 'department' } }).then(({ data: d }) => setUsers(d.users)).catch(() => {});
  }, [canFilterByUser]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    setForbidden(false);
    const params = selectedUserId ? { userId: selectedUserId } : {};
    api
      .get('/dashboard', { params })
      .then(({ data: d }) => {
        setData(d);
        setActivityMore([]);
        setActivityHasMore(!!d.activityHasMore);
      })
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else setError(errMessage(err));
      })
      .finally(() => setLoading(false));
  }, [selectedUserId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh the activity feed every 60s (system/department modes only).
  useEffect(() => {
    if (!data || (data.mode !== 'admin_system' && data.mode !== 'admin_department')) return undefined;
    const interval = setInterval(() => {
      const params = selectedUserId ? { userId: selectedUserId } : {};
      api.get('/dashboard', { params }).then(({ data: d }) => {
        setData((prev) => (prev ? { ...prev, activity: d.activity } : d));
        setActivityHasMore(!!d.activityHasMore);
        setActivityMore([]);
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [data, selectedUserId]);

  const isTechMode = data && (data.mode === 'tech' || data.mode === 'admin_filtered');
  const catalog = isTechMode ? TECH_CATALOG : ADMIN_CATALOG;
  const defaultPanels = isTechMode ? TECH_DEFAULT_PANELS : ADMIN_DEFAULT_PANELS;

  useEffect(() => {
    if (!data) return;
    api.get('/dashboard/layout')
      .then(({ data: d }) => {
        setRawLayout(d.layout);
        setPanels(reconcilePanels(d.layout?.panels, catalog, defaultPanels));
      })
      .catch(() => setPanels(reconcilePanels(null, catalog, defaultPanels)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.mode]);

  const handleMarkAllRead = async () => {
    setMarking(true);
    try {
      await api.patch('/notifications/read-all');
      setData((prev) => (prev ? { ...prev, notifications: prev.notifications.map((n) => ({ ...n, isRead: true })) } : prev));
    } catch {
      /* ignore — non-critical */
    } finally {
      setMarking(false);
    }
  };

  const handleLoadMoreActivity = async () => {
    setLoadingMoreActivity(true);
    try {
      const offset = (data.activity?.length || 0) + activityMore.length;
      const { data: d } = await api.get('/dashboard/activity', { params: { offset } });
      setActivityMore((prev) => [...prev, ...d.activity]);
      setActivityHasMore(d.activityHasMore);
    } catch {
      /* ignore — non-critical */
    } finally {
      setLoadingMoreActivity(false);
    }
  };

  const saveLayout = async (nextPanels) => {
    const catalogKeys = Object.keys(catalog);
    const otherModeEntries = (rawLayout?.panels || []).filter((p) => !catalogKeys.includes(p.key));
    const merged = { panels: [...nextPanels, ...otherModeEntries] };
    setRawLayout(merged);
    try {
      await api.put('/dashboard/layout', { layout: merged });
    } catch {
      /* non-critical — local state already reflects the change */
    }
  };

  const handleDone = () => {
    setEditMode(false);
    saveLayout(panels);
  };

  const handleResetToDefault = async () => {
    setPanels(defaultPanels.map((p) => ({ ...p })));
    try {
      await api.delete('/dashboard/layout');
      const catalogKeys = Object.keys(catalog);
      const otherModeEntries = (rawLayout?.panels || []).filter((p) => !catalogKeys.includes(p.key));
      setRawLayout(otherModeEntries.length ? { panels: otherModeEntries } : null);
    } catch {
      /* non-critical */
    }
  };

  const hidePanel = (key) => setPanels((prev) => prev.map((p) => (p.key === key ? { ...p, hidden: true } : p)));
  const addPanel = (key) => setPanels((prev) => prev.map((p) => (p.key === key ? { ...p, hidden: false } : p)));
  const toggleSize = (key) => setPanels((prev) => prev.map((p) => (p.key === key ? { ...p, size: p.size === 'full' ? 'half' : 'full' } : p)));

  const reorder = (fromIdx, toIdx) => {
    setPanels((prev) => {
      const visible = prev.filter((p) => !p.hidden);
      const hidden = prev.filter((p) => p.hidden);
      const next = [...visible];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return [...next, ...hidden];
    });
  };

  const renderPanelContent = (key) => {
    switch (key) {
      case 'tickets': return <TicketsPanel tickets={data.tickets} />;
      case 'notifications': return <NotificationsPanel notifications={data.notifications} onMarkAllRead={handleMarkAllRead} marking={marking} />;
      case 'projectHealth': return (
        <ProjectHealthPanel
          projects={data.projectHealth}
          title={isTechMode ? 'Project Health' : (data.mode === 'admin_department' ? 'Project Health (My Department)' : 'Project Health (All Projects)')}
          emptyText={isTechMode ? 'No projects with your tasks yet.' : 'No projects to show.'}
        />
      );
      case 'hours': return <HoursPanel hours={data.hours} />;
      case 'teamWorkload': return <TeamWorkloadPanel workload={data.teamWorkload} />;
      case 'activityFeed': return (
        <ActivityFeedPanel
          activity={[...data.activity, ...activityMore]}
          hasMore={activityHasMore}
          onLoadMore={handleLoadMoreActivity}
          loadingMore={loadingMoreActivity}
        />
      );
      case 'quickActions': return <QuickActionsPanel />;
      default: return null;
    }
  };

  const visiblePanels = (panels || []).filter((p) => !p.hidden);
  const hiddenPanelDefs = (panels || []).filter((p) => p.hidden).map((p) => ({ key: p.key, label: catalog[p.key]?.label || p.key }));

  return (
    <div
      style={{ margin: '-2rem -1.5rem', padding: '2rem 1.5rem' }}
      className="min-h-full bg-navy-50"
    >
      {loading && !data ? (
        <Spinner />
      ) : forbidden ? (
        <AccessRestricted />
      ) : error ? (
        <div className="rounded-md p-4 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-bg))', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}>
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {isTechMode && data.mode === 'tech' && (
                <GreetingBar title={`${timeGreeting()}, ${firstName(data.viewingUser.displayName)}`} />
              )}
              {isTechMode && data.mode === 'admin_filtered' && (
                <GreetingBar title={`Viewing ${data.viewingUser.displayName}'s dashboard`} subtitleName={data.viewingUser.displayName} />
              )}
              {!isTechMode && <h1 className="text-xl font-semibold" style={{ color: TEXT }}>Dashboard</h1>}
            </div>

            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              {canFilterByUser && (
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none sm:w-auto"
                  style={{ backgroundColor: CARD_BG, borderColor: 'var(--color-border-strong)', color: TEXT }}
                >
                  <option value="">{isSystemViewer ? 'All users (system wide)' : 'All users in my department'}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName}</option>
                  ))}
                </select>
              )}
              <div className="flex items-center justify-end gap-2">
                {editMode ? (
                  <>
                    <AddPanelMenu hiddenPanels={hiddenPanelDefs} onAdd={addPanel} />
                    <button type="button" onClick={handleDone} className="btn-primary text-sm">Done</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setEditMode(true)} className="btn-secondary text-sm">Customize</button>
                )}
              </div>
              {editMode && (
                <button type="button" onClick={handleResetToDefault} className="text-xs hover:underline" style={{ color: MUTED }}>
                  Reset to default
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={isTechMode ? 'My Open Tickets' : (data.mode === 'admin_department' ? 'My Department Open Tickets' : 'Total Open Tickets')}
              value={data.stats.openTickets}
              color="var(--color-accent)"
            />
            <StatCard label="Overdue Tickets" value={data.stats.overdueTickets} color="var(--color-danger)" />
            {isTechMode ? (
              <StatCard label="High Priority" value={data.stats.highPriorityOpen} color="var(--color-warning)" />
            ) : (
              <StatCard label="Unassigned Tickets" value={data.stats.unassignedTickets} color="var(--color-warning)" />
            )}
            <StatCard label="Closed This Week" value={data.stats.closedThisWeek} color="var(--color-success)" delta={data.stats.closedDelta} />
          </div>

          {panels && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {visiblePanels.map((p, idx) => (
                <PanelSlot
                  key={p.key}
                  label={catalog[p.key]?.label || p.key}
                  size={p.size}
                  editMode={editMode}
                  dragging={draggingIndex === idx}
                  onDragStart={() => { dragIndex.current = idx; setDraggingIndex(idx); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIndex.current !== null) reorder(dragIndex.current, idx); dragIndex.current = null; setDraggingIndex(null); }}
                  onDragEnd={() => { dragIndex.current = null; setDraggingIndex(null); }}
                  onHide={() => hidePanel(p.key)}
                  onToggleSize={() => toggleSize(p.key)}
                >
                  {renderPanelContent(p.key)}
                </PanelSlot>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
