// Form pieces and option lists for the new-ticket form.

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
  { value: 'email', label: 'Email' },
];

function Required() {
  return <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}> *</span>;
}

// One group of the form ("The problem", "Who it's for", …): a fieldset whose
// legend names it for screen readers.
export function Group({ title, optional, className = '', children }) {
  return (
    <fieldset className={`min-w-0 p-5 sm:p-6 ${className}`}>
      <legend className="float-left mb-4 flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-navy-400">
        {title}
        {optional && <span className="font-medium normal-case tracking-normal">(optional)</span>}
      </legend>
      <div className="clear-left space-y-4">{children}</div>
    </fieldset>
  );
}

export function Label({ children, required, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-navy-700">
      {children}
      {required && <Required />}
    </label>
  );
}
