import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconBell, IconMessageReply, IconUserCheck, IconAlertTriangle, IconMessageCircle,
  IconHourglass, IconRefresh, IconBolt, IconEye,
} from '@tabler/icons-react';
import api from '../api/api';

const NOTIF_TYPE = {
  reply: { Icon: IconMessageReply, color: 'var(--color-accent)' },
  assigned: { Icon: IconUserCheck, color: 'var(--color-relation-accent)' },
  overdue: { Icon: IconAlertTriangle, color: 'var(--color-danger)' },
  comment: { Icon: IconMessageCircle, color: 'var(--color-accent)' },
  due_soon: { Icon: IconHourglass, color: 'var(--color-warning)' },
  status_change: { Icon: IconRefresh, color: 'var(--color-success)' },
  watcher_update: { Icon: IconEye, color: 'var(--color-accent)' },
  workflow: { Icon: IconBolt, color: 'var(--color-relation-accent)' },
};

function tint(color) {
  return `color-mix(in srgb, ${color} 18%, var(--color-bg))`;
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// `align`: 'right' (default, panel's right edge meets the bell — used in the
// top bar) or 'left' (panel opens to the right of the bell — used in the
// narrow left sidebar, where a right-aligned panel would render off-screen).
export default function NotificationsDropdown({ align = 'right' }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const ref = useRef(null);

  const load = () => {
    api.get('/notifications').then(({ data }) => setNotifications(data.notifications)).catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    setMarking(true);
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } finally {
      setMarking(false);
    }
  };

  const openNotification = (n) => {
    setOpen(false);
    if (n.ticket) navigate(`/tickets/${n.ticket.id}`);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
        style={{ color: 'var(--color-text-secondary)' }}
        title="Notifications"
      >
        <IconBell size={19} stroke={1.8} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: 'var(--color-danger)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-40 w-80 overflow-hidden rounded-md border shadow-lg ${
            align === 'left' ? 'left-full ml-2 bottom-0' : 'right-0 mt-2'
          }`}
          style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Notifications</span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={!unreadCount || marking}
              className="text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: 'var(--color-accent)' }}
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {notifications.slice(0, 10).map((n) => {
                  const type = NOTIF_TYPE[n.type] || NOTIF_TYPE.comment;
                  const Icon = type.Icon;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(n)}
                        className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-[var(--color-hover)]"
                      >
                        <span
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                          style={{ backgroundColor: tint(type.color), color: type.color }}
                        >
                          <Icon size={16} stroke={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm" style={{ color: 'var(--color-text-primary)' }}>{n.message}</span>
                          <span className="mt-0.5 block text-xs" style={{ color: 'var(--color-text-muted)' }}>{timeAgo(n.createdAt)}</span>
                        </span>
                        {!n.isRead && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t px-4 py-2 text-center" style={{ borderColor: 'var(--color-border)' }}>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/dashboard'); }}
              className="text-xs font-medium hover:underline"
              style={{ color: 'var(--color-accent)' }}
            >
              View all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
