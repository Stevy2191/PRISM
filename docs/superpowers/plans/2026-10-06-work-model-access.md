# One Work Model — Access and the Remaining Fixes (plan 3b-2) Implementation Plan

> **Status: shipped** (see `docs/ROADMAP.md`). The checkboxes below were not ticked as the work went; they don't mean the steps are undone.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Writes check the edit tier (Q26, Q28), and the seeded System Technician keeps today's reach.
- Logging your own time needs only view access, as the user decided on 2026-10-06.
- The task-status and work-type lists become editable.
- Every quirk the baseline still pins is fixed (Q13, Q16, Q17, Q18, Q19, Q23, Q24, Q25, Q27, Q29, Q30, Q33, Q35, Q38).

**Architecture:**
- **Access:** two helpers in `permissionService`, `canEditTicket` and `canEditProject`, apply the edit tier on top of the existing view check. The controllers that change a record's own data call them.
- **Migration:** grants System Technician `tickets.edit_all` and `projects.edit_all`, and retires `projects.log_time`.
- **Quirks:** each is a small, local change with its pinned test rewritten to the fixed behaviour.
- **Settings APIs:** the task-status and work-type endpoints follow the existing `statusesController` pattern.

**Tech Stack:** Node 24.9+, Express 4, Sequelize 6 on MariaDB 11; Jest 30 integration tests; the browser smoke suite. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-05-one-work-model-design.md`](../specs/2026-10-05-one-work-model-design.md) — *Permissions*, *Other fixes*, *Decisions* (Q26), *Data model* (status lists, work types). **One deliberate difference, decided by the user on 2026-10-06:** the spec says "`time.log`: log your own time on anything you can edit"; the user ruled "if I helped on a ticket that is not assigned to me I need to be able to add my time to that ticket". So **logging your own time needs `time.log` plus view access**, on tickets and projects alike. Everything else follows the spec.

## Global Constraints

- **The access rule:**
  - **Changing** a ticket's or project's own data or structure needs the edit tier (`*.edit_own` / `*.edit_department` / `*.edit_all`, matched against the record, on top of view access). That covers its fields, tasks, relations, custom field values, members, expenses, materials, and deleting it.
  - **Collaborating** on it needs view access: comments, attachments, project files, watchers, and your own time.
  - Deletes also keep their own permission (`tickets.delete` / `projects.delete`) and the company fence.
- **The edit tier mirrors the view tier:**

  | Tier | Tickets | Projects |
  |---|---|---|
  | `*_all` | any it can see | any it can see |
  | `*_department` | its department's, or assigned to the user | owned by or for its department, or a member |
  | `*_own` | assigned to the user | a member, or the lead |

- **Seeded roles keep their reach:** System Technician gets `tickets.edit_all` and `projects.edit_all`, which the spec requires. Department Staff (`tickets.edit_own`) can then edit only tickets assigned to them, which is the Q26 fix, and they can still log time on anything they can see.
- **`projects.log_time` is retired.** The migration removes it; every holder already has `time.log`. `down()` restores it to the roles that hold `time.log`.
- **Restricted tickets:** a linked ticket the viewer can't open is returned as `{ id, restricted: true }`, with no title, status or priority (Q18, Q19). The screens show "Restricted ticket" (plan 3c).
- **Test runs:**
  - `cd backend && npm test` runs everything (about 11 minutes; run it in the background);
  - one file runs with `npx cross-env NODE_OPTIONS=--experimental-vm-modules jest <path>`;
  - the smoke suite runs with `npm run test:smoke`;
  - never run the two at the same time.
- **Commits:** stage explicit paths only; end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only when the user says so.

## Review Focus

1. **Someone loses an edit they could do yesterday on a seeded role.** System Technician must still edit every ticket and project it can see, and Department Manager its department's. *(Task 2 tests both roles before and after.)*
2. **Edit-tier checks with a missing department.** A ticket with `departmentId NULL` must never match `user.departmentId NULL` for a user with no department. *(Task 2 test: a department-less staff user and a department-less ticket.)*
3. **A deleted project's files.** They must be removed from disk, and the delete must not leave rows behind if it fails part-way (a single transaction; the disk removal after commit). *(Task 3 test checks every child table and the folder.)*
4. **Renaming or deleting a task status still in use.** Delete is refused while any task uses it, and the last open or the last closed status of a scope can't be removed or flipped. *(Task 8 tests.)*
5. **A restricted link must not leak through another route:** the project task detail, the tasks list, and the relations list after a ticket moves department. *(Task 4 tests both lists and a moved ticket.)*

---

## File map

**Create**
- `backend/migrations/20260101000051-edit-tier.js`
- `backend/src/controllers/taskStatusesController.js`, `backend/src/controllers/workTypesController.js`
- Tests: `backend/test/integration/access.edittier.test.js`, `edittier.migration.test.js`, `settings.taskstatuses.test.js`, `settings.worktypes.test.js`

**Modify**
- **Services:** `backend/src/services/permissionService.js` (`canEditTicket`, `canEditProject`) and `services/tasks/index.js` (restricted linked tickets, viewer passed in).
- **Ticket controllers:** `controllers/tickets/{core,tasks,relations,fields,watchers,shared}.js`.
- **Project controllers:** `controllers/projects/{core,tasks,members,expenses,materials,files}.js`.
- **Other backend:** `controllers/timerController.js`, `services/workflowEngine.js`, and `routes/{tickets,projects,index}.js`.
- **Frontend:** `frontend/src/pages/projects/ProjectDetail.jsx` (time gate).
- **Tests:** rewrite the pinned quirk tests in `tickets.core`, `projects.core`, `tickets.extras`, `projects.extras`, `projects.tasks`, `sideEffects`, `time.permissions` and `time.timer`.
- **Docs:** `UPGRADING.md`, `docs/ROADMAP.md`, `docs/superpowers/specs/2026-10-03-test-baseline-design.md`.

---

### Task 1: Migration — System Technician grant, retire `projects.log_time`

**Files:**
- Create: `backend/migrations/20260101000051-edit-tier.js`, `backend/test/integration/edittier.migration.test.js`

**Interfaces:**
- Produces:
  - System Technician holds `tickets.edit_all` and `projects.edit_all`;
  - the `projects.log_time` permission, its role grants and its user overrides are gone.

- [ ] **Step 1: Failing test**

`backend/test/integration/edittier.migration.test.js`:

```js
const Sequelize = require('sequelize');
const { sequelize, closeDb, resetData } = require('./helpers');

const migration = require('../../migrations/20260101000051-edit-tier');

// Plan 3b-2's migration: the seeded System Technician keeps today's reach
// under the edit tier (spec decision Q26), and projects.log_time retires.

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
const keysOf = async (role) => (await q(`SELECT p.\`key\` AS k FROM Roles r JOIN RolePermissions rp ON rp.roleId = r.id AND rp.granted = 1
  JOIN Permissions p ON p.id = rp.permissionId WHERE r.name = :role ORDER BY p.\`key\``, { role })).map((r) => r.k);

beforeAll(resetData);
afterAll(async () => {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM Permissions WHERE `key` = 'projects.log_time'");
  if (Number(n) > 0) await migration.up(qi(), Sequelize);
  await closeDb();
});

it('grants System Technician the edit_all tiers and retires projects.log_time', async () => {
  const tech = await keysOf('System Technician');
  expect(tech).toEqual(expect.arrayContaining(['projects.edit_all', 'tickets.edit_all', 'time.log']));
  expect(await q("SELECT id FROM Permissions WHERE `key` = 'projects.log_time'")).toEqual([]);
});

it('round-trips: down() restores projects.log_time to time.log holders and takes the grants back', async () => {
  await migration.down(qi(), Sequelize);
  expect(await keysOf('System Technician')).not.toContain('tickets.edit_all');
  for (const role of ['System Technician', 'Department Staff', 'Department Manager']) {
    // eslint-disable-next-line no-await-in-loop
    expect(await keysOf(role)).toContain('projects.log_time');
  }
  await migration.up(qi(), Sequelize);
  expect(await keysOf('System Technician')).toContain('tickets.edit_all');
});
```

- [ ] **Step 2: Run it (fails: cannot find the migration)**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/edittier.migration.test.js`

- [ ] **Step 3: The migration**

`backend/migrations/20260101000051-edit-tier.js`:

```js
'use strict';

// Edit tier (sub-project 3, plan 3b-2). Writes now check *.edit_* against the
// record; the seeded System Technician gets tickets.edit_all and
// projects.edit_all so default installs behave as before (spec decision
// Q26). projects.log_time retires: time.log (plan 3b-1) replaced it, and
// logging your own time needs only view access (user decision 2026-10-06).

const TECH_GRANTS = ['tickets.edit_all', 'projects.edit_all'];
const RETIRED = {
  key: 'projects.log_time', category: 'projects', label: 'Log time', description: 'Log time against projects',
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT r.id, p.id, 1 FROM Roles r JOIN Permissions p ON p.\`key\` IN (:keys)
        WHERE r.name = 'System Technician' AND r.isSystemRole = 1
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = p.id)`,
      { replacements: { keys: TECH_GRANTS }, transaction: t });
      const [retired] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: RETIRED.key }, t);
      if (retired) {
        await db.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: retired.id }, transaction: t });
        await db.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: retired.id }, transaction: t });
      }
      await db.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: RETIRED.key }, transaction: t });
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    await db.transaction(async (t) => {
      await db.query(`DELETE rp FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
        WHERE r.name = 'System Technician' AND r.isSystemRole = 1 AND p.\`key\` IN (:keys)`, { replacements: { keys: TECH_GRANTS }, transaction: t });
      let [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: RETIRED.key }, t);
      if (!perm) {
        await queryInterface.bulkInsert('Permissions', [{ ...RETIRED, createdAt: new Date() }], { transaction: t });
        [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: RETIRED.key }, t);
      }
      // Every role that can log time again can log project time.
      await db.query(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT rp.roleId, :id, 1 FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId
        WHERE p.\`key\` = 'time.log' AND rp.granted = 1
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = rp.roleId AND x.permissionId = :id)`,
      { replacements: { id: perm.id }, transaction: t });
    });
  },
};
```

Note: `down()` can't know whether an install had already given System Technician `edit_all` by hand before this migration, so it always takes the two grants back. That is recorded in UPGRADING.

- [ ] **Step 4: Migrate the test database, run the test**

Run: `cd backend && (set -a; . ./.env.test; set +a; npm run test:migrate) && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/edittier.migration.test.js`
Expected: PASS, 2 tests.

The time routes and the timer still name `projects.log_time`, so the time tests fail until Task 2. That is expected and called out there.

- [ ] **Step 5: Commit**

```bash
git add -A -- backend/migrations/20260101000051-edit-tier.js backend/test/integration/edittier.migration.test.js
git commit -m "feat(access): System Technician edits all; retire projects.log_time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The edit tier (Q26, Q28), and time back on view access

**Files:**
- Modify:
  - `backend/src/services/permissionService.js`;
  - `controllers/tickets/{core,tasks,relations,fields}.js` and `controllers/projects/{core,tasks,members,expenses,materials}.js`;
  - `routes/{tickets,projects}.js` and `controllers/timerController.js`;
  - `frontend/src/pages/projects/ProjectDetail.jsx`.
- Create test: `backend/test/integration/access.edittier.test.js`
- Rewrite: the Q26/Q28 quirk tests in `tickets.core.test.js` and `projects.core.test.js`, and the "interim domain gates" describe in `time.permissions.test.js`.

**Interfaces:**
- Produces:
  - `canEditTicket(user, ticket): Promise<boolean>` and `canEditProject(user, project): Promise<boolean>`, both exported from `permissionService`;
  - the error `403 FORBIDDEN 'You do not have permission to edit this ticket'` (and `… this project`).

- [ ] **Step 1: The access matrix test**

`backend/test/integration/access.edittier.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeTicket, makeProject, makeTask,
} = require('./fixtures');

// The edit tier (Q26, Q28): changing a ticket's or project's own data needs
// *.edit_* against the record; collaborating (comments, attachments, files,
// watchers, your own time) needs only view access (user decision 2026-10-06).

let w;
let staff;
let tech;
let mgr;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  staff = await makeStaff('staff', w.deptA.id); // tickets view_department + edit_own; projects view_department
  tech = await makeTech('tech', w.deptA.id); // System Technician: view_all + edit_all (plan 3b-2)
  mgr = await makeManager('mgr', w.deptA.id); // view/edit department
});
afterAll(closeDb);

const editRefused = (thing) => ({ error: true, message: `You do not have permission to edit this ${thing}`, code: 'FORBIDDEN' });

describe('tickets', () => {
  let mine;
  let theirs;
  beforeEach(async () => {
    mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: staff.user.id });
    theirs = await makeTicket(w.admin.agent, { title: 'Theirs', contactId: w.contact.id, departmentId: w.deptA.id });
  });
  const url = (t, path = '') => `${API}/tickets/${t.id}${path}`;

  it('edit_own: edits tickets assigned to them, not the department\'s others', async () => {
    expect((await staff.agent.patch(url(mine)).send({ priority: 'low' })).status).toBe(200);
    expect((await staff.agent.patch(url(theirs)).send({ priority: 'low' })).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.post(url(theirs, '/tasks')).send({ title: 'x' })).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.patch(url(theirs, '/custom-field-values')).send({ values: {} })).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.post(url(theirs, '/relations')).send({ relatedTicketId: mine.id })).body).toEqual(editRefused('ticket'));
  });

  it('collaborating needs only view access: comments, watchers and your own time', async () => {
    expectOk(await staff.agent.post(url(theirs, '/comments')).send({ body: 'helped', type: 'comment_private' }), 201);
    expectOk(await staff.agent.post(url(theirs, '/time')).send({ durationMinutes: 15 }), 201);
  });

  it('System Technician and Department Manager keep today\'s reach', async () => {
    const elsewhere = await makeTicket(w.admin.agent, { title: 'B', contactId: w.contact.id, departmentId: w.deptB.id });
    expect((await tech.agent.patch(url(elsewhere)).send({ priority: 'low' })).status).toBe(200);
    expect((await mgr.agent.patch(url(theirs)).send({ priority: 'low' })).status).toBe(200);
    expect((await mgr.agent.patch(url(elsewhere)).send({ priority: 'low' })).status).toBe(403);
  });

  it('a department-less user never matches a department-less ticket', async () => {
    const loose = await makeStaff('loose', null);
    await models.User.update({ departmentId: null }, { where: { id: loose.user.id } });
    const orphan = await makeTicket(w.admin.agent, { title: 'No dept', contactId: w.contact.id });
    await models.Ticket.update({ departmentId: null }, { where: { id: orphan.id } });
    expect((await loose.agent.patch(url(orphan)).send({ priority: 'low' })).status).toBe(403);
  });

  it('Q28: delete needs the edit tier as well as tickets.delete', async () => {
    expectOk(await w.admin.agent.post(`${API}/users/${staff.user.id}/overrides`).send({ permissionKey: 'tickets.delete', granted: true }), 201);
    expect((await staff.agent.delete(url(theirs))).body).toEqual(editRefused('ticket'));
    expect((await staff.agent.delete(url(mine))).status).toBe(200);
  });
});

describe('projects', () => {
  let ours;
  beforeEach(async () => {
    ours = await makeProject(w.admin.agent, { name: 'Ours', ownerDepartmentId: w.deptA.id });
  });
  const url = (p, path = '') => `${API}/projects/${p.id}${path}`;

  it('view without edit: staff can\'t edit the project or its tasks, but log their own time', async () => {
    expect((await staff.agent.patch(url(ours)).send({ name: 'x' })).status).toBe(403);
    expect((await staff.agent.post(url(ours, '/tasks')).send({ title: 'x' })).status).toBe(403);
    expectOk(await staff.agent.post(url(ours, '/time-entries')).send({ durationMinutes: 15 }), 201);
  });

  it('edit_department covers the department\'s projects; edit_all (System Technician) covers all', async () => {
    const elsewhere = await makeProject(w.admin.agent, { name: 'B', ownerDepartmentId: w.deptB.id });
    expectOk(await mgr.agent.patch(url(ours)).send({ name: 'Ours 2' }));
    expect((await mgr.agent.patch(url(elsewhere)).send({ name: 'x' })).status).toBe(403);
    expectOk(await tech.agent.patch(url(elsewhere)).send({ name: 'B 2' }));
    const task = await makeTask(tech.agent, elsewhere.id);
    expectOk(await tech.agent.patch(url(elsewhere, `/tasks/${task.id}`)).send({ title: 'y' }));
  });

  it('Q28: delete needs the edit tier as well as projects.delete', async () => {
    expectOk(await w.admin.agent.post(`${API}/users/${mgr.user.id}/overrides`).send({ permissionKey: 'projects.delete', granted: true }), 201);
    const elsewhere = await makeProject(w.admin.agent, { name: 'B', ownerDepartmentId: w.deptB.id });
    expect((await mgr.agent.delete(url(elsewhere))).status).toBe(403);
    expectOk(await mgr.agent.delete(url(ours)));
  });
});

it('the timer runs on anything the user can see (time.log + view)', async () => {
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  expect((await staff.agent.post(`${API}/timer/start`).send({ type: 'project', id: p.id })).status).toBe(201);
});
```

If `makeStaff(…, null)` isn't accepted, create the user with `deptA` and clear `departmentId` with `models.User.update`, as the test already does. Record a ruling.

Rewrite the pinned tests.
- **`tickets.core.test.js`:** the Q26 test becomes "Q26: edit access follows the edit tier". It asserts that a Department Staff user can view a department-A ticket not assigned to them, and that a PATCH to it is 403 `You do not have permission to edit this ticket`. The Q28 test becomes "Q28: delete re-checks the edit tier". It keeps the setup and expects the delete to be 403.
- **`projects.core.test.js`:** the Q26 test becomes "Q26: edit access follows the edit tier". Use a Department Staff user (view without edit), PATCH a department-A project, and expect 403 `You do not have permission to edit this project`. Q28: as on tickets.
- **`time.permissions.test.js`:** replace the `interim domain gates` describe with one test. A user denied `projects.log_time`, a permission that no longer exists, can still log time; a user denied `time.log` can't log on either side:

```js
describe('time needs time.log and view access', () => {
  it('denying time.log stops logging on both sides; nothing else gates it', async () => {
    const ticket = await KINDS.ticket.make();
    const project = await KINDS.project.make();
    expectOk(await w.admin.agent.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'time.log', granted: false }), 201);
    for (const [kind, parent] of [['ticket', ticket], ['project', project]]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(KINDS[kind].url(parent)).send({ durationMinutes: 5 })).status).toBe(403);
    }
  });
});
```

- [ ] **Step 2: Run them (fail)**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/access.edittier.test.js test/integration/tickets.core.test.js test/integration/projects.core.test.js test/integration/time.permissions.test.js`
Expected: FAIL. Staff edits succeed, deletes skip the tier, and project time still asks for `projects.log_time`.

- [ ] **Step 3: The helpers**

In `backend/src/services/permissionService.js`, after `canAccessProject`:

```js
// The edit tier (Q26): writes to a record's own data check *.edit_* against
// that record, on top of being able to see it. The tiers mirror the view
// tiers. A department match needs a real department on both sides.
const sameDept = (a, b) => a != null && b != null && a === b;

async function canEditTicket(user, ticket) {
  if (!(await canAccessTicket(user, ticket))) return false;
  const p = await resolveUserPermissions(user.id);
  if (p['tickets.edit_all']) return true;
  if (p['tickets.edit_department'] && sameDept(ticket.departmentId, user.departmentId)) return true;
  return !!(p['tickets.edit_department'] || p['tickets.edit_own']) && ticket.assigneeId === user.id;
}

async function canEditProject(user, project) {
  if (!(await canAccessProject(user, project))) return false;
  const p = await resolveUserPermissions(user.id);
  if (p['projects.edit_all']) return true;
  const isMember = !!(await ProjectMember.findOne({ where: { projectId: project.id, userId: user.id } }));
  if (p['projects.edit_department']
    && (sameDept(project.ownerDepartmentId, user.departmentId) || sameDept(project.forDepartmentId, user.departmentId) || isMember)) {
    return true;
  }
  return !!p['projects.edit_own'] && (isMember || project.assignedToUserId === user.id);
}
```

Export both.

- [ ] **Step 4: Use them where a record's own data changes**

Add a shared check to each side:
- `controllers/tickets/shared.js`: `async function assertCanEditTicket(user, ticket)`, which throws `new ApiError(403, 'You do not have permission to edit this ticket', 'FORBIDDEN')` when `!(await canEditTicket(user, ticket))`. Export it.
- `controllers/projects/shared.js`: `assertCanEditProject(user, project)`, the same with "this project".

Then call it after the existing view check in:

| File | Handlers |
|---|---|
| `tickets/core.js` | `update` (after `canAccessTicket`), and `remove` (after the company fence) |
| `tickets/tasks.js` | every handler except `listTasks`: give `ticketFor(req, { edit = false } = {})` the option and call it with `{ edit: true }` |
| `tickets/relations.js` | `createRelation` and `removeRelation` |
| `tickets/fields.js` | `updateCustomFieldValues` |
| `projects/core.js` | `update` and `remove` |
| `projects/tasks.js` | `projectFor(req, { edit })`; every handler except `listTasks` passes `{ edit: true }` |
| `projects/members.js` | `addMember` and `removeMember` |
| `projects/expenses.js` | create, update and remove |
| `projects/materials.js` | create, update and remove |

Comments, attachments, watchers, project files and time keep their view check (Global Constraints).

In `tickets/core.js` `remove` and `projects/core.js` `remove`, replace the comment about Q28 with:

```js
  // Deletes need the edit tier on the record (Q28) as well as the delete
  // permission the route checks, and the company fence inside canEdit*.
```

- [ ] **Step 5: Time back on view access; retire `projects.log_time` in code**

- **`routes/tickets.js`:** `const logTime = requirePermission('time.log');`, with the comment "Your own time needs time.log and view access (user decision 2026-10-06); editing others' needs time.manage_others (services/time)."
- **`routes/projects.js`:** the same `logTime`.
- **`controllers/timerController.js`:** remove the `gate` keys from `KINDS`, the `hasAnyPermission` checks in `start` and `logTimer`, and the import. Its gate comment goes too.
- **`frontend/src/pages/projects/ProjectDetail.jsx`:** `const canLogTime = usePermission('time.log');`. Remove the `hasProjectLogTime` line and the comment about plan 3b-2.

Run `grep -rn "projects.log_time" backend/src frontend/src`.
Expected: no output.

- [ ] **Step 6: Run the tests**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/access.edittier.test.js test/integration/tickets.core.test.js test/integration/projects.core.test.js test/integration/time.permissions.test.js test/integration/time.timer.test.js test/integration/tickets.tasks.test.js test/integration/projects.tasks.test.js`
Expected: PASS.

**If a pre-existing test now fails because its actor lost an edit:**
- **The actor is a System Technician (`makeTech`) or an admin:** the code is wrong. Their reach must not change.
- **The actor is a Department Staff user editing an unassigned ticket:** that is the Q26 fix. Give the test a user whose tier allows the edit, and record a ruling.

- [ ] **Step 7: Commit**

```bash
git add -A -- backend/src frontend/src/pages/projects/ProjectDetail.jsx backend/test/integration
git commit -m "feat(access): writes check the edit tier (Q26, Q28); your own time needs view access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Project delete takes its children (Q13); file delete by uploader or moderator (Q17)

**Files:**
- Modify: `backend/src/controllers/projects/core.js` (`remove`), `backend/src/controllers/projects/files.js` (`removeFile`)
- Rewrite tests: Q13 in `projects.core.test.js`, Q17 in `projects.extras.test.js`

- [ ] **Step 1: Tests**

In `projects.core.test.js`, replace the Q13 test:

```js
  it('Q13: deleting a project deletes its tasks, time, expenses, materials, files, members and activity', async () => {
    const fs = require('fs'); // eslint-disable-line global-require
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id });
    await makeTask(tech.agent, p.id);
    expectOk(await tech.agent.post(`${projUrl(p)}/time-entries`).send({ durationMinutes: 30 }), 201);
    expectOk(await tech.agent.post(`${projUrl(p)}/expenses`).send({ description: 'x', amount: 1 }), 201);
    expectOk(await tech.agent.post(`${projUrl(p)}/materials`).send({ itemName: 'x' }), 201);
    const { file } = expectOk(await tech.agent.post(`${projUrl(p)}/files`).attach('file', Buffer.from('hello'), 'notes.txt'), 201);
    expectOk(await w.admin.agent.delete(projUrl(p)));
    const { Task, TimeEntry, ProjectExpense, ProjectMaterial, ProjectFile, ProjectMember, ProjectActivity, AuditLog } = models;
    for (const M of [Task, TimeEntry, ProjectExpense, ProjectMaterial, ProjectFile, ProjectMember, ProjectActivity]) {
      // eslint-disable-next-line no-await-in-loop
      expect([M.name, await M.count({ where: { projectId: p.id } })]).toEqual([M.name, 0]);
    }
    expect(fs.existsSync(file.filepath)).toBe(false);
    const audit = await AuditLog.findOne({ where: { action: 'project.delete', entityId: p.id } });
    expect(audit.meta).toEqual(expect.objectContaining({ name: 'P', tasks: 1, timeEntries: 1, files: 1 }));
  });
```

If the file response doesn't carry `filepath`, use `models.ProjectFile.findByPk(file.id)` before the delete to read it. Record a ruling.

In `projects.extras.test.js`, replace the Q17 test:

```js
  it('Q17: a file is deleted by its uploader or a project moderator, not by any editor', async () => {
    const editor = await makeTech('editor2', w.deptA.id);
    await w.admin.agent.post(`${API}/users/${editor.user.id}/overrides`).send({ permissionKey: 'projects.edit_all', granted: false });
    await w.admin.agent.post(`${API}/projects/${proj.id}/members`).send({ userId: editor.user.id });
    const f = await upload(); // uploaded by tech
    const refused = await editor.agent.delete(`${purl('files')}/${f.id}`);
    expect(refused.body).toEqual({ error: true, message: 'Only the uploader or a project moderator can delete this file', code: 'FORBIDDEN' });
    const mgr = await makeManager('mgr', w.deptA.id); // projects.edit_department in the owning department
    expect((await mgr.agent.delete(`${purl('files')}/${f.id}`)).status).toBe(200);
  });
```

Check which user `upload()` uses in that file, and adjust the "uploader" side so a non-uploader, non-moderator editor is the one refused.

- [ ] **Step 2: Run them (fail)**

- [ ] **Step 3: Implementation**

`projects/core.js` `remove`. Inside one transaction, after the access checks:

```js
  const { Task, TimeEntry, ProjectExpense, ProjectMaterial, ProjectFile, ProjectMember, ProjectActivity } = require('../../models'); // top of file instead
  const where = { projectId: project.id };
  const counts = {};
  const filesDir = path.join(UPLOAD_ROOT, 'projects', String(project.id));
  await sequelize.transaction(async (transaction) => {
    // No database cascades (Q13): everything that belongs to the project goes with it.
    for (const [label, M] of [['tasks', Task], ['timeEntries', TimeEntry], ['expenses', ProjectExpense], ['materials', ProjectMaterial],
      ['files', ProjectFile], ['members', ProjectMember], ['activity', ProjectActivity]]) {
      counts[label] = await M.destroy({ where, transaction }); // eslint-disable-line no-await-in-loop
    }
    await ActiveTimer.destroy({ where: { entityType: 'project', entityId: project.id }, transaction });
    await project.destroy({ transaction });
    await writeAudit(req, 'project.delete', 'Project', project.id, { name: project.name, ...counts }, { transaction });
  });
  fs.rm(filesDir, { recursive: true, force: true }, () => {}); // after commit: rows first, then the disk
```

Remove the old `await project.destroy()` / `writeAudit` lines. Add the models and `sequelize` to the require. Check where `ProjectFile.filepath` lives (`uploads/projects/<id>/…`). If uploads are elsewhere, also `fs.rm` each file's `filepath` after commit.

`projects/files.js` `removeFile`, after the view check:

```js
  // Q17: the uploader, or a project moderator (edit_all, or edit_department
  // for a project owned by or for the user's department).
  if (file.uploadedBy !== req.user.id && !(await canModerateProjectContent(req.user, project))) {
    throw new ApiError(403, 'Only the uploader or a project moderator can delete this file', 'FORBIDDEN');
  }
```

Import `canModerateProjectContent`.

- [ ] **Step 4: Run the tests (pass), then commit**

```bash
git add -A -- backend/src/controllers/projects backend/test/integration/projects.core.test.js backend/test/integration/projects.extras.test.js
git commit -m "fix(projects): deleting a project takes its children (Q13); file delete by uploader or moderator (Q17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Restricted linked tickets (Q18, Q19)

**Files:**
- Modify: `backend/src/controllers/tickets/relations.js` (`listRelations`, `relTicketAttrs`), `backend/src/services/tasks/index.js`, `backend/src/controllers/{tickets,projects}/tasks.js`
- Rewrite tests: Q18 in `tickets.extras.test.js`, Q19 in `projects.tasks.test.js`

**Interfaces:**
- Changes `services/tasks.listTasks(parent, viewer)` and `loadTask(parent, id, viewer)`. Every caller passes `req.user` (`createTask`/`updateTask`/`renumberTask` pass `req.user` to `loadTask`).

- [ ] **Step 1: Tests**

`tickets.extras.test.js`, replace Q18:

```js
  it('Q18: a linked ticket the viewer can\'t open is shown as restricted', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const S = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
    expectOk(await link(A, { relatedTicketId: S.id }, w.admin.agent), 201);
    const [rel] = await listOf(A, staff.agent);
    expect(rel.ticket).toEqual({ id: S.id, restricted: true });
    // Once it moves into their department, it shows in full.
    expectOk(await w.admin.agent.patch(`${API}/tickets/${S.id}`).send({ departmentId: w.deptA.id }));
    expect((await listOf(A, staff.agent))[0].ticket).toEqual(relTicket({ ...S, departmentId: w.deptA.id }));
  });
```

Check what `relTicket()` builds (it maps a ticket to the relation's `ticket` shape), and pass whatever it needs.

`projects.tasks.test.js`, replace Q19:

```js
  it('Q19: a linked ticket the viewer can\'t open is shown as restricted, in the list and on the task', async () => {
    const secret = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
    const t = await makeTask(w.admin.agent, P.id, { linkedTicketId: secret.id });
    expect((await listTasks())[0].linkedTicket).toEqual({ id: secret.id, restricted: true });
    const patched = expectOk(await mgr.agent.patch(taskUrl(t)).send({ title: 'Renamed' })).task;
    expect(patched.linkedTicket).toEqual({ id: secret.id, restricted: true });
    expect((await w.admin.agent.get(`${API}/projects/${P.id}/tasks`)).body.tasks[0].linkedTicket).toEqual({ id: secret.id, title: 'Secret' });
  });
```

- [ ] **Step 2: Run them (fail)**

- [ ] **Step 3: Implementation**

`tickets/relations.js`:
- `relTicketAttrs` gains `'departmentId', 'assigneeId', 'companyId'`, which the access check needs.
- `listRelations` maps each linked ticket through:

```js
// A linked ticket the viewer can't open shows only that it exists (Q18).
async function shownTicket(user, t) {
  if (await canAccessTicket(user, t)) return { id: t.id, title: t.title, status: t.status, priority: t.priority, type: t.type };
  return { id: t.id, restricted: true };
}
```

Use `await Promise.all(rows.map(…))` to build `relations`, with `ticket: await shownTicket(req.user, outgoing ? r.relatedTicket : r.ticket)`. The output fields for an open ticket stay exactly the old `relTicketAttrs` (`id, title, status, priority, type`).

`services/tasks/index.js`:
- the `linkedTicket` include's attributes become `['id', 'title', 'departmentId', 'assigneeId', 'companyId']`;
- `annotate` becomes async, taking `viewer` and calling:

```js
// A linked ticket the viewer can't open shows only its id (Q19).
async function shownLinkedTicket(viewer, linked) {
  if (!linked) return linked;
  if (viewer && await canAccessTicket(viewer, linked)) return { id: linked.id, title: linked.title };
  return { id: linked.id, restricted: true };
}
```

  so that `json.linkedTicket = await shownLinkedTicket(viewer, task.linkedTicket)`;
- `listTasks(parent, viewer)` and `loadTask(parent, id, viewer)` pass the viewer through. `createTask`, `updateTask` and `renumberTask` call `loadTask(parent, task.id, req.user)`;
- both controllers' `listTasks` pass `req.user`.

Import `canAccessTicket` from `../permissionService`.

- [ ] **Step 4: Run them (pass) with the whole tasks and relations files, then commit**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/tickets.extras.test.js test/integration/projects.tasks.test.js test/integration/tickets.tasks.test.js test/integration/companies.review.test.js`

```bash
git add -A -- backend/src/controllers/tickets/relations.js backend/src/services/tasks/index.js backend/src/controllers/tickets/tasks.js backend/src/controllers/projects/tasks.js backend/test/integration/tickets.extras.test.js backend/test/integration/projects.tasks.test.js
git commit -m "fix(access): linked tickets the viewer can't open show as restricted (Q18, Q19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ticket and project rules (Q16, Q24, Q25, Q27, Q35, Q38)

**Files:**
- Modify:
  - `backend/src/services/workflowEngine.js` (Q16);
  - `controllers/tickets/relations.js` (Q24);
  - `controllers/tickets/core.js` (Q25, Q27, Q35, Q38);
  - `controllers/projects/core.js` (Q25, Q38).
- Rewrite tests: those quirks in `sideEffects`, `tickets.extras`, `tickets.core` and `projects.core`.

- [ ] **Step 1: Tests (replace each pinned quirk test)**

```js
// sideEffects.test.js
  it('Q16: escalate_to_user assigns and raises priority to critical', async () => {
    const rule = await makeRule({
      triggerEvent: 'ticket_created', actions: [{ actionType: 'escalate_to_user', actionValue: { userId: tech.user.id } }],
    });
    const n = await makeTicket(w.admin.agent, { title: 'Escalate me', contactId: w.contact.id });
    const fresh = expectOk(await w.admin.agent.get(`${API}/tickets/${n.id}`)).ticket;
    expect([fresh.assigneeId, fresh.priority]).toEqual([tech.user.id, 'critical']);
    const [log] = await logsOf(rule);
    expect(log.actionsExecuted).toEqual(expect.arrayContaining([expect.stringContaining('priority: critical')]));
  });

  it('Q35: creating a ticket already closed obeys requireBeforeClose', async () => {
    await requireTime();
    const res = await tech.agent.post(`${API}/tickets`).send({ title: 'Closed', contactId: w.contact.id, status: 'Closed' });
    expect(res.body).toEqual({ error: true, message: 'Log time on this ticket before closing it', code: 'TIME_REQUIRED_BEFORE_CLOSE' });
  });

// tickets.extras.test.js
  it('Q24: two tickets are linked once, whichever direction', async () => {
    expectOk(await link(A, { relatedTicketId: B.id }), 201);
    const again = await link(B, { relatedTicketId: A.id });
    expect(again.body).toEqual({ error: true, message: 'These tickets are already linked', code: 'DUPLICATE_RELATION' });
    expect(await listOf(A)).toHaveLength(1);
  });

// tickets.core.test.js
  it('Q25: refuses a status no TicketStatus row has', async () => {
    const res = await tech.agent.post(`${API}/tickets`).send({ ...base(), status: 'Bogus' });
    expect(res.body).toEqual({ error: true, message: 'Unknown ticket status', code: 'VALIDATION_ERROR' });
    const t = await makeTicket(tech.agent, base());
    expect((await tech.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Bogus' })).body.message).toBe('Unknown ticket status');
  });

  it('Q38: update refuses a blank or whitespace title', async () => {
    const t = await makeTicket(tech.agent, base());
    for (const title of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.patch(`${API}/tickets/${t.id}`).send({ title })).body)
        .toEqual({ error: true, message: 'Ticket title is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('Q27: clearing dueDate clears dueTime even when one is sent', async () => {
    const t = await makeTicket(tech.agent, { ...base(), dueDate: '2026-12-01', dueTime: '09:00:00' });
    const { ticket } = expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ dueDate: null, dueTime: '10:00:00' }));
    expect(ticket).toEqual(expect.objectContaining({ dueDate: null, dueTime: null }));
  });

// projects.core.test.js
  it('Q38: update refuses a blank or whitespace name', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    for (const name of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.patch(projUrl(p)).send({ name })).body)
        .toEqual({ error: true, message: 'Project name is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('Q25: refuses a status no ProjectStatus row has', async () => {
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    expect((await tech.agent.patch(projUrl(p)).send({ status: 'Bogus' })).body)
      .toEqual({ error: true, message: 'Unknown project status', code: 'VALIDATION_ERROR' });
  });
```

The existing create-time "Ticket title is required" and "Project name is required" messages are the ones the update reuses. Check them in each `create`, and keep the wording identical.

- [ ] **Step 2: Run them (fail)**

- [ ] **Step 3: Implementation**

- **Q16, `workflowEngine.js`:** `priority: 'critical'` in the update, and `(priority: critical)` in the result string. Make the same change in the description at line ~352.
- **Q24, `tickets/relations.js`:** the duplicate check looks in both directions:

```js
  const existing = await TicketRelation.findOne({
    where: {
      [Op.or]: [
        { ticketId: storedTicketId, relatedTicketId: storedRelatedId },
        { ticketId: storedRelatedId, relatedTicketId: storedTicketId },
      ],
    },
  });
```

- **Q25, `tickets/core.js`:** add a helper:

```js
// A status must be one of the configured ticket statuses (Q25).
async function assertTicketStatus(name) {
  if (!(await TicketStatus.findOne({ where: { name } }))) throw new ApiError(400, 'Unknown ticket status', 'VALIDATION_ERROR');
}
```

  In `create`, when a `status` is given, call it before the insert. In `update`, call it when `changes.status !== undefined`. Do the same in `projects/core.js` with `ProjectStatus` and "Unknown project status", in `create` (when given) and `update`.
- **Q38:** in `update`, add `if (changes.title !== undefined) { if (typeof changes.title !== 'string' || !changes.title.trim()) throw 400 'Ticket title is required'; changes.title = changes.title.trim(); }`. Do the same for a project's `name` ('Project name is required').
- **Q27:** replace the dueTime block with `if (changes.dueDate === null || changes.dueDate === '') { changes.dueDate = null; changes.dueTime = null; }`. A time without a date is meaningless, whatever the caller sent.
- **Q35:** in `create`, before the insert:

```js
  // Q35: creating a ticket already closed obeys "require time before close";
  // a new ticket has no time yet.
  if (resolvedStatusName && (await getTicketStatusBehaviorMap()).get(resolvedStatusName) === 'closed') {
    const settings = await getAllSettings();
    if (settings['timeTracking.requireBeforeClose'] === 'true') {
      throw new ApiError(400, 'Log time on this ticket before closing it', 'TIME_REQUIRED_BEFORE_CLOSE');
    }
  }
```

  Here `resolvedStatusName` is the status the create will store (`status || 'Open'`); compute it once and reuse it in the insert.

- [ ] **Step 4: Run (pass), then commit**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/sideEffects.test.js test/integration/tickets.extras.test.js test/integration/tickets.core.test.js test/integration/projects.core.test.js`

```bash
git add -A -- backend/src/services/workflowEngine.js backend/src/controllers/tickets backend/src/controllers/projects/core.js backend/test/integration
git commit -m "fix(tickets, projects): statuses, titles, due time, closed-on-create, links once, escalate (Q16, Q24, Q25, Q27, Q35, Q38)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Custom field values are checked (Q29)

**Files:**
- Modify: `backend/src/controllers/tickets/shared.js` (`syncCustomFieldValues`)
- Rewrite test: Q29 in `tickets.extras.test.js`

- [ ] **Step 1: Test**

```js
  it('Q29: values must fit the field\'s type and options', async () => {
    const field = async (body) => expectOk(await w.admin.agent.post(`${API}/custom-fields`).send(body), 201);
    await field({ label: 'Rank', fieldKey: 'rank', fieldType: 'number' });
    await field({ label: 'When', fieldKey: 'when', fieldType: 'date' });
    await field({ label: 'Mail', fieldKey: 'mail', fieldType: 'email' });
    await field({ label: 'Done', fieldKey: 'done', fieldType: 'checkbox' });
    const bad = async (values, label) => {
      const res = await tech.agent.patch(url()).send({ values });
      expect(res.body).toEqual({ error: true, message: `"${label}" doesn't accept that value`, code: 'VALIDATION_ERROR' });
    };
    await bad({ rank: 'abc' }, 'Rank');
    await bad({ when: '2026-02-30' }, 'When');
    await bad({ mail: 'not-an-email' }, 'Mail');
    await bad({ done: 'maybe' }, 'Done');
    await bad({ systems: ['Z'] }, 'Systems');
    expect(await set({ rank: '42', when: '2026-03-01', mail: 'a@b.co', done: true, systems: ['A'] }))
      .toEqual(expect.objectContaining({ rank: '42', when: '2026-03-01', mail: 'a@b.co', done: 'true', systems: ['A'] }));
  });
```

Before trusting the last line's shape, check the `systems` multiselect's options and label in this file's `beforeEach`, and check how `set()` returns values (strings, with multiselect as an array). Adjust the expectations to them, and record a ruling.

- [ ] **Step 2: Run it (fail)**

- [ ] **Step 3: Implementation**

In `syncCustomFieldValues`, before turning `raw` into `value`:

```js
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A value must fit its field (Q29): numbers are numbers, dates real dates,
// choices among the options. Empty clears the value, as before.
function fitsField(field, raw) {
  const options = Array.isArray(field.options) ? field.options : [];
  switch (field.fieldType) {
    case 'number': return Number.isFinite(Number(raw)) && String(raw).trim() !== '';
    case 'date': return !!toDateString(raw) && String(raw).length === 10;
    case 'datetime': return !Number.isNaN(new Date(raw).getTime());
    case 'dropdown': return options.includes(String(raw));
    case 'multiselect': return Array.isArray(raw) && raw.every((v) => options.includes(String(v)));
    case 'checkbox': return raw === true || raw === false || raw === 'true' || raw === 'false';
    case 'email': return EMAIL.test(String(raw));
    case 'url': return /^https?:\/\/\S+$/i.test(String(raw));
    default: return typeof raw === 'string' || typeof raw === 'number';
  }
}
```

In the loop, after `if (!field) continue;`:

```js
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length);
    if (!empty && !fitsField(field, raw)) {
      throw new ApiError(400, `"${field.label}" doesn't accept that value`, 'VALIDATION_ERROR');
    }
```

Import `toDateString` from `../../utils/orgTime` and `ApiError` if it isn't already imported. `syncCustomFieldValues` is also called by ticket create, so a bad value at create is refused too.

- [ ] **Step 4: Run `tickets.extras` and `tickets.core` (pass), then commit**

```bash
git add -A -- backend/src/controllers/tickets/shared.js backend/test/integration/tickets.extras.test.js
git commit -m "fix(tickets): custom field values must fit the field's type and options (Q29)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lead membership (Q30), expense and material edits (Q33), the remaining audit rows (Q23)

**Files:**
- Modify: `controllers/projects/{core,expenses,materials,members,files}.js`, `controllers/tickets/{watchers,fields}.js`
- Rewrite tests: Q30 in `projects.core`, both Q33 tests in `projects.extras`, the Q23 `unaudited` list in `sideEffects`

- [ ] **Step 1: Tests**

```js
// projects.core.test.js
  it('Q30: a new lead becomes a member with the lead role; the old lead stays a member', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const p = await makeProject(tech.agent, { name: 'P', ownerDepartmentId: w.deptA.id, assignedToUserId: tech.user.id });
    const { project } = expectOk(await tech.agent.patch(projUrl(p)).send({ assignedToUserId: mgr.user.id }));
    expect(project.members.map((m) => [m.userId, m.role]).sort()).toEqual([[tech.user.id, 'member'], [mgr.user.id, 'lead']].sort());
  });

// projects.extras.test.js
  it('Q33: expense edits run the create validation', async () => {
    const e = await create({ description: 'x', amount: 1 });
    for (const [body, message] of [[{ amount: -5 }, 'Amount must be a non-negative number'], [{ description: '  ' }, 'Description is required']]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.patch(`${purl('expenses')}/${e.id}`).send(body)).body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });

  it('Q33: material edits run the create validation', async () => {
    const m = await create({ itemName: 'Switch', quantity: 2, unitCost: 5 });
    const cases = [
      [{ quantity: 0 }, 'Quantity must be a positive number'],
      [{ unitCost: -1 }, 'Unit cost must be a non-negative number'],
      [{ itemName: ' ' }, 'Item name is required'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.patch(`${purl('materials')}/${m.id}`).send(body)).body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
    }
  });
```

In `sideEffects.test.js`, the rows of the `unaudited` list move into the `audited` list (which asserts one audit row each), and the `unaudited` list and its Q23 quirk test are deleted. That covers watcher add and remove, custom field values, expense create, update and delete, material create, update and delete, member add and remove, and project file upload and delete. Leave a one-line comment: "Q23, fixed in plans 3b-1 (tasks) and 3b-2 (the rest)."

- [ ] **Step 2: Run them (fail)**

- [ ] **Step 3: Implementation**

**Q30, `projects/core.js` `update`.** After `await project.update(changes)`, when the lead changed:

```js
  if (changes.assignedToUserId !== undefined && project.assignedToUserId !== previousLeadId) {
    // Q30: the new lead is a member with the lead role; the old lead stays a member.
    if (previousLeadId) await ProjectMember.update({ role: 'member' }, { where: { projectId: project.id, userId: previousLeadId } });
    if (project.assignedToUserId) {
      const [member] = await ProjectMember.findOrCreate({
        where: { projectId: project.id, userId: project.assignedToUserId }, defaults: { role: 'lead' },
      });
      if (member.role !== 'lead') await member.update({ role: 'lead' });
    }
  }
```

**Q33.** In `updateExpense`, validate the same way as create:
- a `description` that is given must be non-blank; trim it;
- a given `amount` → `Number`, finite and ≥ 0;
- the messages are the create ones.

In `updateMaterial`, validate a given `itemName`, `quantity` (≥ 1) and `unitCost` (≥ 0) with the create messages. Place both checks before the `totalCost` computation.

**Q23.** Write `writeAudit(req, action, entityType, id, meta)` after each change:

| Handler | Action | Entity type | Meta |
|---|---|---|---|
| watcher add / remove | `watcher.add` / `watcher.remove` | `Ticket` | `{ userId }` |
| custom field values | `ticket.custom_fields` | `Ticket` | `{ keys }` |
| expenses | `expense.create` / `.update` / `.delete` | `ProjectExpense` | `{ projectId, … }` |
| materials | `material.create` / `.update` / `.delete` | `ProjectMaterial` | `{ projectId, … }` |
| member add / remove | `project_member.add` / `.remove` | `Project` | `{ userId }` |
| file upload / delete | `project_file.upload` / `.delete` | `ProjectFile` | `{ projectId, filename }` |

The watcher and custom-field rows use the ticket's id; the member rows use the project's id. Import `writeAudit` where it is missing.

- [ ] **Step 4: Run `projects.core`, `projects.extras`, `sideEffects` and `tickets.extras` (pass), then commit**

```bash
git add -A -- backend/src/controllers backend/test/integration
git commit -m "fix(projects, tickets): lead membership, expense/material edit validation, audit rows (Q23, Q30, Q33)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Task statuses are editable

**Files:**
- Create: `backend/src/controllers/taskStatusesController.js`, `backend/test/integration/settings.taskstatuses.test.js`
- Modify: `backend/src/routes/index.js`, `backend/test/integration/helpers.js`

**Interfaces:**
- Produces, all except GET needing `settings.manage_statuses`:
  - `POST /task-statuses { scope, name, color?, behaviorType? }`;
  - `PATCH /task-statuses/:id { name?, color?, behaviorType?, isDefault? }`;
  - `DELETE /task-statuses/:id`;
  - `PUT /task-statuses/reorder { scope, order: [id…] }`.

- [ ] **Step 1: Test**

`backend/test/integration/settings.taskstatuses.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, taskStatusId,
} = require('./fixtures');

// Task statuses are editable per scope (spec: Status lists): a status in use
// can't be deleted, and each scope keeps at least one open and one closed.

let w;
const created = [];
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(async () => {
  // Task statuses are seeded and not reset: remove what a test added, put back what it changed.
  await models.TaskStatus.destroy({ where: { id: created.splice(0) } });
  await models.TaskStatus.update({ behaviorType: 'open', name: 'In progress' }, { where: { scope: 'ticket', position: 1 } });
});
afterAll(closeDb);

const err = (message, code = 'VALIDATION_ERROR') => ({ error: true, message, code });
const make = async (body) => {
  const { status } = expectOk(await w.admin.agent.post(`${API}/task-statuses`).send(body), 201);
  created.push(status.id);
  return status;
};

it('creates, renames and reorders statuses in a scope', async () => {
  const s = await make({ scope: 'ticket', name: 'Waiting', color: '#aa00aa', behaviorType: 'open' });
  expect(s).toEqual(expect.objectContaining({ scope: 'ticket', name: 'Waiting', behaviorType: 'open', position: 3 }));
  expect(expectOk(await w.admin.agent.patch(`${API}/task-statuses/${s.id}`).send({ name: 'Waiting on customer' })).status.name)
    .toBe('Waiting on customer');
  const ids = expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=ticket`)).statuses.map((x) => x.id);
  const order = [s.id, ...ids.filter((id) => id !== s.id)];
  expectOk(await w.admin.agent.put(`${API}/task-statuses/reorder`).send({ scope: 'ticket', order }));
  expect(expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=ticket`)).statuses.map((x) => x.id)).toEqual(order);
});

it('validates input', async () => {
  const bad = async (body, message) => expect((await w.admin.agent.post(`${API}/task-statuses`).send(body)).body).toEqual(err(message));
  await bad({ name: 'x' }, 'scope must be ticket or project');
  await bad({ scope: 'ticket', name: ' ' }, 'Status name is required');
  await bad({ scope: 'ticket', name: 'x', behaviorType: 'weird' }, 'Invalid behaviorType');
  await bad({ scope: 'ticket', name: 'To do' }, 'A ticket task status with that name already exists');
});

it('a status in use can\'t be deleted; a protected one never', async () => {
  const s = await make({ scope: 'ticket', name: 'Parked' });
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'x', statusId: s.id }), 201);
  expect((await w.admin.agent.delete(`${API}/task-statuses/${s.id}`)).body)
    .toEqual(err('This status is used by 1 task; move them to another status first', 'STATUS_IN_USE'));
  const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
  expect((await w.admin.agent.delete(`${API}/task-statuses/${done}`)).body)
    .toEqual(err('This status is protected and cannot be deleted', 'PROTECTED_STATUS'));
});

it('a scope keeps at least one open and one closed status', async () => {
  const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
  expect((await w.admin.agent.patch(`${API}/task-statuses/${done}`).send({ behaviorType: 'open' })).body)
    .toEqual(err('Each list needs at least one open and one closed status'));
  const inProgress = await taskStatusId(w.admin.agent, 'ticket', 'In progress');
  expectOk(await w.admin.agent.patch(`${API}/task-statuses/${inProgress}`).send({ behaviorType: 'closed' }));
});

it('editing needs settings.manage_statuses; reading needs a login only', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  expect((await tech.agent.post(`${API}/task-statuses`).send({ scope: 'ticket', name: 'x' })).status).toBe(403);
  expectOk(await tech.agent.get(`${API}/task-statuses`));
});
```

- [ ] **Step 2: Run it (fail: 404s)**

- [ ] **Step 3: The controller**

`backend/src/controllers/taskStatusesController.js`:

```js
// Editing the task status lists (one per scope: ticket, project). Reading
// is GET /task-statuses (workCatalogController). A status in use can't be
// deleted, a protected one never, and each scope keeps at least one open
// and one closed status.
const { Op } = require('sequelize');
const { TaskStatus, Task, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');

const SCOPES = ['ticket', 'project'];
const BEHAVIORS = ['open', 'closed', 'archived'];
const SCOPE_LABEL = { ticket: 'ticket task', project: 'project task' };
const bad = (message, code = 'VALIDATION_ERROR') => new ApiError(400, message, code);

async function statusFor(rawId) {
  const id = parseRecordId(rawId);
  const status = id && await TaskStatus.findByPk(id);
  if (!status) throw new ApiError(404, 'Status not found', 'NOT_FOUND');
  return status;
}

async function assertNameFree(scope, name, exceptId = 0) {
  const clash = await TaskStatus.findOne({ where: { scope, name, id: { [Op.ne]: exceptId } } });
  if (clash) throw bad(`A ${SCOPE_LABEL[scope]} status with that name already exists`);
}

// After a change, the scope must still have an open and a closed status.
async function assertBothBehaviors(scope, transaction) {
  const rows = await TaskStatus.findAll({ where: { scope }, attributes: ['behaviorType'], transaction });
  const kinds = new Set(rows.map((r) => r.behaviorType));
  if (!kinds.has('open') || !kinds.has('closed')) throw bad('Each list needs at least one open and one closed status');
}

const create = asyncHandler(async (req, res) => {
  const { scope, name, color, behaviorType } = req.body || {};
  if (!SCOPES.includes(scope)) throw bad('scope must be ticket or project');
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) throw bad('Status name is required');
  if (behaviorType !== undefined && !BEHAVIORS.includes(behaviorType)) throw bad('Invalid behaviorType');
  await assertNameFree(scope, clean);
  const maxPosition = await TaskStatus.max('position', { where: { scope } });
  const status = await TaskStatus.create({
    scope, name: clean, color: color || '#3b82f6', behaviorType: behaviorType || 'open',
    position: (Number.isFinite(maxPosition) ? maxPosition : -1) + 1,
  });
  await writeAudit(req, 'taskStatus.create', 'TaskStatus', status.id, { scope, name: status.name });
  res.status(201).json({ status });
});

const update = asyncHandler(async (req, res) => {
  const status = await statusFor(req.params.id);
  const { name, color, behaviorType, isDefault } = req.body || {};
  const changes = {};
  if (name !== undefined) {
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean) throw bad('Status name is required');
    if (clean !== status.name) { await assertNameFree(status.scope, clean, status.id); changes.name = clean; }
  }
  if (color !== undefined) changes.color = color;
  if (behaviorType !== undefined) {
    if (!BEHAVIORS.includes(behaviorType)) throw bad('Invalid behaviorType');
    changes.behaviorType = behaviorType;
  }
  if (isDefault !== undefined) changes.isDefault = !!isDefault;
  await sequelize.transaction(async (transaction) => {
    if (changes.isDefault) await TaskStatus.update({ isDefault: false }, { where: { scope: status.scope }, transaction });
    await status.update(changes, { transaction });
    await assertBothBehaviors(status.scope, transaction);
  });
  await writeAudit(req, 'taskStatus.update', 'TaskStatus', status.id, changes);
  res.json({ status });
});

const remove = asyncHandler(async (req, res) => {
  const status = await statusFor(req.params.id);
  if (status.isProtected) throw bad('This status is protected and cannot be deleted', 'PROTECTED_STATUS');
  const used = await Task.count({ where: { statusId: status.id } });
  if (used) throw bad(`This status is used by ${used} task${used === 1 ? '' : 's'}; move them to another status first`, 'STATUS_IN_USE');
  await sequelize.transaction(async (transaction) => {
    await status.destroy({ transaction });
    await assertBothBehaviors(status.scope, transaction);
  });
  await writeAudit(req, 'taskStatus.delete', 'TaskStatus', status.id, { scope: status.scope, name: status.name });
  res.json({ ok: true });
});

// PUT /task-statuses/reorder { scope, order: [id, ...] } — the scope's whole list.
const reorder = asyncHandler(async (req, res) => {
  const { scope } = req.body || {};
  if (!SCOPES.includes(scope)) throw bad('scope must be ticket or project');
  const order = Array.isArray(req.body.order) ? req.body.order.map(parseRecordId) : [];
  const ids = (await TaskStatus.findAll({ where: { scope }, attributes: ['id'] })).map((s) => s.id);
  if (order.length !== ids.length || new Set(order).size !== ids.length || order.some((id) => !ids.includes(id))) {
    throw bad('order must list every status in the scope exactly once');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [i, id] of order.entries()) {
      await TaskStatus.update({ position: i }, { where: { id }, transaction }); // eslint-disable-line no-await-in-loop
    }
  });
  await writeAudit(req, 'taskStatus.reorder', 'TaskStatus', null, { scope, order });
  res.json({ statuses: await TaskStatus.findAll({ where: { scope }, order: [['position', 'ASC'], ['id', 'ASC']] }) });
});

module.exports = { create, update, remove, reorder };
```

In `routes/index.js`, next to the `GET /task-statuses` line:

```js
const taskStatuses = require('../controllers/taskStatusesController');
const manageStatuses = requirePermission('settings.manage_statuses');
router.post('/task-statuses', guard, manageStatuses, taskStatuses.create);
router.put('/task-statuses/reorder', guard, manageStatuses, taskStatuses.reorder);
router.patch('/task-statuses/:id', guard, manageStatuses, taskStatuses.update);
router.delete('/task-statuses/:id', guard, manageStatuses, taskStatuses.remove);
```

Import `requirePermission` in `routes/index.js` if it isn't already.

The test `afterEach` restores the 'In progress' row by `position: 1`. If seeding gave it another position, use its id from `taskStatusId(…, 'ticket', 'In progress')` captured once in `beforeAll`, and record a ruling.

- [ ] **Step 4: Run it (pass), then commit**

```bash
git add -A -- backend/src/controllers/taskStatusesController.js backend/src/routes/index.js backend/test/integration/settings.taskstatuses.test.js
git commit -m "feat(settings): edit the ticket-task and project-task status lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Work types are editable

**Files:**
- Create: `backend/src/controllers/workTypesController.js`, `backend/test/integration/settings.worktypes.test.js`
- Modify: `backend/src/routes/index.js`

**Interfaces:**
- Produces, all except GET needing `settings.manage_system`:
  - `POST /work-types { name, billableDefault?, isActive? }`;
  - `PATCH /work-types/:id { name?, billableDefault?, isActive? }`;
  - `DELETE /work-types/:id`.

  A work type in use can't be deleted (409 `WORK_TYPE_IN_USE`; deactivate it instead), and at least one stays active.

- [ ] **Step 1: Test**

`backend/test/integration/settings.worktypes.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, makeTech, makeTicket } = require('./fixtures');

// Work types are editable (spec: WorkTypes): a type in use is deactivated,
// not deleted, and at least one stays active.

let w;
const created = [];
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(async () => {
  await models.TimeEntry.destroy({ where: { workTypeId: created } });
  await models.WorkType.destroy({ where: { id: created.splice(0) } });
  await models.WorkType.update({ isActive: true }, { where: {} }); // seeded types are not reset
});
afterAll(closeDb);

const err = (message, code = 'VALIDATION_ERROR') => ({ error: true, message, code });
const make = async (body) => {
  const { workType } = expectOk(await w.admin.agent.post(`${API}/work-types`).send(body), 201);
  created.push(workType.id);
  return workType;
};

it('creates and edits a work type', async () => {
  const t = await make({ name: 'Training', billableDefault: false });
  expect(t).toEqual(expect.objectContaining({ name: 'Training', billableDefault: false, isActive: true }));
  const edited = expectOk(await w.admin.agent.patch(`${API}/work-types/${t.id}`).send({ name: 'Training (internal)', billableDefault: true })).workType;
  expect([edited.name, edited.billableDefault]).toEqual(['Training (internal)', true]);
  const dup = await w.admin.agent.post(`${API}/work-types`).send({ name: 'On-site' });
  expect(dup.body).toEqual(err('A work type with that name already exists'));
});

it('a type in use is deactivated, not deleted; inactive types aren\'t offered for new time', async () => {
  const t = await make({ name: 'Training' });
  const ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 5, workTypeId: t.id }), 201);
  const res = await w.admin.agent.delete(`${API}/work-types/${t.id}`);
  expect([res.status, res.body]).toEqual([409, err('This work type is used by time entries; deactivate it instead', 'WORK_TYPE_IN_USE')]);
  expectOk(await w.admin.agent.patch(`${API}/work-types/${t.id}`).send({ isActive: false }));
  expect((await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 5, workTypeId: t.id })).body.message)
    .toBe('Unknown work type');
});

it('an unused type is deleted; the last active type can\'t be deactivated', async () => {
  const t = await make({ name: 'Spare' });
  expectOk(await w.admin.agent.delete(`${API}/work-types/${t.id}`));
  created.splice(created.indexOf(t.id), 1);
  const all = expectOk(await w.admin.agent.get(`${API}/work-types`)).workTypes;
  const [last, ...rest] = all;
  await models.WorkType.update({ isActive: false }, { where: { id: rest.map((x) => x.id) } });
  expect((await w.admin.agent.patch(`${API}/work-types/${last.id}`).send({ isActive: false })).body)
    .toEqual(err('At least one work type must stay active'));
});

it('editing needs settings.manage_system', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  expect((await tech.agent.post(`${API}/work-types`).send({ name: 'x' })).status).toBe(403);
});
```

- [ ] **Step 2: Run it (fail)**

- [ ] **Step 3: The controller**

`backend/src/controllers/workTypesController.js`:

```js
// Editing the work types (Remote support, On-site, ...). Reading is
// GET /work-types (workCatalogController). A type in use is deactivated,
// never deleted, and at least one type stays active.
const { Op } = require('sequelize');
const { WorkType, TimeEntry } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');

const bad = (message, code = 'VALIDATION_ERROR', status = 400) => new ApiError(status, message, code);
const cleanName = (name) => (typeof name === 'string' ? name.trim() : '');

async function typeFor(rawId) {
  const id = parseRecordId(rawId);
  const type = id && await WorkType.findByPk(id);
  if (!type) throw new ApiError(404, 'Work type not found', 'NOT_FOUND');
  return type;
}

async function assertNameFree(name, exceptId = 0) {
  if (await WorkType.findOne({ where: { name, id: { [Op.ne]: exceptId } } })) throw bad('A work type with that name already exists');
}

const create = asyncHandler(async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) throw bad('Work type name is required');
  await assertNameFree(name);
  const maxPosition = await WorkType.max('position');
  const workType = await WorkType.create({
    name,
    billableDefault: req.body.billableDefault === undefined ? true : !!req.body.billableDefault,
    isActive: req.body.isActive === undefined ? true : !!req.body.isActive,
    position: (Number.isFinite(maxPosition) ? maxPosition : -1) + 1,
  });
  await writeAudit(req, 'workType.create', 'WorkType', workType.id, { name });
  res.status(201).json({ workType });
});

const update = asyncHandler(async (req, res) => {
  const workType = await typeFor(req.params.id);
  const changes = {};
  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) throw bad('Work type name is required');
    if (name !== workType.name) { await assertNameFree(name, workType.id); changes.name = name; }
  }
  if (req.body?.billableDefault !== undefined) changes.billableDefault = !!req.body.billableDefault;
  if (req.body?.isActive !== undefined) changes.isActive = !!req.body.isActive;
  if (changes.isActive === false && workType.isActive) {
    const others = await WorkType.count({ where: { isActive: true, id: { [Op.ne]: workType.id } } });
    if (!others) throw bad('At least one work type must stay active');
  }
  await workType.update(changes);
  await writeAudit(req, 'workType.update', 'WorkType', workType.id, changes);
  res.json({ workType });
});

const remove = asyncHandler(async (req, res) => {
  const workType = await typeFor(req.params.id);
  if (await TimeEntry.count({ where: { workTypeId: workType.id } })) {
    throw bad('This work type is used by time entries; deactivate it instead', 'WORK_TYPE_IN_USE', 409);
  }
  if (workType.isActive && !(await WorkType.count({ where: { isActive: true, id: { [Op.ne]: workType.id } } }))) {
    throw bad('At least one work type must stay active');
  }
  await workType.destroy();
  await writeAudit(req, 'workType.delete', 'WorkType', workType.id, { name: workType.name });
  res.json({ ok: true });
});

module.exports = { create, update, remove };
```

Routes in `routes/index.js`:

```js
const workTypes = require('../controllers/workTypesController');
const manageSystem = requirePermission('settings.manage_system');
router.post('/work-types', guard, manageSystem, workTypes.create);
router.patch('/work-types/:id', guard, manageSystem, workTypes.update);
router.delete('/work-types/:id', guard, manageSystem, workTypes.remove);
```

- [ ] **Step 4: Run it (pass), then commit**

```bash
git add -A -- backend/src/controllers/workTypesController.js backend/src/routes/index.js backend/test/integration/settings.worktypes.test.js
git commit -m "feat(settings): edit work types (deactivate in use, keep one active)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Whole suite, docs, final review

- [ ] **Step 1: Every test**

Run in the background, one after the other: `cd backend && npm test > <scratch>/3b2-full.log 2>&1; npm run test:smoke > <scratch>/3b2-smoke.log 2>&1; grep -E "^(FAIL|Tests:)" <scratch>/3b2-full.log <scratch>/3b2-smoke.log`
Expected: both green.

Then run `grep -rn "\[quirk\]" backend/test/integration`.
Expected: no output. Every baseline quirk is now fixed.

- [ ] **Step 2: Docs**

- **`UPGRADING.md`:** under the work-model section, add a sub-list "**Part 2: who may change what**":
  - writes to a ticket's or project's own data (fields, tasks, relations, custom field values, members, expenses, materials, delete) now check the edit tier against the record. `tickets.edit_own` means tickets assigned to you; the department tier means your department's. System Technician is granted `tickets.edit_all` and `projects.edit_all`, so it is unaffected. Department Staff can now edit only tickets assigned to them;
  - logging your own time needs `time.log` and view access to the ticket or project. `projects.log_time` is removed;
  - a linked ticket you can't open shows as "Restricted ticket" (id only);
  - task statuses and work types are editable (API now; screens in the next update);
  - deleting a project now deletes its tasks, time, expenses, materials, files, members and activity;
  - the smaller fixes: custom field values are validated, ticket and project statuses must exist, blank titles are refused, a new lead becomes a member, escalate sets priority critical, a ticket created closed obeys "require time before close", and two tickets link once;
  - rolling the migration back removes System Technician's `edit_all` grants even if an install had given them earlier.

  In the time-permission bullet written by plan 3b-1, replace the "Until the next part of this work checks the edit tier, …" sentence with "Logging your own time needs view access to the ticket or project; `projects.log_time` is gone."
- **`docs/superpowers/specs/2026-10-03-test-baseline-design.md`:** every remaining "3" in the last column becomes `3 (fixed in plan 3b-2)`; Q28's "2" becomes `2 (fixed in plan 3b-2)`. Delete the note "Q8, Q23, Q25 and Q38 are fixed for tasks in plan 3b-1…" and write "Every quirk is now fixed (plans 3b-1 and 3b-2)."
- **`docs/ROADMAP.md`:** sub-project 3's Plan column adds `[plan 3b-2](superpowers/plans/2026-10-06-work-model-access.md) (access and remaining fixes)`, and "3b-2 (access and remaining fixes) and 3c (the screens) next" becomes "3c (the screens) next".
- **`docs/superpowers/specs/2026-10-05-one-work-model-design.md`:** under *Permissions*, after the `time.log` bullet, add "**Changed by the user on 2026-10-06:** logging your own time needs view access, not the edit tier — people log time on tickets they helped with."

- [ ] **Step 3: Commit the docs**

```bash
git add -A -- UPGRADING.md docs
git commit -m "docs: one work model part 2 — access and fixes in upgrading notes, roadmap, quirk table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final review**

Run two fresh reviewers on the most capable model, in parallel:
- a whole-branch review against this plan and the spec;
- a security review, because this plan changes who may edit and delete records.

Fix Critical and Important findings in one pass, each with a test that fails first. Defer minors to the ledger. Push only when the user says so.
