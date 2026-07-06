import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api from '../api/api';

// Nav visibility gates, per the roles/permissions build spec (Prompt 4).
const TICKETS_PERMISSION_KEYS = ['tickets.view_own', 'tickets.view_department', 'tickets.view_all'];
const PROJECTS_PERMISSION_KEYS = ['projects.view_own', 'projects.view_department', 'projects.view_all'];
const REPORTS_PERMISSION_KEYS = ['reports.view_own', 'reports.view_department', 'reports.view_all'];
// "Any permission starting with settings." plus the three People permissions
// that specifically unlock a Settings-hub card (manage_roles, manage_departments,
// view_all) — deliberately narrower than the full People permission set.
const SETTINGS_PERMISSION_KEYS = [
  'settings.manage_statuses', 'settings.manage_business_hours', 'settings.manage_branding',
  'settings.manage_system', 'settings.view_audit_log',
  'people.manage_roles', 'people.manage_departments', 'people.view_all',
];

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
  const { user, logout, hasAnyPermission } = useAuth();
  const { settings } = useSettings();
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

  // Sidebar surface is theme-aware (--color-sidebar), so its text uses the
  // same --color-text-* variables the rest of the app reads.
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium transition ${
      isActive ? 'bg-prism text-white' : 'hover:bg-[var(--color-hover)]'
    }`;
  const linkStyle = ({ isActive }) => (isActive ? undefined : { color: 'var(--color-text-secondary)' });

  // Permission-gated on top of the existing role-based visibility — cosmetic
  // only, the backend is the real enforcement (see requirePermission middleware).
  const permissionGate = (key) => {
    if (key === 'tickets' || key === 'calendar') return hasAnyPermission(TICKETS_PERMISSION_KEYS);
    if (key === 'projects') return hasAnyPermission(PROJECTS_PERMISSION_KEYS);
    if (key === 'reports') return hasAnyPermission(REPORTS_PERMISSION_KEYS);
    if (key === 'settings') return hasAnyPermission(SETTINGS_PERMISSION_KEYS);
    return true;
  };
  const items = NAV.filter((n) => rolesFor(n.key).includes(user?.role) && permissionGate(n.key));

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="sidebar-surface flex w-64 flex-shrink-0 flex-col" style={{ borderRight: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 px-5 py-5">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="logo" className="h-8 w-8 rounded object-contain" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="11" height="11" rx="2.5" fill="#1d3461" stroke="var(--color-accent)" strokeWidth="1.4" />
              <rect x="14" y="1" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="1" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="#1e3a5f" strokeWidth="1.4" />
              <rect x="14" y="14" width="11" height="11" rx="2.5" fill="var(--color-card)" stroke="var(--color-border)" strokeWidth="1.4" />
            </svg>
          )}
          <span className="truncate text-xl font-bold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
            {settings.appName || settings.branding?.appName || 'PRISM'}
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={linkClass} style={linkStyle}>
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="truncate text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{user?.displayName}</p>
          <p className="mb-3 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>{user?.primaryRole?.name || 'No role assigned'}</p>
          {user?.isLocalAccount && (
            <Link to="/change-password" className="mb-2 block text-center text-xs hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Change password
            </Link>
          )}
          <button onClick={handleLogout} className="w-full btn-secondary py-1.5 text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-navy-50">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
