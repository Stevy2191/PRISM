import { IconLock } from '@tabler/icons-react';

// Inline 403 state — shown in place of a page/section's content when the
// backend rejects a request with 403, instead of a blank screen or a raw
// error string. Deliberately does not surface which permission was missing.
export default function AccessRestricted() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[10px] border p-12 text-center" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, transparent)' }}>
        <IconLock size={22} style={{ color: 'var(--color-danger)' }} />
      </span>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>Access restricted</h2>
      <p className="max-w-sm text-sm" style={{ color: 'var(--color-text-muted)' }}>
        You don&apos;t have permission to view this. Contact your administrator if you need access.
      </p>
    </div>
  );
}

// Shared predicate so pages don't each hand-roll `err?.response?.status === 403`.
export function isForbidden(err) {
  return err?.response?.status === 403;
}
