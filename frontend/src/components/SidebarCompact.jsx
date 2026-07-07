import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { IconSearch, IconSettings } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api from '../api/api';
import { visibleNavItems, colorForDepartment, initials, useGlobalSearchShortcut } from './navConfig';
import NotificationsDropdown from './NotificationsDropdown';
import GlobalSearch from './GlobalSearch';

// Icon-only alternative to the top bar (~60px wide), tooltip on hover,
// for users who prefer a sidebar (Account Preferences -> Navigation style).
export default function SidebarCompact() {
  const { user, logout, hasAnyPermission } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [visibility, setVisibility] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
      <aside
        className="fixed inset-y-0 left-0 z-40 flex w-[60px] flex-col items-center border-r py-3"
        style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <Link to="/dashboard" className="group relative mb-4 flex h-9 w-9 items-center justify-center">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="logo" className="h-7 w-7 rounded object-contain" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="11" height="11" rx="2.5" fill="#1d3461" stroke="var(--color-accent)" strokeWidth="1.4" />
              <rect x="14" y="1" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="1" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="14" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth="1.4" />
            </svg>
          )}
          <Tooltip label="Dashboard" />
        </Link>

        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `group relative flex h-10 w-10 items-center justify-center rounded-md text-lg ${isActive ? 'bg-prism text-white' : 'hover:bg-[var(--color-hover)]'}`
              }
              style={({ isActive }) => (isActive ? undefined : { color: 'var(--color-text-secondary)' })}
            >
              <span>{n.icon}</span>
              <Tooltip label={n.label} />
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-1 pt-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="group relative flex h-10 w-10 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <IconSearch size={18} stroke={1.8} />
            <Tooltip label="Search (Ctrl+K)" />
          </button>

          <div className="flex h-10 w-10 items-center justify-center">
            <NotificationsDropdown align="left" />
          </div>

          <Link
            to="/settings"
            className="group relative flex h-10 w-10 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <IconSettings size={18} stroke={1.8} />
            <Tooltip label="Settings" />
          </Link>

          <div className="relative" ref={userMenuRef}>
            <button type="button" onClick={() => setUserMenuOpen((o) => !o)} className="group relative flex h-10 w-10 items-center justify-center">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: colorForDepartment(user?.departmentId) }}
              >
                {initials(user?.displayName)}
              </span>
              <Tooltip label={user?.displayName} />
            </button>

            {userMenuOpen && (
              <div
                className="absolute bottom-0 left-full z-40 ml-2 w-56 overflow-hidden rounded-md border shadow-lg"
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
        </div>
      </aside>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </>
  );
}

function Tooltip({ label }) {
  if (!label) return null;
  return (
    <span
      className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded px-2 py-1 text-xs opacity-0 shadow-md transition group-hover:opacity-100"
      style={{ backgroundColor: 'var(--color-text-primary)', color: 'var(--color-card)', zIndex: 50 }}
    >
      {label}
    </span>
  );
}
