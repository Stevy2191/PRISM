import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconMessageReply,
  IconUserCheck,
  IconAlertTriangle,
  IconMessageCircle,
  IconHourglass,
  IconRefresh,
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
      className={`rounded-[10px] border p-5 ${className}`}
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

const ACTIVITY_VERB = {
  opened: 'opened',
  closed: 'closed',
  assigned: 'assigned',
  updated: 'updated',
  overdue: 'is now overdue on',
};

function ActivityFeedPanel({ activity }) {
  return (
    <Card className="!p-0">
      <div className="border-b px-5 py-4" style={{ borderColor: CARD_BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Activity Feed</h2>
      </div>
      {activity.length === 0 ? (
        <p className="p-5 text-sm" style={{ color: MUTED }}>No recent activity.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: CARD_BORDER }}>
          {activity.map((a) => (
            <li key={a.id} className="px-5 py-3 text-sm">
              <span style={{ color: TEXT }}>
                {a.actorName ? <strong>{a.actorName}</strong> : <strong style={{ color: 'var(--color-danger)' }}>Ticket</strong>}{' '}
                {ACTIVITY_VERB[a.action] || a.action}{' '}
                {a.ticketId && (
                  <Link to={`/tickets/${a.ticketId}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                    {formatTicketId({ id: a.ticketId, ticketNumber: a.ticketNumber })} {a.ticketTitle}
                  </Link>
                )}
              </span>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{timeAgo(a.occurredAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
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

function TechDashboard({ data, greetingTitle, subtitleName, onMarkAllRead, marking }) {
  const { stats, tickets, notifications, projectHealth, hours } = data;
  return (
    <div className="space-y-6">
      <GreetingBar title={greetingTitle} subtitleName={subtitleName} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="My Open Tickets" value={stats.openTickets} color="var(--color-accent)" />
        <StatCard label="Overdue Tickets" value={stats.overdueTickets} color="var(--color-danger)" />
        <StatCard label="High Priority" value={stats.highPriorityOpen} color="var(--color-warning)" />
        <StatCard label="Closed This Week" value={stats.closedThisWeek} color="var(--color-success)" delta={stats.closedDelta} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TicketsPanel tickets={tickets} />
        <NotificationsPanel notifications={notifications} onMarkAllRead={onMarkAllRead} marking={marking} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProjectHealthPanel projects={projectHealth} emptyText="No projects with your tasks yet." />
        <HoursPanel hours={hours} />
      </div>
    </div>
  );
}

function SystemWideDashboard({ data, title }) {
  const { stats, teamWorkload, projectHealth, activity } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={title ? `${title} Open Tickets` : 'Total Open Tickets'} value={stats.openTickets} color="var(--color-accent)" />
        <StatCard label="Overdue Tickets" value={stats.overdueTickets} color="var(--color-danger)" />
        <StatCard label="Unassigned Tickets" value={stats.unassignedTickets} color="var(--color-warning)" />
        <StatCard label="Closed This Week" value={stats.closedThisWeek} color="var(--color-success)" delta={stats.closedDelta} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TeamWorkloadPanel workload={teamWorkload} />
        <ActivityFeedPanel activity={activity} />
      </div>

      <ProjectHealthPanel projects={projectHealth} title={title ? `Project Health (${title})` : 'Project Health (All Projects)'} />
    </div>
  );
}

export default function Dashboard() {
  const { user, hasAnyPermission } = useAuth();
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

  useEffect(() => {
    if (!canFilterByUser) return;
    api.get('/users').then(({ data: d }) => setUsers(d.users)).catch(() => {});
  }, [canFilterByUser]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    setForbidden(false);
    const params = selectedUserId ? { userId: selectedUserId } : {};
    api
      .get('/dashboard', { params })
      .then(({ data: d }) => setData(d))
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else setError(errMessage(err));
      })
      .finally(() => setLoading(false));
  }, [selectedUserId]);

  useEffect(() => {
    load();
  }, [load]);

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
          {canFilterByUser && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-xl font-semibold" style={{ color: TEXT }}>Dashboard</h1>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Viewing:</span>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="rounded-md border px-3 py-1.5 text-sm focus:outline-none"
                    style={{ backgroundColor: CARD_BG, borderColor: 'var(--color-border-strong)', color: TEXT }}
                  >
                    <option value="">{isSystemViewer ? 'All users (system wide)' : 'All users in my department'}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.displayName}</option>
                    ))}
                  </select>
                </div>
                {data?.mode === 'admin_filtered' && (
                  <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                    Filtered to: {data.viewingUser.displayName}
                  </span>
                )}
              </div>
            </div>
          )}

          {data && data.mode === 'admin_system' && <SystemWideDashboard data={data} />}
          {data && data.mode === 'admin_department' && <SystemWideDashboard data={data} title="My Department" />}
          {data && data.mode === 'tech' && (
            <TechDashboard
              data={data}
              greetingTitle={`${timeGreeting()}, ${firstName(data.viewingUser.displayName)}`}
              onMarkAllRead={handleMarkAllRead}
              marking={marking}
            />
          )}
          {data && data.mode === 'admin_filtered' && (
            <TechDashboard
              data={data}
              greetingTitle={`Viewing ${data.viewingUser.displayName}'s dashboard`}
              subtitleName={data.viewingUser.displayName}
              onMarkAllRead={handleMarkAllRead}
              marking={marking}
            />
          )}
        </div>
      )}
    </div>
  );
}
