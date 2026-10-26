import { useCallback, useEffect, useRef, useState } from 'react';
import SlaBadge, { CLOCK_LABELS } from '../components/SlaBadge';
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
  IconLayoutGrid,
} from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Button from '../components/ui/Button';
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
  on_hold: { label: 'On hold', color: 'var(--color-warning)' },
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
      className={`h-full rounded-xl border p-5 ${className}`}
      style={{ backgroundColor: CARD_BG, borderColor: CARD_BORDER }}
    >
      {children}
    </div>
  );
}

// Stat tile: label, big number (coloured only when it signals trouble).
function StatCard({ label, value, color = TEXT, delta }) {
  return (
    <div className="h-full rounded-xl border p-5 max-sm:p-4" style={{ backgroundColor: CARD_BG, borderColor: CARD_BORDER }}>
      <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="num mt-2 text-3xl font-semibold leading-none tracking-tight" style={{ color }}>{value}</p>
      {delta !== undefined && (
        <p className="num mt-2 text-xs font-semibold" style={{ color: delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
          {delta >= 0 ? '+' : ''}{delta} vs last week
        </p>
      )}
    </div>
  );
}

// Shared panel header: title, optional right-hand controls (e.g. Mark all read).
function PanelHead({ title, children }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
      <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>{title}</h2>
      {children}
    </div>
  );
}

function ProgressBar({ percent, color }) {
  return (
    <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function ProjectHealthPanel({ projects, title = 'Project Health', emptyText = 'No projects to show.' }) {
  return (
    <Card className="!p-0">
      <PanelHead title={title} />
      {projects.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>{emptyText}</p>
      ) : (
        <ul className="divide-y divide-navy-100">
          {projects.map((p) => {
            const badge = DUE_BADGE[p.dueBadge] || DUE_BADGE.none;
            return (
              <li key={p.id} className="px-5 py-4" style={{ borderColor: CARD_BORDER }}>
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/projects/${p.id}`} className="min-w-0 truncate font-medium hover:underline" style={{ color: TEXT }}>
                    {p.name}
                  </Link>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
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
      <PanelHead title="My Tickets" />
      {tickets.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No assigned tickets.</p>
      ) : (
        <ul className="divide-y divide-navy-100">
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
                  className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
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
      <PanelHead title="Notifications">
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={!hasUnread || marking}
          className="rounded-md border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: CARD_BORDER, color: 'var(--color-accent)' }}
        >
          Mark all read
        </button>
      </PanelHead>
      {notifications.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>You&apos;re all caught up.</p>
      ) : (
        <ul className="divide-y divide-navy-100">
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
                  <p className="text-sm [overflow-wrap:anywhere]" style={{ color: TEXT }}>{n.message}</p>
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
      <h2 className="eyebrow uppercase tracking-wide">My Hours This Week</h2>
      <p className="mt-2 num text-3xl font-semibold tracking-tight" style={{ color: TEXT }}>{hours.total}h</p>
      <div className="mt-5 space-y-3">
        {hours.byDay.map((d) => (
          <div key={d.day} className="flex items-center gap-3">
            <span className="w-8 text-xs font-medium" style={{ color: MUTED }}>{d.day}</span>
            <div className="h-2 flex-1 rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
              <div
                className="h-full rounded-full"
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
      <PanelHead title="Team Workload" />
      {workload.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No staff members yet.</p>
      ) : (
        <div className="space-y-3 px-5 py-4">
          {workload.map((w) => (
            <div key={w.userId} className="flex items-center gap-3">
              <span className="w-32 flex-shrink-0 truncate text-sm" style={{ color: TEXT }}>{w.displayName}</span>
              <div className="h-2 flex-1 rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
                <div
                  className="h-full rounded-full"
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

function formatHoursShort(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function StarRating({ value }) {
  const full = Math.round(value);
  return (
    <span className="text-lg leading-none text-amber-500">
      {'★'.repeat(full)}
      <span style={{ color: 'var(--color-border)' }}>{'★'.repeat(5 - full)}</span>
    </span>
  );
}

function MyRatingsPanel({ ratings }) {
  if (!ratings) return null;
  return (
    <Card>
      <h2 className="eyebrow uppercase tracking-wide">My Ratings</h2>
      {ratings.showRating ? (
        <div className="mt-3 flex items-baseline gap-2">
          <StarRating value={ratings.avgRating || 0} />
          <span className="num text-2xl font-semibold tracking-tight" style={{ color: TEXT }}>{ratings.avgRating?.toFixed(1)}</span>
          <span className="text-sm" style={{ color: MUTED }}>/ 5 · {ratings.responseCount} response{ratings.responseCount === 1 ? '' : 's'}</span>
        </div>
      ) : (
        <p className="mt-3 text-sm" style={{ color: MUTED }}>
          Not enough survey responses yet ({ratings.responseCount}/{ratings.minTicketsToShowRating ?? 3}).
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs" style={{ color: MUTED }}>Avg first response</p>
          <p className="text-base font-semibold" style={{ color: TEXT }}>{formatHoursShort(ratings.avgFirstResponseHours)}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: MUTED }}>Avg resolution</p>
          <p className="text-base font-semibold" style={{ color: TEXT }}>{formatHoursShort(ratings.avgResolutionHours)}</p>
        </div>
      </div>
    </Card>
  );
}

function TeamHappinessPanel({ data }) {
  const scoreColor = (score) => {
    if (score === null || score === undefined) return MUTED;
    if (score >= 4) return 'var(--color-success)';
    if (score >= 3) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };
  const sorted = [...(data || [])].sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1));
  return (
    <Card className="!p-0">
      <PanelHead title="Team Happiness" />
      {sorted.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No technicians yet.</p>
      ) : (
        <ul className="divide-y divide-navy-100">
          {sorted.map((t) => (
            <li key={t.userId} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: TEXT }}>{t.name}</span>
              {t.showRating ? (
                <>
                  <span className="text-sm font-semibold" style={{ color: scoreColor(t.avgRating) }}>
                    {t.avgRating?.toFixed(1)}
                  </span>
                  <span className="w-16 flex-shrink-0 text-right text-xs" style={{ color: MUTED }}>
                    {t.responseCount} resp.
                  </span>
                  <span className="w-16 flex-shrink-0 text-right text-xs" style={{ color: MUTED }}>
                    {formatHoursShort(t.avgResolutionHours)}
                  </span>
                </>
              ) : (
                <span className="text-xs" style={{ color: MUTED }}>Not enough responses ({t.responseCount})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssetsSummaryPanel({ data }) {
  if (!data) return null;
  const stats = [
    { label: 'Due for replacement (90 days)', value: data.dueForReplacement, to: '/assets?filter=dueForReplacement', color: data.dueForReplacement > 0 ? 'var(--color-warning)' : TEXT },
    { label: 'Expired warranty', value: data.expiredWarranty, to: '/assets?filter=expiredWarranty', color: data.expiredWarranty > 0 ? 'var(--color-danger)' : TEXT },
    { label: 'Subscriptions renewing (30 days)', value: data.subscriptionsRenewingSoon ?? 0, to: '/calendar', color: (data.subscriptionsRenewingSoon ?? 0) > 0 ? 'var(--color-warning)' : TEXT },
    { label: 'Total active', value: data.totalActive, to: '/assets?status=active', color: TEXT },
    { label: 'Licenses expiring (30 days)', value: data.licensesExpiringSoon ?? 0, to: '/assets/licenses?status=expiring_soon', color: (data.licensesExpiringSoon ?? 0) > 0 ? 'var(--color-warning)' : TEXT },
    { label: 'Contracts renewing (60 days)', value: data.contractsRenewingSoon ?? 0, to: '/assets/contracts?status=expiring_soon', color: (data.contractsRenewingSoon ?? 0) > 0 ? 'var(--color-warning)' : TEXT },
  ];
  return (
    <Card>
      <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>Assets</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="rounded-lg border p-3 text-center transition hover:bg-[var(--color-hover)]" style={{ borderColor: CARD_BORDER }}>
            <p className="num text-2xl font-semibold tracking-tight" style={{ color: s.color }}>{s.value}</p>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>{s.label}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function SlaAtRiskPanel({ tickets }) {
  if (!tickets) return null;
  return (
    <Card>
      <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>SLA at risk</h2>
      {tickets.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: MUTED }}>Nothing breached or at risk.</p>
      ) : (
        <ul className="mt-3 divide-y divide-navy-100" data-testid="sla-at-risk">
          {tickets.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <Link to={`/tickets/${t.id}`} className="min-w-0 truncate text-sm hover:underline" style={{ color: TEXT }}>
                <span className="num text-xs" style={{ color: MUTED }}>#{String(t.id).padStart(5, '0')}</span> {t.title}
              </Link>
              <span className="flex flex-shrink-0 items-center gap-2">
                {t.sla?.worst && <span className="hidden text-xs sm:inline" style={{ color: MUTED }}>{CLOCK_LABELS[t.sla.worst.clock]}</span>}
                <SlaBadge sla={t.sla} />
              </span>
            </li>
          ))}
        </ul>
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
      <h2 className="eyebrow mb-4">Quick Actions</h2>
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
      <PanelHead title="Activity Feed" />
      {activity.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No recent activity.</p>
      ) : (
        <ul className="divide-y divide-navy-100">
          {activity.map((a) => {
            const color = ACTIVITY_COLOR[a.colorKey] || 'var(--color-accent)';
            const to = a.targetType === 'project' ? `/projects/${a.targetId}` : `/tickets/${a.targetId}`;
            return (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm [overflow-wrap:anywhere]">
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
  myRatings: { label: 'My Ratings', defaultSize: 'half' },
  slaAtRisk: { label: 'SLA at Risk', defaultSize: 'half' },
  quickActions: { label: 'Quick Actions', defaultSize: 'half' },
};
const ADMIN_CATALOG = {
  teamWorkload: { label: 'Team Workload', defaultSize: 'half' },
  activityFeed: { label: 'Activity Feed', defaultSize: 'half' },
  projectHealth: { label: 'Project Health', defaultSize: 'full' },
  teamHappiness: { label: 'Team Happiness', defaultSize: 'half' },
  assetsSummary: { label: 'Assets', defaultSize: 'half' },
  slaAtRisk: { label: 'SLA at Risk', defaultSize: 'half' },
  quickActions: { label: 'Quick Actions', defaultSize: 'half' },
};

const TECH_DEFAULT_PANELS = [
  { key: 'tickets', size: 'half', hidden: false },
  { key: 'notifications', size: 'half', hidden: false },
  { key: 'projectHealth', size: 'half', hidden: false },
  { key: 'hours', size: 'half', hidden: false },
  { key: 'myRatings', size: 'half', hidden: false },
  { key: 'slaAtRisk', size: 'half', hidden: false },
  { key: 'quickActions', size: 'half', hidden: true },
];
const ADMIN_DEFAULT_PANELS = [
  { key: 'teamWorkload', size: 'half', hidden: false },
  { key: 'activityFeed', size: 'half', hidden: false },
  { key: 'projectHealth', size: 'full', hidden: false },
  { key: 'teamHappiness', size: 'half', hidden: false },
  { key: 'assetsSummary', size: 'half', hidden: false },
  { key: 'slaAtRisk', size: 'half', hidden: false },
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
  const spanClass = size === 'full' ? 'min-w-0 md:col-span-2' : 'min-w-0 md:col-span-1';

  if (!editMode) {
    return <div className={spanClass}>{children}</div>;
  }

  return (
    <div
      className={`${spanClass} flex flex-col rounded-2xl border border-dashed p-2`}
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
          <button type="button" onClick={onToggleSize} className="text-xs font-semibold hover:underline" style={{ color: TEXT }}>
            {size === 'full' ? 'Make half-width' : 'Make full-width'}
          </button>
          <button type="button" onClick={onHide} className="flex h-6 w-6 items-center justify-center rounded-full text-xs" style={{ color: 'var(--color-danger)', backgroundColor: tint('var(--color-danger)') }} title="Hide panel" aria-label={`Hide ${label}`}>
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
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
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}><IconPlus size={15} aria-hidden="true" />Add panel</Button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border p-1 shadow-lg"
          style={{ backgroundColor: CARD_BG, borderColor: CARD_BORDER }}
        >
          {hiddenPanels.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { onAdd(p.key); setOpen(false); }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
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
    <div>
      <h1 className="page-title">{title}</h1>
      <p className="mt-1 text-sm" style={{ color: MUTED }}>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        {subtitleName && <> · Here is what&apos;s happening with {subtitleName}&apos;s work.</>}
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
    // limit=all rather than /users/directory: this dropdown must keep the
    // scope=department semantics above, and it is an option list — a
    // truncated picker silently hides people with no cue that it did.
    api.get('/users', { params: { scope: 'department', limit: 'all' } }).then(({ data: d }) => setUsers(d.users)).catch(() => {});
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
      case 'myRatings': return <MyRatingsPanel ratings={data.myRatings} />;
      case 'teamWorkload': return <TeamWorkloadPanel workload={data.teamWorkload} />;
      case 'teamHappiness': return <TeamHappinessPanel data={data.teamHappiness} />;
      case 'assetsSummary': return <AssetsSummaryPanel data={data.assetsSummary} />;
      case 'slaAtRisk': return <SlaAtRiskPanel tickets={data.slaAtRisk} />;
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
      className="mx-auto min-h-full max-w-[1280px] px-1 sm:px-0 lg:px-6"
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {isTechMode && data.mode === 'tech' && (
                <GreetingBar title={`${timeGreeting()}, ${firstName(data.viewingUser.displayName)}`} />
              )}
              {isTechMode && data.mode === 'admin_filtered' && (
                <GreetingBar title={`Viewing ${data.viewingUser.displayName}'s dashboard`} subtitleName={data.viewingUser.displayName} />
              )}
              {!isTechMode && <h1 className="page-title">Dashboard</h1>}
            </div>

            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              {canFilterByUser && (
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  aria-label="Whose dashboard"
                  className="sel w-full sm:w-auto"
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
                    <Button variant="primary" onClick={handleDone}>Done</Button>
                  </>
                ) : (
                  <Button onClick={() => setEditMode(true)}><IconLayoutGrid size={15} aria-hidden="true" />Customize</Button>
                )}
              </div>
              {editMode && (
                <button type="button" onClick={handleResetToDefault} className="text-xs hover:underline" style={{ color: MUTED }}>
                  Reset to default
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label={isTechMode ? 'My Open Tickets' : (data.mode === 'admin_department' ? 'My Department Open Tickets' : 'Total Open Tickets')}
              value={data.stats.openTickets}
            />
            <StatCard label="Overdue Tickets" value={data.stats.overdueTickets} color="var(--color-danger)" />
            {isTechMode ? (
              <StatCard label="High Priority" value={data.stats.highPriorityOpen} color="var(--color-warning)" />
            ) : (
              <StatCard label="Unassigned Tickets" value={data.stats.unassignedTickets} color="var(--color-warning)" />
            )}
            <StatCard label="Closed This Week" value={data.stats.closedThisWeek} delta={data.stats.closedDelta} />
          </div>

          {panels && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
