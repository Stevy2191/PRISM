// Outlined label, e.g. a project or ticket tag.
export default function Tag({ className = '', children }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border border-navy-100 px-2 text-xs text-navy-500 ${className}`}>
      {children}
    </span>
  );
}
