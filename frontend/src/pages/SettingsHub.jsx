import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const SCROLL_KEY = 'settings_scroll';

// sessionStorage can throw (private browsing with storage disabled, quota
// exceeded, etc.) — every call here is wrapped so a storage failure never
// breaks navigation, it just silently skips scroll restoration.
function readStoredScroll() {
  try {
    return sessionStorage.getItem(SCROLL_KEY);
  } catch {
    return null;
  }
}
function clearStoredScroll() {
  try {
    sessionStorage.removeItem(SCROLL_KEY);
  } catch {
    /* ignore */
  }
}
function saveScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  } catch {
    /* ignore */
  }
}

// Sub-item permission gates, per the roles/permissions build spec (Prompt 4).
// Each is deliberately its own array — the rules aren't all the same set.
const USERS_KEYS = ['people.view_all', 'people.create_users'];
const TEAMS_KEYS = ['people.view_all', 'people.manage_departments'];
const DEPARTMENTS_KEYS = ['people.manage_departments'];
const ROLES_KEYS = ['people.manage_roles'];
const BRANDING_KEYS = ['settings.manage_branding', 'settings.manage_system'];
const BUSINESS_HOURS_KEYS = ['settings.manage_business_hours'];
const STATUSES_KEYS = ['settings.manage_statuses'];
const SYSTEM_KEYS = ['settings.manage_system'];
const AUDIT_LOG_KEYS = ['settings.view_audit_log'];

// roles default to admin-only; list roles explicitly to widen visibility.
const ALL = ['admin', 'technician'];
const SECTIONS = [
  {
    title: 'My Account',
    items: [
      { label: 'Preferences', to: '/settings/preferences', desc: 'Your personal preferences', roles: ALL },
    ],
  },
  {
    title: 'Organization',
    items: [
      { label: 'Company', to: '/settings/company', desc: 'Name, logo, timezone, locale', permission: BRANDING_KEYS },
      { label: 'Branding', to: '/settings/branding', desc: 'App name, logo, and login page', permission: BRANDING_KEYS },
      { label: 'Business Hours', to: '/settings/business-hours', desc: 'Work schedules', permission: BUSINESS_HOURS_KEYS },
      { label: 'Holiday Lists', to: '/settings/holidays', desc: 'Holidays that pause SLAs', permission: BUSINESS_HOURS_KEYS },
      { label: 'Customer Happiness', to: '/settings/customer-happiness', desc: 'CSAT surveys & scores', permission: SYSTEM_KEYS },
    ],
  },
  {
    title: 'User Management',
    items: [
      { label: 'Users', to: '/admin/users', desc: 'Accounts and roles', permission: USERS_KEYS },
      { label: 'Teams', to: '/settings/teams', desc: 'Group technicians into teams', permission: TEAMS_KEYS },
      { label: 'Departments', to: '/admin/departments', desc: 'Organizational departments', permission: DEPARTMENTS_KEYS },
      { label: 'Roles & Permissions', to: '/admin/roles', desc: 'Manage roles and permission sets', permission: ROLES_KEYS },
    ],
  },
  {
    title: 'Customization',
    items: [
      { label: 'Modules & Tabs', to: '/settings/modules', desc: 'Show/hide sidebar items per role', permission: SYSTEM_KEYS },
      { label: 'Statuses', to: '/settings/statuses', desc: 'Custom ticket & project statuses', permission: STATUSES_KEYS },
      { label: 'Layouts & Fields', to: '/settings/layouts', desc: 'Custom ticket fields', permission: SYSTEM_KEYS },
      { label: 'Blueprints', to: '/admin/blueprints', desc: 'Ticket templates', roles: ['admin', 'technician'] },
      { label: 'Email Templates', to: '/settings/email-templates', desc: 'Outbound email content' },
      { label: 'Notifications', to: '/settings/notifications', desc: 'Which events send in-app notifications', permission: SYSTEM_KEYS },
      { label: 'General Settings', to: '/admin/settings', desc: 'LDAP status, timezone, attachment limits', permission: SYSTEM_KEYS },
      { label: 'Time Tracking', to: '/settings/time-tracking', desc: 'System-wide time logging defaults', permission: SYSTEM_KEYS },
    ],
  },
  {
    title: 'Automation',
    items: [
      { label: 'Assignment Rules', to: '/settings/assignment-rules', desc: 'Auto-assign tickets by type/department/priority', permission: SYSTEM_KEYS },
      { label: 'Workflow Rules', to: '/settings/workflow-rules', desc: 'Trigger-based conditions & actions', permission: SYSTEM_KEYS },
      { label: 'Macros', to: '/settings/macros', desc: 'One-click action sets' },
      { label: 'SLAs', to: '/settings/slas', desc: 'Response & resolution time targets', permission: SYSTEM_KEYS },
      { label: 'Supervisor Rules', to: '/settings/supervisor-rules', desc: 'Escalations' },
      { label: 'Schedules', to: '/settings/schedules', desc: 'Background job status', permission: SYSTEM_KEYS },
    ],
  },
  {
    title: 'Data Administration',
    items: [
      { label: 'Import', to: '/settings/import', desc: 'Import records' },
      { label: 'Export', to: '/settings/export', desc: 'Export records' },
      { label: 'Audit Log', to: '/settings/audit-log', desc: 'Activity history', permission: AUDIT_LOG_KEYS },
      { label: 'Recycle Bin', to: '/settings/recycle-bin', desc: 'Recover deleted records' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { label: 'API Keys', to: '/admin/apikeys', desc: 'Programmatic access', roles: ALL },
      { label: 'Calendar Integration', to: '/settings/calendar-integration', desc: 'Sync with calendars' },
      { label: 'Directory Sync', to: '/settings/directory-sync', desc: 'AD contact sync & group mapping', permission: SYSTEM_KEYS },
    ],
  },
];

export default function SettingsHub() {
  const { user, hasAnyPermission } = useAuth();
  const role = user?.role;

  // Restore the scroll position saved when the user last left this page for
  // a sub-page (see the save effect below). The short delay lets the
  // section grid finish rendering/laying out first — scrolling immediately
  // on mount can land short if the page's full height isn't committed yet.
  useEffect(() => {
    const saved = readStoredScroll();
    if (saved === null) return undefined;
    clearStoredScroll();
    const y = Number(saved);
    if (!Number.isFinite(y)) return undefined;
    const timer = setTimeout(() => window.scrollTo(0, y), 50);
    return () => clearTimeout(timer);
  }, []);

  // Save scroll position on unmount — fires for every way of navigating to
  // a sub-page (a "← Back to Settings"-style nav link click, browser
  // back/forward, etc.), not just a specific onClick handler that every
  // sub-page link would otherwise need individually.
  useEffect(() => () => saveScroll(), []);

  // Items with a `permission` array are gated purely on the resolved
  // permissions map (Prompt 3 roles/permissions system); everything else
  // keeps the original role-string gate.
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((it) => (
      it.permission ? hasAnyPermission(it.permission) : (it.roles || ['admin']).includes(role)
    )),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Settings</h1>
        <p className="text-sm text-navy-500">Configure PRISM for your organization.</p>
      </div>

      {visibleSections.map((section) => (
        <div key={section.title}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-400">{section.title}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((it) => (
              <Link key={it.to} to={it.to} className="card p-5 transition hover:border-prism hover:shadow-md">
                <p className="font-semibold text-navy-900">{it.label}</p>
                <p className="mt-1 text-sm text-navy-500">{it.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
