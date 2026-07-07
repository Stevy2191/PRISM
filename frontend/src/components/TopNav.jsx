import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { IconSearch, IconSettings, IconMenu2, IconX } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api from '../api/api';
import { visibleNavItems, colorForDepartment, initials, useGlobalSearchShortcut } from './navConfig';
import NotificationsDropdown from './NotificationsDropdown';
import GlobalSearch from './GlobalSearch';

export default function TopNav() {
  const { user, logout, hasAnyPermission } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [visibility, setVisibility] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    api.get('/modules')
      .then(({ data }) => {
        const map = {};
        data.modules.forEach((m) => { map[m.moduleName] = m.visibleToRoles || []; });
        setVisibility(map);
      })
      .catch(() => setVisibility(null));
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onClick = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  useGlobalSearchShortcut(() => setSearchOpen(true));

  const items = visibleNavItems({ visibility, user, hasAnyPermission });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-40 flex items-center gap-1 border-b px-4"
        style={{ height: 52, backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <Link to="/dashboard" className="mr-4 flex flex-shrink-0 items-center gap-2">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="logo" className="h-6 w-6 rounded object-contain" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="11" height="11" rx="2.5" fill="#1d3461" stroke="var(--color-accent)" strokeWidth="1.4" />
              <rect x="14" y="1" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="1" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="14" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth="1.4" />
            </svg>
          )}
          <span className="hidden truncate text-base font-bold tracking-wide sm:inline" style={{ color: 'var(--color-text-primary)' }}>
            {settings.appName || settings.branding?.appName || 'PRISM'}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `relative flex h-[52px] items-center px-3 text-sm font-medium transition ${
                  isActive ? '' : 'hover:opacity-80'
                }`
              }
              style={({ isActive }) => ({
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
              })}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        {/* Mobile: push everything right since nav items are hidden */}
        <div className="flex-1 md:hidden" />

        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Search (Ctrl+K)"
          >
            <IconSearch size={18} stroke={1.8} />
          </button>

          <NotificationsDropdown />

          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Settings"
          >
            <IconSettings size={18} stroke={1.8} />
          </Link>

          <div className="relative ml-1" ref={userMenuRef}>
            <button type="button" onClick={() => setUserMenuOpen((o) => !o)} title={user?.displayName}>
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: colorForDepartment(user?.departmentId) }}
              >
                {initials(user?.displayName)}
              </span>
            </button>

            {userMenuOpen && (
              <div
                className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-md border shadow-lg"
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
            className="absolute inset-y-0 right-0 flex w-64 flex-col shadow-2xl"
            style={{ backgroundColor: 'var(--color-card)' }}
          >
            <div className="flex items-center justify-between border-b px-4" style={{ height: 52, borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Menu</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} style={{ color: 'var(--color-text-secondary)' }}>
                <IconX size={20} stroke={1.8} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-prism text-white' : 'hover:bg-[var(--color-hover)]'}`
                  }
                  style={({ isActive }) => (isActive ? undefined : { color: 'var(--color-text-secondary)' })}
                >
                  <span className="w-4 text-center">{n.icon}</span>
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </>
  );
}
