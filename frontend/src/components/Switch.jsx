// Pill-style toggle switch. The rest of the app uses plain checkboxes for
// simple on/off inputs (Teams/Modules pages) — this one exists specifically
// for the permission-toggle grid, where a switch reads more clearly than a
// checkbox at a glance across a long list.
export default function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-prism focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-prism' : 'bg-navy-200'
      }`}
    >
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(1.125rem)' : 'translateX(0.25rem)' }}
      />
    </button>
  );
}
