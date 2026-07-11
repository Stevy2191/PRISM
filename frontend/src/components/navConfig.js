// Shared nav definition + visibility rules, used by TopNav, SidebarCompact,
// and the mobile drawer so all three stay in sync automatically.
import { useEffect } from 'react';
import { initials } from '../utils/userDisplay';

export { initials };

export const TICKETS_PERMISSION_KEYS = ['tickets.view_own', 'tickets.view_department', 'tickets.view_all'];
export const PROJECTS_PERMISSION_KEYS = ['projects.view_own', 'projects.view_department', 'projects.view_all'];
export const CONTACTS_PERMISSION_KEYS = ['people.view_own_department', 'people.view_all'];
export const ASSETS_PERMISSION_KEYS = ['assets.view'];
export const REPORTS_PERMISSION_KEYS = ['reports.view_own', 'reports.view_department', 'reports.view_all'];
// "Any permission starting with settings." plus the three People permissions
// that specifically unlock a Settings-hub card (manage_roles, manage_departments,
// view_all) — deliberately narrower than the full People permission set.
export const SETTINGS_PERMISSION_KEYS = [
  'settings.manage_statuses', 'settings.manage_business_hours', 'settings.manage_branding',
  'settings.manage_system', 'settings.view_audit_log',
  'people.manage_roles', 'people.manage_departments', 'people.view_all',
];

// Nav modules. `key` matches a ModuleVisibility.moduleName row.
export const NAV = [
  { key: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: '◧' },
  { key: 'tickets', to: '/tickets', label: 'Tickets', icon: '🎫' },
  { key: 'contacts', to: '/contacts', label: 'Contacts', icon: '👤' },
  { key: 'assets', to: '/assets', label: 'Assets', icon: '🖥' },
  { key: 'projects', to: '/projects', label: 'Projects', icon: '🗂' },
  { key: 'reports', to: '/reports', label: 'Reports', icon: '📊' },
  { key: 'calendar', to: '/calendar', label: 'Calendar', icon: '📅' },
  { key: 'settings', to: '/settings', label: 'Settings', icon: '⚙️' },
];

// Sensible defaults if module visibility hasn't loaded yet.
export const DEFAULT_ROLES = {
  dashboard: ['admin', 'technician'],
  tickets: ['admin', 'technician'],
  contacts: ['admin', 'technician'],
  assets: ['admin', 'technician'],
  projects: ['admin', 'technician'],
  reports: ['admin', 'technician'],
  calendar: ['admin', 'technician'],
  settings: ['admin', 'technician'],
};

// Permission-gated on top of the role-based module visibility — cosmetic
// only, the backend is the real enforcement (see requirePermission middleware).
export function permissionGate(key, hasAnyPermission) {
  if (key === 'tickets') return hasAnyPermission(TICKETS_PERMISSION_KEYS);
  // Calendar aggregates both tickets and projects/tasks — visible to anyone
  // who can view either, not just ticket viewers.
  if (key === 'calendar') return hasAnyPermission([...TICKETS_PERMISSION_KEYS, ...PROJECTS_PERMISSION_KEYS]);
  if (key === 'contacts') return hasAnyPermission(CONTACTS_PERMISSION_KEYS);
  if (key === 'assets') return hasAnyPermission(ASSETS_PERMISSION_KEYS);
  if (key === 'projects') return hasAnyPermission(PROJECTS_PERMISSION_KEYS);
  if (key === 'reports') return hasAnyPermission(REPORTS_PERMISSION_KEYS);
  if (key === 'settings') return hasAnyPermission(SETTINGS_PERMISSION_KEYS);
  return true;
}

export function visibleNavItems({ visibility, user, hasAnyPermission }) {
  const rolesFor = (key) => (visibility && visibility[key]) || DEFAULT_ROLES[key] || [];
  return NAV.filter((n) => rolesFor(n.key).includes(user?.role) && permissionGate(n.key, hasAnyPermission));
}

// Fixed palette for department-colored avatars — hashed by departmentId so
// the same department always renders the same color.
const AVATAR_PALETTE = ['#2563eb', '#7c3aed', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#db2777', '#65a30d'];
export function colorForDepartment(departmentId) {
  if (!departmentId) return AVATAR_PALETTE[0];
  return AVATAR_PALETTE[departmentId % AVATAR_PALETTE.length];
}

// Cmd/Ctrl+K opens the global search overlay from anywhere in the app.
export function useGlobalSearchShortcut(onOpen) {
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onOpen]);
}
