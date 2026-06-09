import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTimer, formatElapsed } from '../context/TimerContext';
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
  const navigate = useNavigate();
  const [visibility, setVisibility] = useState(null);

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

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium transition ${
      isActive ? 'bg-prism text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
    }`;

  const items = NAV.filter((n) => rolesFor(n.key).includes(user?.role));

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 flex-shrink-0 flex-col bg-navy-900">
        <div className="flex items-center gap-2 px-5 py-5">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="logo" className="h-8 w-8 rounded object-contain" />
          ) : (
            <svg viewBox="0 0 64 64" className="h-8 w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 25 L23 30" stroke="#e2e8f0" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M42 31 L62 20" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              <path d="M42 31 L62 25" stroke="#f97316" strokeWidth="2" strokeLinecap="round" />
              <path d="M42 31 L62 30" stroke="#eab308" strokeWidth="2" strokeLinecap="round" />
              <path d="M42 31 L62 35" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
              <path d="M42 31 L62 40" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
              <path d="M42 31 L62 45" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
              <path d="M32 11 L50 47 L14 47 Z" stroke="#93c5fd" strokeWidth="2.5" strokeLinejoin="round" fill="#1e3a5f" fillOpacity="0.6" />
            </svg>
          )}
          <span className="truncate text-xl font-bold tracking-wide text-white">{settings.company?.name || 'PRISM'}</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={linkClass}>
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-navy-800 p-4">
          <p className="truncate text-sm font-medium text-white">{user?.displayName}</p>
          <p className="mb-3 truncate text-xs capitalize text-navy-300">{user?.role}</p>
          {user?.isLocalAccount && (
            <Link to="/change-password" className="mb-2 block text-center text-xs text-navy-300 hover:text-white">
              Change password
            </Link>
          )}
          <button onClick={handleLogout} className="w-full btn-secondary py-1.5 text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-navy-50">
        {activeTimer && (
          <div className="sticky top-0 z-20 flex items-center justify-between bg-prism px-6 py-2 text-sm text-white shadow">
            <span className="truncate">
              ⏱ Timing <span className="font-semibold">{activeTimer.label}</span> · {formatElapsed(elapsedSeconds)}
            </span>
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
