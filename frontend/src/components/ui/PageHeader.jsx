import Breadcrumbs from './Breadcrumbs';

// Look A page header: optional breadcrumb, title, sub line, actions on the right.
export default function PageHeader({
  title, sub, crumbs, actions, className = '',
}) {
  return (
    <header className={`min-w-0 ${className}`}>
      {crumbs && <Breadcrumbs items={crumbs} className="mb-2" />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="page-title break-words">{title}</h1>
          {sub && <p className="mt-1 text-sm text-navy-500">{sub}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
