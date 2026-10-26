import { Link } from 'react-router-dom';

// The public Help Center's frame: brand bar with "Staff sign in", centred
// column. width: Tailwind max-width class for the column.
export default function PortalShell({
  wordmark, logoUrl, width = 'max-w-4xl', children,
}) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}>
      <header className="border-b border-navy-100" style={{ backgroundColor: 'var(--color-card)' }}>
        <div className={`mx-auto flex ${width} items-center justify-between gap-3 px-4 py-3`}>
          <Link to="/kb" className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? <img src={logoUrl} alt={wordmark} className="h-7 w-7 object-contain" /> : (
              <span aria-hidden="true" className="h-6 w-6 flex-shrink-0 rounded-md" style={{ backgroundColor: 'var(--color-accent)' }} />
            )}
            <span className="truncate font-bold tracking-tight text-navy-900">{wordmark}</span>
            <span className="hidden text-sm text-navy-500 sm:inline">· Help Center</span>
          </Link>
          <Link to="/login" className="flex-shrink-0 py-2 text-sm font-medium text-navy-700 hover:underline">Staff sign in →</Link>
        </div>
      </header>
      <main className={`mx-auto ${width} px-4 py-8 sm:py-10`}>{children}</main>
    </div>
  );
}
