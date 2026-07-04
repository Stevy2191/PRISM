import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTimer, formatElapsed } from '../context/TimerContext';
import { useTheme, THEME_OPTIONS } from '../context/ThemeContext';
import api from '../api/api';

// Sidebar modules. `key` matches a ModuleVisibility.moduleName row.
const NAV = [
  { key: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: '◧' },
  { key: 'tickets', to: '/tickets', label: 'Tickets', icon: '🎫' },
  { key: 'projects', to: '/projects', label: 'Projects', icon: '🗂' },
  { key: 'reports', to: '/reports', label: 'Reports', icon: '📊' },
  { key: 'calendar', to: '/calendar', label: 'Calendar', icon: '📅' },
  { key: 'settings', to: '/settings', label: 'Settings', icon: '⚙️' },
];

// Sensible defaults if module visibility hasn't loaded yet.
const DEFAULT_ROLES = {
  dashboard: ['admin', 'technician', 'requester'],
  tickets: ['admin', 'technician', 'requester'],
  projects: ['admin', 'technician', 'requester'],
  reports: ['admin', 'technician'],
  calendar: ['admin', 'technician', 'requester'],
  settings: ['admin', 'technician', 'requester'],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { activeTimer, elapsedSeconds, stop, cancel } = useTimer();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [visibility, setVisibility] = useState(null);

  // Cycle Light → Dark → System.
  const cycleTheme = () => {
    const order = THEME_OPTIONS.map((o) => o.value);
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };
  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';

  useEffect(() => {
    api
      .get('/modules')
      .then(({ data }) => {
        const map = {};
        data.modules.forEach((m) => { map[m.moduleName] = m.visibleToRoles || []; });
        setVisibility(map);
      })
      .catch(() => setVisibility(DEFAULT_ROLES));
  }, []);

  const rolesFor = (key) => {
    if (visibility && visibility[key]) return visibility[key];
    return DEFAULT_ROLES[key] || [];
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Sidebar stays dark in both themes, so its text uses fixed (non-themed) colors.
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium transition ${
      isActive ? 'bg-prism text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`;

  const items = NAV.filter((n) => rolesFor(n.key).includes(user?.role));

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="sidebar-surface flex w-64 flex-shrink-0 flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="logo" className="h-8 w-8 rounded object-contain" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="11" height="11" rx="2.5" fill="#1d3461" stroke="#3b82f6" strokeWidth="1.4" />
              <rect x="14" y="1" width="11" height="11" rx="2.5" fill="#0d1120" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="1" y="14" width="11" height="11" rx="2.5" fill="#0d1120" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="14" y="14" width="11" height="11" rx="2.5" fill="#0d1120" stroke="#161c2d" strokeWidth="1.4" />
            </svg>
          )}
          <span className="truncate text-xl font-bold tracking-wide text-white">{settings.appName || settings.branding?.appName || 'PRISM'}</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={linkClass}>
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <button
            onClick={cycleTheme}
            title={`Theme: ${theme} (click to change)`}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-white/10 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <span>{themeIcon}</span> Theme: <span className="capitalize">{theme}</span>
          </button>
          <p className="truncate text-sm font-medium text-white">{user?.displayName}</p>
          <p className="mb-3 truncate text-xs capitalize text-slate-400">{user?.role}</p>
          {user?.isLocalAccount && (
            <Link to="/change-password" className="mb-2 block text-center text-xs text-slate-400 hover:text-white">
              Change password
            </Link>
          )}
          <button onClick={handleLogout} className="w-full btn-secondary py-1.5 text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-navy-50">
        {/* Project timers still use the shared server-backed ActiveTimer (ticket
            timers moved to a self-contained localStorage widget on the ticket
            detail page and no longer touch this context), so this bar only
            ever fires for type === 'project' and stays visible while the tech
            has navigated away from that project's own page. */}
        {activeTimer?.type === 'project' && (
          <div className="sticky top-0 z-20 flex items-center justify-between bg-prism px-6 py-2 text-sm text-white shadow">
            <Link to={`/projects/${activeTimer.id}`} className="truncate hover:underline">
              ⏱ Timing <span className="font-semibold">{activeTimer.label}</span> · {formatElapsed(elapsedSeconds)}
            </Link>
            <div className="flex flex-shrink-0 gap-2">
              <button onClick={() => stop()} className="rounded bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30">
                Stop &amp; log
              </button>
              <button onClick={() => { if (confirm('Discard this timer without logging?')) cancel(); }} className="rounded px-2 py-1 text-xs text-white/80 hover:text-white">
                Discard
              </button>
            </div>
          </div>
        )}
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
