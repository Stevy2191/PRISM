import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUPS, PAGES, REDIRECTS, SECTIONS, allRoutes, canOpen, findPage, searchPages, sectionBySlug, visibleGroups,
} from './registry.js';

const auth = (perms = [], { role = 'technician', isOwner = false } = {}) => ({
  role, isOwner, hasAnyPermission: (keys) => keys.some((k) => perms.includes(k)),
});
const owner = auth(['settings.manage_system', 'settings.manage_branding', 'settings.manage_statuses',
  'settings.manage_business_hours', 'settings.view_audit_log', 'people.view_all', 'people.create_users',
  'people.manage_departments', 'people.manage_roles', 'companies.view', 'projects.manage_templates',
  'money.settings', 'money.rates.manage', 'money.billing.view'], { role: 'admin', isOwner: true });

test('every page has a known group, a name, a description, a path and a width', () => {
  for (const p of PAGES) {
    assert.ok(GROUPS.includes(p.group), `${p.id}: unknown group ${p.group}`);
    assert.ok(p.name && p.desc, `${p.id}: name and desc`);
    // Settings' own pages, or (external) a company's page.
    assert.match(p.path, p.external ? /^\/companies(\/|$)/ : /^\/(settings|admin)\//, p.id);
    assert.ok(['narrow', 'wide'].includes(p.width), p.id);
    assert.ok(Array.isArray(p.keywords), p.id);
  }
});

test('ids and paths are unique, and no redirect shadows a route', () => {
  const routes = allRoutes();
  assert.equal(new Set(routes.map((r) => r.id)).size, routes.length);
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
  for (const [from, to] of REDIRECTS) {
    assert.ok(!routes.some((r) => r.path === from), `${from} is both a page and a redirect`);
    assert.ok(to === '/settings' || to.startsWith('/companies') || routes.some((r) => r.path === to), `${from} → ${to} goes nowhere`);
  }
});

test('the placeholders are gone and the split pages exist', () => {
  const paths = allRoutes().map((r) => r.path);
  for (const gone of ['/settings/macros', '/settings/supervisor-rules', '/settings/recycle-bin', '/admin/settings', '/settings/branding', '/settings/assignment-rules', '/settings/modules']) {
    assert.ok(!paths.includes(gone), gone);
  }
  // Directory (sign-in and sync) and Email (in and out) are one page each (CS).
  for (const added of ['/settings/email-templates', '/settings/directory', '/settings/email', '/settings/system']) {
    assert.ok(paths.includes(added), added);
  }
});

test('canOpen follows the permission, the legacy role and the owner mark', () => {
  assert.equal(canOpen({}, auth()), true);
  assert.equal(canOpen({ permission: ['settings.manage_system'] }, auth()), false);
  assert.equal(canOpen({ permission: ['settings.manage_system'] }, auth(['settings.manage_system'])), true);
  assert.equal(canOpen({ roles: ['admin'] }, auth([], { role: 'technician' })), false);
  assert.equal(canOpen({ permission: ['settings.manage_system'], owner: true }, auth(['settings.manage_system'])), false);
  assert.equal(canOpen({ permission: ['settings.manage_system'], owner: true }, auth(['settings.manage_system'], { isOwner: true })), true);
});

test('a sub-page takes its page\'s access unless it sets its own', () => {
  const byPath = Object.fromEntries(allRoutes().map((r) => [r.path, r]));
  assert.deepEqual(byPath['/admin/roles/:id'].access, byPath['/admin/roles'].access);
  assert.deepEqual(byPath['/admin/users/:id'].access, {}); // everyone opens their own profile
});

test('findPage matches a page and its detail pages, never Settings home', () => {
  assert.equal(findPage('/admin/roles').id, 'roles');
  assert.equal(findPage('/admin/roles/12').id, 'roles');
  assert.equal(findPage('/settings/workflow-rules/new').id, 'workflow-rules');
  assert.equal(findPage('/settings'), null);
  assert.equal(findPage('/settings/nope'), null);
});

test('search matches names, descriptions and keywords, names first', () => {
  const found = searchPages('logo', PAGES).map((p) => p.id);
  assert.equal(found[0], 'your-company');
  assert.ok(searchPages('PASSWORD', PAGES).some((p) => p.id === 'users'));
  assert.equal(searchPages('time', PAGES)[0].id, 'time-tracking');
  assert.deepEqual(searchPages('   ', PAGES), []);
  assert.deepEqual(searchPages('([*', PAGES), []); // regex characters are just text
});

test('visibleGroups keeps the menu order and drops groups with nothing to open', () => {
  const staff = visibleGroups(auth());
  assert.deepEqual(staff.map((g) => g.name), ['You', 'People & access', 'Service desk', 'About']);
  assert.deepEqual(staff.find((g) => g.name === 'You').pages.map((p) => p.id), ['preferences']);
  const all = visibleGroups(owner).map((g) => g.name);
  assert.deepEqual(all, GROUPS);
  // Non-owner administrators see only the email templates under Sign-in & email.
  const sysadmin = visibleGroups({ ...owner, isOwner: false });
  assert.deepEqual(sysadmin.find((g) => g.name === 'Sign-in & email').pages.map((p) => p.id), ['email-templates']);
});

test('project-templates is in group Projects and needs projects.manage_templates', () => {
  const page = PAGES.find((p) => p.id === 'project-templates');
  assert.equal(page.group, 'Projects');
  assert.deepEqual(page.access, { permission: ['projects.manage_templates'] });
  assert.equal(page.width, 'wide');
  assert.deepEqual(page.sub.map((s) => s.path), ['/settings/project-templates/new', '/settings/project-templates/:id']);
  assert.equal(canOpen(page.access, auth()), false);
  assert.equal(canOpen(page.access, auth(['projects.manage_templates'])), true);
  assert.ok(GROUPS.includes('Projects'));
});

test('Hours & SLAs holds the starting values for new companies and Staff hours', () => {
  assert.ok(GROUPS.includes('Hours & SLAs'));
  assert.ok(!GROUPS.includes('Workload'));
  const start = PAGES.find((p) => p.id === 'starting-values');
  assert.equal(start.group, 'Hours & SLAs');
  assert.equal(start.path, '/settings/starting-values');
  const wh = PAGES.find((p) => p.id === 'work-hours');
  assert.equal(wh.group, 'Hours & SLAs');
  assert.deepEqual(wh.access, { permission: ['settings.manage_business_hours'] });
  // Each company's own SLA, hours and holidays are on its page, not here.
  for (const gone of ['slas', 'business-hours', 'holidays']) assert.equal(PAGES.find((p) => p.id === gone), undefined);
});

test('every section has a unique slug, an icon and a description, and every group is a section', () => {
  assert.equal(new Set(SECTIONS.map((x) => x.slug)).size, SECTIONS.length);
  for (const x of SECTIONS) {
    assert.match(x.slug, /^[a-z-]+$/);
    assert.ok(x.icon && x.desc, x.name);
    assert.equal(sectionBySlug(x.slug).name, x.name);
  }
  assert.equal(sectionBySlug('nope'), null);
});

test('PB2: Forms and Playbooks moved to Checklists, keeping ids', async () => {
  const { redirectTarget } = await import('./registry.js');
  const paths = allRoutes().map((r) => r.path);
  for (const gone of ['/settings/forms', '/settings/forms/:id', '/settings/playbooks', '/settings/playbooks/:id']) assert.ok(!paths.includes(gone), gone);
  for (const added of ['/settings/checklists', '/settings/checklists/new', '/settings/checklists/:id', '/settings/checklists/bundles/new', '/settings/checklists/bundles/:id']) assert.ok(paths.includes(added), added);
  const to = Object.fromEntries(REDIRECTS);
  assert.equal(redirectTarget(to['/settings/forms/:id'], { id: '12' }), '/settings/checklists/12');
  assert.equal(redirectTarget(to['/settings/playbooks/:id'], { id: '3' }), '/settings/checklists/bundles/3');
  assert.equal(redirectTarget(to['/settings/forms'], {}), '/settings/checklists');
  assert.equal(findPage('/settings/checklists/bundles/3').id, 'checklists');
});

test('your company is one page in Settings; customers have their own section (CS)', () => {
  const byId = Object.fromEntries(PAGES.map((p) => [p.id, p]));
  assert.ok(GROUPS.includes('Your company') && GROUPS.includes('Customers'));
  // One entry for your company: profile, departments, sites, categories, devices.
  assert.deepEqual(PAGES.filter((p) => p.group === 'Your company').map((p) => p.id), ['your-company']);
  assert.ok(!byId['your-company'].external);
  assert.equal(findPage('/settings/your-company').id, 'your-company');
  for (const gone of ['company', 'own-departments', 'own-company-page', 'departments']) assert.ok(!byId[gone], gone);
  assert.deepEqual(['companies', 'client-portal', 'customer-happiness'].map((id) => byId[id].group), ['Customers', 'Customers', 'Customers']);
  // The customer list is outside Settings, and never the current Settings page.
  const paths = allRoutes().map((r) => r.path);
  assert.ok(!paths.some((p) => p.startsWith('/companies')));
  for (const gone of ['/settings/company', '/settings/departments', '/admin/departments']) assert.ok(!paths.includes(gone), gone);
  assert.equal(findPage('/companies'), null);
});

test('Money holds its four pages, each behind its permission (Phase 3)', () => {
  const ids = PAGES.filter((p) => p.group === 'Money').map((p) => p.id);
  assert.deepEqual(ids, ['money-settings', 'money-rates', 'money-tax', 'money-products']);
  assert.equal(visibleGroups(auth(['money.rates.manage'])).some((g) => g.name === 'Money'), true);
  assert.equal(visibleGroups(auth([])).some((g) => g.name === 'Money'), false);
});

test('each Money page finds itself, not another Money page by prefix', () => {
  for (const id of ['money-settings', 'money-rates', 'money-tax', 'money-products']) {
    const page = PAGES.find((p) => p.id === id);
    assert.equal(findPage(page.path).id, id);
  }
});
