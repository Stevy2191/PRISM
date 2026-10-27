import { IconX } from '@tabler/icons-react';

// Portal admins as removable chips.
export default function AdminChips({ contacts, canEdit, onRemove, roleLabel, empty = 'No admins' }) {
  if (!contacts.length) return <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{empty}</span>;
  return contacts.map((c) => (
    <span key={c.id} className="inline-flex min-w-0 items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-sm font-medium" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-primary)' }}>
      <span className="min-w-0 truncate">{c.displayName}</span>
      {canEdit && (
        <button type="button" aria-label={`Remove ${c.displayName} as ${roleLabel}`} onClick={() => onRemove(c)} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full hover:bg-[var(--color-card)]" style={{ color: 'var(--color-text-muted)' }}>
          <IconX size={13} aria-hidden="true" />
        </button>
      )}
    </span>
  ));
}
