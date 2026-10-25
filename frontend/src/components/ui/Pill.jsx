// Filter pill: a rounded toggle. `on` fills it with the strong ink colour.
export default function Pill({ on = false, type = 'button', className = '', children, ...rest }) {
  return (
    <button
      type={type}
      aria-pressed={on}
      className={`h-8 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:min-h-[44px] ${
        on ? 'border-transparent' : 'border-navy-100 bg-surface text-navy-500 hover:bg-[var(--color-hover)]'
      } ${className}`}
      style={on ? { backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg)' } : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
