// Look A button. variant: primary | default | quiet | icon; size: sm (32px) | md (40px).
const VARIANTS = {
  primary: 'border-transparent hover:opacity-90',
  default: 'border-navy-100 bg-surface text-navy-900 hover:bg-[var(--color-hover)]',
  quiet: 'border-transparent bg-transparent text-navy-500 hover:bg-[var(--color-hover)]',
  icon: 'border-navy-100 bg-surface text-navy-900 justify-center px-0 hover:bg-[var(--color-hover)]',
};

export default function Button({
  variant = 'default', size = 'md', type = 'button', className = '', style, children, ...rest
}) {
  const h = size === 'sm' ? 'h-8 text-[13px]' : 'h-10 text-sm';
  const w = variant === 'icon' ? (size === 'sm' ? 'w-8' : 'w-10') : (size === 'sm' ? 'px-3' : 'px-4');
  // Primary is painted from --color-accent so a custom accent colour applies.
  const primary = variant === 'primary'
    ? { backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)', ...style }
    : style;
  return (
    <button
      type={type}
      className={`inline-flex ${h} ${w} items-center gap-2 whitespace-nowrap rounded-md border font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[44px] ${VARIANTS[variant] || VARIANTS.default} ${className}`}
      style={primary}
      {...rest}
    >
      {children}
    </button>
  );
}
