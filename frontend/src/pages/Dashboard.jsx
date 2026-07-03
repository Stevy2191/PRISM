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
import { formatTicketId } from '../utils/ticketId';

// This page always renders as a fixed dark control-panel surface (matching
// Login), independent of the app-wide light/dark theme toggle.
const BG = '#080b12';
const CARD_BG = '#0d1120';
const CARD_BORDER = '#161c2d';
const TEXT = '#e2e8f0';
const MUTED = '#64748b';

const DUE_BADGE = {
  green: { pill: 'bg-[#0c2a1a] text-[#4ade80]', bar: '#4ade80' },
  amber: { pill: 'bg-[#2d1f00] text-[#fbbf24]', bar: '#fbbf24' },
  red: { pill: 'bg-[#2d0f0f] text-[#f87171]', bar: '#f87171' },
  none: { pill: 'bg-[#161c2d] text-[#64748b]', bar: '#3b82f6' },
};

const TICKET_STATUS = {
  open: { label: 'Open', cls: 'bg-[#0d2847] text-[#60a5fa]' },
  in_progress: { label: 'In Progress', cls: 'bg-[#0c2a1a] text-[#4ade80]' },
  overdue: { label: 'Overdue', cls: 'bg-[#2d0f0f] text-[#f87171]' },
  closed: { label: 'Closed', cls: 'bg-[#161c2d] text-[#94a3b8]' },
};

const NOTIF_TYPE = {
  reply: { Icon: IconMessageReply, bg: '#083344', fg: '#22d3ee' },
  assigned: { Icon: IconUserCheck, bg: '#1d3461', fg: '#60a5fa' },
  overdue: { Icon: IconAlertTriangle, bg: '#2d0f0f', fg: '#f87171' },
  comment: { Icon: IconMessageCircle, bg: '#2a1f3d', fg: '#c084fc' },
  due_soon: { Icon: IconHourglass, bg: '#2d1f00', fg: '#fbbf24' },
  status_change: { Icon: IconRefresh, bg: '#0c2a1a', fg: '#4ade80' },
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
        <p className="mt-1 text-xs" style={{ color: delta >= 0 ? '#4ade80' : '#f87171' }}>
          {delta >= 0 ? '+' : ''}
          {delta} vs last week
        </p>
      )}
    </Card>
  );
}

function ProgressBar({ percent, color }) {
  return (
    <div className="h-[5px] w-full rounded-[3px]" style={{ backgroundColor: '#161c2d' }}>
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
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.pill}`}>
                    {dueBadgeLabel(p.dueBadge, p.dueDate)}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {p.totalTasks} tasks · {p.closedTasks} closed · {p.openTasks} open
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1"><ProgressBar percent={p.percent} color={badge.bar} /></div>
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
                <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
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
          style={{ borderColor: CARD_BORDER, color: '#93c5fd' }}
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
                    ? { borderLeft: '2px solid #3b82f6', backgroundColor: '#0d1525' }
                    : { borderLeft: '2px solid transparent' }
                }
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px]"
                  style={{ backgroundColor: type.bg, color: type.fg }}
                >
                  <Icon size={18} stroke={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm" style={{ color: TEXT }}>{n.message}</p>
                  <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{timeAgo(n.createdAt)}</p>
                </div>
                {unread && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: '#3b82f6' }} />}
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
            <div className="h-3 flex-1 rounded-[3px]" style={{ backgroundColor: '#161c2d' }}>
              <div
                className="h-full rounded-[3px]"
                style={{ width: `${(d.hours / maxHours) * 100}%`, backgroundColor: '#3b82f6' }}
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
  const colorFor = (count) => (count > 25 ? '#f87171' : count > 15 ? '#fbbf24' : '#3b82f6');
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
              <div className="h-3 flex-1 rounded-[3px]" style={{ backgroundColor: '#161c2d' }}>
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
                {a.actorName ? <strong>{a.actorName}</strong> : <strong className="text-[#f87171]">Ticket</strong>}{' '}
                {ACTIVITY_VERB[a.action] || a.action}{' '}
                {a.ticketId && (
                  <Link to={`/tickets/${a.ticketId}`} className="hover:underline" style={{ color: '#93c5fd' }}>
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
        <StatCard label="My Open Tickets" value={stats.openTickets} color="#3b82f6" />
        <StatCard label="Overdue Tickets" value={stats.overdueTickets} color="#f87171" />
        <StatCard label="High Priority" value={stats.highPriorityOpen} color="#fbbf24" />
        <StatCard label="Closed This Week" value={stats.closedThisWeek} color="#4ade80" delta={stats.closedDelta} />
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

function SystemWideDashboard({ data }) {
  const { stats, teamWorkload, projectHealth, activity } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Open Tickets" value={stats.openTickets} color="#3b82f6" />
        <StatCard label="Overdue Tickets" value={stats.overdueTickets} color="#f87171" />
        <StatCard label="Unassigned Tickets" value={stats.unassignedTickets} color="#fbbf24" />
        <StatCard label="Closed This Week" value={stats.closedThisWeek} color="#4ade80" delta={stats.closedDelta} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TeamWorkloadPanel workload={teamWorkload} />
        <ActivityFeedPanel activity={activity} />
      </div>

      <ProjectHealthPanel projects={projectHealth} title="Project Health (All Projects)" />
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [selectedUserId, setSelectedUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users').then(({ data: d }) => setUsers(d.users)).catch(() => {});
  }, [isAdmin]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = selectedUserId ? { userId: selectedUserId } : {};
    api
      .get('/dashboard', { params })
      .then(({ data: d }) => setData(d))
      .catch((err) => setError(errMessage(err)))
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
      style={{ backgroundColor: BG, margin: '-2rem -1.5rem', padding: '2rem 1.5rem' }}
      className="min-h-full"
    >
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <div className="rounded-md p-4 text-sm" style={{ backgroundColor: '#1a0a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {isAdmin && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-xl font-semibold" style={{ color: TEXT }}>Dashboard</h1>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Viewing:</span>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="rounded-md border px-3 py-1.5 text-sm focus:outline-none"
                    style={{ backgroundColor: CARD_BG, borderColor: '#1a2235', color: TEXT }}
                  >
                    <option value="">All users (system wide)</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.displayName}</option>
                    ))}
                  </select>
                </div>
                {data?.mode === 'admin_filtered' && (
                  <span className="text-xs font-medium" style={{ color: '#3b82f6' }}>
                    Filtered to: {data.viewingUser.displayName}
                  </span>
                )}
              </div>
            </div>
          )}

          {data && data.mode === 'admin_system' && <SystemWideDashboard data={data} />}
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
