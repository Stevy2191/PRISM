import { Fragment } from 'react';
import { Link } from 'react-router-dom';

// "Assets / LT-0014": items are [{ label, to?, current? }]; the last one is this
// page unless it says current: false (e.g. a Settings group).
export default function Breadcrumbs({ items = [], className = '' }) {
  return (
    <nav aria-label="Breadcrumb" className={`flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-navy-400 ${className}`}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {!item.to || (last && item.current !== false) ? (
              <span aria-current={last && item.current !== false ? 'page' : undefined} className="num min-w-0 truncate">{item.label}</span>
            ) : (
              <Link to={item.to} className="hover:underline" style={{ color: 'var(--color-accent)' }}>{item.label}</Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
