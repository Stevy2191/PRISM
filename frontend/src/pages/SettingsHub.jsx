import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

// NOTE ON SCROLL TARGET: Layout.jsx's <main> (the content area under the
// top nav / beside the sidebar) has no overflow/height constraint of its
// own — grep confirms the only overflow-y-auto elements anywhere in the
// nav shell are the nav menus themselves, not the page content area. That
// means the page genuinely scrolls at the window/document level, not
// inside a nested container, so this uses window.scrollY / window.scrollTo
// rather than a container ref. A ref pointed at a non-scrolling div would
// always read scrollTop === 0 and silently do nothing.
export const SETTINGS_SCROLL_KEY = 'settings_scroll_y';
const SCROLL_KEY = SETTINGS_SCROLL_KEY;
const THROTTLE_MS = 100;

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
function writeStoredScroll(y) {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(y));
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
  const { settings } = useSettings();
  const adConnected = !!settings?.ldap?.connected;
  const role = user?.role;

  const lastWriteAtRef = useRef(0);
  const trailingTimerRef = useRef(null);

  // Restore the scroll position saved from the last time this page was
  // left. requestAnimationFrame defers until after the browser has painted
  // the freshly-mounted page, so the scrollable height being measured is
  // the real, settled one. Deliberately does NOT clear the stored value —
  // clearing happens only when the user navigates away from the whole
  // settings/admin area (see Layout.jsx), so repeated back-and-forth
  // navigation within Settings keeps restoring correctly. (An earlier
  // version cleared the value synchronously inside this same effect body,
  // before the deferred restore ran — under React.StrictMode's dev-only
  // double-invoke-on-mount, that meant the first invocation's clear wiped
  // the value before the second, real mount ever got to read it, so the
  // restore silently never fired.)
  useEffect(() => {
    const saved = readStoredScroll();
    if (saved === null) return undefined;
    const y = Number(saved);
    if (!Number.isFinite(y)) return undefined;
    const raf = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Continuously persist scroll position (throttled to once per 100ms)
  // while this page is scrolled, rather than only on unmount — this is
  // resilient to any way the component goes away, including cases where an
  // unmount cleanup might not fire in time relative to a route swap.
  useEffect(() => {
    const onScroll = () => {
      const now = Date.now();
      const elapsed = now - lastWriteAtRef.current;
      const commit = () => {
        lastWriteAtRef.current = Date.now();
        writeStoredScroll(window.scrollY);
      };
      if (elapsed >= THROTTLE_MS) {
        commit();
      } else {
        // Trailing-edge write so the final resting scroll position still
        // gets recorded even if the user stops scrolling mid-throttle-window.
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = setTimeout(commit, THROTTLE_MS - elapsed);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(trailingTimerRef.current);
    };
  }, []);

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
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-navy-900">{it.label}</p>
                  {it.label === 'General Settings' && adConnected && (
                    <span
                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500"
                      title="Active Directory connected"
                    />
                  )}
                </div>
                <p className="mt-1 text-sm text-navy-500">{it.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
