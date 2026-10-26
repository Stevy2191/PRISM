import { NavLink } from 'react-router-dom';

// Always-visible sub-nav for the three Assets-section pages — the TopNav
// dropdown (see navConfig.js/TopNav.jsx) covers the default nav style, but
// the compact-sidebar alt preference doesn't render sub-items, so this is
// the one navigation path that works regardless of nav style preference.
const TABS = [
  { to: '/assets', label: 'Assets' },
  { to: '/assets/licenses', label: 'Licenses' },
  { to: '/assets/contracts', label: 'Contracts' },
];

export default function AssetsSubNav() {
  return (
    <nav aria-label="Assets sections" className="flex gap-1 overflow-x-auto border-b border-navy-100">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) => `-mb-px flex-shrink-0 border-b-2 px-3.5 py-2.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent ${isActive ? 'font-semibold text-navy-900' : 'border-transparent font-medium text-navy-500 hover:text-navy-900'}`}
          style={({ isActive }) => (isActive ? { borderBottomColor: 'var(--color-accent)' } : undefined)}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
