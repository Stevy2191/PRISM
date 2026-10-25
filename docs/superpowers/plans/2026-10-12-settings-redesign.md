# Settings Redesign Implementation Plan

> **Status: shipped** (see `docs/ROADMAP.md`). The checkboxes below were not ticked as the work went; they don't mean the steps are undone.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Settings one left-hand menu (option A), a search, an overview home, regrouped pages and one shared page layout, with the menu and the page guards built from a single registry.

**Architecture:** A pure-data registry (`frontend/src/pages/settings/registry.js`) lists every Settings page, its group, words to search by and its access rule. `App.jsx` generates the Settings routes and their guards from it, nested in a `SettingsShell` layout route that draws the menu; the menu and the overview read the same registry through `canOpen`, so a menu entry can never disagree with its route. Every page renders inside a shared `SettingsPage` frame. One new owner-only endpoint, `GET /settings/status`, feeds the overview's status hints.

**Tech Stack:** React 18 + React Router 6 + Tailwind (frontend, Vite); Express + Sequelize (backend); Jest integration tests; Playwright smoke tests (`npm run test:smoke`); Node's built-in `node:test` for the registry's unit tests (new `npm test` in `frontend/`).

**Spec:** `docs/superpowers/specs/2026-10-12-settings-redesign-design.md`

## Global Constraints

- Who may open each page does not change; the spec's table is the authority ("this redesign moves pages, it does not change who may open them").
- The server keeps enforcing every permission and the owner rule; hiding a menu entry is never the security.
- Existing URLs stay. New pages: `/settings/directory`, `/settings/incoming-email`, `/settings/outgoing-email`, `/settings/system`.
- Redirects: `/admin/settings` → `/settings`; `/settings/branding` → `/settings/company`; `/settings/email-templates`, `/settings/macros`, `/settings/supervisor-rules`, `/settings/recycle-bin` → `/settings`. The old duplicate `/settings/blueprints` → `/admin/blueprints`.
- `GET /settings/status` is owner-only (`403 OWNER_ONLY` otherwise) and returns only booleans and counts: never a host, username, address, password or secret.
- Copy: page names as in the spec's grouping table, sentence case ("Single sign-on", "Roles & permissions"). Plain words, active voice; no "Back to Settings" links anywhere.
- Phones: under 768px (`md`) the menu is behind a full-width "Settings ▾" button; no page scrolls sideways at 375px.
- Save bar ("Unsaved changes" / "Saved"): on the whole-page forms of Company profile, Time tracking, Expiry alerts, Customer happiness, Notifications and System info. Pages whose forms live in panels with their own Test buttons (Directory, Incoming email, Outgoing email, Single sign-on, Calendar) and editors inside modals keep their own buttons.
- Use the app's existing tokens and classes (`card`, `input`, `label`, `btn-primary`, `btn-secondary`, `eyebrow`, `page-title`, `var(--color-…)`, `text-navy-…`). No new dependencies.
- Run backend tests with `npx cross-env NODE_OPTIONS=--experimental-vm-modules jest <file>` from `backend/`; never two test runs at once (they share one test database). Smoke: `npm run test:smoke -- <pattern>` from `backend/` (it builds the frontend first).

## Review Focus

1. A registry page whose id has no component in `App.jsx`'s map: a blank or crashed page. Expect every menu page to open with its title (Task 9's every-page smoke test).
2. A user with only `settings.manage_branding` on Company profile: they may upload the logo and favicon, but saving the text needs `settings.manage_system`. Expect read-only text fields and a note instead of a Save that fails with 403 (Task 3).
3. A search with regular-expression characters, or with no matches: expect no crash and "No settings match" (Task 2 unit test; Task 5 smoke).
4. Someone with almost no Settings pages opening a detail page directly (Department Staff on their own `/admin/users/:id`): expect the shell and page to render, with a short menu (Task 5).
5. The phone menu: expect it to close once a page is picked, and no sideways scroll at 375px (Task 5).

---

## File structure

| File | Responsibility |
|---|---|
| `backend/src/controllers/settingsController.js` | + `status` handler |
| `backend/src/routes/settings.js` | + `GET /status` (owner settings guard) |
| `backend/test/integration/settings.status.test.js` | new: the endpoint |
| `frontend/package.json` | + `"test": "node --test \"src/**/*.test.js\""` |
| `frontend/src/pages/settings/registry.js` | new: groups, pages, redirects, `canOpen`, `findPage`, `searchPages`, `visibleGroups`, `allRoutes` (no React, no imports) |
| `frontend/src/pages/settings/registry.test.js` | new: unit tests (`node:test`) |
| `frontend/src/components/settings/SettingsPage.jsx` | new: `SettingsPage`, `SettingsPanel`, `SettingsRow` |
| `frontend/src/components/settings/SaveBar.jsx` | new: `SaveBar`, `isDirty` |
| `frontend/src/components/settings/SettingsMenu.jsx` | new: the menu with search |
| `frontend/src/components/settings/SettingsShell.jsx` | new: layout route: menu (desktop) / "Settings ▾" sheet (phone) + `<Outlet/>` |
| `frontend/src/pages/settings/CompanyProfile.jsx` | new: Company + Branding merged |
| `frontend/src/pages/settings/Directory.jsx`, `IncomingEmail.jsx`, `OutgoingEmail.jsx`, `SystemInfo.jsx` | new: General Settings split |
| `frontend/src/pages/settings/SettingsHome.jsx` | new: overview, status hints, version footer |
| `frontend/src/App.jsx` | Settings routes generated from the registry |
| `frontend/src/components/Layout.jsx` | drop the old hub's scroll-restore cleanup |
| Deleted | `pages/SettingsHub.jsx`, `pages/AdminSettings.jsx`, `pages/settings/Company.jsx`, `pages/settings/Branding.jsx`, `pages/settings/Placeholder.jsx` |
| ~30 settings pages | wrapped in `SettingsPage` (Tasks 6–8) |
| `backend/test/smoke/settings.smoke.js` | new: shell, search, redirects, phone, pages |
| `backend/test/smoke/owner.smoke.js` | updated for the split pages and new names |
| `UPGRADING.md`, `docs/ROADMAP.md` | release notes, testing feedback |

---

### Task 1: `GET /settings/status`

**Files:**
- Modify: `backend/src/controllers/settingsController.js`
- Modify: `backend/src/routes/settings.js`
- Test: `backend/test/integration/settings.status.test.js`

**Interfaces:**
- Produces: `GET /api/v1/settings/status` → `{ directory: { configured: boolean, connected: boolean }, incomingEmail: { enabled: boolean }, outgoingEmail: { configured: boolean }, singleSignOn: { enabled: number } }`; non-owners `403 OWNER_ONLY`; no `settings.manage_system` → `403`.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/integration/settings.status.test.js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeStaff } = require('./fixtures');

// The Settings overview's status hints (spec: Settings redesign): owners
// only, and only booleans and counts, never a host, address or secret.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

const status = (u) => u.agent.get(`${API}/settings/status`);

it('an owner gets booleans and counts', async () => {
  const body = expectOk(await status(w.admin));
  expect(body).toEqual({
    directory: { configured: expect.any(Boolean), connected: expect.any(Boolean) },
    incomingEmail: { enabled: false },
    outgoingEmail: { configured: false },
    singleSignOn: { enabled: 0 },
  });
});

it('reflects mail settings without repeating them', async () => {
  await models.SystemSettings.bulkCreate([
    { key: 'smtp.host', value: 'mail.example.com' },
    { key: 'smtp.fromEmail', value: 'desk@example.com' },
    { key: 'inboundEmail.enabled', value: 'true' },
  ]);
  const body = expectOk(await status(w.admin));
  expect([body.outgoingEmail.configured, body.incomingEmail.enabled]).toEqual([true, true]);
  expect(JSON.stringify(body)).not.toMatch(/example\.com/);
});

it('a System Administrator who is not an owner is refused; so is someone without system settings', async () => {
  const roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  const sysadmin = await makeStaff('sysadmin', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${sysadmin.user.id}/roles`)
    .send({ roleId: roles.find((r) => r.name === 'System Administrator').id }), 201);
  const res = await status(sysadmin);
  expect([res.status, res.body.code]).toEqual([403, 'OWNER_ONLY']);
  const staff = await makeStaff('staff', w.deptA.id);
  expect((await status(staff)).status).toBe(403);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/settings.status.test.js`
Expected: FAIL — `GET /api/v1/settings/status → 404`.

- [ ] **Step 3: Implement**

In `backend/src/controllers/settingsController.js`, next to the other requires:

```js
const { isConfigured: isLdapConfigured } = require('../config/ldap');
const { resolveSmtpConfig, isSmtpConfigured } = require('../services/emailSender');
```

Add `SsoProvider` to the models require already in the file (`const { ..., SsoProvider } = require('../models');`), then add the handler above `module.exports` and export it:

```js
// GET /settings/status — owner only (the route). The Settings overview's
// hints: whether the directory, incoming and outgoing email and single
// sign-on are set up. Booleans and counts only, never their settings.
const status = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const directory = await isLdapConfigured();
  res.json({
    directory: { configured: !!directory, connected: !!(directory && values['ldap.lastTestAt']) },
    incomingEmail: { enabled: values['inboundEmail.enabled'] === 'true' },
    outgoingEmail: { configured: isSmtpConfigured(await resolveSmtpConfig(values)) },
    singleSignOn: { enabled: await SsoProvider.count({ where: { isEnabled: true } }) },
  });
});
```

In `backend/src/routes/settings.js`, after `router.get('/email-log', …)`:

```js
router.get('/status', ownerSettings, ctrl.status);
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/settings.status.test.js test/integration/owner.settings.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/settingsController.js backend/src/routes/settings.js backend/test/integration/settings.status.test.js
git commit -m "feat(settings): owner-only status for the Settings overview's hints"
```

---

### Task 2: The settings registry

**Files:**
- Create: `frontend/src/pages/settings/registry.js`
- Create: `frontend/src/pages/settings/registry.test.js`
- Modify: `frontend/package.json` (scripts)

**Interfaces:**
- Produces (named exports of `registry.js`):
  - `GROUPS: string[]` — the menu order.
  - `PAGES: Page[]` where `Page = { id, group, name, desc, keywords: string[], path, access: Access, width: 'narrow'|'wide', sub?: { id, path, access? }[] }` and `Access = { permission?: string[], roles?: string[], owner?: boolean }`.
  - `REDIRECTS: [from: string, to: string][]`.
  - `canOpen(access: Access, auth: { role, isOwner, hasAnyPermission(keys) }): boolean`.
  - `allRoutes(): { id, path, access }[]` — every page and sub-page; a sub-page without `access` takes its page's.
  - `findPage(pathname): Page | null` — the page whose path equals `pathname` or is a `/`-prefix of it. Never matches `/settings` itself.
  - `visibleGroups(auth): { name, pages: Page[] }[]` — menu order, pages the user may open, empty groups dropped.
  - `searchPages(query, pages): Page[]` — case-insensitive on name, desc and keywords; name matches first; `[]` for a blank query.

- [ ] **Step 1: Add the test script**

In `frontend/package.json` `"scripts"`, add:

```json
"test": "node --test \"src/**/*.test.js\""
```

- [ ] **Step 2: Write the failing tests**

```js
// frontend/src/pages/settings/registry.test.js
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
  'people.manage_departments', 'people.manage_roles', 'companies.view'], { role: 'admin', isOwner: true });

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
  for (const gone of ['/settings/email-templates', '/settings/macros', '/settings/supervisor-rules', '/settings/recycle-bin', '/admin/settings', '/settings/branding']) {
    assert.ok(!paths.includes(gone), gone);
  }
  for (const added of ['/settings/directory', '/settings/incoming-email', '/settings/outgoing-email', '/settings/system']) {
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
  const sysadmin = visibleGroups({ ...owner, isOwner: false }).map((g) => g.name);
  assert.ok(!sysadmin.includes('Sign-in & email'));
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module …/registry.js`.

- [ ] **Step 4: Write the registry**

```js
// frontend/src/pages/settings/registry.js
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
  { id: 'company', group: 'Organization', name: 'Company profile', desc: 'Name, logo, time zone and login page', keywords: ['logo', 'favicon', 'branding', 'time zone', 'timezone', 'date format', 'language', 'login page', 'app name'], path: '/settings/company', access: { permission: ['settings.manage_branding', 'settings.manage_system'] }, width: 'narrow' },
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
  { id: 'assignment-rules', group: 'Service desk', name: 'Assignment rules', desc: 'Who gets new tickets', keywords: ['assign', 'round robin', 'routing'], path: '/settings/assignment-rules', access: SYSTEM, width: 'narrow' },
  { id: 'workflow-rules', group: 'Service desk', name: 'Workflow rules', desc: 'Automatic actions on tickets', keywords: ['automation', 'trigger', 'action'], path: '/settings/workflow-rules', access: SYSTEM, width: 'wide', sub: [{ id: 'workflow-rule-new', path: '/settings/workflow-rules/new' }, { id: 'workflow-rule-edit', path: '/settings/workflow-rules/:id' }] },
  { id: 'notifications', group: 'Service desk', name: 'Notifications', desc: 'Which events notify people', keywords: ['bell', 'alert', 'notify'], path: '/settings/notifications', access: SYSTEM, width: 'narrow' },
  { id: 'customer-happiness', group: 'Service desk', name: 'Customer happiness', desc: 'Satisfaction surveys and scores', keywords: ['csat', 'survey', 'rating', 'feedback'], path: '/settings/customer-happiness', access: SYSTEM, width: 'narrow' },
  // Hours & SLAs
  { id: 'slas', group: 'Hours & SLAs', name: 'SLAs', desc: 'Response and resolution targets', keywords: ['sla', 'response time', 'resolution', 'escalation'], path: '/settings/slas', access: SYSTEM, width: 'narrow' },
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
  { id: 'email-log', group: 'Sign-in & email', name: 'Email log', desc: 'What came in and what was sent', keywords: ['mail log', 'bounce', 'delivery'], path: '/settings/email-log', access: OWNER, width: 'wide' },
  { id: 'calendar', group: 'Sign-in & email', name: 'Calendar', desc: 'Google and Microsoft calendar sync', keywords: ['google', 'microsoft', 'outlook', 'oauth'], path: '/settings/calendar-integration', access: OWNER, width: 'narrow' },
  // System
  { id: 'modules', group: 'System', name: 'Modules & tabs', desc: 'Show or hide parts of PRISM', keywords: ['menu', 'tab', 'module', 'hide'], path: '/settings/modules', access: SYSTEM, width: 'narrow' },
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
  ['/settings/email-templates', '/settings'],
  ['/settings/macros', '/settings'],
  ['/settings/supervisor-rules', '/settings'],
  ['/settings/recycle-bin', '/settings'],
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
```

- [ ] **Step 5: Run them to see them pass**

Run: `cd frontend && npm test`
Expected: PASS — 8 tests. (`time` must rank Time tracking first: "time tracking" starts with it; if another name also starts with "time", reorder by keeping `PAGES` order, which `sort` keeps stable.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/src/pages/settings/registry.js frontend/src/pages/settings/registry.test.js
git commit -m "feat(settings): one registry of Settings pages, groups, search words and access"
```

---

### Task 3: The page frame, the save bar, and Company profile

**Files:**
- Create: `frontend/src/components/settings/SettingsPage.jsx`
- Create: `frontend/src/components/settings/SaveBar.jsx`
- Create: `frontend/src/pages/settings/CompanyProfile.jsx`
- Delete: `frontend/src/pages/settings/Company.jsx`, `frontend/src/pages/settings/Branding.jsx`
- Modify: `frontend/src/App.jsx` (the `/settings/company` and `/settings/branding` routes only; Task 5 replaces all Settings routes)
- Test: `backend/test/smoke/settings.smoke.js` (new)

**Interfaces:**
- Consumes: `findPage(pathname)` (Task 2).
- Produces:
  - `SettingsPage({ title?, description?, actions?, width?, children })` — title and description default to the registry page's `name` and `desc`, width to its `width` (`'narrow'` → `max-w-3xl`, `'wide'` → full). Renders a breadcrumb "Settings / {group}", an `h1.page-title`, the description and the actions slot.
  - `SettingsPanel({ title, description?, actions?, children })` — a `card` with a header strip.
  - `SettingsRow({ label, htmlFor?, help?, children })` — label + help on the left (220px), control on the right; stacks under 640px.
  - `SaveBar({ dirty, saving, saved, disabled?, note? })` — a submit button "Save"; shows "Unsaved changes" when `dirty`, "Saved" when `saved && !dirty`; `note` replaces both (used for read-only).
  - `isDirty(form, snapshot): boolean`.

- [ ] **Step 1: Write the failing smoke test**

```js
// backend/test/smoke/settings.smoke.js
const { resetData, closeDb, models, ROLE } = require('../integration/helpers');
const { API, expectOk, makeWorld, makeUser } = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// The Settings redesign (spec 2026-10-12): one menu, one page layout, the
// regrouped pages.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const setting = async (key) => (await models.SystemSettings.findOne({ where: { key } }))?.value;

let smoke;
let w;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

describe('Company profile', () => {
  it('holds what Company and Branding did, and saves a value from each panel', async () => {
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    await page.getByLabel('Organization name').fill('Northwind IT');
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    await page.getByLabel('App name').fill('Northwind Desk');
    await page.getByLabel('Login page tagline').fill('Help, fast');
    await shown(page, 'Unsaved changes').waitFor();
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith('/settings'));
    await page.getByRole('button', { name: 'Save' }).click();
    await saved;
    await shown(page, 'Saved').waitFor();
    expect([await setting('company.name'), await setting('company.timezone'), await setting('branding.appName'), await setting('branding.tagline')])
      .toEqual(['Northwind IT', 'America/Chicago', 'Northwind Desk', 'Help, fast']);
  });

  it('a branding-only user may change the logo but sees the text read-only', async () => {
    const brand = await makeUser('brand', ROLE.DEPARTMENT_STAFF, w.deptA.id);
    expectOk(await w.admin.agent.post(`${API}/users/${brand.user.id}/overrides`).send({ permissionKey: 'settings.manage_branding', granted: true }), 201);
    const page = await smoke.pageAs('brand');
    await page.goto('/settings/company');
    await page.getByRole('heading', { level: 1, name: 'Company profile' }).waitFor();
    expect(await page.getByLabel('Organization name').isDisabled()).toBe(true);
    await shown(page, /Changing these needs the System settings permission/).waitFor();
    expect(await page.getByRole('button', { name: 'Save' }).count()).toBe(0);
    await page.getByText('Upload').first().waitFor();
  });

  it('the old Branding address opens Company profile', async () => {
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/branding');
    await page.waitForURL('**/settings/company');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && npm run test:smoke -- settings.smoke`
Expected: FAIL — no heading "Company profile".

- [ ] **Step 3: Write the frame and the save bar**

```jsx
// frontend/src/components/settings/SettingsPage.jsx
// The one layout every Settings page shares (spec: Settings redesign): a
// breadcrumb, the title and description (from the registry unless given),
// an actions slot, then panels.
import { Link, useLocation } from 'react-router-dom';
import { findPage } from '../../pages/settings/registry';

export default function SettingsPage({ title, description, actions, width, children }) {
  const { pathname } = useLocation();
  const entry = findPage(pathname);
  const w = width || entry?.width || 'narrow';
  return (
    <div className={`space-y-5 ${w === 'narrow' ? 'max-w-3xl' : ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-navy-400">
            <Link to="/settings" className="hover:text-prism hover:underline">Settings</Link>
            {entry && <> / {entry.group}</>}
          </nav>
          <h1 className="page-title">{title || entry?.name}</h1>
          {(description || entry?.desc) && <p className="mt-1 text-sm text-navy-500">{description || entry?.desc}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function SettingsPanel({ title, description, actions, children }) {
  return (
    <section className="card" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-3" style={{ borderColor: 'var(--color-border)' }}>
        <div className="min-w-0">
          <h2 className="font-semibold text-navy-900">{title}</h2>
          {description && <p className="text-xs text-navy-400">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>{children}</div>
    </section>
  );
}

export function SettingsRow({ label, htmlFor, help, children }) {
  return (
    <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="block text-sm font-medium text-navy-800">{label}</label>
        {help && <p className="mt-0.5 text-xs text-navy-400">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
```

```jsx
// frontend/src/components/settings/SaveBar.jsx
// The end of a whole-page Settings form: says when there are unsaved
// changes, then that they were saved. `note` (for example, why the form is
// read-only) takes the button's place.
export const isDirty = (form, snapshot) => JSON.stringify(form) !== JSON.stringify(snapshot);

export default function SaveBar({ dirty, saving, saved, disabled = false, note = null }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {note ? <p className="text-sm text-navy-500">{note}</p> : (
        <>
          {dirty && <span className="text-sm text-navy-500">Unsaved changes</span>}
          {saved && !dirty && <span role="status" className="text-sm" style={{ color: 'var(--color-success)' }}>Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving || disabled || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write Company profile**

```jsx
// frontend/src/pages/settings/CompanyProfile.jsx
// Company and Branding as one page (spec: Settings redesign): each value is
// edited in one place. The logo and favicon save on upload (needs
// settings.manage_branding or manage_system); the rest saves with Save, which
// the server allows only with settings.manage_system, so a branding-only
// user sees those fields read-only.
import { useEffect, useRef, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const DATE_FORMATS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD MMM YYYY'];
const TIME_FORMATS = [['12h', '12-hour (2:30 PM)'], ['24h', '24-hour (14:30)']];
const LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']];
const KEYS = ['company.name', 'company.supportEmail', 'company.timezone', 'company.dateFormat', 'company.timeFormat', 'company.language', 'branding.appName', 'branding.tagline'];
const DEFAULTS = { 'company.timezone': 'UTC', 'company.dateFormat': 'YYYY-MM-DD', 'company.timeFormat': '12h', 'company.language': 'en', 'branding.appName': 'PRISM' };

function ImagePicker({ label, url, onUpload, onRemove, help }) {
  const ref = useRef();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded border border-navy-200 bg-navy-50">
        {url ? <img src={url} alt={label} className="h-12 w-12 object-contain" /> : <span className="text-[10px] text-navy-400">none</span>}
      </div>
      <label className="btn-secondary cursor-pointer">
        Upload
        <input ref={ref} type="file" accept="image/*" className="hidden" aria-label={`Upload ${label.toLowerCase()}`}
          onChange={async (e) => { await onUpload(e.target.files?.[0]); if (ref.current) ref.current.value = ''; }} />
      </label>
      {url && <button type="button" onClick={onRemove} className="btn-secondary">Remove</button>}
      {help && <p className="w-full text-xs text-navy-400">{help}</p>}
    </div>
  );
}

export default function CompanyProfile() {
  const { hasPermission } = useAuth();
  const canSave = hasPermission('settings.manage_system');
  const { settings, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [bullets, setBullets] = useState([]);
  const [newBullet, setNewBullet] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      const s = data.settings;
      const f = Object.fromEntries(KEYS.map((k) => [k, s[k] || DEFAULTS[k] || '']));
      let b = [];
      try { b = JSON.parse(s['branding.loginBullets'] || '[]'); } catch { b = []; }
      setForm(f);
      setBullets(b);
      setSnapshot({ f, b });
    }).catch((err) => setError(errMessage(err)));
  }, []);

  if (!form) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const dirty = isDirty({ f: form, b: bullets }, snapshot);
  const set = (k) => (e) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const setList = (next) => { setSaved(false); setBullets(next); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings', { settings: { ...form, 'branding.loginBullets': JSON.stringify(bullets) } });
      await refresh();
      setSnapshot({ f: form, b: bullets });
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const upload = (path) => async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(path, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refresh();
    } catch (err) { setError(errMessage(err)); }
  };
  const remove = (path) => async () => {
    try { await api.delete(path); await refresh(); } catch (err) { setError(errMessage(err)); }
  };
  const move = (i, dir) => {
    const next = [...bullets];
    const t = i + dir;
    if (t < 0 || t >= next.length) return;
    [next[i], next[t]] = [next[t], next[i]];
    setList(next);
  };

  return (
    <SettingsPage>
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <SettingsPanel title="Look" description="Saved as soon as you upload.">
        <SettingsRow label="Logo" help="Shown in the top bar and on the login page. PNG or SVG, up to 5 MB.">
          <ImagePicker label="Logo" url={settings.logoUrl} onUpload={upload('/settings/logo')} onRemove={remove('/settings/logo')} />
        </SettingsRow>
        <SettingsRow label="Favicon" help="The icon in the browser tab.">
          <ImagePicker label="Favicon" url={settings.faviconUrl} onUpload={upload('/settings/favicon')} onRemove={remove('/settings/favicon')} />
        </SettingsRow>
      </SettingsPanel>

      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={!canSave} className="space-y-5">
          <SettingsPanel title="Details">
            <SettingsRow label="Organization name" htmlFor="company-name" help="Shown in email footers and reports.">
              <input id="company-name" className="input" value={form['company.name']} onChange={set('company.name')} required />
            </SettingsRow>
            <SettingsRow label="Support email" htmlFor="support-email">
              <input id="support-email" type="email" className="input" value={form['company.supportEmail']} onChange={set('company.supportEmail')} />
            </SettingsRow>
            <SettingsRow label="App name" htmlFor="app-name" help="Shown in the top bar, the login page and the browser tab.">
              <input id="app-name" className="input" value={form['branding.appName']} onChange={set('branding.appName')} />
            </SettingsRow>
          </SettingsPanel>

          <SettingsPanel title="Regional">
            <SettingsRow label="Time zone" htmlFor="tz" help="Used for dates, reports and the time ledger.">
              <select id="tz" className="input" value={form['company.timezone']} onChange={set('company.timezone')}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label="Date format" htmlFor="date-format">
              <select id="date-format" className="input" value={form['company.dateFormat']} onChange={set('company.dateFormat')}>
                {DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label="Time format" htmlFor="time-format">
              <select id="time-format" className="input" value={form['company.timeFormat']} onChange={set('company.timeFormat')}>
                {TIME_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label="Language" htmlFor="language">
              <select id="language" className="input" value={form['company.language']} onChange={set('company.language')}>
                {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </SettingsRow>
          </SettingsPanel>

          <SettingsPanel title="Login page">
            <SettingsRow label="Login page tagline" htmlFor="tagline">
              <input id="tagline" className="input" value={form['branding.tagline']} onChange={set('branding.tagline')} />
            </SettingsRow>
            <SettingsRow label="Bullet points" help="Shown beside the sign-in form.">
              <ul className="mb-2 space-y-1.5">
                {bullets.map((b, i) => (
                  <li key={`${b}-${i}`} className="flex items-center gap-2 rounded border border-navy-200 px-2 py-1.5">
                    <span className="min-w-0 flex-1 text-sm text-navy-800">{b}</span>
                    <button type="button" aria-label={`Move "${b}" up`} onClick={() => move(i, -1)} disabled={i === 0} className="text-navy-400 disabled:opacity-30">↑</button>
                    <button type="button" aria-label={`Move "${b}" down`} onClick={() => move(i, 1)} disabled={i === bullets.length - 1} className="text-navy-400 disabled:opacity-30">↓</button>
                    <button type="button" aria-label={`Remove "${b}"`} onClick={() => setList(bullets.filter((_, j) => j !== i))} className="text-red-500">✕</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input className="input" aria-label="New bullet point" value={newBullet} placeholder="Add a bullet point…"
                  onChange={(e) => setNewBullet(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newBullet.trim()) { setList([...bullets, newBullet.trim()]); setNewBullet(''); } } }} />
                <button type="button" className="btn-secondary" onClick={() => { if (newBullet.trim()) { setList([...bullets, newBullet.trim()]); setNewBullet(''); } }}>Add</button>
              </div>
            </SettingsRow>
          </SettingsPanel>
        </fieldset>
        <SaveBar dirty={dirty} saving={saving} saved={saved}
          note={canSave ? null : 'Changing these needs the System settings permission. You can still change the logo and favicon.'} />
      </form>
    </SettingsPage>
  );
}
```

- [ ] **Step 5: Route it, and retire the two old pages**

In `frontend/src/App.jsx`: replace the imports of `SettingsCompany` and `SettingsBranding` with `import CompanyProfile from './pages/settings/CompanyProfile';`, and replace the two routes with:

```jsx
<Route path="/settings/company" element={perm(<CompanyProfile />, BRANDING_KEYS)} />
<Route path="/settings/branding" element={<Navigate to="/settings/company" replace />} />
```

Then: `git rm frontend/src/pages/settings/Company.jsx frontend/src/pages/settings/Branding.jsx`. In `frontend/src/pages/SettingsHub.jsx` remove the `Branding` card and rename the `Company` card to `Company profile` (the hub goes in Task 6; it must keep building until then).

- [ ] **Step 6: Build, then run the smoke test**

Run: `cd frontend && npx vite build 2>&1 | tail -1` → Expected: `✓ built in …`
Run: `cd backend && npm run test:smoke -- settings.smoke`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src backend/test/smoke/settings.smoke.js
git commit -m "feat(settings): one page frame and save bar; Company and Branding become Company profile"
```

---

### Task 4: Split General Settings

**Files:**
- Create: `frontend/src/pages/settings/Directory.jsx`, `IncomingEmail.jsx`, `OutgoingEmail.jsx`, `SystemInfo.jsx`
- Delete: `frontend/src/pages/AdminSettings.jsx`
- Modify: `frontend/src/App.jsx`, `frontend/src/pages/SettingsHub.jsx`, `frontend/src/pages/settings/LdapSection.jsx`, `InboundEmailSection.jsx`, `OutboundEmailSection.jsx` (only if they render their own page-level `h1`; they render cards with `h2`, which stay)
- Test: `backend/test/smoke/owner.smoke.js`, `backend/test/smoke/settings.smoke.js`

**Interfaces:**
- Consumes: `SettingsPage`, `SettingsPanel`, `SettingsRow`, `SaveBar`, `isDirty` (Task 3).
- Produces: routes `/settings/directory`, `/settings/incoming-email`, `/settings/outgoing-email` (owner guard), `/settings/system` (`settings.manage_system`); `/admin/settings` → `/settings`.

- [ ] **Step 1: Update the owner smoke tests (failing)**

In `backend/test/smoke/owner.smoke.js`, replace the first two tests with:

```js
it('a System Administrator doesn\'t get the Owner-only settings', async () => {
  const page = await smoke.pageAs('sysadmin');
  await page.goto('/settings/single-sign-on');
  await shown(page, /needs an Owner/).waitFor();
  await page.goto('/settings/directory');
  await shown(page, /needs an Owner/).waitFor();
  expect(await page.getByText('Active Directory / LDAP', { exact: true }).filter({ visible: true }).count()).toBe(0);
});

it('an Owner does', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/directory');
  await shown(page, 'Active Directory / LDAP').waitFor();
  await page.goto('/settings/outgoing-email');
  await page.getByRole('heading', { level: 1, name: 'Outgoing email' }).waitFor();
});
```

And add to `backend/test/smoke/settings.smoke.js`:

```js
describe('System info', () => {
  it('has the upload limit, and the old General Settings address lands on Settings', async () => {
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/system');
    await page.getByRole('heading', { level: 1, name: 'System info' }).waitFor();
    await page.getByLabel('Max attachment size (MB)').fill('30');
    await page.getByRole('button', { name: 'Save' }).click();
    await shown(page, 'Saved').waitFor();
    expect(await setting('system.maxAttachmentSizeMB')).toBe('30');
    await page.goto('/admin/settings');
    await page.waitForURL(/\/settings$/);
  });
});
```

Run: `cd backend && npm run test:smoke -- "owner.smoke|settings.smoke"` → Expected: FAIL (no `/settings/directory` page).

- [ ] **Step 2: Write the four pages**

```jsx
// frontend/src/pages/settings/Directory.jsx
// Active Directory / LDAP, out of the old General Settings (spec: Settings
// redesign). Owner only: the route guards it, the server refuses others.
import SettingsPage from '../../components/settings/SettingsPage';
import LdapSection from './LdapSection';

export default function Directory() {
  return <SettingsPage><LdapSection /></SettingsPage>;
}
```

```jsx
// frontend/src/pages/settings/IncomingEmail.jsx
import { Link } from 'react-router-dom';
import SettingsPage from '../../components/settings/SettingsPage';
import InboundEmailSection from './InboundEmailSection';

export default function IncomingEmail() {
  return (
    <SettingsPage actions={<Link to="/settings/email-log" className="btn-secondary">Email log</Link>}>
      <InboundEmailSection />
    </SettingsPage>
  );
}
```

```jsx
// frontend/src/pages/settings/OutgoingEmail.jsx
import SettingsPage from '../../components/settings/SettingsPage';
import OutboundEmailSection from './OutboundEmailSection';

export default function OutgoingEmail() {
  return <SettingsPage><OutboundEmailSection /></SettingsPage>;
}
```

```jsx
// frontend/src/pages/settings/SystemInfo.jsx
// The upload limit and what this instance runs on, out of the old General
// Settings. The time zone lives on Company profile only.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

function Info({ label, children }) {
  return (
    <div className="flex justify-between gap-4 px-5 py-2.5 text-sm">
      <span className="text-navy-500">{label}</span>
      <span className="min-w-0 truncate font-mono text-navy-800">{children ?? '—'}</span>
    </div>
  );
}

export default function SystemInfo() {
  const [config, setConfig] = useState(null);
  const [size, setSize] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setConfig(data.config);
      const v = data.settings['system.maxAttachmentSizeMB'] || '25';
      setSize(v);
      setSnapshot(v);
    }).catch((err) => setError(errMessage(err)));
  }, []);

  if (!config) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings', { settings: { 'system.maxAttachmentSizeMB': String(size) } });
      setSnapshot(size);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage>
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <form onSubmit={save} className="space-y-5">
        <SettingsPanel title="Uploads">
          <SettingsRow label="Max attachment size (MB)" htmlFor="max-upload" help="For ticket and project files. The hard ceiling is 100 MB.">
            <input id="max-upload" type="number" min="1" max="100" className="input max-w-[8rem]" value={size}
              onChange={(e) => { setSaved(false); setSize(e.target.value); }} />
          </SettingsRow>
        </SettingsPanel>
        <SaveBar dirty={isDirty(size, snapshot)} saving={saving} saved={saved} />
      </form>
      <SettingsPanel title="Database">
        <Info label="Host">{config.database.host}</Info>
        <Info label="Port">{config.database.port}</Info>
        <Info label="Name">{config.database.name}</Info>
        <Info label="User">{config.database.user}</Info>
      </SettingsPanel>
      <SettingsPanel title="Application">
        <Info label="Environment">{config.app.nodeEnv}</Info>
        <Info label="Session secret">{config.app.sessionSecretSet ? 'set' : 'not set'}</Info>
      </SettingsPanel>
    </SettingsPage>
  );
}
```

- [ ] **Step 3: Route them, retire General Settings**

In `frontend/src/App.jsx`: remove `import AdminSettings …`; add imports for the four pages; replace `<Route path="/admin/settings" …/>` with:

```jsx
<Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
<Route path="/settings/directory" element={owner(<SettingsDirectory />, SYSTEM_KEYS)} />
<Route path="/settings/incoming-email" element={owner(<SettingsIncomingEmail />, SYSTEM_KEYS)} />
<Route path="/settings/outgoing-email" element={owner(<SettingsOutgoingEmail />, SYSTEM_KEYS)} />
<Route path="/settings/system" element={perm(<SettingsSystemInfo />, SYSTEM_KEYS)} />
```

(imported as `SettingsDirectory`, `SettingsIncomingEmail`, `SettingsOutgoingEmail`, `SettingsSystemInfo`). `git rm frontend/src/pages/AdminSettings.jsx`. In `SettingsHub.jsx`, replace the `General Settings` card with four cards for the new pages (Directory/Incoming/Outgoing with `owner: true`, System info with `SYSTEM_KEYS`), and remove the `adConnected` dot that referred to General Settings.

- [ ] **Step 4: Build and run**

Run: `cd frontend && npx vite build 2>&1 | tail -1` → `✓ built`
Run: `cd backend && npm run test:smoke -- "owner.smoke|settings.smoke"` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src backend/test/smoke
git commit -m "feat(settings): General Settings becomes Directory, Incoming email, Outgoing email and System info"
```

---

### Task 5: The Settings shell, menu and search; routes from the registry

**Files:**
- Create: `frontend/src/components/settings/SettingsMenu.jsx`
- Create: `frontend/src/components/settings/SettingsShell.jsx`
- Modify: `frontend/src/App.jsx`
- Delete: `frontend/src/pages/settings/Placeholder.jsx`
- Test: `backend/test/smoke/settings.smoke.js`

**Interfaces:**
- Consumes: `PAGES`, `REDIRECTS`, `allRoutes`, `canOpen`, `findPage`, `visibleGroups`, `searchPages` (Task 2).
- Produces:
  - `SettingsMenu({ onNavigate? })` — search box (`aria-label="Find a setting"`), "Settings home" link, groups (`eyebrow` headings) with links; the current page's link has `aria-current="page"` (detail pages included, via `findPage`). Typing filters to a flat list of matches; Enter opens the first; Escape clears. "No settings match" when empty.
  - `SettingsShell()` — layout route element: desktop `aside` (`aria-label="Settings menu"`, hidden under `md`) + `<Outlet/>`; under `md`, a `button` named "Settings menu" showing "Settings ▾ · {page name}" that opens the menu as a full-screen sheet (`role="dialog"`, `aria-label="Settings menu"`), closed on navigation or ✕.

- [ ] **Step 1: Write the failing smoke tests**

Add to `backend/test/smoke/settings.smoke.js`:

```js
describe('the menu', () => {
  const menu = (page) => page.getByRole('complementary', { name: 'Settings menu' });

  it('an owner sees every group; a System Administrator no Sign-in & email; Department Staff only a few', async () => {
    const groups = ['You', 'Organization', 'People & access', 'Service desk', 'Hours & SLAs', 'Time & work', 'Assets', 'Sign-in & email', 'System'];
    let page = await smoke.pageAs('admin');
    await page.goto('/settings/preferences');
    for (const g of groups) await menu(page).getByText(g, { exact: true }).waitFor(); // eslint-disable-line no-await-in-loop
    await makeUser('sysadmin2', ROLE.ADMIN, w.deptA.id);
    page = await smoke.pageAs('sysadmin2');
    await page.goto('/settings/preferences');
    await menu(page).getByText('Time & work', { exact: true }).waitFor();
    expect(await menu(page).getByText('Sign-in & email', { exact: true }).count()).toBe(0);
    await makeUser('staff1', ROLE.DEPARTMENT_STAFF, w.deptA.id);
    page = await smoke.pageAs('staff1');
    await page.goto('/settings/preferences');
    await menu(page).getByRole('link', { name: 'Preferences' }).waitFor();
    for (const hidden of ['Time tracking', 'Roles & permissions', 'Single sign-on', 'Import']) {
      expect([hidden, await menu(page).getByRole('link', { name: hidden }).count()]).toEqual([hidden, 0]); // eslint-disable-line no-await-in-loop
    }
  });

  it('marks the current page, including a detail page', async () => {
    const roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
    const page = await smoke.pageAs('admin');
    await page.goto(`/admin/roles/${roles[0].id}`);
    await menu(page).locator('[aria-current="page"]', { hasText: 'Roles & permissions' }).waitFor();
  });

  it('someone with few pages can still open their own profile inside Settings', async () => {
    const me = await makeUser('staff2', ROLE.DEPARTMENT_STAFF, w.deptA.id);
    const page = await smoke.pageAs('staff2');
    await page.goto(`/admin/users/${me.user.id}`);
    await menu(page).getByRole('link', { name: 'Preferences' }).waitFor();
  });

  it('search narrows the menu; Enter opens the first match; nothing matches safely', async () => {
    const page = await smoke.pageAs('admin');
    await page.goto('/settings/preferences');
    const search = menu(page).getByLabel('Find a setting');
    await search.fill('logo');
    await menu(page).getByRole('link', { name: 'Company profile' }).waitFor();
    expect(await menu(page).getByRole('link', { name: 'Time tracking' }).count()).toBe(0);
    await search.press('Enter');
    await page.waitForURL('**/settings/company');
    await search.fill('([*');
    await menu(page).getByText('No settings match').waitFor();
    await search.press('Escape');
    await menu(page).getByRole('link', { name: 'Time tracking' }).waitFor();
  });

  it('old addresses land where they should', async () => {
    const page = await smoke.pageAs('admin');
    for (const [from, to] of [['/settings/macros', /\/settings$/], ['/settings/recycle-bin', /\/settings$/], ['/settings/blueprints', /\/admin\/blueprints$/]]) {
      await page.goto(from); // eslint-disable-line no-await-in-loop
      await page.waitForURL(to); // eslint-disable-line no-await-in-loop
    }
  });

  it('on a phone the menu is behind "Settings menu", closes after picking, and nothing scrolls sideways', async () => {
    const page = await smoke.pageAs('admin', undefined, { viewport: { width: 375, height: 800 } });
    await page.goto('/settings/preferences');
    expect(await menu(page).isVisible()).toBe(false);
    await page.getByRole('button', { name: /Settings menu/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings menu' });
    await sheet.getByRole('link', { name: 'Time tracking' }).click();
    await page.waitForURL('**/settings/time-tracking');
    expect(await sheet.count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
```

Run: `cd backend && npm run test:smoke -- settings.smoke` → Expected: FAIL (no "Settings menu").

- [ ] **Step 2: Write the menu**

```jsx
// frontend/src/components/settings/SettingsMenu.jsx
// The Settings menu (spec: Settings redesign, option A): every group and
// page the user may open, from the registry, with search. canOpen decides
// visibility exactly as the routes' guards do; the server enforces access.
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { findPage, searchPages, visibleGroups } from '../../pages/settings/registry';

function MenuLink({ page, current, onNavigate }) {
  return (
    <Link to={page.path} onClick={onNavigate} aria-current={current ? 'page' : undefined}
      className={`block rounded-md px-2.5 py-1.5 text-sm ${current ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'}`}
      style={current ? { backgroundColor: 'var(--color-card)', boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}>
      {page.name}
    </Link>
  );
}

export default function SettingsMenu({ onNavigate }) {
  const { user, isOwner, hasAnyPermission } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => visibleGroups({ role: user?.role, isOwner, hasAnyPermission }), [user, isOwner, hasAnyPermission]);
  const current = findPage(pathname);
  const matches = searchPages(query, groups.flatMap((g) => g.pages));
  const searching = query.trim() !== '';

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && matches[0]) { e.preventDefault(); setQuery(''); onNavigate?.(); navigate(matches[0].path); }
    if (e.key === 'Escape') setQuery('');
  };

  return (
    <div className="space-y-1">
      <input type="search" className="input mb-2" placeholder="Find a setting" aria-label="Find a setting"
        value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      {searching ? (
        matches.length
          ? matches.map((p) => <MenuLink key={p.id} page={p} current={current?.id === p.id} onNavigate={() => { setQuery(''); onNavigate?.(); }} />)
          : <p className="px-2.5 py-1.5 text-sm text-navy-400">No settings match</p>
      ) : (
        <>
          <Link to="/settings" onClick={onNavigate} aria-current={pathname === '/settings' ? 'page' : undefined}
            className={`block rounded-md px-2.5 py-1.5 text-sm font-semibold ${pathname === '/settings' ? '' : 'hover:bg-[var(--color-hover)]'}`}
            style={pathname === '/settings' ? { backgroundColor: 'var(--color-card)', boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}>
            Settings home
          </Link>
          {groups.map((g) => (
            <div key={g.name} className="pt-3">
              <p className="eyebrow px-2.5 pb-1">{g.name}</p>
              {g.pages.map((p) => <MenuLink key={p.id} page={p} current={current?.id === p.id} onNavigate={onNavigate} />)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the shell**

```jsx
// frontend/src/components/settings/SettingsShell.jsx
// Every Settings page renders in here (spec: Settings redesign): the menu on
// the left, the page on the right. Under md the menu is behind a
// "Settings menu" button, as a full-screen sheet.
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { IconChevronDown, IconX } from '@tabler/icons-react';
import { useNavStyle } from '../../context/NavStyleContext';
import { findPage } from '../../pages/settings/registry';
import SettingsMenu from './SettingsMenu';

export default function SettingsShell() {
  const { navStyle } = useNavStyle();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  // Below the fixed top bar (52px) or beside the compact sidebar.
  const top = navStyle === 'sidebar' ? 16 : 68;
  const here = findPage(pathname)?.name || 'Settings home';

  return (
    <div className="flex gap-6 lg:gap-8">
      <aside aria-label="Settings menu" className="hidden w-[232px] flex-shrink-0 md:block">
        <div className="sticky overflow-y-auto rounded-md border p-2.5"
          style={{ top, maxHeight: `calc(100vh - ${top + 16}px)`, backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)' }}>
          <SettingsMenu />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <button type="button" aria-label={`Settings menu: ${here}`} onClick={() => setOpen(true)}
          className="mb-4 flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium md:hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
          <span>Settings · {here}</span><IconChevronDown size={16} />
        </button>
        <Outlet />
      </div>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Settings menu" className="fixed inset-0 z-50 overflow-y-auto p-4 md:hidden"
          style={{ backgroundColor: 'var(--color-bg)' }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold">Settings</p>
            <button type="button" aria-label="Close the settings menu" onClick={() => setOpen(false)}><IconX size={20} /></button>
          </div>
          <SettingsMenu onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Generate the Settings routes from the registry**

In `frontend/src/App.jsx`:

1. Import `SettingsShell`, `{ allRoutes, REDIRECTS }` from `./pages/settings/registry`, and `Navigate` (already imported).
2. Add the component map and guard above `export default function App()`:

```jsx
// Which component each registry page (and sub-page) renders. The registry
// holds its access; settingsElement turns that into the same guards as
// before the redesign (spec: Settings redesign, "One source of truth").
const SETTINGS_COMPONENTS = {
  preferences: SettingsPreferences, about: SettingsAbout, company: CompanyProfile,
  companies: () => <CompaniesList inSettings />,
  users: AdminUsers, 'user-detail': UserDetail, teams: SettingsTeams, departments: AdminDepartments,
  roles: AdminRoles, 'role-new': RoleEditor, 'role-edit': RoleEditor, 'api-keys': AdminApiKeys,
  statuses: SettingsStatuses, 'custom-fields': SettingsLayouts, blueprints: AdminBlueprints,
  'assignment-rules': AssignmentRules, 'workflow-rules': WorkflowRules,
  'workflow-rule-new': WorkflowRuleEditor, 'workflow-rule-edit': WorkflowRuleEditor,
  notifications: SettingsNotifications, 'customer-happiness': CustomerHappiness,
  slas: SLAs, 'business-hours': SettingsBusinessHours, holidays: SettingsHolidays,
  'time-tracking': SettingsTimeTracking, 'work-types': SettingsWorkTypes,
  'asset-categories': SettingsAssetCategories, 'asset-alerts': SettingsAssetAlerts,
  'single-sign-on': SettingsSingleSignOn, directory: SettingsDirectory, 'directory-sync': DirectorySync,
  'incoming-email': SettingsIncomingEmail, 'outgoing-email': SettingsOutgoingEmail, 'email-log': EmailLog,
  calendar: CalendarIntegration, modules: SettingsModules, schedules: Schedules, import: SettingsImport,
  export: SettingsExport, 'audit-log': AuditLog, system: SettingsSystemInfo,
};

function settingsElement(id, access) {
  const Component = SETTINGS_COMPONENTS[id];
  const page = access.owner ? <OwnerOnly><Component /></OwnerOnly> : <Component />;
  return access.roles || access.permission
    ? <ProtectedRoute roles={access.roles} permission={access.permission}>{page}</ProtectedRoute>
    : page;
}
```

3. Delete every hand-written Settings route (from `{/* Settings hub + sections */}` through `/settings/calendar-integration`, the `/admin/*` settings routes, `/settings/companies`, the placeholder routes, and the routes added in Tasks 3–4), and put in their place, inside the `Layout` route:

```jsx
<Route element={<SettingsShell />}>
  <Route path="/settings" element={<SettingsHub />} />
  {allRoutes().map((r) => <Route key={r.path} path={r.path} element={settingsElement(r.id, r.access)} />)}
  {REDIRECTS.map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
</Route>
```

4. Remove imports and `*_KEYS` constants that are now unused (`Placeholder`, `IconMail`, `IconBolt`, `IconShieldCheck`, `IconTrash` if only the placeholders used them, `BRANDING_KEYS`, `BUSINESS_HOURS_KEYS`, `STATUSES_KEYS`, `TEAMS_KEYS`, `DEPARTMENTS_KEYS`, `ROLES_KEYS`, `USERS_KEYS`, `AUDIT_LOG_KEYS`, and `owner`/`admin` helpers if unused; keep `SYSTEM_KEYS` only if still referenced). `git rm frontend/src/pages/settings/Placeholder.jsx`.

- [ ] **Step 5: Build, unit tests, smoke**

Run: `cd frontend && npm test && npx vite build 2>&1 | tail -1` → Expected: 8 pass; `✓ built`.
Run: `cd backend && npm run test:smoke -- "settings.smoke|owner.smoke|companies.shell|users.accounts|companies.settings|work.settings|companies.departments"`
Expected: PASS. (A failure in an older smoke test from a heading or link now inside the menu is fixed by scoping its selector to the page, for example `page.getByRole('main')`, never by weakening what it checks.)

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src backend/test/smoke
git commit -m "feat(settings): Settings menu with search, built with the routes from one registry"
```

---

### Task 6: Settings home

**Files:**
- Create: `frontend/src/pages/settings/SettingsHome.jsx`
- Delete: `frontend/src/pages/SettingsHub.jsx`
- Modify: `frontend/src/App.jsx` (`/settings` → `SettingsHome`), `frontend/src/components/Layout.jsx` (remove the `SETTINGS_SCROLL_KEY` import, `isSettingsArea` and its effect)
- Test: `backend/test/smoke/settings.smoke.js`

**Interfaces:**
- Consumes: `visibleGroups`, `searchPages` (Task 2); `GET /settings/status` (Task 1).
- Produces: the overview at `/settings`.

- [ ] **Step 1: Write the failing smoke test**

```js
describe('Settings home', () => {
  it('lists the groups, searches, and shows status hints to an owner only', async () => {
    let page = await smoke.pageAs('admin');
    await page.goto('/settings');
    const main = page.getByRole('main');
    await main.getByRole('heading', { level: 1, name: 'Settings' }).waitFor();
    await main.getByRole('heading', { name: 'Hours & SLAs' }).waitFor();
    await main.getByText('Not set up').first().waitFor(); // outgoing email in a fresh install
    await main.getByLabel('Find a setting').fill('sla');
    await main.getByRole('link', { name: /SLAs/ }).first().waitFor();
    page = await smoke.pageAs('sysadmin2');
    await page.goto('/settings');
    await page.getByRole('main').getByRole('heading', { name: 'Time & work' }).waitFor();
    expect(await page.getByRole('main').getByText('Not set up').count()).toBe(0);
  });
});
```

(`sysadmin2` is created in Task 5's first menu test, which runs earlier in the file.)

Run: `cd backend && npm run test:smoke -- settings.smoke` → Expected: FAIL (no "Hours & SLAs" heading on the old hub).

- [ ] **Step 2: Write Settings home**

```jsx
// frontend/src/pages/settings/SettingsHome.jsx
// The Settings overview (spec: Settings redesign): every group the user may
// open with its pages, a search, and — for owners — whether sign-in and
// email are set up (GET /settings/status: booleans and counts only).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { searchPages, visibleGroups } from './registry';

const HINT = { ok: { color: 'var(--color-success)' }, warn: { color: 'var(--color-warning)' }, off: { color: 'var(--color-text-muted)' } };

function hintsFrom(s) {
  if (!s) return {};
  const dir = s.directory.connected ? ['ok', 'Connected'] : s.directory.configured ? ['warn', 'Not tested'] : ['off', 'Not set up'];
  return {
    directory: dir,
    'incoming-email': s.incomingEmail.enabled ? ['ok', 'On'] : ['off', 'Off'],
    'outgoing-email': s.outgoingEmail.configured ? ['ok', 'Set up'] : ['warn', 'Not set up'],
    'single-sign-on': s.singleSignOn.enabled ? ['ok', `${s.singleSignOn.enabled} on`] : ['off', 'Off'],
  };
}

function VersionFooter() {
  const [info, setInfo] = useState(null);
  useEffect(() => { api.get('/version').then(({ data }) => setInfo(data)).catch(() => {}); }, []);
  if (!info) return null;
  return (
    <p className="border-t border-navy-100 pt-4 font-mono text-xs text-navy-400">
      PRISM {info.version}
      {info.gitSha !== 'unknown' && <> · {info.gitSha}</>}
      {/* An untagged build says so, so a dev image is never taken for a release. */}
      {!info.release && <> · unreleased build</>}
      {' · '}<Link to="/settings/about" className="hover:text-prism hover:underline">About</Link>
    </p>
  );
}

export default function SettingsHome() {
  const { user, isOwner, hasAnyPermission } = useAuth();
  const groups = useMemo(() => visibleGroups({ role: user?.role, isOwner, hasAnyPermission }), [user, isOwner, hasAnyPermission]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!isOwner) return;
    api.get('/settings/status').then(({ data }) => setStatus(data)).catch(() => {});
  }, [isOwner]);
  const hints = hintsFrom(status);
  const matches = searchPages(query, groups.flatMap((g) => g.pages));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-navy-500">Set up PRISM for your organization.</p>
      </header>
      <input type="search" className="input max-w-md" aria-label="Find a setting" placeholder='Find a setting — try "SLA", "logo" or "password"'
        value={query} onChange={(e) => setQuery(e.target.value)} />
      {query.trim() ? (
        <ul className="max-w-md space-y-1">
          {matches.length ? matches.map((p) => (
            <li key={p.id}><Link to={p.path} className="block rounded-md px-2 py-1.5 hover:bg-[var(--color-hover)]">
              <span className="font-medium text-prism">{p.name}</span> <span className="text-sm text-navy-400">· {p.group} · {p.desc}</span>
            </Link></li>
          )) : <li className="text-sm text-navy-400">No settings match</li>}
        </ul>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h2 className="eyebrow mb-2">{g.name}</h2>
              <ul>
                {g.pages.map((p) => (
                  <li key={p.id} className="border-b border-dashed" style={{ borderColor: 'var(--color-border)' }}>
                    <Link to={p.path} className="flex items-baseline justify-between gap-3 py-1.5">
                      <span className="min-w-0">
                        <span className="font-medium text-prism hover:underline">{p.name}</span>
                        <span className="block truncate text-xs text-navy-400">{p.desc}</span>
                      </span>
                      {hints[p.id] && <span className="flex-shrink-0 font-mono text-[11px] font-semibold" style={HINT[hints[p.id][0]]}>{hints[p.id][1]}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <VersionFooter />
    </div>
  );
}
```

Note: the group headings are `h2` with class `eyebrow`, so the test's `getByRole('heading', { name: 'Hours & SLAs' })` finds them.

- [ ] **Step 3: Wire it, remove the hub**

In `App.jsx`: replace `import SettingsHub …` with `import SettingsHome from './pages/settings/SettingsHome';` and `<Route path="/settings" element={<SettingsHub />} />` with `<Route path="/settings" element={<SettingsHome />} />`. `git rm frontend/src/pages/SettingsHub.jsx`. In `Layout.jsx`, delete the `SETTINGS_SCROLL_KEY` import, `isSettingsArea`, the `useEffect` that clears it, and the now-unused `useEffect`/`useLocation` imports. The menu replaces the hub's scroll restore: there is no long hub to return to.

- [ ] **Step 4: Build and run**

Run: `cd frontend && npx vite build 2>&1 | tail -1` → `✓ built`
Run: `cd backend && npm run test:smoke -- "settings.smoke|companies.shell|owner.smoke"` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src backend/test/smoke
git commit -m "feat(settings): Settings home lists every group, searches, and shows owners what is set up"
```

---

### Task 7: Pages into the frame — You, Organization, People & access

**Files (modify):** `pages/settings/Preferences.jsx`, `pages/settings/About.jsx`, `pages/companies/CompaniesList.jsx`, `pages/AdminUsers.jsx`, `pages/UserDetail.jsx`, `pages/settings/Teams.jsx`, `pages/AdminDepartments.jsx`, `pages/AdminRoles.jsx`, `pages/RoleEditor.jsx`, `pages/AdminApiKeys.jsx`
**Test:** `backend/test/smoke/settings.smoke.js`

**Interfaces:**
- Consumes: `SettingsPage` (Task 3).

**The conversion (same for every page in Tasks 7–9):** the page's outer wrapper, its `← Back to Settings` link, its `h1` and its description paragraph become one `SettingsPage`; anything that sat on the title's line (a "New …" button, a Save button) moves to `actions`. Title and description come from the registry, so pass neither unless the table says so. Example, `AdminDepartments.jsx`:

```jsx
// before
<div className="space-y-5">
  <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
  <div className="flex items-center justify-between">
    <h1 className="text-2xl font-bold tracking-tight text-navy-900">Departments</h1>
    <button className="btn-primary" onClick={() => setEditing('new')}>+ New department</button>
  </div>
  {/* … the rest … */}
</div>

// after
<SettingsPage actions={<button className="btn-primary" onClick={() => setEditing('new')}>+ New department</button>}>
  {/* … the rest, unchanged … */}
</SettingsPage>
```

Remove the `Link` import where it becomes unused. Do not change the page's behaviour, fields or calls.

| File | Notes |
|---|---|
| `Preferences.jsx` | Its cards stay. |
| `About.jsx` | — |
| `CompaniesList.jsx` | Only when `inSettings`: wrap in `SettingsPage` with `title="Companies & vendors"`; the `/companies` page keeps its own header. |
| `AdminUsers.jsx` | "New local account" and similar header buttons → `actions`. |
| `UserDetail.jsx` | `title={user.displayName}` and `description={user.username}`; the breadcrumb shows People & access (findPage matches `/admin/users/:id`). Keep its tabs and the owner/read-only notices under the header. |
| `Teams.jsx` | — |
| `AdminDepartments.jsx` | as above |
| `AdminRoles.jsx` | "New role" → `actions` |
| `RoleEditor.jsx` | `title={isNew ? 'New role' : role.name}`; Save → `actions` only if it sits in the header today. |
| `AdminApiKeys.jsx` | — |

- [ ] **Step 1: Write the failing smoke test**

```js
describe('every page uses the Settings frame', () => {
  const framed = async (page, path, title) => {
    await page.goto(path);
    const main = page.getByRole('main');
    await main.getByRole('navigation', { name: 'Breadcrumb' }).waitFor();
    await main.getByRole('heading', { level: 1, name: title }).waitFor();
    expect([path, await page.getByText('Back to Settings').count()]).toEqual([path, 0]);
  };
  it('You, Organization, People & access', async () => {
    const page = await smoke.pageAs('admin');
    for (const [path, title] of [
      ['/settings/preferences', 'Preferences'], ['/settings/about', 'About PRISM'], ['/settings/companies', 'Companies & vendors'],
      ['/admin/users', 'Users'], ['/settings/teams', 'Teams'], ['/admin/departments', 'Departments'],
      ['/admin/roles', 'Roles & permissions'], ['/admin/roles/new', 'New role'], ['/admin/apikeys', 'API keys'],
    ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
  });
});
```

(`framed` is shared by Tasks 8 and 9's tests: define it once at the top of the `describe`.)

Run: `cd backend && npm run test:smoke -- settings.smoke` → Expected: FAIL (no breadcrumb on Preferences).

- [ ] **Step 2: Convert the pages** (table above).

- [ ] **Step 3: Build and run**

Run: `cd frontend && npx vite build 2>&1 | tail -1` → `✓ built`
Run: `cd backend && npm run test:smoke -- "settings.smoke|users.accounts|companies.settings|companies.departments|owner.smoke"` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src backend/test/smoke
git commit -m "feat(settings): You, Organization and People & access pages in the Settings frame"
```

---

### Task 8: Pages into the frame — Service desk, Hours & SLAs

**Files (modify):** `pages/settings/Statuses.jsx`, `Layouts.jsx`, `pages/AdminBlueprints.jsx`, `pages/settings/AssignmentRules.jsx`, `WorkflowRules.jsx`, `WorkflowRuleEditor.jsx`, `Notifications.jsx`, `CustomerHappiness.jsx`, `SLAs.jsx`, `BusinessHours.jsx`, `Holidays.jsx`
**Test:** `backend/test/smoke/settings.smoke.js`

**Interfaces:** Consumes `SettingsPage`, `SettingsPanel`, `SaveBar`, `isDirty` (Task 3).

Use the conversion described in Task 7. In addition, **Notifications** and **Customer happiness** end with the save bar: keep a `snapshot` of the loaded form (set after load and after a successful save), pass `dirty={isDirty(form, snapshot)}`, `saving`, `saved` (set true after a save, false on any change) to `<SaveBar>`, and remove the page's old Save button and "Saved" text. Wrap the page's sections in `SettingsPanel`s where they are `card` blocks with an `h2` (title = that `h2`'s text).

| File | Notes |
|---|---|
| `Statuses.jsx` | Its four tabs stay below the header. |
| `Layouts.jsx` | registry title "Custom fields"; "New field" → `actions`. |
| `AdminBlueprints.jsx` | registry title "Ticket templates"; "New blueprint" → `actions`. |
| `AssignmentRules.jsx`, `SLAs.jsx`, `BusinessHours.jsx`, `Holidays.jsx` | "New …" → `actions`. |
| `WorkflowRules.jsx` | "New rule" → `actions`. |
| `WorkflowRuleEditor.jsx` | `title={isNew ? 'New workflow rule' : rule.name}`. |
| `Notifications.jsx`, `CustomerHappiness.jsx` | save bar (above). |

- [ ] **Step 1: Write the failing smoke test** (inside the `describe` from Task 7)

```js
it('Service desk, Hours & SLAs', async () => {
  const page = await smoke.pageAs('admin');
  for (const [path, title] of [
    ['/settings/statuses', 'Statuses'], ['/settings/layouts', 'Custom fields'], ['/admin/blueprints', 'Ticket templates'],
    ['/settings/assignment-rules', 'Assignment rules'], ['/settings/workflow-rules', 'Workflow rules'],
    ['/settings/workflow-rules/new', 'New workflow rule'], ['/settings/notifications', 'Notifications'],
    ['/settings/customer-happiness', 'Customer happiness'], ['/settings/slas', 'SLAs'],
    ['/settings/business-hours', 'Business hours'], ['/settings/holidays', 'Holidays'],
  ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
});

it('Notifications says when there are unsaved changes, then that they were saved', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/notifications');
  await page.getByRole('main').getByRole('checkbox').first().click();
  await shown(page, 'Unsaved changes').waitFor();
  await page.getByRole('button', { name: 'Save' }).click();
  await shown(page, 'Saved').waitFor();
});
```

Run → Expected: FAIL. Convert, build, then run `npm run test:smoke -- "settings.smoke|work.settings"` → Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add -A frontend/src backend/test/smoke
git commit -m "feat(settings): Service desk and Hours & SLAs pages in the Settings frame"
```

---

### Task 9: Pages into the frame — Time & work, Assets, Sign-in & email, System; every page opens

**Files (modify):** `pages/settings/TimeTracking.jsx`, `WorkTypes.jsx`, `AssetCategories.jsx`, `AssetAlerts.jsx`, `SingleSignOn.jsx`, `DirectorySync.jsx`, `EmailLog.jsx`, `CalendarIntegration.jsx`, `Modules.jsx`, `Schedules.jsx`, `Import.jsx`, `Export.jsx`, `AuditLog.jsx`
**Test:** `backend/test/smoke/settings.smoke.js`

**Interfaces:** Consumes `SettingsPage`, `SettingsPanel`, `SettingsRow`, `SaveBar`, `isDirty` (Task 3).

Use the conversion described in Task 7. **Time tracking** and **Expiry alerts** (`AssetAlerts.jsx`) get the save bar, as described in Task 8, and Time tracking's four settings become `SettingsRow`s in one `SettingsPanel` titled "Timer" (mode, minimum, longest entry) and one titled "Closing tickets" (require time). `EmailLog.jsx` keeps its table; `wide` comes from the registry.

- [ ] **Step 1: Write the failing smoke tests** (inside the `describe` from Task 7)

```js
it('Time & work, Assets, Sign-in & email, System', async () => {
  const page = await smoke.pageAs('admin');
  for (const [path, title] of [
    ['/settings/time-tracking', 'Time tracking'], ['/settings/work-types', 'Work types'],
    ['/settings/asset-categories', 'Asset categories'], ['/settings/asset-alerts', 'Expiry alerts'],
    ['/settings/single-sign-on', 'Single sign-on'], ['/settings/directory', 'Directory (AD/LDAP)'],
    ['/settings/directory-sync', 'Directory sync'], ['/settings/incoming-email', 'Incoming email'],
    ['/settings/outgoing-email', 'Outgoing email'], ['/settings/email-log', 'Email log'],
    ['/settings/calendar-integration', 'Calendar'], ['/settings/modules', 'Modules & tabs'],
    ['/settings/schedules', 'Background jobs'], ['/settings/import', 'Import'], ['/settings/export', 'Export'],
    ['/settings/audit-log', 'Audit log'], ['/settings/system', 'System info'], ['/settings/company', 'Company profile'],
  ]) await framed(page, path, title); // eslint-disable-line no-await-in-loop
});

it('every menu page opens for an owner (no page is missing from the component map)', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/preferences');
  const links = await page.getByRole('complementary', { name: 'Settings menu' }).getByRole('link').evaluateAll(
    (as) => as.map((a) => [a.getAttribute('href'), a.textContent.trim()]),
  );
  expect(links.length).toBeGreaterThan(35);
  for (const [href, name] of links.filter(([h]) => h !== '/settings')) {
    await page.goto(href); // eslint-disable-line no-await-in-loop
    await page.getByRole('main').getByRole('heading', { level: 1, name }).waitFor(); // eslint-disable-line no-await-in-loop
  }
});

it('Time tracking says when there are unsaved changes, then that they were saved', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/time-tracking');
  await page.getByLabel('Longest time entry').selectOption('10');
  await shown(page, 'Unsaved changes').waitFor();
  await page.getByRole('button', { name: 'Save' }).click();
  await shown(page, 'Saved').waitFor();
  expect(await setting('timeTracking.maxEntryHours')).toBe('10');
});
```

Run → Expected: FAIL. Convert, build, then run `npm run test:smoke -- settings.smoke` → Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add -A frontend/src backend/test/smoke
git commit -m "feat(settings): remaining pages in the Settings frame; every menu page opens"
```

---

### Task 10: Notes, and the whole suite

**Files:** `UPGRADING.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Release notes** — under `## Unreleased` in `UPGRADING.md`, add a section `### Settings, reorganized` saying, in the file's plain style:
  - Settings has its own menu down the left, with search; under 768px it is behind a "Settings" button. Opening Settings shows every group, and owners see whether the directory, incoming and outgoing email and single sign-on are set up.
  - The new groups (list them), and that who may open each page is unchanged.
  - Company and Branding are one page, Company profile; `/settings/branding` opens it.
  - General Settings is now Directory (AD/LDAP), Incoming email, Outgoing email and System info; the time zone is set on Company profile only; `/admin/settings` opens Settings.
  - Email templates, Macros, Supervisor rules and Recycle bin are hidden until they're built; their addresses open Settings.
  - New: `GET /settings/status` (owner only; booleans and counts).
- [ ] **Step 2: Roadmap** — add to Phase 1's **Testing feedback**: `- Settings (2026-10-12): one menu with search, regrouped pages, one page layout ([spec](superpowers/specs/2026-10-12-settings-redesign-design.md), [plan](superpowers/plans/2026-10-12-settings-redesign.md)).`
- [ ] **Step 3: Everything**

Run: `cd frontend && npm test && npx vite build 2>&1 | tail -1` → 8 pass; `✓ built`.
Run: `cd backend && npm test` (≈12 minutes) → Expected: all suites pass.
Run: `cd backend && npm run test:smoke` → Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add UPGRADING.md docs/ROADMAP.md
git commit -m "docs: Settings reorganized — release notes and roadmap"
```
