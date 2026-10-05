// Small badges on the ticket page: source and CSAT.
import { IconWorld, IconMail, IconPhone } from '@tabler/icons-react';
import { MUTED } from '../theme';

// Hardcoded colors (not theme CSS variables) per spec — these identify how
// a ticket entered the system and should read the same regardless of theme.
const SOURCE_META = {
  manual: { label: 'Manual', color: '#64748b', icon: null },
  email: { label: 'Email', color: '#2563eb', icon: IconMail },
  phone: { label: 'Phone', color: '#16a34a', icon: IconPhone },
  portal: { label: 'Portal', color: '#7c3aed', icon: IconWorld },
};

export function SourceBadge({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.manual;
  const Icon = meta.icon;
  return (
    <span
      className="flex items-center gap-1 rounded-[3px] px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, transparent)`, color: meta.color }}
    >
      {Icon && <Icon size={12} />}
      {meta.label}
    </span>
  );
}

// CSAT survey status in the ticket header — a rating badge once the contact
// has responded, or a quiet "awaiting response" pill while it's still
// outstanding. Renders nothing if no survey was ever created for this
// ticket (CSAT disabled, or the ticket has no contact/contact email).
export function CsatBadge({ survey }) {
  if (!survey) return null;
  if (survey.status === 'responded' && survey.rating) {
    return (
      <span
        className="flex items-center gap-1 rounded-[3px] px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: 'color-mix(in srgb, #f59e0b 15%, transparent)', color: '#b45309' }}
        title={survey.comment || ''}
      >
        {'★'.repeat(survey.rating)}
        {'☆'.repeat(5 - survey.rating)} {survey.rating}/5
        {survey.comment ? ` — ${survey.comment.slice(0, 40)}${survey.comment.length > 40 ? '…' : ''}` : ''}
      </span>
    );
  }
  if (survey.sentAt) {
    return (
      <span className="rounded-[3px] px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: 'var(--color-hover)', color: MUTED }}>
        Survey sent — awaiting response
      </span>
    );
  }
  return null;
}
