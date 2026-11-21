// Every Settings page in one list (spec: Settings redesign). The menu, the
// overview, the search and the routes' guards (App.jsx) are all built from
// it, so a menu entry always matches whether its page lets you in. Plain
// data: no React, so it can be unit tested with node:test. Access is what
// the page needed before the redesign; the server enforces it regardless.

// The sections, in menu order (layout B, 2026-10-28: a category rail; one
// section's pages at a time). slug is the ?section= value on Settings home;
// icon is a name the menu maps to an icon.
export const SECTIONS = [
  { name: 'You', slug: 'you', icon: 'user', desc: 'Your own preferences.' },
  // Owner, 2026-11-14: Settings holds what applies everywhere; anything set
  // for one company (departments, sites, categories, SLA, support hours and
  // holidays, portal, surveys, devices) is on that company's page, your own
  // company's included. These two sections say which is which and lead there.
  { name: 'Your company', slug: 'your-company', icon: 'building', desc: 'Your own company: profile and sign-in page, departments, sites, support hours and holidays, SLA, categories, portal and devices, on one page.' },
  { name: 'Customers', slug: 'customers', icon: 'briefcase', desc: 'The companies you support. Each one\'s settings are on its own page.' },
  { name: 'People & access', slug: 'people-access', icon: 'users', desc: 'Accounts, teams and what each role can do.' },
  { name: 'Service desk', slug: 'service-desk', icon: 'ticket', desc: 'How tickets work, from statuses to the client portal.' },
  { name: 'Sign-in & email', slug: 'sign-in-email', icon: 'mail', desc: 'How people sign in and how mail comes and goes.' },
  { name: 'Hours & SLAs', slug: 'hours-slas', icon: 'clock', desc: 'What a new company starts with, and the hours your staff work.' },
  { name: 'Time & work', slug: 'time-work', icon: 'stopwatch', desc: 'Time entries and kinds of work.' },
  { name: 'Projects', slug: 'projects', icon: 'folder', desc: 'Starting points for new projects.' },
  { name: 'Assets', slug: 'assets', icon: 'box', desc: 'Equipment, licenses and contracts.' },
  { name: 'System', slug: 'system', icon: 'server', desc: 'Data in and out, jobs, the audit log and the server.' },
  // Owner, 2026-11-14: About PRISM is its own section, not under You.
  { name: 'About', slug: 'about', icon: 'info', desc: 'Which version this is, the license, and how to report a problem.' },
];
export const GROUPS = SECTIONS.map((s) => s.name);
export const sectionByName = (name) => SECTIONS.find((s) => s.name === name) || null;
export const sectionBySlug = (slug) => SECTIONS.find((s) => s.slug === slug) || null;

const SYSTEM = { permission: ['settings.manage_system'] };
const OWNER = { permission: ['settings.manage_system'], owner: true };

export const PAGES = [
  // You
  { id: 'preferences', group: 'You', name: 'Preferences', desc: 'Theme, timers and reminders', keywords: ['theme', 'dark mode', 'timer', 'reminder', 'notifications', 'profile', 'password', 'calendar'], path: '/settings/preferences', access: {}, width: 'narrow' },
  { id: 'about', group: 'About', name: 'About PRISM', desc: 'Version, license, report a problem', keywords: ['version', 'license', 'bug', 'issue'], path: '/settings/about', access: {}, width: 'narrow' },
  // Your company (CS): one page for everything about your own company.
  { id: 'your-company', group: 'Your company', name: 'Your company', desc: 'Profile and sign-in page, departments, sites, categories and devices', keywords: ['logo', 'favicon', 'branding', 'time zone', 'timezone', 'login page', 'sign-in page', 'app name', 'organization name', 'department', 'default role', 'short code', 'site', 'categories', 'devices', 'agent', 'own company', 'internal'], path: '/settings/your-company', access: { permission: ['settings.manage_branding', 'settings.manage_system', 'people.manage_departments', 'companies.view'] }, width: 'wide' },
  { id: 'companies', group: 'Customers', name: 'Customer companies', desc: 'Customers and vendors; each one\'s settings are on its page', keywords: ['client', 'customer', 'vendor', 'site', 'domain', 'msp', 'company'], path: '/companies', external: true, access: { permission: ['companies.view'] }, width: 'wide' },
  // People & access
  { id: 'users', group: 'People & access', name: 'Users', desc: 'Accounts, roles and owners', keywords: ['account', 'password', 'username', 'owner', 'invite', 'deactivate'], path: '/admin/users', access: { permission: ['people.view_all', 'people.create_users'] }, width: 'wide', sub: [{ id: 'user-detail', path: '/admin/users/:id', access: {} }] },
  { id: 'teams', group: 'People & access', name: 'Teams', desc: 'Groups of technicians', keywords: ['team lead', 'group'], path: '/settings/teams', access: { permission: ['people.view_all', 'people.manage_departments'] }, width: 'narrow' },
  { id: 'roles', group: 'People & access', name: 'Roles & permissions', desc: 'What each role can do', keywords: ['permission', 'access', 'role'], path: '/admin/roles', access: { permission: ['people.manage_roles'] }, width: 'wide', sub: [{ id: 'role-new', path: '/admin/roles/new' }, { id: 'role-edit', path: '/admin/roles/:id' }] },
  { id: 'api-keys', group: 'People & access', name: 'API keys', desc: 'Access for scripts and tools', keywords: ['api', 'token', 'integration'], path: '/admin/apikeys', access: { roles: ['admin', 'technician'] }, width: 'wide' },
  // Service desk
  { id: 'statuses', group: 'Service desk', name: 'Statuses', desc: 'Ticket, project and task statuses', keywords: ['status', 'workflow', 'closed'], path: '/settings/statuses', access: { permission: ['settings.manage_statuses'] }, width: 'narrow' },
  { id: 'custom-fields', group: 'Service desk', name: 'Custom fields', desc: 'Extra fields on tickets', keywords: ['field', 'layout', 'form'], path: '/settings/layouts', access: SYSTEM, width: 'wide' },
  { id: 'blueprints', group: 'Service desk', name: 'Ticket templates', desc: 'Blueprints for common tickets', keywords: ['blueprint', 'template'], path: '/admin/blueprints', access: { roles: ['admin', 'technician'] }, width: 'wide' },
  { id: 'ticket-rules', group: 'Service desk', name: 'Ticket rules', desc: 'Require a category; require time before closing', keywords: ['category required', 'require time', 'closing', 'rule'], path: '/settings/ticket-rules', access: { permission: ['tickets.categories.manage', 'settings.manage_system'] }, width: 'narrow' },
  { id: 'canned-responses', group: 'Service desk', name: 'Canned responses', desc: 'Reusable replies for the reply box', keywords: ['canned', 'macro', 'snippet', 'template', 'reply'], path: '/settings/canned-responses', access: {}, width: 'narrow' },
  { id: 'recurring-tickets', group: 'Service desk', name: 'Recurring tickets', desc: 'Tickets opened on a schedule', keywords: ['recurring', 'schedule', 'repeat', 'maintenance', 'routine'], path: '/settings/recurring-tickets', access: { permission: ['tickets.recurring.manage'] }, width: 'narrow', sub: [{ id: 'recurring-ticket-new', path: '/settings/recurring-tickets/new' }, { id: 'recurring-ticket-edit', path: '/settings/recurring-tickets/:id' }] },
  // PB2: checklists and bundles on one page (were Forms and Playbooks).
  { id: 'checklists', group: 'Service desk', name: 'Checklists', desc: 'Steps for tickets, and bundles that add several at once', keywords: ['checklist', 'form', 'playbook', 'bundle', 'steps', 'onboarding', 'offboarding', 'termination', 'new account', 'check-in', 'check-out', 'device'], path: '/settings/checklists', access: { permission: ['settings.manage_playbooks'] }, width: 'wide', sub: [{ id: 'checklist-new', path: '/settings/checklists/new' }, { id: 'bundle-new', path: '/settings/checklists/bundles/new' }, { id: 'bundle-edit', path: '/settings/checklists/bundles/:id' }, { id: 'checklist-edit', path: '/settings/checklists/:id' }] },
  { id: 'workflow-rules', group: 'Service desk', name: 'Workflow rules', desc: 'Automatic actions on tickets', keywords: ['automation', 'trigger', 'action'], path: '/settings/workflow-rules', access: SYSTEM, width: 'wide', sub: [{ id: 'workflow-rule-new', path: '/settings/workflow-rules/new' }, { id: 'workflow-rule-edit', path: '/settings/workflow-rules/:id' }] },
  { id: 'notifications', group: 'Service desk', name: 'Notifications', desc: 'Which events notify people', keywords: ['bell', 'alert', 'notify'], path: '/settings/notifications', access: SYSTEM, width: 'narrow' },
  { id: 'client-portal', group: 'Customers', name: 'Client portal', desc: 'The Microsoft sign-in app, and who may manage portal access. Each company turns its own portal on, on its page', keywords: ['portal', 'customer portal', 'self service', 'contact sign in', 'help center'], path: '/settings/client-portal', access: SYSTEM, width: 'narrow' },
  { id: 'customer-happiness', group: 'Customers', name: 'Satisfaction surveys', desc: 'The question, when it is sent, how long the link works. On or off is on each company\'s page', keywords: ['csat', 'survey', 'rating', 'feedback'], path: '/settings/customer-happiness', access: SYSTEM, width: 'narrow' },
  // Projects
  { id: 'project-templates', group: 'Projects', name: 'Project templates', desc: 'Phases and tasks to start new projects from', keywords: ['template', 'project', 'phase', 'task', 'plan', 'copy'], path: '/settings/project-templates', access: { permission: ['projects.manage_templates'] }, width: 'wide', sub: [{ id: 'project-template-new', path: '/settings/project-templates/new' }, { id: 'project-template-edit', path: '/settings/project-templates/:id' }] },
  // Workload
  // Hours & SLAs
  // Time & work
  // CS: each company's SLA, support hours and holidays are on its page.
  { id: 'starting-values', group: 'Hours & SLAs', name: 'Starting values for new companies', desc: 'The SLA targets, support hours and holidays a new company starts with', keywords: ['sla', 'targets', 'response', 'resolution', 'business hours', 'support hours', 'holidays', 'default'], path: '/settings/starting-values', access: SYSTEM, width: 'wide' },
  { id: 'work-hours', group: 'Hours & SLAs', name: 'Staff hours', desc: 'The week your people work, ticket size and each person\'s own hours', keywords: ['hours', 'capacity', 'part time', 'schedule', 'workload', 'ticket size', 'estimate'], path: '/settings/work-hours', access: { permission: ['settings.manage_business_hours'] }, width: 'wide' },
  { id: 'time-tracking', group: 'Time & work', name: 'Time tracking', desc: 'The longest time entry', keywords: ['timer', 'time entry', 'automatic', 'minimum', 'longest'], path: '/settings/time-tracking', access: SYSTEM, width: 'narrow' },
  { id: 'work-types', group: 'Time & work', name: 'Work types', desc: 'Kinds of work and billable defaults', keywords: ['billable', 'work type', 'labor'], path: '/settings/work-types', access: SYSTEM, width: 'narrow' },
  // Assets
  { id: 'asset-categories', group: 'Assets', name: 'Asset categories', desc: 'Categories and their fields', keywords: ['asset', 'device', 'category'], path: '/settings/asset-categories', access: SYSTEM, width: 'wide' },
  { id: 'mdms', group: 'Assets', name: 'MDMs', desc: 'The device management tools you use', keywords: ['mdm', 'device management', 'managed', 'enrollment'], path: '/settings/mdms', access: { permission: ['settings.manage_playbooks'] }, width: 'narrow' },
  { id: 'asset-alerts', group: 'Assets', name: 'Expiry alerts', desc: 'Warranty, license and contract reminders', keywords: ['warranty', 'expiry', 'renewal', 'license', 'contract'], path: '/settings/asset-alerts', access: SYSTEM, width: 'narrow' },
  // Sign-in & email (owners)
  { id: 'single-sign-on', group: 'Sign-in & email', name: 'Single sign-on', desc: 'SAML and OIDC sign-in', keywords: ['sso', 'saml', 'oidc', 'entra', 'azure', 'okta'], path: '/settings/single-sign-on', access: OWNER, width: 'narrow' },
  { id: 'directory', group: 'Sign-in & email', name: 'Directory', desc: 'Active Directory sign-in, and contacts synced from it', keywords: ['ldap', 'active directory', 'ad', 'domain', 'ad sync', 'contacts', 'group mapping', 'directory sync'], path: '/settings/directory', access: OWNER, width: 'narrow' },
  { id: 'email', group: 'Sign-in & email', name: 'Email', desc: 'The help desk\'s mailbox: emails in become tickets, and how PRISM sends mail', keywords: ['imap', 'mailbox', 'email to ticket', 'smtp', 'mail server', 'from address', 'incoming', 'outgoing'], path: '/settings/email', access: OWNER, width: 'narrow' },
  { id: 'email-templates', group: 'Sign-in & email', name: 'Email templates', desc: 'What PRISM emails say', keywords: ['template', 'auto-reply', 'signature', 'branding', 'placeholder', 'survey email'], path: '/settings/email-templates', access: SYSTEM, width: 'wide' },
  { id: 'email-log', group: 'Sign-in & email', name: 'Email log', desc: 'What came in and what was sent', keywords: ['mail log', 'bounce', 'delivery'], path: '/settings/email-log', access: OWNER, width: 'wide' },
  { id: 'calendar', group: 'Sign-in & email', name: 'Calendar apps', desc: 'The Google and Microsoft apps people connect their calendars through', keywords: ['google', 'microsoft', 'outlook', 'oauth'], path: '/settings/calendar-integration', access: OWNER, width: 'narrow' },
  { id: 'claude', group: 'Sign-in & email', name: 'Claude', desc: 'Let people connect Claude to PRISM', keywords: ['claude', 'mcp', 'ai', 'oauth', 'connector', 'anthropic'], path: '/settings/claude', access: OWNER, width: 'narrow' },
  // System
  { id: 'schedules', group: 'System', name: 'Background jobs', desc: 'Scheduled jobs and their status', keywords: ['schedule', 'job', 'cron', 'sync'], path: '/settings/schedules', access: SYSTEM, width: 'narrow' },
  { id: 'import', group: 'System', name: 'Import', desc: 'Bring records in from a file', keywords: ['csv', 'upload', 'migrate'], path: '/settings/import', access: { roles: ['admin'] }, width: 'narrow' },
  { id: 'export', group: 'System', name: 'Export', desc: 'Take records out as a file', keywords: ['csv', 'download', 'backup'], path: '/settings/export', access: { roles: ['admin'] }, width: 'narrow' },
  { id: 'audit-log', group: 'System', name: 'Audit log', desc: 'Who changed what, and when', keywords: ['history', 'audit', 'security'], path: '/settings/audit-log', access: { permission: ['settings.view_audit_log'] }, width: 'wide' },
  { id: 'system', group: 'System', name: 'System info', desc: 'Upload limit, database and app', keywords: ['attachment', 'upload', 'file size', 'database', 'version'], path: '/settings/system', access: SYSTEM, width: 'narrow' },
];

export const REDIRECTS = [
  ['/admin/settings', '/settings'],
  // Per-company settings moved to company pages (owner, 2026-11-14).
  ['/settings/companies', '/companies'],
  ['/admin/departments', '/settings/your-company'],
  ['/settings/branding', '/settings/your-company'],
  ['/settings/blueprints', '/admin/blueprints'],
  ['/settings/macros', '/settings'],
  ['/settings/supervisor-rules', '/settings'],
  ['/settings/recycle-bin', '/settings'],
  // Removed in the Settings cleanup (user decision 2026-10-12).
  ['/settings/assignment-rules', '/settings/workflow-rules'],
  ['/settings/modules', '/settings'],
  // PB2: Forms and Playbooks became Checklists (ids are kept).
  ['/settings/forms', '/settings/checklists'],
  ['/settings/forms/new', '/settings/checklists'],
  ['/settings/forms/:id', '/settings/checklists/:id'],
  ['/settings/playbooks', '/settings/checklists'],
  ['/settings/playbooks/new', '/settings/checklists/bundles/new'],
  ['/settings/playbooks/:id', '/settings/checklists/bundles/:id'],
];

// A redirect's target with the route's params filled in ("/x/:id" → "/x/12").
export function redirectTarget(to, params = {}) {
  return to.replace(/:(\w+)/g, (m, k) => (params[k] !== undefined ? encodeURIComponent(params[k]) : m));
}

export function canOpen(access, auth) {
  const a = access || {};
  if (a.owner && !auth.isOwner) return false;
  if (a.roles && !a.roles.includes(auth.role)) return false;
  if (a.permission && !auth.hasAnyPermission(a.permission)) return false;
  return true;
}

// Settings' own routes: not the entries that open a company's page.
export function allRoutes() {
  return PAGES.filter((p) => !p.external).flatMap((p) => [
    { id: p.id, path: p.path, access: p.access },
    ...(p.sub || []).map((s) => ({ id: s.id, path: s.path, access: s.access ?? p.access })),
  ]);
}

export function findPage(pathname) {
  return PAGES.find((p) => !p.external && (pathname === p.path || pathname.startsWith(`${p.path}/`))) || null;
}

export function visibleGroups(auth) {
  return SECTIONS
    .map((sec) => ({ ...sec, pages: PAGES.filter((p) => p.group === sec.name && canOpen(p.access, auth)) }))
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
