// Every Settings page in one list (spec: Settings redesign). The menu, the
// overview, the search and the routes' guards (App.jsx) are all built from
// it, so a menu entry always matches whether its page lets you in. Plain
// data: no React, so it can be unit tested with node:test. Access is what
// the page needed before the redesign; the server enforces it regardless.

export const GROUPS = [
  'You', 'Organization', 'People & access', 'Service desk', 'Hours & SLAs',
  'Time & work', 'Assets', 'Sign-in & email', 'System',
];

const SYSTEM = { permission: ['settings.manage_system'] };
const OWNER = { permission: ['settings.manage_system'], owner: true };

export const PAGES = [
  // You
  { id: 'preferences', group: 'You', name: 'Preferences', desc: 'Theme, timers and reminders', keywords: ['theme', 'dark mode', 'timer', 'reminder', 'notifications', 'profile', 'password', 'calendar'], path: '/settings/preferences', access: {}, width: 'narrow' },
  { id: 'about', group: 'You', name: 'About PRISM', desc: 'Version, license, report a problem', keywords: ['version', 'license', 'bug', 'issue'], path: '/settings/about', access: {}, width: 'narrow' },
  // Organization
  { id: 'company', group: 'Organization', name: 'Company profile', desc: 'Name, logo, time zone and login page', keywords: ['logo', 'favicon', 'branding', 'time zone', 'timezone', 'login page', 'app name', 'organization name'], path: '/settings/company', access: { permission: ['settings.manage_branding', 'settings.manage_system'] }, width: 'narrow' },
  { id: 'companies', group: 'Organization', name: 'Companies & vendors', desc: 'Clients, vendors, sites and domains', keywords: ['client', 'customer', 'vendor', 'site', 'domain', 'msp'], path: '/settings/companies', access: { permission: ['companies.view'] }, width: 'wide' },
  // People & access
  { id: 'users', group: 'People & access', name: 'Users', desc: 'Accounts, roles and owners', keywords: ['account', 'password', 'username', 'owner', 'invite', 'deactivate'], path: '/admin/users', access: { permission: ['people.view_all', 'people.create_users'] }, width: 'wide', sub: [{ id: 'user-detail', path: '/admin/users/:id', access: {} }] },
  { id: 'teams', group: 'People & access', name: 'Teams', desc: 'Groups of technicians', keywords: ['team lead', 'group'], path: '/settings/teams', access: { permission: ['people.view_all', 'people.manage_departments'] }, width: 'narrow' },
  { id: 'departments', group: 'People & access', name: 'Departments', desc: 'Who works where', keywords: ['department', 'default role'], path: '/admin/departments', access: { permission: ['people.manage_departments'] }, width: 'wide' },
  { id: 'roles', group: 'People & access', name: 'Roles & permissions', desc: 'What each role can do', keywords: ['permission', 'access', 'role'], path: '/admin/roles', access: { permission: ['people.manage_roles'] }, width: 'wide', sub: [{ id: 'role-new', path: '/admin/roles/new' }, { id: 'role-edit', path: '/admin/roles/:id' }] },
  { id: 'api-keys', group: 'People & access', name: 'API keys', desc: 'Access for scripts and tools', keywords: ['api', 'token', 'integration'], path: '/admin/apikeys', access: { roles: ['admin', 'technician'] }, width: 'wide' },
  // Service desk
  { id: 'statuses', group: 'Service desk', name: 'Statuses', desc: 'Ticket, project and task statuses', keywords: ['status', 'workflow', 'closed'], path: '/settings/statuses', access: { permission: ['settings.manage_statuses'] }, width: 'narrow' },
  { id: 'custom-fields', group: 'Service desk', name: 'Custom fields', desc: 'Extra fields on tickets', keywords: ['field', 'layout', 'form'], path: '/settings/layouts', access: SYSTEM, width: 'wide' },
  { id: 'blueprints', group: 'Service desk', name: 'Ticket templates', desc: 'Blueprints for common tickets', keywords: ['blueprint', 'template'], path: '/admin/blueprints', access: { roles: ['admin', 'technician'] }, width: 'wide' },
  { id: 'ticket-categories', group: 'Service desk', name: 'Ticket categories', desc: 'The category tree tickets are filed under', keywords: ['category', 'categories', 'classification', 'tree', 'sub-category'], path: '/settings/ticket-categories', access: { permission: ['tickets.categories.manage'] }, width: 'wide' },
  { id: 'canned-responses', group: 'Service desk', name: 'Canned responses', desc: 'Reusable replies for the reply box', keywords: ['canned', 'macro', 'snippet', 'template', 'reply'], path: '/settings/canned-responses', access: {}, width: 'narrow' },
  { id: 'recurring-tickets', group: 'Service desk', name: 'Recurring tickets', desc: 'Tickets opened on a schedule', keywords: ['recurring', 'schedule', 'repeat', 'maintenance', 'routine'], path: '/settings/recurring-tickets', access: { permission: ['tickets.recurring.manage'] }, width: 'narrow', sub: [{ id: 'recurring-ticket-new', path: '/settings/recurring-tickets/new' }, { id: 'recurring-ticket-edit', path: '/settings/recurring-tickets/:id' }] },
  { id: 'workflow-rules', group: 'Service desk', name: 'Workflow rules', desc: 'Automatic actions on tickets', keywords: ['automation', 'trigger', 'action'], path: '/settings/workflow-rules', access: SYSTEM, width: 'wide', sub: [{ id: 'workflow-rule-new', path: '/settings/workflow-rules/new' }, { id: 'workflow-rule-edit', path: '/settings/workflow-rules/:id' }] },
  { id: 'notifications', group: 'Service desk', name: 'Notifications', desc: 'Which events notify people', keywords: ['bell', 'alert', 'notify'], path: '/settings/notifications', access: SYSTEM, width: 'narrow' },
  { id: 'customer-happiness', group: 'Service desk', name: 'Customer happiness', desc: 'Satisfaction surveys and scores', keywords: ['csat', 'survey', 'rating', 'feedback'], path: '/settings/customer-happiness', access: SYSTEM, width: 'narrow' },
  // Hours & SLAs
  { id: 'slas', group: 'Hours & SLAs', name: 'SLAs', desc: 'Assignment, response and resolution targets', keywords: ['sla', 'response time', 'resolution', 'escalation', 'assignment', 'breach'], path: '/settings/slas', access: SYSTEM, width: 'wide' },
  { id: 'business-hours', group: 'Hours & SLAs', name: 'Business hours', desc: 'Work schedules', keywords: ['hours', 'schedule', 'open'], path: '/settings/business-hours', access: { permission: ['settings.manage_business_hours'] }, width: 'narrow' },
  { id: 'holidays', group: 'Hours & SLAs', name: 'Holidays', desc: 'Days the SLA clock stops', keywords: ['holiday', 'closed', 'day off'], path: '/settings/holidays', access: { permission: ['settings.manage_business_hours'] }, width: 'narrow' },
  // Time & work
  { id: 'time-tracking', group: 'Time & work', name: 'Time tracking', desc: 'Timer defaults and the longest entry', keywords: ['timer', 'time entry', 'automatic', 'minimum', 'longest'], path: '/settings/time-tracking', access: SYSTEM, width: 'narrow' },
  { id: 'work-types', group: 'Time & work', name: 'Work types', desc: 'Kinds of work and billable defaults', keywords: ['billable', 'work type', 'labor'], path: '/settings/work-types', access: SYSTEM, width: 'narrow' },
  // Assets
  { id: 'asset-categories', group: 'Assets', name: 'Asset categories', desc: 'Categories and their fields', keywords: ['asset', 'device', 'category'], path: '/settings/asset-categories', access: SYSTEM, width: 'wide' },
  { id: 'asset-alerts', group: 'Assets', name: 'Expiry alerts', desc: 'Warranty, license and contract reminders', keywords: ['warranty', 'expiry', 'renewal', 'license', 'contract'], path: '/settings/asset-alerts', access: SYSTEM, width: 'narrow' },
  // Sign-in & email (owners)
  { id: 'single-sign-on', group: 'Sign-in & email', name: 'Single sign-on', desc: 'SAML and OIDC sign-in', keywords: ['sso', 'saml', 'oidc', 'entra', 'azure', 'okta'], path: '/settings/single-sign-on', access: OWNER, width: 'narrow' },
  { id: 'directory', group: 'Sign-in & email', name: 'Directory (AD/LDAP)', desc: 'Active Directory sign-in and lookups', keywords: ['ldap', 'active directory', 'ad', 'domain'], path: '/settings/directory', access: OWNER, width: 'narrow' },
  { id: 'directory-sync', group: 'Sign-in & email', name: 'Directory sync', desc: 'Contacts from Active Directory', keywords: ['ad sync', 'contacts', 'group mapping'], path: '/settings/directory-sync', access: OWNER, width: 'narrow' },
  { id: 'incoming-email', group: 'Sign-in & email', name: 'Incoming email', desc: 'Turn emails into tickets', keywords: ['imap', 'mailbox', 'email to ticket'], path: '/settings/incoming-email', access: OWNER, width: 'narrow' },
  { id: 'outgoing-email', group: 'Sign-in & email', name: 'Outgoing email', desc: 'How PRISM sends mail', keywords: ['smtp', 'mail server', 'from address'], path: '/settings/outgoing-email', access: OWNER, width: 'narrow' },
  { id: 'email-templates', group: 'Sign-in & email', name: 'Email templates', desc: 'What PRISM emails say', keywords: ['template', 'auto-reply', 'signature', 'branding', 'placeholder', 'survey email'], path: '/settings/email-templates', access: SYSTEM, width: 'wide' },
  { id: 'email-log', group: 'Sign-in & email', name: 'Email log', desc: 'What came in and what was sent', keywords: ['mail log', 'bounce', 'delivery'], path: '/settings/email-log', access: OWNER, width: 'wide' },
  { id: 'calendar', group: 'Sign-in & email', name: 'Calendar', desc: 'Google and Microsoft calendar sync', keywords: ['google', 'microsoft', 'outlook', 'oauth'], path: '/settings/calendar-integration', access: OWNER, width: 'narrow' },
  // System
  { id: 'schedules', group: 'System', name: 'Background jobs', desc: 'Scheduled jobs and their status', keywords: ['schedule', 'job', 'cron', 'sync'], path: '/settings/schedules', access: SYSTEM, width: 'narrow' },
  { id: 'import', group: 'System', name: 'Import', desc: 'Bring records in from a file', keywords: ['csv', 'upload', 'migrate'], path: '/settings/import', access: { roles: ['admin'] }, width: 'narrow' },
  { id: 'export', group: 'System', name: 'Export', desc: 'Take records out as a file', keywords: ['csv', 'download', 'backup'], path: '/settings/export', access: { roles: ['admin'] }, width: 'narrow' },
  { id: 'audit-log', group: 'System', name: 'Audit log', desc: 'Who changed what, and when', keywords: ['history', 'audit', 'security'], path: '/settings/audit-log', access: { permission: ['settings.view_audit_log'] }, width: 'wide' },
  { id: 'system', group: 'System', name: 'System info', desc: 'Upload limit, database and app', keywords: ['attachment', 'upload', 'file size', 'database', 'version'], path: '/settings/system', access: SYSTEM, width: 'narrow' },
];

export const REDIRECTS = [
  ['/admin/settings', '/settings'],
  ['/settings/branding', '/settings/company'],
  ['/settings/blueprints', '/admin/blueprints'],
  ['/settings/macros', '/settings'],
  ['/settings/supervisor-rules', '/settings'],
  ['/settings/recycle-bin', '/settings'],
  // Removed in the Settings cleanup (user decision 2026-10-12).
  ['/settings/assignment-rules', '/settings/workflow-rules'],
  ['/settings/modules', '/settings'],
];

export function canOpen(access, auth) {
  const a = access || {};
  if (a.owner && !auth.isOwner) return false;
  if (a.roles && !a.roles.includes(auth.role)) return false;
  if (a.permission && !auth.hasAnyPermission(a.permission)) return false;
  return true;
}

export function allRoutes() {
  return PAGES.flatMap((p) => [
    { id: p.id, path: p.path, access: p.access },
    ...(p.sub || []).map((s) => ({ id: s.id, path: s.path, access: s.access ?? p.access })),
  ]);
}

export function findPage(pathname) {
  return PAGES.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`)) || null;
}

export function visibleGroups(auth) {
  return GROUPS
    .map((name) => ({ name, pages: PAGES.filter((p) => p.group === name && canOpen(p.access, auth)) }))
    .filter((g) => g.pages.length > 0);
}

export function searchPages(query, pages) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const score = (p) => {
    const name = p.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (p.keywords.some((k) => k.includes(q))) return 2;
    if (p.desc.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return pages
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.p);
}
