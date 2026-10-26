// A single row of Pills that scrolls sideways on a phone instead of wrapping.
export default function PillRow({ label, className = '', children }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
}
