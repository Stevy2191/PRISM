import StatusChip from '../ui/StatusChip';
import { fmtDate } from '../../utils/formatDate';

// Shared bits for the PRISM agent's staff screens (8a): a device's status
// chip, "3 h ago", sizes and dates.

export function ago(iso, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const days = (iso, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86400000));

export function gb(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const g = bytes / 1024 ** 3;
  return `${g >= 100 ? Math.round(g) : g.toFixed(1)} GB`;
}

export const shortDate = (iso) => fmtDate(iso);
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—');

// A device's status from its last check-in, by the server's rules (online
// within 10 minutes; stale after 14 days), where only the times are sent.
export function statusOf(d, now = Date.now()) {
  if (!d) return null;
  if (d.revokedAt) return 'revoked';
  const seen = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
  if (seen && now - seen <= 10 * 60 * 1000) return 'online';
  if (!seen || now - seen > 14 * 86400000) return 'stale';
  return 'offline';
}

export const PLATFORM = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

// Online (green), last seen … (neutral), Stale · 16 d (amber), Revoked (red).
export function AgentStatus({ device, short = false }) {
  if (!device) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  switch (device.status) {
    case 'online': return <StatusChip tone="good">Online</StatusChip>;
    case 'stale': return <StatusChip tone="waiting">{device.lastSeenAt ? `Stale · ${days(device.lastSeenAt)} d` : 'Never seen'}</StatusChip>;
    case 'revoked': return <StatusChip tone="bad">Revoked</StatusChip>;
    default: return <StatusChip tone="neutral">{short ? ago(device.lastSeenAt) : `Last seen ${ago(device.lastSeenAt)}`}</StatusChip>;
  }
}

export function AgentBadge() {
  return <StatusChip tone="info">Agent-managed</StatusChip>;
}
