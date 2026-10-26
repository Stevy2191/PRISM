import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUPS, PAGES, REDIRECTS, allRoutes, canOpen, findPage, searchPages, visibleGroups,
} from './registry.js';

const auth = (perms = [], { role = 'technician', isOwner = false } = {}) => ({
  role, isOwner, hasAnyPermission: (keys) => keys.some((k) => perms.includes(k)),
});
const owner = auth(['settings.manage_system', 'settings.manage_branding', 'settings.manage_statuses',
  'settings.manage_business_hours', 'settings.view_audit_log', 'people.view_all', 'people.create_users',
  'people.manage_departments', 'people.manage_roles', 'companies.view', 'projects.manage_templates'], { role: 'admin', isOwner: true });

test('every page has a known group, a name, a description, a path and a width', () => {
  for (const p of PAGES) {
    assert.ok(GROUPS.includes(p.group), `${p.id}: unknown group ${p.group}`);
    assert.ok(p.name && p.desc, `${p.id}: name and desc`);
    assert.match(p.path, /^\/(settings|admin)\//, p.id);
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
    assert.ok(to === '/settings' || routes.some((r) => r.path === to), `${from} → ${to} goes nowhere`);
  }
});

test('the placeholders are gone and the split pages exist', () => {
  const paths = allRoutes().map((r) => r.path);
  for (const gone of ['/settings/macros', '/settings/supervisor-rules', '/settings/recycle-bin', '/admin/settings', '/settings/branding', '/settings/assignment-rules', '/settings/modules']) {
    assert.ok(!paths.includes(gone), gone);
  }
  for (const added of ['/settings/email-templates', '/settings/directory', '/settings/incoming-email', '/settings/outgoing-email', '/settings/system']) {
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
  assert.equal(found[0], 'company');
  assert.ok(searchPages('PASSWORD', PAGES).some((p) => p.id === 'users'));
  assert.equal(searchPages('time', PAGES)[0].id, 'time-tracking');
  assert.deepEqual(searchPages('   ', PAGES), []);
  assert.deepEqual(searchPages('([*', PAGES), []); // regex characters are just text
});

test('visibleGroups keeps the menu order and drops groups with nothing to open', () => {
  const staff = visibleGroups(auth());
  assert.deepEqual(staff.map((g) => g.name), ['You', 'People & access', 'Service desk']);
  assert.deepEqual(staff.find((g) => g.name === 'You').pages.map((p) => p.id), ['preferences', 'about']);
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
