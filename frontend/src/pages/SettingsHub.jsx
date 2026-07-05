import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Shared by Users/Teams/Departments cards (and their routes in App.jsx).
const PEOPLE_KEYS = ['people.view_all', 'people.manage_departments'];

// roles default to admin-only; list roles explicitly to widen visibility.
const ALL = ['admin', 'technician', 'requester'];
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
      { label: 'Company', to: '/settings/company', desc: 'Name, logo, timezone, locale' },
      { label: 'Branding', to: '/settings/branding', desc: 'App name, logo, and login page' },
      { label: 'Business Hours', to: '/settings/business-hours', desc: 'Work schedules' },
      { label: 'Holiday Lists', to: '/settings/holidays', desc: 'Holidays that pause SLAs' },
      { label: 'Customer Happiness', to: '/settings/customer-happiness', desc: 'CSAT surveys & scores' },
    ],
  },
  {
    title: 'User Management',
    items: [
      { label: 'Users', to: '/admin/users', desc: 'Accounts and roles', permission: PEOPLE_KEYS },
      { label: 'Teams', to: '/settings/teams', desc: 'Group technicians into teams', permission: PEOPLE_KEYS },
      { label: 'Departments', to: '/admin/departments', desc: 'Organizational departments', permission: PEOPLE_KEYS },
      { label: 'Roles & Permissions', to: '/admin/roles', desc: 'Manage roles and permission sets', permission: ['people.manage_roles'] },
    ],
  },
  {
    title: 'Customization',
    items: [
      { label: 'Modules & Tabs', to: '/settings/modules', desc: 'Show/hide sidebar items per role' },
      { label: 'Statuses', to: '/settings/statuses', desc: 'Custom ticket & project statuses' },
      { label: 'Layouts & Fields', to: '/settings/layouts', desc: 'Custom ticket fields' },
      { label: 'Blueprints', to: '/admin/blueprints', desc: 'Ticket templates', roles: ['admin', 'technician'] },
      { label: 'Email Templates', to: '/settings/email-templates', desc: 'Outbound email content' },
      { label: 'Notifications', to: '/settings/notifications', desc: 'Notification rules', roles: ['admin', 'technician'] },
      { label: 'General Settings', to: '/admin/settings', desc: 'System / LDAP config' },
      { label: 'Time Tracking', to: '/settings/time-tracking', desc: 'Time logging options', roles: ['admin', 'technician'] },
    ],
  },
  {
    title: 'Automation',
    items: [
      { label: 'Assignment Rules', to: '/settings/assignment-rules', desc: 'Auto-assign tickets' },
      { label: 'Workflows', to: '/settings/workflows', desc: 'Trigger-based actions' },
      { label: 'Macros', to: '/settings/macros', desc: 'One-click action sets' },
      { label: 'SLAs', to: '/settings/slas', desc: 'Service level targets' },
      { label: 'Supervisor Rules', to: '/settings/supervisor-rules', desc: 'Escalations' },
      { label: 'Schedules', to: '/settings/schedules', desc: 'Scheduled actions' },
    ],
  },
  {
    title: 'Data Administration',
    items: [
      { label: 'Import', to: '/settings/import', desc: 'Import records' },
      { label: 'Export', to: '/settings/export', desc: 'Export records' },
      { label: 'Audit Log', to: '/settings/audit-log', desc: 'Activity history' },
      { label: 'Recycle Bin', to: '/settings/recycle-bin', desc: 'Recover deleted records' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { label: 'API Keys', to: '/admin/apikeys', desc: 'Programmatic access', roles: ALL },
      { label: 'Calendar Integration', to: '/settings/calendar-integration', desc: 'Sync with calendars' },
    ],
  },
];

export default function SettingsHub() {
  const { user, hasAnyPermission } = useAuth();
  const role = user?.role;

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
