// Look A filter select: "Status: All statuses" in one 32px box. The visible
// prefix is decorative; the select is named by `label`.
export default function SelectChip({
  label, showLabel = true, active = false, className = '', children, ...rest
}) {
  return (
    <span
      className={`inline-flex h-8 flex-shrink-0 items-center rounded-md border bg-surface pl-3 text-[13px] font-medium text-navy-500 focus-within:ring-2 focus-within:ring-prism-accent max-sm:h-11 ${active ? '' : 'border-navy-100'} ${className}`}
      style={active ? { borderColor: 'var(--color-accent)' } : undefined}
    >
      {showLabel && <span aria-hidden="true">{label}:</span>}
      <select
        aria-label={label}
        className={`h-full max-w-[12rem] cursor-pointer truncate rounded-md border-0 bg-transparent pr-2 font-semibold text-navy-900 focus:outline-none ${showLabel ? 'pl-1' : 'pl-0'}`}
        {...rest}
      >
        {children}
      </select>
    </span>
  );
}
