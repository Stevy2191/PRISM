import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { IconSearch, IconSettings, IconMenu2, IconX, IconChevronDown } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { visibleNavItems, colorForDepartment, initials, useGlobalSearchShortcut } from './navConfig';
import { useCompanySummary } from '../context/CompanyContext';
import NotificationsDropdown from './NotificationsDropdown';
import TimerIndicator from './work/TimerIndicator';
import GlobalSearch from './GlobalSearch';
import ThemeToggle from './ThemeToggle';
import QueueBadge from './QueueBadge';

// Renders a nav item with `subItems` (currently just Assets: Assets/
// Licenses/Contracts) as a click-to-open dropdown rather than a plain link —
// the only nav item with sub-sections, so this stays local to TopNav rather
// than a generalized menu system nothing else needs yet.
function NavDropdown({ item, iconOnly }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const isActive = item.subItems.some((s) => (
    s.to === item.to ? location.pathname === s.to : location.pathname === s.to || location.pathname.startsWith(`${s.to}/`)
  ));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          iconOnly
            ? `relative my-1.5 flex flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2.5 text-[11px] font-medium transition ${isActive ? '' : 'hover:bg-[var(--color-hover)]'}`
            : `relative flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium transition ${isActive ? '' : 'hover:bg-[var(--color-hover)]'}`
        }
        style={{
          color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          backgroundColor: isActive ? 'var(--color-accent-soft)' : undefined,
        }}
      >
        {iconOnly && <span className="text-sm leading-none">{item.icon}</span>}
        <span className={iconOnly ? 'truncate leading-none' : ''}>{item.label}</span>
        <IconChevronDown size={14} stroke={2} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 w-44 overflow-hidden rounded-xl border shadow-lg mt-1"
          style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
        >
          {item.subItems.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.to === item.to}
              onClick={() => setOpen(false)}
              className={({ isActive: a }) => `flex items-center gap-2 px-3 py-2 text-sm ${a ? 'font-medium' : ''}`}
              style={({ isActive: a }) => ({
                color: 'var(--color-text-primary)',
                backgroundColor: a ? 'var(--color-hover)' : 'transparent',
              })}
            >
              <span className="w-4 text-center text-xs">{s.icon}</span>
              {s.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopNav() {
  const { user, logout, hasAnyPermission } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onClick = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  useGlobalSearchShortcut(() => setSearchOpen(true));

  const { multiCompany } = useCompanySummary();
  const items = visibleNavItems({ hasAnyPermission, multiCompany });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-40 flex items-center gap-1 border-b px-4 lg:px-7"
        style={{ height: 56, backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <Link to="/dashboard" className="mr-4 flex flex-shrink-0 items-center gap-2">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="logo" className="h-6 w-6 rounded object-contain" />
          ) : (
            <span className="block h-[22px] w-[22px] rounded-md" style={{ backgroundColor: 'var(--color-accent)' }} aria-hidden="true" />
          )}
          <span className="hidden truncate text-base font-bold tracking-wide sm:inline" style={{ color: 'var(--color-text-primary)' }}>
            {settings.appName || settings.branding?.appName || 'PRISM'}
          </span>
        </Link>

        {/* Desktop nav (1024px+) — full labels */}
        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          {items.map((n) => (n.subItems ? (
            <NavDropdown key={n.to} item={n} />
          ) : (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `relative flex h-9 items-center rounded-md px-3 text-sm font-medium transition ${
                  isActive ? '' : 'hover:bg-[var(--color-hover)]'
                }`
              }
              style={({ isActive }) => ({
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                backgroundColor: isActive ? 'var(--color-accent-soft)' : undefined,
              })}
            >
              {n.label}
              {n.key === 'tickets' && <QueueBadge />}
            </NavLink>
          )))}
        </nav>

        {/* Tablet nav (768-1024px) — compact icon-over-label */}
        <nav className="hidden flex-1 items-stretch gap-0.5 overflow-x-auto md:flex lg:hidden">
          {items.map((n) => (n.subItems ? (
            <NavDropdown key={n.to} item={n} iconOnly />
          ) : (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `relative my-1.5 flex flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2.5 text-[11px] font-medium transition ${
                  isActive ? '' : 'hover:bg-[var(--color-hover)]'
                }`
              }
              style={({ isActive }) => ({
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                backgroundColor: isActive ? 'var(--color-accent-soft)' : undefined,
              })}
            >
              <span className="text-sm leading-none">{n.icon}</span>
              <span className="truncate leading-none">{n.label}</span>
              {n.key === 'tickets' && <QueueBadge compact />}
            </NavLink>
          )))}
        </nav>

        {/* Mobile: push everything right since nav items are hidden */}
        <div className="flex-1 md:hidden" />

        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mr-1 hidden h-9 items-center gap-2 rounded-md border px-2.5 text-sm md:flex xl:w-64"
            style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
            title="Search (Ctrl+K)"
            aria-label="Search"
          >
            <IconSearch size={16} stroke={1.8} />
            <span className="hidden flex-1 text-left xl:inline">Search</span>
            <kbd className="hidden rounded border px-1.5 text-xs xl:inline" style={{ borderColor: 'var(--color-border)', fontFamily: 'inherit' }}>Ctrl K</kbd>
          </button>

          <TimerIndicator />
          <NotificationsDropdown />

          <Link
            to="/settings"
            className="hidden h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-hover)] md:flex"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Settings"
          >
            <IconSettings size={18} stroke={1.8} />
          </Link>

          {/* Visible at every width, unlike search/settings: on mobile it's
              the only way to switch theme without digging into Preferences. */}
          <ThemeToggle className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-hover)]" />

          <div className="relative ml-1 hidden md:block" ref={userMenuRef}>
            <button type="button" onClick={() => setUserMenuOpen((o) => !o)} title={user?.displayName}>
              <span
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-xs font-semibold"
                style={{ backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg)' }}
              >
                {initials(user)}
              </span>
            </button>

            {userMenuOpen && (
              <div
                className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border shadow-lg"
                style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
              >
                <div className="border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{user?.displayName}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>{user?.primaryRole?.name || 'No role assigned'}</p>
                </div>
                <Link
                  to="/settings/preferences"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2 text-sm hover:bg-[var(--color-hover)]"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Account preferences
                </Link>
                {user?.isLocalAccount && (
                  <Link
                    to="/change-password"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2 text-sm hover:bg-[var(--color-hover)]"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    Change password
                  </Link>
                )}
                <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
                    style={{ color: 'var(--color-danger)' }}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-hover)] md:hidden"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Menu"
          >
            <IconMenu2 size={20} stroke={1.8} />
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col shadow-2xl"
            style={{ backgroundColor: 'var(--color-card)' }}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b px-4" style={{ height: 56, borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Menu</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-11 w-11 items-center justify-center"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <IconX size={20} stroke={1.8} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {items.map((n) => (
                <div key={n.to}>
                  <NavLink
                    to={n.to}
                    end={!!n.subItems}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex h-12 items-center gap-3 rounded-md px-3 text-sm font-medium ${isActive ? 'bg-prism text-white' : 'hover:bg-[var(--color-hover)]'}`
                    }
                    style={({ isActive }) => (isActive ? undefined : { color: 'var(--color-text-secondary)' })}
                  >
                    <span className="w-4 text-center">{n.icon}</span>
                    {n.label}
                  </NavLink>
                  {n.subItems && n.subItems.filter((s) => s.to !== n.to).map((s) => (
                    <NavLink
                      key={s.to}
                      to={s.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `ml-6 flex h-10 items-center gap-3 rounded-md px-3 text-sm ${isActive ? 'bg-prism text-white' : 'hover:bg-[var(--color-hover)]'}`
                      }
                      style={({ isActive }) => (isActive ? undefined : { color: 'var(--color-text-secondary)' })}
                    >
                      <span className="w-4 text-center text-xs">{s.icon}</span>
                      {s.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>

            <div className="flex-shrink-0 border-t p-3" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-3 px-1 py-2">
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: colorForDepartment(user?.departmentId) }}
                >
                  {initials(user)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{user?.displayName}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>{user?.primaryRole?.name || 'No role assigned'}</p>
                </div>
              </div>
              <Link
                to="/settings/preferences"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-12 items-center rounded-md px-3 text-sm font-medium hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Account preferences
              </Link>
              {user?.isLocalAccount && (
                <Link
                  to="/change-password"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-12 items-center rounded-md px-3 text-sm font-medium hover:bg-[var(--color-hover)]"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Change password
                </Link>
              )}
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                className="flex h-12 w-full items-center rounded-md px-3 text-left text-sm font-medium hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-danger)' }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </>
  );
}
