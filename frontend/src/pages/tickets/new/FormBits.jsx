// Form pieces and option lists for the new-ticket form.
import { CARD_BG, BORDER, TEXT, MUTED } from '../theme';

export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export const TYPE_OPTIONS = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'problem', label: 'Problem' },
  { value: 'change', label: 'Change' },
];

export const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// Email/Portal are system-set only (inbound email processing / future
// customer portal) — never offered here, matching the backend's own
// restriction to manual/phone on this endpoint.
export const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'phone', label: 'Phone' },
];

function Required() {
  return <span style={{ color: 'var(--color-danger)' }}> *</span>;
}

function OptionalPill() {
  return (
    <span
      className="rounded-[3px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: BORDER, color: MUTED }}
    >
      Optional
    </span>
  );
}

export function Card({ title, optional, children }) {
  return (
    <div className="rounded-[10px] border p-6" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {optional && <OptionalPill />}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Label({ children, required }) {
  return (
    <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }}>
      {children}
      {required && <Required />}
    </label>
  );
}
