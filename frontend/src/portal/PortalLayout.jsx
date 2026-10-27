import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { IconMenu2, IconX } from '@tabler/icons-react';
import { usePortalAuth } from './PortalAuth';

// The portal frame (mockups Tickets / Phone): brand "· Support", Tickets and
// Knowledge base, who is signed in and Sign out; on a phone a menu button
// and tabs under the bar.
export function Brand({ config, to = '/portal/tickets', support = true }) {
  const name = config?.branding?.appName || 'PRISM';
  const logo = config?.branding?.logoUrl;
  return (
    <Link to={to} className="flex min-w-0 items-center gap-2.5 text-[17px] font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
      {logo ? <img src={logo} alt="" className="h-7 w-7 flex-shrink-0 object-contain" /> : (
        <span aria-hidden="true" className="h-7 w-7 flex-shrink-0 rounded-lg" style={{ backgroundColor: 'var(--color-accent)' }} />
      )}
      <span className="truncate">{name}</span>
      {support && <span className="hidden flex-shrink-0 text-sm font-medium sm:inline" style={{ color: 'var(--color-text-muted)' }}>· Support</span>}
    </Link>
  );
}

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

const navCls = ({ isActive }) => `flex h-9 items-center rounded-lg px-3 text-sm ${isActive ? 'font-semibold' : 'font-medium hover:bg-[var(--color-hover)]'}`;
const navStyle = ({ isActive }) => (isActive
  ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
  : { color: 'var(--color-text-secondary)' });

export default function PortalLayout() {
  const { me, config, signOut } = usePortalAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const out = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/portal/sign-in', { replace: true });
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <header className="border-b" style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-7 px-4 sm:px-6">
          <Brand config={config} />
          <nav aria-label="Portal" className="hidden gap-1 md:flex">
            <NavLink to="/portal/tickets" className={navCls} style={navStyle}>Tickets</NavLink>
            <NavLink to="/portal/kb" className={navCls} style={navStyle}>Knowledge base</NavLink>
          </nav>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            <div className="min-w-0 text-right">
              <div className="truncate text-[13.5px] font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{me?.displayName}</div>
              <div className="max-w-[260px] truncate text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>{me?.company?.name}</div>
            </div>
            <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{initials(me?.displayName)}</span>
            <button type="button" onClick={out} className="text-[13.5px] font-medium hover:underline" style={{ color: 'var(--color-text-secondary)' }}>Sign out</button>
          </div>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg md:hidden"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {menuOpen ? <IconX size={22} aria-hidden="true" /> : <IconMenu2 size={22} aria-hidden="true" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t px-4 py-3 md:hidden" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{me?.displayName}</div>
            <div className="mb-3 break-words text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{me?.company?.name}</div>
            <button type="button" onClick={out} className="btn-secondary h-11 w-full justify-center">Sign out</button>
          </div>
        )}
        <nav aria-label="Portal sections" className="flex gap-1 border-t px-4 py-2 md:hidden" style={{ borderColor: 'var(--color-border)' }}>
          <NavLink to="/portal/tickets" className={(s) => `${navCls(s)} h-11 flex-1 justify-center`} style={navStyle}>Tickets</NavLink>
          <NavLink to="/portal/kb" className={(s) => `${navCls(s)} h-11 flex-1 justify-center`} style={navStyle}>Knowledge base</NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-[1120px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <Outlet />
      </main>
    </div>
  );
}
