# The Owner Role Implementation Plan

> **Status: shipped** (see `docs/ROADMAP.md`). The checkboxes below were not ticked as the work went; they don't mean the steps are undone.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an **Owner** above System Administrator, so that one rogue System Administrator can't take over the system.
- Only Owners create System Administrators or other Owners, and only Owners change an administrator's account.
- Only Owners change the identity, sign-in, mail and integration settings.
- There can be several Owners, and always at least one.

**Architecture:**
- **The Owner role:** a locked system role. Permission resolution treats it as holding every permission, now and in future, ignoring overrides. It reaches every company.
- **Shared checks:** one service, `services/ownership.js`, answers "is this user an Owner / an administrator" and guards the owner-only actions. It is used by the role-grant service, the user-account controllers, and a `requireOwner` route middleware.
- **Who becomes Owner:** a migration creates the role and makes the oldest active administrator account the Owner. On a fresh install, that is the bootstrap account created at setup.

**Tech Stack:** Express 4, Sequelize 6, MariaDB 11, Jest 30 + supertest; React/Vite; the Playwright smoke suite. No new dependencies.

**Spec:** user decisions in conversation, 2026-10-11 (no separate spec document):
- the Owner is the top role and has every permission;
- the Owner is usually the first account created at setup;
- only the Owner creates System Administrators;
- System Administrators change only the roles and permissions of roles beneath them;
- there may be several Owners;
- the system-wide settings a rogue administrator could abuse are Owner-only too.

## Global Constraints

- **Owner-only:**
  - granting or removing the **Owner** or **System Administrator** role, including through the legacy `role: 'admin'` field and a department's default role;
  - any change to an Owner's or System Administrator's account: roles, permission overrides, company access, the legacy role, department, password reset, profile edits by someone else, and deletion;
  - the settings in **Owner-only settings** below.
- **System Administrators** keep everything else: every other setting, and every role and account below them.
- **Nobody, Owner included, changes their own roles or permissions** (existing rule).
- **At least one active Owner** always remains:
  - the last Owner's Owner role can't be removed;
  - the last Owner can't be deleted.
- **Owner-only settings** (identity, sign-in, mail and integration secrets — each a route to taking over accounts or reading mail):
  - single sign-on (`/sso-admin/*`), including its role mappings;
  - LDAP (`/settings/ldap*`);
  - directory sync (`/ad-sync/*`), including group-to-role mappings;
  - inbound email and SMTP (`/settings/inbound-email*`, `/settings/smtp*`);
  - the calendar integration secrets (`integrations.*` keys in `PUT/PATCH /settings`).
- **Errors:** `403 OWNER_ONLY` with a sentence saying what needs an Owner.
- **Commits:** explicit paths, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only when the user says so.

## Review Focus

1. **The upgrade picks the wrong Owner, or none.** It should pick the oldest *active* administrator, by account id. With no administrator at all, there is no Owner, and the first administrator the bootstrap creates later becomes one. *(Task 1 test: an inactive older admin is skipped.)*
2. **Locking out the last Owner:** removing the Owner role from, or deleting, the only active Owner. *(Task 2 test.)*
3. **An administrator escalating sideways:**
   - assigning System Administrator or Owner through *any* path: role assignment, the legacy `role: 'admin'` on create or update, or a department's default role;
   - mapping an SSO or directory group to a role. *(Tasks 2 and 3 tests.)*
4. **Owner deny overrides.** An Owner "has every permission", so a deny override on an Owner must not take anything away. *(Task 1 test.)*
5. **Fenced Owners:** an Owner always reaches every company, and company access for an Owner can't be narrowed. *(Task 1 test.)*

---

### Task 1: The Owner role exists, holds everything, and the oldest administrator becomes Owner

**Files:**
- Create: `backend/migrations/20260101000055-owner-role.js`, `backend/src/services/ownership.js`, `backend/test/integration/owner.role.test.js`
- Modify: `backend/src/services/permissionService.js` (`resolveUserPermissions`, `isUnfenceable`), `backend/src/controllers/authController.js` (`isOwner` on the session user), `backend/test/integration/helpers.js` (`ROLE.OWNER`, and the test admin made an Owner)

**Interfaces:**
- **Produces:**
  - `ownership.OWNER = 'Owner'`;
  - `ownership.isOwner(user): Promise<boolean>`;
  - `ownership.isAdministrator(user): Promise<boolean>` — an Owner or a System Administrator;
  - `ownership.assertOwner(actor, what)` — throws 403 `OWNER_ONLY` with `` `${what} needs an Owner` ``;
  - `ownership.requireOwner(what)` — Express middleware.

- [ ] **Step 1: Failing test**

`backend/test/integration/owner.role.test.js`:

```js
const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const { API, expectOk, makeWorld, makeUser } = require('./fixtures');
const migration = require('../../migrations/20260101000055-owner-role');

// The Owner (user decision 2026-10-11): the top role, every permission, every
// company; on upgrade the oldest active administrator becomes the Owner.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

const ownerRole = () => models.Role.findOne({ where: { name: 'Owner', isSystemRole: true } });

it('the Owner role holds every permission, even against a deny override, and reaches every company', async () => {
  const me = expectOk(await w.admin.agent.get(`${API}/auth/me`)).user;
  expect(me.isOwner).toBe(true);
  const owner = w.admin.user;
  await models.UserPermissionOverride.create({ userId: owner.id, permissionKey: 'tickets.view_all', granted: false });
  require('../../src/services/permissionService').invalidateAllPermissions(); // eslint-disable-line global-require
  const perms = await require('../../src/services/permissionService').resolveUserPermissions(owner.id); // eslint-disable-line global-require
  expect(Object.values(perms).every(Boolean)).toBe(true);
  const access = expectOk(await w.admin.agent.get(`${API}/users/${owner.id}/company-access`)).access;
  expect(access.unfenceable).toBe(true);
});

it('the migration makes the oldest active administrator the Owner, and round-trips', async () => {
  const qi = sequelize.getQueryInterface();
  await migration.down(qi, Sequelize);
  expect(await ownerRole()).toBeNull();
  // An older administrator who is inactive is skipped.
  const older = await makeUser('olderadmin', 'System Administrator', w.deptA.id);
  await models.User.update({ isActive: false }, { where: { id: older.user.id } });
  await models.User.update({ id: 0 }, { where: { id: -1 } }); // no-op; ids are as created
  await migration.up(qi, Sequelize);
  const role = await ownerRole();
  const holders = (await models.UserRole.findAll({ where: { roleId: role.id } })).map((r) => r.userId);
  const admins = await models.User.findAll({ where: { isActive: true }, order: [['id', 'ASC']] });
  const firstAdmin = admins.find((u) => u.role === 'admin');
  expect(holders).toEqual([firstAdmin.id]);
});
```

`makeUser(username, roleName, deptId)` exists in `fixtures.js`. If `'System Administrator'` isn't accepted as a role name there, create the user with `models.User.create` + `models.UserRole.create`, and record a ruling. Remove the no-op line once the test is green; it is a leftover from drafting.

In `helpers.js`, the test world's admin (`makeAdmin`) must end up an Owner: after the admin user is created, add a `UserRole` row for the Owner role (look the role up by name). That mirrors a fresh install, where the bootstrap admin becomes the Owner.

- [ ] **Step 2: Run it (fails: no Owner role)**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/owner.role.test.js`

- [ ] **Step 3: The migration**

`backend/migrations/20260101000055-owner-role.js`:

```js
'use strict';

// The Owner (user decision 2026-10-11): a locked role above System
// Administrator. Only Owners make System Administrators or Owners, change an
// administrator's account, or change sign-in, mail and integration settings,
// so one rogue System Administrator can't take the system over. An Owner holds
// every permission (permissionService treats the role so; the grants here
// keep listings honest). The oldest active administrator becomes the Owner:
// on a fresh install, the bootstrap account created at setup.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      let [role] = await select("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", {}, t);
      if (!role) {
        await queryInterface.bulkInsert('Roles', [{
          name: 'Owner',
          description: 'Owns this PRISM: every permission, and the only one who can make System Administrators or change their accounts and the sign-in, mail and integration settings.',
          isSystemRole: true, scope: 'system', createdAt: new Date(), updatedAt: new Date(),
        }], { transaction: t });
        [role] = await select("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", {}, t);
      }
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT :roleId, p.id, 1 FROM Permissions p
        WHERE NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = :roleId AND x.permissionId = p.id)`,
      { replacements: { roleId: role.id }, transaction: t });
      const [hasOwner] = await select('SELECT userId FROM UserRoles WHERE roleId = :roleId LIMIT 1', { roleId: role.id }, t);
      if (!hasOwner) {
        const [first] = await select(`SELECT u.id FROM Users u
          WHERE u.isActive = 1 AND (u.role = 'admin'
            OR u.roleId IN (SELECT id FROM Roles WHERE name = 'System Administrator' AND isSystemRole = 1)
            OR EXISTS (SELECT 1 FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
                       WHERE ur.userId = u.id AND r.name = 'System Administrator' AND r.isSystemRole = 1))
          ORDER BY u.id ASC LIMIT 1`, {}, t);
        if (first) {
          await queryInterface.bulkInsert('UserRoles', [{ userId: first.id, roleId: role.id, createdAt: new Date() }], { transaction: t });
        }
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    const db = queryInterface.sequelize;
    const [role] = await db.query("SELECT id FROM Roles WHERE name = 'Owner' AND isSystemRole = 1", { type: Sequelize.QueryTypes.SELECT });
    if (!role) return;
    await db.transaction(async (t) => {
      await db.query('DELETE FROM UserRoles WHERE roleId = :id', { replacements: { id: role.id }, transaction: t });
      await db.query('DELETE FROM RolePermissions WHERE roleId = :id', { replacements: { id: role.id }, transaction: t });
      await db.query('UPDATE Users SET roleId = NULL WHERE roleId = :id', { replacements: { id: role.id }, transaction: t });
      await db.query('DELETE FROM Roles WHERE id = :id', { replacements: { id: role.id }, transaction: t });
    });
  },
};
```

Check the `Roles` and `UserRoles` columns (`scope`, `departmentId`, `createdAt`/`updatedAt`) with `DESCRIBE`, by reading the model files, before trusting this insert. Adjust the inserted column list to match, and record a ruling.

- [ ] **Step 4: `services/ownership.js`**

```js
// The Owner (user decision 2026-10-11): the top role. One rogue System
// Administrator can't make administrators, change an administrator's account,
// or change sign-in, mail and integration settings — those need an Owner.
const { Role, UserRole } = require('../models');
const { ApiError } = require('../middleware/error');

const OWNER = 'Owner';
const SYSTEM_ADMIN = 'System Administrator';

async function holdsSystemRole(user, name) {
  const role = await Role.findOne({ where: { name, isSystemRole: true }, attributes: ['id'] });
  if (!role) return false;
  if (user.roleId === role.id) return true;
  return !!(await UserRole.findOne({ where: { userId: user.id, roleId: role.id }, attributes: ['userId'] }));
}

const isOwner = (user) => holdsSystemRole(user, OWNER);

// An Owner or a System Administrator (the legacy 'admin' role included).
async function isAdministrator(user) {
  return user.role === 'admin' || (await isOwner(user)) || holdsSystemRole(user, SYSTEM_ADMIN);
}

async function assertOwner(actor, what) {
  if (!(await isOwner(actor))) throw new ApiError(403, `${what} needs an Owner`, 'OWNER_ONLY');
}

// Express middleware: the route needs an Owner.
function requireOwner(what) {
  return async (req, res, next) => {
    try {
      await assertOwner(req.user, what);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  OWNER, SYSTEM_ADMIN, isOwner, isAdministrator, assertOwner, requireOwner,
};
```

- [ ] **Step 5: Permissions and fences**

- `permissionService.resolveUserPermissions`: after collecting `roleIds`, look up the Owner role id (`Role.findOne({ where: { name: 'Owner', isSystemRole: true } })`). If the user holds it, every key is `true`; skip the overrides and cache.
- `isUnfenceable(user)`: true also for an Owner. Use the same `UserRole` / `roleId` lookup, inline, since `ownership.js` requires models and `permissionService` is required by many modules. Keep `permissionService` free of a require cycle: do not require `ownership.js` from it.
- `authController`'s session-user shape gains `isOwner: await isOwner(user)`, next to `canLogTimeForOthers`.

- [ ] **Step 6: Migrate the test database and run the tests (pass); then the role, user and company suites**

Run: `cd backend && (set -a; . ./.env.test; set +a; npm run test:migrate) && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/owner.role.test.js test/integration/users.escalation.test.js test/integration/companies.access.test.js test/integration/authorization.test.js`

- [ ] **Step 7: Commit**

---

### Task 2: Only Owners make administrators or change an administrator's account; there's always an Owner

**Files:**
- Modify:
  - `backend/src/services/roleGrant.js`: granting the Owner or System Administrator role, or the legacy `admin`, needs an Owner;
  - `backend/src/controllers/userAccessController.js`: roles and overrides of an administrator need an Owner; the last Owner is kept;
  - `backend/src/controllers/companyAccessController.js` and `backend/src/controllers/usersController.js` (update, remove);
  - `backend/src/controllers/rolesController.js`: the Owner role is locked like System Administrator.
- Create test: `backend/test/integration/owner.guard.test.js`

- [ ] **Step 1: Failing test**

```js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeStaff } = require('./fixtures');

// Only Owners make System Administrators or Owners, or change an
// administrator's account; a System Administrator manages everything below.

let w;
let sysadmin;
let roles;
const roleId = (name) => roles.find((r) => r.name === name).id;
const ownerOnly = (what) => ({ error: true, message: `${what} needs an Owner`, code: 'OWNER_ONLY' });

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  sysadmin = await makeStaff('sysadmin', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${sysadmin.user.id}/roles`).send({ roleId: roleId('System Administrator') }), 201);
});
afterAll(closeDb);

it('a System Administrator can\'t make administrators or Owners, by any path', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  const a = sysadmin.agent;
  expect((await a.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Administrator') })).body)
    .toEqual(ownerOnly('Granting the System Administrator role'));
  expect((await a.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('Owner') })).body)
    .toEqual(ownerOnly('Granting the Owner role'));
  expect((await a.patch(`${API}/users/${staff.user.id}`).send({ role: 'admin' })).body)
    .toEqual(ownerOnly('Granting the System Administrator role'));
  expect((await a.patch(`${API}/departments/${w.deptA.id}`).send({ defaultRoleId: roleId('System Administrator') })).body)
    .toEqual(ownerOnly('Granting the System Administrator role'));
  // Below them, they manage freely.
  expect((await a.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('System Technician') })).status).toBeLessThan(300);
});

it('a System Administrator can\'t change another administrator\'s or an Owner\'s account', async () => {
  const other = await makeStaff('other', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${other.user.id}/roles`).send({ roleId: roleId('System Administrator') }), 201);
  const a = sysadmin.agent;
  const what = 'Changing an administrator\'s account';
  for (const target of [other.user.id, w.admin.user.id]) {
    for (const res of [
      // eslint-disable-next-line no-await-in-loop
      await a.post(`${API}/users/${target}/overrides`).send({ permissionKey: 'tickets.view_all', granted: false }),
      // eslint-disable-next-line no-await-in-loop
      await a.patch(`${API}/users/${target}`).send({ jobTitle: 'Demoted' }),
      // eslint-disable-next-line no-await-in-loop
      await a.put(`${API}/users/${target}/company-access`).send({ allCompanies: false, companyIds: [] }),
      // eslint-disable-next-line no-await-in-loop
      await a.delete(`${API}/users/${target}`),
    ]) {
      expect(res.body).toEqual(ownerOnly(what));
    }
  }
  expect((await a.delete(`${API}/users/${other.user.id}/roles/${roleId('System Administrator')}`)).body).toEqual(ownerOnly(what));
});

it('an Owner makes administrators and other Owners; the last Owner stays', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/roles`).send({ roleId: roleId('Owner') }), 201);
  // Two Owners: one can remove the other's Owner role.
  expectOk(await w.admin.agent.delete(`${API}/users/${staff.user.id}/roles/${roleId('Owner')}`));
  // Now one Owner is left; no one can take theirs away (and nobody changes their own).
  const owners = await models.UserRole.count({ where: { roleId: roleId('Owner') } });
  expect(owners).toBe(1);
  expect((await w.admin.agent.delete(`${API}/users/${w.admin.user.id}/roles/${roleId('Owner')}`)).status).toBe(403);
});

it('the Owner role can\'t be edited or deleted', async () => {
  expect((await w.admin.agent.patch(`${API}/roles/${roleId('Owner')}/permissions/tickets.view_all`).send({ granted: false })).status).toBe(400);
  expect((await w.admin.agent.delete(`${API}/roles/${roleId('Owner')}`)).status).toBeGreaterThanOrEqual(400);
});
```

`makeStaff` needs `people.manage_roles` etc. through the System Administrator role it is given. Since `resolveUserPermissions` caches, assigning the role must invalidate it; the role-assign endpoint already invalidates. Check the route verbs and paths used (`PATCH /departments/:id`, `PUT /users/:id/company-access`, `DELETE /users/:id/roles/:roleId`) against `routes/users.js` and `routes/departments.js`, and adjust.

- [ ] **Step 2: Run it (fails)**

- [ ] **Step 3: Implementation**

**`roleGrant.js`:**
- `assertCanGrantSystemAdmin(actor)` becomes `assertOwner(actor, 'Granting the System Administrator role')`.
- `assertCanGrantRole` also calls `assertOwner(actor, 'Granting the Owner role')` when `role.name === 'Owner'`.
- The legacy `assertCanSetLegacyRole(actor, 'admin')` path already goes through `assertCanGrantSystemAdmin`.
- `isUnfenceable` exemptions stay: Owners and System Administrators are both exempt from the "only what you hold" checks.

Add to `ownership.js`:

```js
// Changing someone's account when that someone is an administrator (an Owner
// or System Administrator) needs an Owner.
async function assertCanManageAccount(actor, target) {
  if (await isAdministrator(target)) await assertOwner(actor, 'Changing an administrator\'s account');
}

// Removing an Owner (their Owner role, or the account) must leave an active one.
async function assertKeepsAnOwner(targetUserId) {
  const role = await Role.findOne({ where: { name: OWNER, isSystemRole: true }, attributes: ['id'] });
  if (!role) return;
  const { User } = require('../models'); // eslint-disable-line global-require
  const others = await UserRole.count({
    where: { roleId: role.id, userId: { [require('sequelize').Op.ne]: targetUserId } }, // eslint-disable-line global-require
    include: [{ model: User, as: 'user', where: { isActive: true }, attributes: [] }],
  });
  if (!others) throw new ApiError(400, 'There must always be an Owner: make someone else an Owner first', 'LAST_OWNER');
}
```

Check the `UserRole` → `User` association alias in `models/index.js`. If none exists, count with a raw `SELECT COUNT(*) FROM UserRoles ur JOIN Users u ON u.id = ur.userId WHERE ur.roleId = :r AND ur.userId <> :t AND u.isActive = 1`.

Apply:
- **`userAccessController`:**
  - `assignRole`, `removeRole`, `createOverride`, `revokeOverride` call `await assertCanManageAccount(req.user, user)` right after loading the user;
  - `removeRole` of the Owner role also calls `assertKeepsAnOwner(user.id)`;
  - the existing "not your own" checks stay first.
- **`companyAccessController.putUserAccess`:** `assertCanManageAccount`.
- **`usersController.update`** (when not self) and **`remove`:** `assertCanManageAccount`. `remove` also calls `assertKeepsAnOwner(user.id)` if the target is an Owner. The existing password-reset message about System Administrators is replaced by the general check.
- **`rolesController`:** `isFullyLocked(role)` is true for the system roles named `System Administrator` **or** `Owner`. Check that `remove` refuses system roles; if not, refuse a locked role there too.

- [ ] **Step 4: Run (pass), then every role, user, company and escalation suite**

- [ ] **Step 5: Commit**

---

### Task 3: Sign-in, mail and integration settings are Owner-only

**Files:**
- Modify: `backend/src/routes/settings.js`, `backend/src/routes/ssoAdmin.js`, `backend/src/routes/adSync.js`, `backend/src/controllers/settingsController.js` (`integrations.*` keys)
- Create test: `backend/test/integration/owner.settings.test.js`

- [ ] **Step 1: Failing test**

```js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeStaff } = require('./fixtures');

// Sign-in, mail and integration settings need an Owner (user decision
// 2026-10-11): each is a way to take over accounts or read mail.

let w;
let sysadmin;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const roles = expectOk(await w.admin.agent.get(`${API}/roles`)).roles;
  sysadmin = await makeStaff('sysadmin', w.deptA.id);
  expectOk(await w.admin.agent.post(`${API}/users/${sysadmin.user.id}/roles`)
    .send({ roleId: roles.find((r) => r.name === 'System Administrator').id }), 201);
});
afterAll(closeDb);

it('a System Administrator is refused every Owner-only setting; an Owner is not', async () => {
  const calls = [
    ['get', '/sso-admin/providers'], ['get', '/settings/ldap'], ['patch', '/settings/ldap'],
    ['get', '/settings/smtp'], ['patch', '/settings/smtp'], ['get', '/settings/inbound-email'],
    ['get', '/ad-sync/settings'], ['post', '/ad-sync/group-mappings'],
  ];
  for (const [verb, path] of calls) {
    // eslint-disable-next-line no-await-in-loop
    const res = await sysadmin.agent[verb](`${API}${path}`).send({});
    expect([path, res.status, res.body.code]).toEqual([path, 403, 'OWNER_ONLY']);
  }
  expect((await w.admin.agent.get(`${API}/settings/ldap`)).status).toBe(200);
});

it('integration secrets in the general settings need an Owner; other settings do not', async () => {
  const refused = await sysadmin.agent.put(`${API}/settings`).send({ settings: { 'integrations.googleClientSecret': 'evil' } });
  expect([refused.status, refused.body.code]).toEqual([403, 'OWNER_ONLY']);
  expectOk(await sysadmin.agent.put(`${API}/settings`).send({ settings: { 'company.name': 'Acme' } }));
  expectOk(await w.admin.agent.put(`${API}/settings`).send({ settings: { 'integrations.googleClientId': 'mine' } }));
});
```

Check how `PATCH /settings` takes its body (`{ settings }` or a flat object) in `settingsController.patch`, and test the same key there.

- [ ] **Step 2: Run it (fails)**

- [ ] **Step 3: Implementation**

**`routes/settings.js`:**
- `const ownerOnly = requireOwner('Changing sign-in and mail settings');`
- Add `ownerOnly` after `manageSystem` on every `/ldap*`, `/inbound-email*`, `/smtp*` and `/email-log` route.

**`routes/ssoAdmin.js`:** `router.use(manageSystem, requireOwner('Single sign-on settings'))`.

**`routes/adSync.js`:** `router.use(manage, requireOwner('Directory sync settings'))`.

**`settingsController.update` / `patch`:** before saving:

```js
// Integration secrets (calendar OAuth apps) need an Owner (user decision 2026-10-11).
if (Object.keys(incoming).some((k) => k.startsWith('integrations.'))) {
  await assertOwner(req.user, 'Changing integration settings');
}
```

Here `incoming` is the key/value object each handler already reads.

- [ ] **Step 4: Run (pass), then the settings, SSO, LDAP and AD-sync suites**

- [ ] **Step 5: Commit**

---

### Task 4: The screens

**Files:**
- Modify:
  - `frontend/src/context/AuthContext.jsx`: `isOwner` from the session user;
  - `frontend/src/pages/SettingsHub.jsx` and `App.jsx`: Owner-only cards and routes;
  - `frontend/src/pages/UserDetail.jsx`: read-only for an administrator's account when the viewer isn't an Owner;
  - `frontend/src/pages/AdminUsers.jsx` / the roles list: an Owner badge.
- Create: `backend/test/smoke/owner.smoke.js`

**Steps:**
- A smoke test, failing first:
  - a System Administrator's Settings page has no Single sign-on, Directory/LDAP, Inbound email, Outbound email or Calendar integrations cards, and visiting `/settings/sso` directly shows "Only an Owner can change this";
  - an Owner sees them;
  - on an administrator's user page, a System Administrator sees "Only an Owner can change an administrator's account", with the role and override controls absent.
- `GET /users/:id` adds `administrator: boolean` (via `isAdministrator`), so the page knows.
- Implement, run the smoke test, commit.

### Task 5: Docs, whole suite, review

- **`UPGRADING.md`:** a section "**The Owner**", covering:
  - who becomes Owner on upgrade (the oldest active administrator account, usually the setup account);
  - what only Owners can do;
  - how to add a second Owner;
  - that there is always at least one Owner.
- **`docs/ROADMAP.md`:** a line under sub-project 3's notes, or the decisions table: "Owner role above System Administrator (2026-10-11)".
- The full suite and smoke suite are green.
- A fresh security review (opus) of this plan's diff, focusing on every path that grants or reaches an administrator's account.
- Fix Critical/Important findings, each test-first.
- Push only when the user says so.
