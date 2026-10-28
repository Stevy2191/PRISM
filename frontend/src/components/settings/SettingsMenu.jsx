// The Settings menu (layout B, 2026-10-28): a rail of sections with their
// icons; the open section (the current page's, or the one Settings home is
// showing) lists its pages underneath. Search covers every section. canOpen
// decides visibility exactly as the routes' guards do; the server enforces
// access.
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { IconSearch } from '@tabler/icons-react';
import { useAuth } from '../../context/AuthContext';
import { findPage, searchPages, visibleGroups } from '../../pages/settings/registry';
import { sectionIcon } from './sectionIcons';

function PageLink({ page, current, onNavigate, nested = false }) {
  return (
    <Link to={page.path} onClick={onNavigate} aria-current={current ? 'page' : undefined}
      className={`block rounded-md py-1.5 text-[13.5px] ${nested ? 'px-2.5' : 'px-3'} ${current ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'}`}
      style={current ? { backgroundColor: 'var(--color-hover)' } : undefined}>
      {page.name}
    </Link>
  );
}

export function SectionLink({ section, open, onNavigate, big = false }) {
  const Icon = sectionIcon(section.icon);
  return (
    <Link to={`/settings?section=${section.slug}`} onClick={onNavigate} aria-current={open ? 'true' : undefined}
      className={`flex items-center gap-3 rounded-lg px-2.5 text-[14.5px] font-medium ${big ? 'h-14' : 'h-11'} ${open ? '' : 'hover:bg-[var(--color-hover)]'}`}
      style={open ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : { color: 'var(--color-text-primary)' }}>
      <span aria-hidden="true" className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg border"
        style={open
          ? { backgroundColor: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }
          : { backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Icon size={16} stroke={2} />
      </span>
      <span className="min-w-0 flex-1 truncate">{section.name}</span>
      <span className="num text-xs" style={{ color: open ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>{section.pages.length}</span>
    </Link>
  );
}

export default function SettingsMenu({ onNavigate, big = false }) {
  const { user, isOwner, hasAnyPermission } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => visibleGroups({ role: user?.role, isOwner, hasAnyPermission }), [user, isOwner, hasAnyPermission]);
  const current = findPage(pathname);
  // The open section: the current page's, or the one Settings home shows.
  const openName = current?.group || (pathname === '/settings' ? groups.find((g) => g.slug === params.get('section'))?.name : null);
  const matches = searchPages(query, groups.flatMap((g) => g.pages));
  const searching = query.trim() !== '';

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && matches[0]) { e.preventDefault(); setQuery(''); onNavigate?.(); navigate(matches[0].path); }
    if (e.key === 'Escape') setQuery('');
  };

  return (
    <div>
      <label className="relative mb-2 block">
        <IconSearch size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
        <input type="search" className={`input pl-8 text-[13.5px] ${big ? 'h-11' : 'h-10'}`} placeholder="Find a setting" aria-label="Find a setting"
          value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      </label>
      {searching ? (
        <div className="space-y-0.5">
          {matches.length
            ? matches.map((p) => <PageLink key={p.id} page={p} current={current?.id === p.id} onNavigate={() => { setQuery(''); onNavigate?.(); }} />)
            : <p className="px-3 py-1.5 text-sm text-navy-400">No settings match</p>}
        </div>
      ) : (
        <nav aria-label="Settings sections" className="space-y-0.5">
          {groups.map((g) => (
            <div key={g.slug}>
              <SectionLink section={g} open={g.name === openName} onNavigate={onNavigate} big={big} />
              {g.name === openName && !big && (
                <div className="mb-1.5 ml-[26px] mt-1 space-y-0.5 border-l pl-2.5" style={{ borderColor: 'var(--color-border)' }}>
                  {g.pages.map((p) => <PageLink key={p.id} page={p} current={current?.id === p.id} onNavigate={onNavigate} nested />)}
                </div>
              )}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
