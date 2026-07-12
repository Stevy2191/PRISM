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
    <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className="border-b-2 px-3 py-2 text-sm font-medium transition hover:opacity-80"
          style={({ isActive }) => ({
            color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            borderColor: isActive ? 'var(--color-accent)' : 'transparent',
          })}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
