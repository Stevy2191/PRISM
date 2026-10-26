// The Settings menu (spec: Settings redesign, option A): every group and
// page the user may open, from the registry, with search. canOpen decides
// visibility exactly as the routes' guards do; the server enforces access.
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IconSearch } from '@tabler/icons-react';
import { useAuth } from '../../context/AuthContext';
import { findPage, searchPages, visibleGroups } from '../../pages/settings/registry';

function MenuLink({ page, current, onNavigate }) {
  return (
    <Link to={page.path} onClick={onNavigate} aria-current={current ? 'page' : undefined}
      className={`block rounded-md px-2.5 py-1.5 text-sm ${current ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'}`}
      style={current ? { backgroundColor: 'var(--color-card)', boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}>
      {page.name}
    </Link>
  );
}

export default function SettingsMenu({ onNavigate }) {
  const { user, isOwner, hasAnyPermission } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => visibleGroups({ role: user?.role, isOwner, hasAnyPermission }), [user, isOwner, hasAnyPermission]);
  const current = findPage(pathname);
  const matches = searchPages(query, groups.flatMap((g) => g.pages));
  const searching = query.trim() !== '';

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && matches[0]) { e.preventDefault(); setQuery(''); onNavigate?.(); navigate(matches[0].path); }
    if (e.key === 'Escape') setQuery('');
  };

  return (
    <div className="space-y-1">
      <label className="relative mb-2 block">
        <IconSearch size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
        <input type="search" className="input h-9 pl-8 text-[13px]" placeholder="Find a setting" aria-label="Find a setting"
          value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      </label>
      {searching ? (
        matches.length
          ? matches.map((p) => <MenuLink key={p.id} page={p} current={current?.id === p.id} onNavigate={() => { setQuery(''); onNavigate?.(); }} />)
          : <p className="px-2.5 py-1.5 text-sm text-navy-400">No settings match</p>
      ) : (
        <>
          <Link to="/settings" onClick={onNavigate} aria-current={pathname === '/settings' ? 'page' : undefined}
            className={`block rounded-md px-2.5 py-1.5 text-sm font-semibold ${pathname === '/settings' ? '' : 'hover:bg-[var(--color-hover)]'}`}
            style={pathname === '/settings' ? { backgroundColor: 'var(--color-card)', boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}>
            Settings home
          </Link>
          {groups.map((g) => (
            <div key={g.name} className="pt-3">
              <p className="eyebrow px-2.5 pb-1">{g.name}</p>
              {g.pages.map((p) => <MenuLink key={p.id} page={p} current={current?.id === p.id} onNavigate={onNavigate} />)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
