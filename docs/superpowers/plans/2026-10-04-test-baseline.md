# Test Baseline (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin down, as integration tests, how PRISM's tickets, projects, tasks, subtasks, time, timer and the readers of time data behave today, and fix the security gaps found doing it, so that sub-projects 2 and 3 fail loudly when they change something by accident.

**Architecture:** One new Jest file per area in `backend/test/integration/`, driving the real Express app through supertest against the migrated `prism_test` MariaDB schema (the existing harness in `helpers.js`). A new `fixtures.js` builds every record through the HTTP API. Time-dependent tests fake only `Date`. Behaviour that is probably wrong is pinned as-is and tagged `[quirk]`. Security gaps (S1–S5) are fixed test-first.

**Tech Stack:** Node 24.9+, Jest 30, supertest 7, Sequelize 6 + MariaDB 11, Express 4. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-03-test-baseline-design.md`](../specs/2026-10-03-test-baseline-design.md). Read it before starting. Where this plan differs from it, the **Corrections to the spec** section below wins. The last task writes those corrections back into the spec.

## Global Constraints

- Node `>=24.9`. Run tests from `backend/` with `npm test` (whole suite) or `npm run test:integration -- <file>` (one file). Both pass `--experimental-vm-modules`; plain `npx jest` does not, so don't use it.
- The local test database is the `prism-test-db` container (`mariadb:11`) on `127.0.0.1:3307`, matching `backend/.env.test`. Start it with `docker start prism-test-db`. If it is missing, recreate it and migrate:
  `docker run -d --name prism-test-db -p 127.0.0.1:3307:3306 -e MARIADB_DATABASE=prism_test -e MARIADB_USER=prism -e MARIADB_PASSWORD=prismtestpw -e MARIADB_ROOT_PASSWORD=roottestpw mariadb:11`, wait about 10 seconds, then run `npm run test:migrate`.
- `backend/.env.test` sets `UPLOAD_DIR` to a scratch directory from an older session. If upload tests fail with ENOENT, point `UPLOAD_DIR` at a directory that exists. The file is git-ignored, so this is a local fix only. CI sets its own `UPLOAD_DIR`.
- Use backend integration tests through the HTTP API only: no frontend tests, no snapshots, no mocked models.
- Read assertions from the API wherever it exposes the result. Use direct model reads only for:
  - `AuditLog` rows (no endpoint reads them; see correction C1)
  - orphan-row checks for Q13
  - setup writes to columns no endpoint can set (`TimeEntry.loggedAt`, `ProjectTask.completedAt`)
  
  Each such read or write gets a one-line comment saying why.
- Behaviour changes are limited to S1–S5. Everything else that looks wrong gets a `[quirk]` test, never a fix.
- Name a quirk test `'[quirk] Qn: <what it pins>'` and put a comment on the line above it: `// Likely correct: <behaviour>. Expected to change in sub-project 3.`
- No test file exceeds roughly 800 lines. A file that would gets split into `<area>.<part>.test.js`.
- The CI workflow (`.github/workflows/test.yml`) does not change.
- Commit after every task, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `dev`.
- **When an assertion in this plan disagrees with what the code does:** first re-read the code.
  - If the plan misread it, correct the assertion and say so in the commit message.
  - If the code is doing something wrong but harmless, pin it as a new `[quirk]` (next free Q number) and add it to the quirk table in Task 19.
  - If it is a security or access bug, stop and raise it with the user before writing more.

## Review Focus

Five input classes the spec implies but no other test exercises. Each line names the input and the behaviour a reasonable person expects, most likely to bite first. Each has a test in the task that owns the code.

1. **Ids sent as strings** (`"3"` where `3` is meant), in bodies and in the `userId` "log for" fields. A user who passes their own id as a string is treated as themselves, not as "someone else" (Task 13, Step 1, case 12). A string `statusId` equal to the current one is not a status change; today it is, which is pinned as Q7 (Task 11).
2. **Non-numeric ids in URLs** (`/tickets/abc`, `/projects/abc/tasks/xyz`) should return 404, not 500 (Task 7, cases 15 and 27; Task 10, cases 9 and 30; Task 11, case 31).
3. **Durations across midnight UTC and the DST change** are measured instant to instant: 07:30Z→08:30Z on 2026-03-08 (US DST night) is exactly 60 minutes, and 23:30Z→00:30Z the next day is 60 minutes (Task 13, cases 6–7; Task 14, case 5).
4. **Readers with no data** return zeros, empty lists and `null` labour cost, never an error: a ticket with no time, a project with no tasks, every report on an empty install (Task 13, case 21; Task 14, case 22; Task 16, case 1; Task 17, case 1).
5. **Whitespace-only text** (`"   "`) for ticket title, comment body, ticket-task description, project name, project task and subtask title, expense description and material name is rejected with 400 `VALIDATION_ERROR` exactly like an empty value (Tasks 7, 8, 9, 10, 11, 12).

## Corrections to the spec (found while planning)

The planning pass read every handler in scope and ran throwaway probes against `prism_test`. These change the spec:

| # | Spec said | Actually | What the plan does |
|---|---|---|---|
| C1 | Assert audit rows through `/audit-log`. | `GET /audit-log` reads `SystemAuditLogs` (permission changes) only. `writeAudit()` rows go to `AuditLogs`, which no endpoint reads. | Assert `AuditLog` rows via `models.AuditLog`, which the spec's "direct reads only for state no endpoint shows" rule allows. Add `SystemAuditLogs` to the reset. |
| C2 | Teams with a lead and a user's `userType`/`hourlyRate` have no create endpoint, so build them through models. | `POST /teams` takes `members: [{ userId, isLead }]` (legacy `role: 'admin'` required), and `PATCH /users/:id` sets `userType`/`hourlyRate`. "Own"-tier users can be made with `POST /users/:id/overrides`. | Fixtures use the API for all of them. No fixture writes a model directly. |
| C3 | Q5: timer time has no `entryDate`. | `TimeEntry.entryDate` has a model default, so timer entries get the **UTC date at the moment the timer stops**. They still have no `startTime`, `endTime` or `loggedById`, and `loggedAt` is the timer's start. | Q5 is reworded to match. |
| C4 | S3/S4: an out-of-scope ticket is treated like a missing one. | A missing ticket is not consistent today. A missing `parentTicketId`/`childTicketIds`/`relatedTicketIds` on create gets 400 `FK_CONSTRAINT`. A missing `linkedTicketId` is **accepted** (201, dangling id, no foreign key on that column). | Missing and out-of-scope both become 400 `VALIDATION_ERROR` with the same message. That changes the missing-ticket response too, which is unavoidable if existence must not be probeable. Recorded in `UPGRADING.md`. |
| C5 | S1–S4 are the only gaps. | `POST /projects/:id/files` skips `verifyFileSignature`, which ticket attachments run. A Windows executable renamed `.pdf` is stored on a project. | Fixed as **S5**, test-first, under the spec's rule that security bugs found while writing tests are fixed here. |
| C6 | Q1–Q8 are the known quirks. | The probes found Q9–Q24. See the quirk table in Task 19. Q18, Q19 and Q21 are access-flavoured; they are pinned, and the handoff asks the user whether to promote any of them to S-fixes. | Pinned as `[quirk]`. |
| C7 | "Dates … tested at fixed instants including one where the UTC date and the server's local date differ." | CI runs in UTC and this machine in America/Chicago, so "local" differs between them. | `test/checkNodeVersion.js` (Jest `globalSetup`) pins `process.env.TZ = 'America/Chicago'` for every run, so local and CI behave the same. Probe-verified to reach both in-band and worker runs. |
| C8 | Roadmap rule 6: large existing files touched by the work are split as part of it. | `ticketsController.js` (1390 lines) and `projectsController.js` (1178) get small S-fixes here. | **Not split here.** Splitting them before the baseline exists would be the unprotected refactor the baseline is meant to prevent. Sub-project 3 rewrites both and splits them with these tests as the net. Flagged to the user at handoff. |

## Known facts the tests rely on (from code and probes)

- Seeded ticket statuses (`GET /api/v1/ticket-statuses` → `{ statuses }`) are Open, In Progress, Pending and On Hold (behaviour `open`), then Resolved and Closed (`closed`). No status has behaviour `archived`.
- Seeded project statuses (`GET /api/v1/project-statuses` → `{ statuses }`) are Active and On Hold (`open`), Completed (`closed`) and Archived (`archived`). Tests look ids up by name through the `projectStatusId` fixture rather than hard-coding them.
- Seeded role grants that matter here:
  - **System Technician**: `tickets.view_all`, `tickets.edit_own`, `projects.view_all`, `projects.edit_own`, `projects.log_time`, `projects.manage_expenses`, `projects.manage_members`, `tickets.view_private_comments`, `reports.view_department`, `reports.export`. No moderation, no `tickets.delete`.
  - **Department Manager**: `tickets.view_department`, `tickets.edit_department`, `projects.view_department`, `projects.edit_department`, `projects.log_time`, `projects.manage_expenses`, `projects.manage_members`, `tickets.view_private_comments`, `reports.view_department`, `reports.export`.
  - **Department Staff**: `tickets.view_department`, `tickets.edit_own`, `tickets.create`, `tickets.manage_watchers`, `projects.view_department`, `projects.log_time`, `reports.view_own`. No `projects.edit_*`, no private comments.
  - **Read Only**: `tickets.view_department`, `projects.view_department`, `reports.view_own`.
  - No seeded role is "own"-tier for tickets or projects. The `makeOwnTier` fixture makes one with overrides.
- `SystemSettings` has no seeded rows. Everything comes from `DEFAULTS` in `settingsController.js`, so tests can delete any row they set.
- Error bodies are always `{ error: true, message, code }`.
- `laborCost` comes back as a JSON number (`113.13`), not a string. It is `null` for internal staff.
- `User.displayName` is `Test <username>` for users made by `createUser()`.
- `POST /departments` upper-cases `shortCode`.
- `resetData()` does not truncate `ProjectActivities` or `ProjectIdSequences` today. Because ids restart at 1, a new project 1 inherits the previous suite's activity, and project codes keep counting (`SD-P00002`, …). Task 1 fixes the reset.

---

### Task 1: Test infrastructure — reset, time zone, fixtures

**Files:**
- Modify: `backend/test/integration/helpers.js` (the `resetData()` table list and the settings cleanup)
- Modify: `backend/test/checkNodeVersion.js` (pin TZ)
- Create: `backend/test/integration/fixtures.js`
- Create: `backend/test/integration/fixtures.test.js`

**Interfaces:**
- Produces, from `fixtures.js`, the following. Every builder throws `Error("<METHOD> <path> → <status> (wanted <n>): <body>")` on an unexpected status.
  - `API`: the string `'/api/v1'`.
  - `expectOk(res, status = 200) → res.body`.
  - `makeAdmin(username = 'admin') → { user, agent, password }`, with legacy role `admin`.
  - `makeDept(admin, name, shortCode) → department`.
  - `makeUser(username, roleName, departmentId) → { user, agent, password }`.
  - `makeTech(username, departmentId)`: a System Technician.
  - `makeManager(username, departmentId)`: a Department Manager.
  - `makeStaff(username, departmentId)`: Department Staff.
  - `makeOwnTier(admin, username, departmentId)`: Department Staff narrowed to own-tier on tickets and projects.
  - `makeContractor(admin, username, departmentId, { rate })`: a technician with `userType: 'contractor'` and `hourlyRate: rate`, which may be `null`.
  - `makeContact(admin, fields = {}) → contact`. Defaults: `firstName: 'Casey'`, `lastName: 'Contact'`, and a unique `email`.
  - `makeTicket(agent, fields) → ticket`. `fields.contactId` is required.
  - `makeProject(agent, fields) → project`. `fields.ownerDepartmentId` is required.
  - `makeTask(agent, projectId, fields = {}) → task`. Default title `'Task'`.
  - `makeSubtask(agent, projectId, taskId, fields = {}) → subtask`. Default title `'Subtask'`.
  - `makeTeam(admin, name, members) → team`, where `members` is `[{ userId, isLead }]`.
  - `setSettings(admin, settings) → settings`.
  - `projectStatusId(agent, name) → number`.
  - `freezeClock(iso)`, `advanceClock(ms)`, `unfreezeClock()`.
  - `waitFor(predicate, timeoutMs = 2000)`: polls with real timers, for fire-and-forget work.
  - `makeWorld() → { admin, deptA, deptB, contact }`, where `deptA` is Service Desk/`SD` and `deptB` is Facilities/`FAC`.

- [ ] **Step 1: Write the failing infrastructure tests**

`backend/test/integration/fixtures.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeTicket, makeProject,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Guards for the harness itself: if these fail, every baseline suite's
// results are suspect.

afterAll(closeDb);
afterEach(unfreezeClock);

describe('resetData()', () => {
  it('restarts project codes and drops the previous run\'s project activity', async () => {
    await resetData();
    const w = await makeWorld();
    const p1 = await makeProject(w.admin.agent, { name: 'First', ownerDepartmentId: w.deptA.id });
    expect(p1.projectCode).toBe('SD-P00001');

    await resetData();
    const w2 = await makeWorld();
    const p2 = await makeProject(w2.admin.agent, { name: 'Second', ownerDepartmentId: w2.deptA.id });
    expect(p2.projectCode).toBe('SD-P00001');
    const activity = expectOk(await w2.admin.agent.get(`${API}/projects/${p2.id}/activity`)).activity;
    expect(activity.map((a) => a.detail.name)).toEqual(['Second']);
  });

  it('clears settings the baseline flips', async () => {
    await resetData();
    const w = await makeWorld();
    expectOk(await w.admin.agent.patch(`${API}/settings`).send({
      'timeTracking.requireBeforeClose': 'true', 'csat.enabled': 'true',
    }));
    await resetData();
    // No endpoint distinguishes "unset" from "set to the default".
    const keys = (await models.SystemSettings.findAll({ raw: true })).map((r) => r.key);
    expect(keys).not.toContain('timeTracking.requireBeforeClose');
    expect(keys).not.toContain('csat.enabled');
  });
});

describe('time zone', () => {
  it('runs every suite in America/Chicago so UTC and local dates can differ', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Chicago');
    expect(new Date('2026-03-10T03:30:00Z').getDate()).toBe(9);
  });
});

describe('fixtures', () => {
  beforeEach(resetData);

  it('makes an own-tier user who sees only tickets assigned to them', async () => {
    const w = await makeWorld();
    const own = await makeOwnTier(w.admin, 'owner', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: own.user.id });
    const theirs = await makeTicket(w.admin.agent, { title: 'Theirs', contactId: w.contact.id, departmentId: w.deptA.id });
    expect((await own.agent.get(`${API}/tickets/${mine.id}`)).status).toBe(200);
    expect((await own.agent.get(`${API}/tickets/${theirs.id}`)).status).toBe(403);
  });

  it('makes a contractor whose time carries labour cost', async () => {
    const w = await makeWorld();
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
    const entry = expectOk(await ctr.agent.post(`${API}/tickets/${t.id}/time`).send({ minutes: 30 }), 201).entry;
    expect(entry.laborCost).toBe(30);
  });

  it('freezes only Date, leaving the database driver\'s timers alone', async () => {
    freezeClock('2026-03-10T03:30:00Z');
    const w = await makeWorld();
    const tech = await makeTech('clocky', w.deptA.id);
    const t = await makeTicket(tech.agent, { title: 'T', contactId: w.contact.id });
    expect(t.createdAt).toBe('2026-03-10T03:30:00.000Z');
    advanceClock(90 * 1000);
    expect(new Date().toISOString()).toBe('2026-03-10T03:31:30.000Z');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm run test:integration -- fixtures.test.js`
Expected: FAIL with `Cannot find module './fixtures'`.

- [ ] **Step 3: Pin the time zone**

In `backend/test/checkNodeVersion.js`, add this as the first line inside the exported async function, before the version check:

```js
  // Every suite runs in a fixed non-UTC zone so tests that depend on "the
  // local date" behave the same on a developer machine and on the UTC CI
  // runner. Set here, in globalSetup, because assigning TZ inside a test
  // file's VM context does not reach Node's date handling; workers spawned
  // after globalSetup inherit it.
  process.env.TZ = 'America/Chicago';
```

Also change the file's header comment's first line from `// Runs once before the suite.` to `// Runs once before the suite: pins the time zone, then checks the Node version.`

- [ ] **Step 4: Extend `resetData()`**

In `backend/test/integration/helpers.js`, replace the `tables` array and the `SystemSettings` cleanup inside `resetData()` with:

```js
  const tables = [
    'Comments', 'Attachments', 'TicketWatchers', 'TicketTasks', 'TicketActivities',
    'TicketRelations', 'TicketFieldValues', 'TimeEntries', 'ActiveTimers',
    'CsatSurveys', 'CsatResponses', 'AssetTickets', 'Notifications', 'Tickets', 'Contacts',
    // Project child tables truncate with Projects: TRUNCATE resets
    // AUTO_INCREMENT, so a project created by the next test reuses id 1 and
    // would otherwise inherit the previous test's expenses/time/materials.
    'ProjectExpenses', 'ProjectMaterials', 'ProjectTimeEntries', 'ProjectFiles',
    'ProjectActivities', 'ProjectMembers', 'ProjectSubtasks', 'ProjectTasks',
    'ProjectIdSequences', 'Projects',
    'WorkflowRuleLogs', 'WorkflowActions', 'WorkflowConditions', 'WorkflowRules',
    'AssignmentRules', 'CustomFields', 'TeamMembers', 'Teams',
    'AuditLogs', 'SystemAuditLogs',
    'SsoAuthRequests', 'SsoGroupMappings', 'SsoIdentities', 'SsoProviders',
    'UserRoles', 'UserPermissionOverrides', 'ApiKeys', 'Sessions', 'Users', 'Departments',
  ];
```

and

```js
  // SystemSettings is not truncated (other code relies on any rows an
  // install has), but settings a test flips must not leak into the next one —
  // SSO enforcement in particular would fail every subsequent login.
  await sequelize.query(
    "DELETE FROM SystemSettings WHERE `key` LIKE 'sso.%' OR `key` LIKE 'timeTracking.%' "
    + "OR `key` LIKE 'csat.%' OR `key` = 'notifications.enabledTypes'"
  ).catch(() => {});
```

- [ ] **Step 5: Write `fixtures.js`**

`backend/test/integration/fixtures.js`:

```js
// Builders for the baseline suites. Every record is created through the HTTP
// API, so setup runs the same code paths the tests check. Each builder throws
// with the response body when the API refuses, so a broken fixture fails at
// the line that built it rather than three assertions later.
const { jest } = require('@jest/globals');
const { createUserAndLogin, ROLE } = require('./helpers');

const API = '/api/v1';

function expectOk(res, status = 200) {
  if (res.status !== status) {
    throw new Error(
      `${res.req.method} ${res.req.path} → ${res.status} (wanted ${status}): ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

// legacyRole 'admin' matters: logging time for others, deleting other
// people's time and managing teams still check User.role (quirk Q6).
function makeAdmin(username = 'admin') {
  return createUserAndLogin({ username, roleName: ROLE.ADMIN, legacyRole: 'admin' });
}

async function makeDept(admin, name, shortCode) {
  return expectOk(await admin.agent.post(`${API}/departments`).send({ name, shortCode }), 201).department;
}

function makeUser(username, roleName, departmentId) {
  return createUserAndLogin({ username, roleName, departmentId });
}
const makeTech = (username, departmentId) => makeUser(username, ROLE.TECHNICIAN, departmentId);
const makeManager = (username, departmentId) => makeUser(username, ROLE.DEPARTMENT_MANAGER, departmentId);
const makeStaff = (username, departmentId) => makeUser(username, ROLE.DEPARTMENT_STAFF, departmentId);

// No seeded role is "own"-tier, so narrow Department Staff with overrides.
const OWN_TIER_OVERRIDES = [
  ['tickets.view_department', false], ['tickets.view_own', true],
  ['projects.view_department', false], ['projects.view_own', true], ['projects.edit_own', true],
];
async function makeOwnTier(admin, username, departmentId) {
  const u = await makeStaff(username, departmentId);
  for (const [permissionKey, granted] of OWN_TIER_OVERRIDES) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(await admin.agent.post(`${API}/users/${u.user.id}/overrides`).send({ permissionKey, granted }), 201);
  }
  return u;
}

async function makeContractor(admin, username, departmentId, { rate }) {
  const u = await makeTech(username, departmentId);
  expectOk(await admin.agent.patch(`${API}/users/${u.user.id}`).send({ userType: 'contractor', hourlyRate: rate }));
  return u;
}

let contactSeq = 0;
async function makeContact(admin, fields = {}) {
  contactSeq += 1;
  const body = { firstName: 'Casey', lastName: 'Contact', email: `contact${contactSeq}@example.com`, ...fields };
  return expectOk(await admin.agent.post(`${API}/contacts`).send(body), 201).contact;
}

async function makeTicket(agent, fields) {
  return expectOk(await agent.post(`${API}/tickets`).send(fields), 201).ticket;
}

async function makeProject(agent, fields) {
  return expectOk(await agent.post(`${API}/projects`).send(fields), 201).project;
}

async function makeTask(agent, projectId, fields = {}) {
  return expectOk(await agent.post(`${API}/projects/${projectId}/tasks`).send({ title: 'Task', ...fields }), 201).task;
}

async function makeSubtask(agent, projectId, taskId, fields = {}) {
  const res = await agent.post(`${API}/projects/${projectId}/tasks/${taskId}/subtasks`).send({ title: 'Subtask', ...fields });
  return expectOk(res, 201).subtask;
}

async function makeTeam(admin, name, members) {
  return expectOk(await admin.agent.post(`${API}/teams`).send({ name, members }), 201).team;
}

async function setSettings(admin, settings) {
  return expectOk(await admin.agent.patch(`${API}/settings`).send(settings)).settings;
}

async function projectStatusId(agent, name) {
  const { statuses } = expectOk(await agent.get(`${API}/project-statuses`));
  const found = statuses.find((s) => s.name === name);
  if (!found) throw new Error(`project status "${name}" not seeded`);
  return found.id;
}

// Fakes Date and nothing else: the MariaDB driver and supertest need real
// timers. Only freeze to instants earlier than the real clock, and don't
// reuse an agent after unfreezing: the session cookie is rolling, so a
// request made under the frozen clock re-dates its expiry from that clock.
const REAL_TIMERS = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
  'clearInterval', 'setTimeout', 'clearTimeout',
];
function freezeClock(iso) {
  jest.useFakeTimers({ doNotFake: REAL_TIMERS, now: new Date(iso) });
}
function advanceClock(ms) {
  jest.setSystemTime(new Date(Date.now() + ms));
}
function unfreezeClock() {
  jest.useRealTimers();
}

// For fire-and-forget work (the reply email): polls until `predicate()` is
// true, or throws after `timeoutMs`. Counts attempts rather than reading
// Date.now(), which a frozen clock would stop.
async function waitFor(predicate, timeoutMs = 2000) {
  for (let waited = 0; !predicate(); waited += 25) {
    if (waited >= timeoutMs) throw new Error('waitFor: condition not met in time');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

async function makeWorld() {
  const admin = await makeAdmin();
  const deptA = await makeDept(admin, 'Service Desk', 'SD');
  const deptB = await makeDept(admin, 'Facilities', 'FAC');
  const contact = await makeContact(admin);
  return { admin, deptA, deptB, contact };
}

module.exports = {
  API, expectOk, makeAdmin, makeDept, makeUser, makeTech, makeManager, makeStaff, makeOwnTier,
  makeContractor, makeContact, makeTicket, makeProject, makeTask, makeSubtask, makeTeam,
  setSettings, projectStatusId, freezeClock, advanceClock, unfreezeClock, waitFor, makeWorld,
};
```

- [ ] **Step 6: Run the infrastructure tests**

Run: `cd backend && npm run test:integration -- fixtures.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the whole existing suite**

Run: `cd backend && npm test`
Expected: PASS. All 15 pre-existing suites still pass, now under America/Chicago and with the longer reset. If an existing suite fails because of the time zone, that suite depended on running in UTC: fix the suite by making its date arithmetic explicit, not by unpinning TZ, and say so in the commit.

- [ ] **Step 8: Commit**

```bash
git add backend/test/checkNodeVersion.js backend/test/integration/helpers.js backend/test/integration/fixtures.js backend/test/integration/fixtures.test.js
git commit -m "test: baseline fixtures, fuller reset, pinned test time zone"
```

---

### Task 2: S1 — subtask delete must check the task belongs to the project

**Files:**
- Create: `backend/test/integration/projects.tasks.test.js` (Task 11 completes it)
- Modify: `backend/src/controllers/projectsController.js` (`removeSubtask`)

**Interfaces:**
- Consumes: `fixtures.js` (Task 1).
- Produces: the `projects.tasks.test.js` header (imports and the `makeWorld`-based setup) that Tasks 5 and 11 extend.

- [ ] **Step 1: Write the failing test**

Create `backend/test/integration/projects.tasks.test.js`:

```js
const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeOwnTier, makeTicket, makeProject, makeTask,
  makeSubtask, projectStatusId, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S1: DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId', () => {
  it('refuses a task from another project, leaving its subtask in place', async () => {
    // A Department Manager in A can edit A's projects, not B's.
    const mgr = await makeManager('mgr', w.deptA.id);
    const projA = await makeProject(w.admin.agent, { name: 'A', ownerDepartmentId: w.deptA.id });
    const projB = await makeProject(w.admin.agent, { name: 'B', ownerDepartmentId: w.deptB.id });
    const taskB = await makeTask(w.admin.agent, projB.id, { title: 'B task' });
    const subB = await makeSubtask(w.admin.agent, projB.id, taskB.id, { title: 'B sub' });

    const res = await mgr.agent.delete(`${API}/projects/${projA.id}/tasks/${taskB.id}/subtasks/${subB.id}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Task not found');

    const tasks = expectOk(await w.admin.agent.get(`${API}/projects/${projB.id}/tasks`)).tasks;
    expect(tasks[0].subtasks.map((s) => s.id)).toEqual([subB.id]);
  });

  it('still deletes a subtask through its own project', async () => {
    const mgr = await makeManager('mgr', w.deptA.id);
    const projA = await makeProject(w.admin.agent, { name: 'A', ownerDepartmentId: w.deptA.id });
    const task = await makeTask(mgr.agent, projA.id);
    const sub = await makeSubtask(mgr.agent, projA.id, task.id);
    expectOk(await mgr.agent.delete(`${API}/projects/${projA.id}/tasks/${task.id}/subtasks/${sub.id}`));
    const tasks = expectOk(await mgr.agent.get(`${API}/projects/${projA.id}/tasks`)).tasks;
    expect(tasks[0].subtasks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch the first test fail**

Run: `cd backend && npm run test:integration -- projects.tasks.test.js`
Expected: FAIL on "refuses a task from another project", with `Expected: 404, Received: 200`. That proves the gap. The second test passes.

- [ ] **Step 3: Fix `removeSubtask`**

In `backend/src/controllers/projectsController.js`, replace the body of `removeSubtask` so it loads the task through the project first, as `updateSubtask` does:

```js
// DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId
const removeSubtask = asyncHandler(async (req, res) => {
  // The task is loaded through the project first: access is checked on
  // project :id, so a :taskId from another project must not be reachable
  // through it.
  const task = await ProjectTask.findOne({ where: { id: req.params.taskId, projectId: req.params.id } });
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  const subtask = await ProjectSubtask.findOne({ where: { id: req.params.subtaskId, taskId: task.id } });
  if (!subtask) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await subtask.destroy();
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npm run test:integration -- projects.tasks.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/projectsController.js backend/test/integration/projects.tasks.test.js
git commit -m "fix(projects): subtask delete checks the task belongs to the project (S1)"
```

---

### Task 3: S2 — the timer must check ticket access

**Files:**
- Create: `backend/test/integration/time.timer.test.js` (Task 15 completes it)
- Modify: `backend/src/controllers/timerController.js` (`start`)

**Interfaces:**
- Consumes: `fixtures.js`.
- Produces: the `time.timer.test.js` header that Task 15 extends.

- [ ] **Step 1: Write the failing test**

Create `backend/test/integration/time.timer.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeContractor, makeTicket,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S2: POST /timer/start checks access to the ticket', () => {
  it('refuses a ticket the user cannot see, and starts nothing', async () => {
    // Department Staff holds projects.log_time (so the route lets them in)
    // but sees only department A's tickets.
    const staff = await makeStaff('staff', w.deptA.id);
    const other = await makeTicket(w.admin.agent, { title: 'B only', contactId: w.contact.id, departmentId: w.deptB.id });

    const res = await staff.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: other.id });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: true, message: 'You do not have access to this ticket', code: 'FORBIDDEN' });
    expect(expectOk(await staff.agent.get(`${API}/timer`)).timer).toBeNull();
  });

  it('still starts on a ticket the user can see', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    const mine = await makeTicket(w.admin.agent, { title: 'A', contactId: w.contact.id, departmentId: w.deptA.id });
    const res = await staff.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: mine.id });
    expect(res.status).toBe(201);
    expect(res.body.timer.id).toBe(mine.id);
  });
});
```

- [ ] **Step 2: Run it and watch the first test fail**

Run: `cd backend && npm run test:integration -- time.timer.test.js`
Expected: FAIL with `Expected: 403, Received: 201`.

- [ ] **Step 3: Fix `start`**

In `backend/src/controllers/timerController.js`, add `canAccessTicket` to the requires:

```js
const { canAccessTicket } = require('../services/permissionService');
```

and replace the line `if (!(await Ticket.findByPk(targetId))) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');` with:

```js
  const ticket = await Ticket.findByPk(targetId);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  // Same rule as every other ticket route: a timer logs time to the ticket
  // when it stops, so starting one needs access to it.
  if (!(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npm run test:integration -- time.timer.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/timerController.js backend/test/integration/time.timer.test.js
git commit -m "fix(timer): starting a timer checks access to the ticket (S2)"
```

---

### Task 4: S3 — ticket links must not reach tickets the user cannot see

**Files:**
- Create: `backend/test/integration/tickets.extras.test.js` (Task 8 completes it)
- Modify: `backend/src/services/permissionService.js` (add `findAccessibleTicket`)
- Modify: `backend/src/controllers/ticketsController.js` (`create`, `createRelation`)

**Interfaces:**
- Produces: `findAccessibleTicket(user, ticketId) → Promise<Ticket|null>`, exported from `permissionService.js`. It returns `null` for a missing id, a non-numeric id, or a ticket the user cannot access. Task 5 uses it.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/integration/tickets.extras.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeContact, makeTicket,
  makeTeam, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('S3: links never reach a ticket the user cannot see', () => {
  let staff;
  let mine;
  let hidden;
  beforeEach(async () => {
    staff = await makeStaff('staff', w.deptA.id);
    mine = await makeTicket(w.admin.agent, { title: 'Mine', contactId: w.contact.id, departmentId: w.deptA.id });
    hidden = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
  });

  it('POST /:id/relations treats an out-of-scope target exactly like a missing one', async () => {
    const outOfScope = await staff.agent.post(`${API}/tickets/${mine.id}/relations`).send({ relatedTicketId: hidden.id });
    const missing = await staff.agent.post(`${API}/tickets/${mine.id}/relations`).send({ relatedTicketId: 99999 });
    expect(outOfScope.status).toBe(404);
    expect(outOfScope.body).toEqual(missing.body);
    expect(missing.body).toEqual({ error: true, message: 'Related ticket not found', code: 'NOT_FOUND' });
    const rels = expectOk(await w.admin.agent.get(`${API}/tickets/${mine.id}/relations`)).relations;
    expect(rels).toEqual([]);
  });

  it.each([
    ['parentTicketId', (id) => ({ parentTicketId: id })],
    ['childTicketIds', (id) => ({ childTicketIds: [id] })],
    ['relatedTicketIds', (id) => ({ relatedTicketIds: [id] })],
  ])('create with %s: out-of-scope and missing get the same 400', async (_name, link) => {
    const base = { title: 'New', contactId: w.contact.id, departmentId: w.deptA.id };
    const outOfScope = await staff.agent.post(`${API}/tickets`).send({ ...base, ...link(hidden.id) });
    const missing = await staff.agent.post(`${API}/tickets`).send({ ...base, ...link(99999) });
    expect(outOfScope.status).toBe(400);
    expect(outOfScope.body).toEqual({ error: true, message: 'Linked ticket not found', code: 'VALIDATION_ERROR' });
    expect(missing.body).toEqual(outOfScope.body);
    // Nothing was created by either refused request.
    const list = expectOk(await w.admin.agent.get(`${API}/tickets`)).tickets;
    expect(list.map((t) => t.title).sort()).toEqual(['Mine', 'Secret']);
  });

  it('create still links tickets the user can see', async () => {
    const res = await staff.agent.post(`${API}/tickets`).send({
      title: 'Child', contactId: w.contact.id, departmentId: w.deptA.id, parentTicketId: mine.id,
    });
    expect(res.status).toBe(201);
    const rels = expectOk(await staff.agent.get(`${API}/tickets/${res.body.ticket.id}/relations`)).relations;
    expect(rels).toEqual([expect.objectContaining({ relationType: 'parent', direction: 'outgoing', ticket: expect.objectContaining({ id: mine.id }) })]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm run test:integration -- tickets.extras.test.js`
Expected: FAIL.
- The relation test gets `201` (the gap).
- The three `create with …` tests get `201` for the out-of-scope case.
- The missing case gets `FK_CONSTRAINT` instead of the shared body.
- "create still links" passes.

- [ ] **Step 3: Add `findAccessibleTicket`**

In `backend/src/services/permissionService.js`, add `Ticket` to the models require:

```js
const {
  User, UserRole, RolePermission, Permission, UserPermissionOverride, Role, ProjectMember, Ticket,
} = require('../models');
```

Add this after `canAccessTicket`:

```js
// Loads a ticket the caller may see, or null. A missing ticket and one out of
// the caller's scope look identical, so a field that links to another ticket
// (relations, a project task's linkedTicketId) can't be used to probe which
// ticket ids exist or read their titles.
async function findAccessibleTicket(user, ticketId) {
  const id = parseInt(ticketId, 10);
  if (!id) return null;
  const ticket = await Ticket.findByPk(id);
  if (!ticket || !(await canAccessTicket(user, ticket))) return null;
  return ticket;
}
```

Export it by adding `findAccessibleTicket,` after `canAccessTicket,` in `module.exports`.

- [ ] **Step 4: Fix `createRelation` and `create`**

In `backend/src/controllers/ticketsController.js`, add `findAccessibleTicket` to the `permissionService` require.

In `createRelation`, replace:

```js
  const related = await Ticket.findByPk(relId);
  if (!related) throw new ApiError(404, 'Related ticket not found', 'NOT_FOUND');
```

with:

```js
  const related = await findAccessibleTicket(req.user, relId);
  if (!related) throw new ApiError(404, 'Related ticket not found', 'NOT_FOUND');
```

In `create`, directly after `const parentId = …;`, insert:

```js
  // Every ticket this one links to must be one the caller can see. Missing
  // and out-of-scope get the same answer, so the links can't probe ids.
  const linkedIds = [...new Set([parentId, ...childIdList, ...relatedIdList].filter(Boolean))];
  for (const linkedId of linkedIds) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await findAccessibleTicket(req.user, linkedId))) {
      throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
    }
  }
```

- [ ] **Step 5: Run them and watch them pass**

Run: `cd backend && npm run test:integration -- tickets.extras.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/permissionService.js backend/src/controllers/ticketsController.js backend/test/integration/tickets.extras.test.js
git commit -m "fix(tickets): relations can't reach or probe out-of-scope tickets (S3)"
```

---

### Task 5: S4 — a project task's linked ticket must be one the user can see

**Files:**
- Modify: `backend/test/integration/projects.tasks.test.js` (append a describe block)
- Modify: `backend/src/controllers/projectsController.js` (`createTask`, `updateTask`)

**Interfaces:**
- Consumes: `findAccessibleTicket` (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/integration/projects.tasks.test.js`:

```js
describe('S4: linkedTicketId on project tasks', () => {
  let mgr;
  let proj;
  let mine;
  let hidden;
  beforeEach(async () => {
    // Can edit department A's projects, can see only department A's tickets.
    mgr = await makeManager('mgr', w.deptA.id);
    proj = await makeProject(w.admin.agent, { name: 'A', ownerDepartmentId: w.deptA.id });
    mine = await makeTicket(w.admin.agent, { title: 'Visible', contactId: w.contact.id, departmentId: w.deptA.id });
    hidden = await makeTicket(w.admin.agent, { title: 'Secret', contactId: w.contact.id, departmentId: w.deptB.id });
  });

  const refused = { error: true, message: 'Linked ticket not found', code: 'VALIDATION_ERROR' };

  it('create: an out-of-scope ticket and a missing one get the same 400', async () => {
    const out = await mgr.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', linkedTicketId: hidden.id });
    const missing = await mgr.agent.post(`${API}/projects/${proj.id}/tasks`).send({ title: 'x', linkedTicketId: 99999 });
    expect(out.status).toBe(400);
    expect(out.body).toEqual(refused);
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual(refused);
    expect(expectOk(await mgr.agent.get(`${API}/projects/${proj.id}/tasks`)).tasks).toEqual([]);
  });

  it('update: same rule, and the task keeps its old link', async () => {
    const task = await makeTask(mgr.agent, proj.id, { linkedTicketId: mine.id });
    const out = await mgr.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ linkedTicketId: hidden.id });
    expect(out.status).toBe(400);
    expect(out.body).toEqual(refused);
    const [fresh] = expectOk(await mgr.agent.get(`${API}/projects/${proj.id}/tasks`)).tasks;
    expect(fresh.linkedTicket).toEqual({ id: mine.id, title: 'Visible' });
  });

  it('a visible ticket links, and clearing the link with null still works', async () => {
    const task = await makeTask(mgr.agent, proj.id, { linkedTicketId: mine.id });
    expect(task.linkedTicket).toEqual({ id: mine.id, title: 'Visible' });
    const cleared = expectOk(await mgr.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ linkedTicketId: null })).task;
    expect(cleared.linkedTicketId).toBeNull();
    expect(cleared.linkedTicket).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && npm run test:integration -- projects.tasks.test.js`
Expected: FAIL. Create gets `201` for both the out-of-scope and the missing id, and update gets `200`. The third test passes.

- [ ] **Step 3: Fix `createTask` and `updateTask`**

In `backend/src/controllers/projectsController.js`, add `findAccessibleTicket` to the `permissionService` require.

In `createTask`, after the title check, add:

```js
  // Missing and out-of-scope tickets look the same (see findAccessibleTicket).
  if (linkedTicketId && !(await findAccessibleTicket(req.user, linkedTicketId))) {
    throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
  }
```

In `updateTask`, after the `changes` loop, add:

```js
  if (changes.linkedTicketId && !(await findAccessibleTicket(req.user, changes.linkedTicketId))) {
    throw new ApiError(400, 'Linked ticket not found', 'VALIDATION_ERROR');
  }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd backend && npm run test:integration -- projects.tasks.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/projectsController.js backend/test/integration/projects.tasks.test.js
git commit -m "fix(projects): task linkedTicketId must be a ticket the user can see (S4)"
```

---

### Task 6: S5 — project file uploads get the same content check as ticket attachments

**Files:**
- Create: `backend/test/integration/projects.extras.test.js` (Task 12 completes it)
- Modify: `backend/src/routes/projects.js`

- [ ] **Step 1: Write the failing test**

Create `backend/test/integration/projects.extras.test.js`:

```js
const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeProject, makeTask,
  freezeClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
let proj;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  proj = await makeProject(tech.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

describe('S5: POST /projects/:id/files checks file content', () => {
  it('rejects an executable disguised as a PDF and stores nothing', async () => {
    const res = await tech.agent.post(`${API}/projects/${proj.id}/files`).attach('file', EXE, 'report.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_CONTENT');
    expect(expectOk(await tech.agent.get(`${API}/projects/${proj.id}/files`)).files).toEqual([]);
  });

  it('still accepts an ordinary text file', async () => {
    const res = await tech.agent.post(`${API}/projects/${proj.id}/files`).attach('file', Buffer.from('hello'), 'notes.txt');
    expect(res.status).toBe(201);
    expect(res.body.file).toEqual(expect.objectContaining({ filename: 'notes.txt', filesize: 5 }));
  });
});
```

- [ ] **Step 2: Run it and watch the first test fail**

Run: `cd backend && npm run test:integration -- projects.extras.test.js`
Expected: FAIL with `Expected: 400, Received: 201`.

- [ ] **Step 3: Add `verifyFileSignature` to the route**

In `backend/src/routes/projects.js`, change the upload require to:

```js
const { projectUpload, enforceMaxAttachmentSize, verifyFileSignature } = require('../middleware/upload');
```

and the files POST route to:

```js
router.post('/:id/files', editMin, projectUpload.single('file'), verifyFileSignature, enforceMaxAttachmentSize, ctrl.uploadFile);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npm run test:integration -- projects.extras.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/projects.js backend/test/integration/projects.extras.test.js
git commit -m "fix(projects): file uploads get the content check ticket attachments have (S5)"
```

---

## How the coverage tasks (7–18) are written

Each remaining task fills one test file. Every task gives you the same three things:

- the file's **setup** (or says which earlier task created it),
- a **case table** where every row is one `it()`, with the exact request and the exact assertions,
- **worked examples** in full code for the patterns that are easy to get wrong.

For each row, write an `it()` whose name is the row's **Test name**. Make the request in the **Request** column as the stated user. Assert everything in **Expect**, reading follow-up state with the GET the row names. Write rows marked `[quirk]` per the quirk naming rule in Global Constraints.

Some conventions apply throughout:
- **Status strings** are the seeded names. **`today`** means `new Date().toISOString().slice(0, 10)` at test time, unless the row freezes the clock.
- **"403 ticket"** means `{ status: 403, code: 'FORBIDDEN', message: 'You do not have access to this ticket' }`. **"403 project"** is the same with "project".
- **"404 NOT_FOUND 'X'"** means status 404, code `NOT_FOUND`, message `X`.
- **"400 VALIDATION_ERROR"** means status 400 and code `VALIDATION_ERROR`. Assert the message too when the row quotes one.
- **"audit `a` {m}"** means a `models.AuditLog` row exists with `action: 'a'` and `meta` equal to `{m}`. Read it with `await models.AuditLog.findOne({ where: { action: 'a' }, order: [['id', 'DESC']] })`, after a comment saying no endpoint exposes `AuditLogs`.
- **Read-only describes** build their fixtures in `beforeAll`. Rows that mutate use `beforeEach`. Whole-file `beforeEach(resetData)` still applies to the first describe; read-only describes call `resetData()` at the top of their own `beforeAll`.

- **Audit rows live in `sideEffects.test.js` (Task 18).** The area files assert the activity timeline and leave audit to Task 18, so each audit expectation is written once.

---

### Task 7: `tickets.core.test.js` — create, get, update, delete, list, board

**Files:**
- Create: `backend/test/integration/tickets.core.test.js`

**Interfaces:**
- Consumes: `fixtures.js`.

- [ ] **Step 1: Write the file setup and the worked examples**

```js
const { resetData, closeDb, models, ROLE, createUserAndLogin } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeContact, makeTicket,
  makeProject, makeTeam, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
});
afterEach(unfreezeClock);
afterAll(closeDb);

const base = () => ({ title: 'Printer offline', contactId: w.contact.id });

describe('POST /tickets', () => {
  it('applies defaults', async () => {
    const t = await makeTicket(tech.agent, { ...base(), title: '  Printer offline  ' });
    expect(t).toEqual(expect.objectContaining({
      title: 'Printer offline', description: null, status: 'Open', priority: 'medium', type: 'request',
      source: 'manual', assigneeId: null, teamId: null, departmentId: null, projectId: null,
      dueDate: null, dueTime: null, tags: null, resolvedAt: null, resolution: null,
      createdBy: tech.user.id, contactId: w.contact.id, customFields: {}, ticketNumber: '00001',
    }));
    expect(expectOk(await tech.agent.get(`${API}/tickets/${t.id}`)).ticket).toEqual(expect.objectContaining({ title: 'Printer offline', status: 'Open' }));
  });
});

describe('PATCH /tickets/:id activity', () => {
  it('logs one entry per tracked field that really changed, with display values', async () => {
    const team = await makeTeam(w.admin, 'Desk team', [{ userId: tech.user.id, isLead: false }]);
    const t = await makeTicket(tech.agent, base());
    expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({
      status: 'In Progress', priority: 'high', type: 'incident', assigneeId: tech.user.id, teamId: team.id,
      departmentId: w.deptA.id, dueDate: '2026-12-01', dueTime: '09:00:00', title: 'Renamed',
    }));
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${t.id}/activity`));
    expect(activity.map((a) => [a.action, a.fromValue, a.toValue])).toEqual(expect.arrayContaining([
      ['created', null, null],
      ['status', 'Open', 'In Progress'],
      ['priority', 'medium', 'high'],
      ['type', 'request', 'incident'],
      ['assigneeId', null, 'Test tech'],
      ['teamId', null, 'Desk team'],
      ['departmentId', null, 'Service Desk'],
      ['dueDate', null, '2026-12-01'],
      ['dueTime', null, '09:00:00'],
    ]));
    expect(activity).toHaveLength(9); // title is not a tracked field
  });
});
```

- [ ] **Step 2: Add the remaining cases**

Users: `tech` (System Technician, A), and per test as needed `mgr = makeManager('mgr', A)`, `staff = makeStaff('staff', A)` and `own = makeOwnTier(w.admin, 'own', A)`. "T" is a ticket made by the admin with `base()` plus the fields shown.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | applies defaults | worked example | — |
| 2 | keeps every explicit field | tech: `base()` + `description:'d', priority:'high', type:'incident', status:'In Progress', departmentId:A, assigneeId:tech, dueDate:'2026-12-01', dueTime:'14:30:00', tags:['vpn','urgent']` | 201 with each value echoed exactly; GET returns the same |
| 3 | drops dueTime when there is no dueDate | tech: `base()` + `dueTime:'09:00:00'` | `dueTime: null` |
| 4 | requires a title | tech: no title; then title `'   '` | both 400 VALIDATION_ERROR 'Ticket title is required' |
| 5 | requires a contact | tech: `{ title:'x' }` | 400 VALIDATION_ERROR 'A contact is required' |
| 6 | lets callers pick only manual or phone as the source | tech: `source` = `'phone'`, `'email'`, `'portal'`, `'bogus'` | stored `phone`, `manual`, `manual`, `manual` |
| 7 | stamps resolvedAt when created closed | tech: `base()` + `status:'Resolved'` | `resolvedAt` is an ISO string |
| 8 | `[quirk] Q25: accepts a status no TicketStatus row has` | tech: `status:'Bogus'` | 201, `status:'Bogus'`, `resolvedAt:null`; GET `/tickets/board` has the ticket in no column |
| 9 | applies a matching assignment rule when no assignee or team is given | admin POST `/assignment-rules` `{ name:'Incidents', ticketType:'incident', assigneeId: tech }`; then tech creates `type:'incident'` and `type:'request'` | the incident gets `assigneeId: tech`; the request gets `null` |
| 10 | an explicit assignee beats the rule | rule as in 9; create `type:'incident', assigneeId: mgr` | `assigneeId: mgr` |
| 11 | a rule matches only when department and priority both match | rule `{ name:'R', departmentId:A, priority:'high', assigneeId: tech }`; create A/high and A/medium | high → tech, medium → null |
| 12 | logs a created activity entry | tech creates | activity is `[['created', null, null]]` |
| 13 | GET returns the ticket with its related records | tech: GET T with `assigneeId: tech, departmentId: A` | `assignee` is `{ id, displayName:'Test tech', username:'tech', email:null }`, `department` is `{ id:A, name:'Service Desk' }`, `contact.id` is the contact |
| 14 | GET a missing ticket | tech: GET `/tickets/99999` | 404 NOT_FOUND 'Ticket not found' |
| 15 | GET with a non-numeric id is a 404, not a 500 | tech: GET `/tickets/abc` | 404 |
| 16 | own-tier sees and edits only tickets assigned to them | own: GET/PATCH T assigned to own; T2 assigned to tech | 200/200; 403 ticket / 403 ticket |
| 17 | department-tier sees their department plus anything assigned to them | staff: GET T(A); T(B); T(B, assigneeId: staff) | 200, 403 ticket, 200 |
| 18 | `[quirk] Q26: edit access follows the view tier, not the edit tier` | tech (holds only `tickets.edit_own`, but views all): PATCH `{ priority:'low' }` on a dept-B ticket assigned to nobody | 200 // Likely correct: `edit_own` limits edits to the user's own tickets |
| 19 | updates every allowed field | tech: PATCH T with `title, description, status:'Pending', priority:'critical', type:'change', assigneeId:tech, teamId, contactId:(second contact), projectId:(project in A), departmentId:B, dueDate:'2026-11-02', dueTime:'08:15:00', tags:['x'], resolution:'Swapped toner'` | 200 echoing each; GET agrees |
| 20 | ignores fields that are not editable | tech: PATCH `{ createdBy: 999, resolvedAt: '2020-01-01T00:00:00Z', source: 'email', ticketNumber: '9' }` | 200; those four unchanged |
| 21 | clearing dueDate clears dueTime | T with `dueDate:'2026-12-01', dueTime:'09:00:00'`; PATCH `{ dueDate: null }` | both null; activity has `['dueTime','09:00:00',null]` |
| 22 | `[quirk] Q27: keeps a dueTime sent alongside a cleared dueDate` | same T; PATCH `{ dueDate:null, dueTime:'10:00:00' }` | `dueDate:null, dueTime:'10:00:00'` // Likely correct: a time without a date is cleared |
| 23 | stamps who set the resolution and when | tech: PATCH `{ resolution:'Fixed' }` | `resolution:'Fixed'`, `resolutionUpdatedBy: tech`, `resolutionUpdatedAt` is a string, `resolutionUpdatedByUser.id === tech` |
| 24 | keeps resolvedAt through closed→closed and clears it on reopen | freeze 2026-03-11T17:00:00Z; PATCH Resolved; advance 60 s; PATCH Closed; PATCH Open | `resolvedAt` = '2026-03-11T17:00:00.000Z', then still that, then `null` |
| 25 | logs one entry per changed tracked field | worked example | — |
| 26 | writes no activity when a field is set to its current value | PATCH `{ priority:'medium' }` on a medium ticket | activity is still only `created` |
| 27 | PATCH a missing or non-numeric ticket | tech: PATCH `/tickets/99999`, `/tickets/abc` | both 404 |
| 28 | admin deletes a ticket and its time with it | admin: T with a 30-minute entry; DELETE T | `{ ok: true }`; GET T 404; `GET /tickets/T/time` 404 |
| 29 | delete a missing ticket | admin: DELETE `/tickets/99999` | 404 NOT_FOUND 'Ticket not found' |
| 30 | `[quirk] Q28: delete does not re-check scope` | staff with override `tickets.delete: true` (admin POST `/users/:id/overrides`): DELETE a dept-B ticket | 200 // Likely correct: refused like GET. Expected to change in sub-project 2 |
| 31 | lists with the standard paginated shape, newest update first | 3 tickets created with the clock advanced 1 s between them | `{ tickets, page:1, limit:50, total:3, totalPages:1 }`; titles newest first; each has `timeLoggedMinutes` |
| 32 | filters the list | it.each over the filter table below | each returns exactly the titles shown |
| 33 | myTickets pins the list to the caller | tech: `?myTickets=true` with tickets assigned to tech and to mgr, plus `&assignee=<mgr>` | only tech's tickets |
| 34 | sorts by column and direction | `?sortBy=title&sortDir=asc`; `?sortBy=nope` | alphabetical; unknown falls back to updatedAt desc |
| 35 | sorts by a number custom field numerically | admin POST `/custom-fields` `{ label:'Rank', fieldKey:'rank', fieldType:'number' }`; tickets with rank `'9'` and `'10'`; `?sortBy=cf:rank&sortDir=asc` | the 9 ticket first |
| 36 | scopes the list to the caller's tier | own, staff, tech each GET `/tickets` over: A unassigned, A assigned own, B unassigned, B assigned staff | own: 1 (assigned own); staff: A unassigned, A assigned own, B assigned staff; tech: all 4 |
| 37 | board has one column per non-archived status, in order | tech: GET `/tickets/board` | 6 columns, statuses `Open, In Progress, Pending, On Hold, Resolved, Closed`; each `{ status, total, limit:100, tickets }` |
| 38 | board applies the list's filters and scope, ignoring `status` | staff: GET `/tickets/board?priority=high&status=Closed` over A/high/Open, A/low/Open, B/high/Open | only A/high/Open, in the Open column |

Filter table for case 32. Freeze at `2026-03-11T17:00:00Z`. Seed through the API as admin, then set `status` with PATCH where shown.

| title | fields |
|---|---|
| Alpha | `priority:'high', type:'incident', departmentId:A, assigneeId:tech, dueDate:'2026-03-10'` |
| Bravo | `priority:'low', source:'phone', departmentId:B, description:'printer jam'` |
| Charlie | `status` PATCHed to `'Resolved'`, `projectId:P`, `dueDate:'2026-03-01'` |
| Delta | `teamId: team`, `contactId: contact2`, `dueDate:'2026-03-11'` |

| query | titles |
|---|---|
| `status=Open` | Alpha, Bravo, Delta |
| `status=closed` | Charlie |
| `priority=high` | Alpha |
| `type=incident` | Alpha |
| `source=phone` | Bravo |
| `assignee=<tech>` | Alpha |
| `project=<P>` | Charlie |
| `department=<B>` | Bravo |
| `contactId=<contact2>` | Delta |
| `team=<team>` | Delta |
| `unassigned=true` | Bravo, Charlie, Delta |
| `overdue=true` | Alpha (Charlie is closed; Delta's due today) |
| `overdue=true&status=Resolved` | Charlie |
| `search=jam` | Bravo |
| `search=%2300002` (`#00002`) | Bravo |
| `search=0002` | Bravo |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- tickets.core.test.js`
Expected: PASS. If a case fails, apply the "When an assertion disagrees" rule in Global Constraints.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/tickets.core.test.js
git commit -m "test(tickets): baseline for create/get/update/delete/list/board"
```

---

### Task 8: ticket extras — comments, attachments, relations, watchers, custom fields, staff CSAT

At full size this would pass 800 lines, so it is two files:
- `tickets.comments.test.js` covers comments and attachments. It mocks outbound email.
- `tickets.extras.test.js`, started in Task 4, covers relations, watchers, custom fields and staff CSAT.

**Files:**
- Create: `backend/test/integration/tickets.comments.test.js`
- Modify: `backend/test/integration/tickets.extras.test.js`

- [ ] **Step 1: Write `tickets.comments.test.js` setup and the email worked example**

```js
// Outbound email is recorded, not sent: ticketsController destructures
// sendMail when it loads, so spying after load would do nothing.
jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeContact, makeTicket,
  freezeClock, advanceClock, unfreezeClock, waitFor,
} = require('./fixtures');

let w;
let tech;
let ticket;
beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id,
  });
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('reply email to the contact', () => {
  it('emails a reply to the ticket\'s contact', async () => {
    expectOk(await tech.agent.post(`${API}/tickets/${ticket.id}/comments`).send({ body: 'On my way' }), 201);
    await waitFor(() => sendMail.mock.calls.length === 1);
    expect(sendMail).toHaveBeenCalledWith({
      to: w.contact.email,
      subject: 'Re: [Ticket #00001] Printer offline',
      text: 'On my way\n\n--\nReply to this email to respond to your ticket.',
      headers: { 'X-PRISM-Ticket-ID': '00001' },
      messageId: expect.any(String),
    });
  });

  it('sends nothing for an internal comment', async () => {
    expectOk(await tech.agent.post(`${API}/tickets/${ticket.id}/comments`).send({ body: 'note', type: 'comment_private' }), 201);
    await new Promise((r) => { setTimeout(r, 200); }); // give a stray send time to happen
    expect(sendMail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add the comment and attachment cases to `tickets.comments.test.js`**

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | posts a reply by default, trimmed | tech: POST `{ body:'  On my way  ' }` | 201 `comment` has `body:'On my way', type:'reply', authorId:tech`, and `author.displayName:'Test tech'` |
| 2 | rejects an empty or whitespace body | tech: `{}`; `{ body:'   ' }` | 400 VALIDATION_ERROR 'Comment body is required' |
| 3 | lets a holder of view_private_comments post internal notes | tech: `{ body:'x', type:'comment_private' }` | 201 `type:'comment_private'` |
| 4 | refuses internal or public-note types to users without view_private_comments | staff(A): `type:'comment_private'`; `type:'comment_public'` | both 403 FORBIDDEN 'You do not have permission to post internal comments' |
| 5 | rejects an unknown type | tech: `type:'shout'` | 400 VALIDATION_ERROR 'Invalid comment type' |
| 6 | hides internal comments from users who can't view them | tech posts a reply and a private note; staff GET; tech GET | staff sees 1 (the reply); tech sees 2 |
| 7 | pages newest-first but returns each page oldest-first | freeze; tech posts c1, c2, c3, advancing 1 s each; GET `?limit=2`; GET `?limit=2&page=2` | page 1: `[c2, c3]`, `total:3, totalPages:2`; page 2: `[c1]` |
| 8 | authors edit their own comment | tech PATCH own `{ body:' edited ' }` | 200 `body:'edited'` |
| 9 | edit refuses an empty body | tech PATCH own `{ body:'' }` | 400 VALIDATION_ERROR 'Comment body is required' |
| 10 | edit_own users cannot edit others' comments | mgr2 = makeManager in A posts; tech PATCHes it | 403 FORBIDDEN 'You can only edit your own comments' |
| 11 | department editors moderate comments in their department | tech posts; mgr(A) PATCHes and then DELETEs it | 200, 200 |
| 12 | edit_own users cannot delete others' comments | mgr posts; tech DELETEs | 403 FORBIDDEN 'You can only delete your own comments' |
| 13 | a comment id from another ticket is not found through this one | admin: comment on T2; PATCH and DELETE via `/tickets/T/comments/<id>` | 404 NOT_FOUND 'Comment not found' both |
| 14 | logs a comment activity entry | tech posts | activity contains `['comment', null, null]` |
| 15 | emails a reply to the contact | worked example | — |
| 16 | emails a public note the same way | tech: `type:'comment_public'` | sendMail called once |
| 17 | sends nothing for an internal comment | worked example | — |
| 18 | sends nothing when the contact has no email | ticket with a contact made with `email: null` | after 200 ms, sendMail not called |
| 19 | uploads an attachment | tech: `.attach('file', Buffer.from('hello'), 'notes.txt')` | 201 `attachment` has `originalName:'notes.txt', size:5, mimeType:'text/plain', uploadedById:tech`; activity has `['attachment_added', null, 'notes.txt']` |
| 20 | lists attachments newest first | freeze; upload a.txt, advance 1 s, upload b.txt | `attachments` names `['b.txt','a.txt']`, `total:2` |
| 21 | downloads the stored bytes | GET `.../attachments/:aid/download` | 200, `res.text` is `'hello'`, `content-disposition` contains `notes.txt` |
| 22 | rejects an executable disguised as a PDF | tech: `MZ`+64 zero bytes as `report.pdf` | 400 `code:'INVALID_FILE_CONTENT'`; list empty |
| 23 | rejects a request with no file | tech: POST with no attachment | 400 `code:'NO_FILE'` |
| 24 | uploaders delete their own; edit_own users can't delete others'; department editors can | tech deletes own; mgr uploads, tech deletes; mgr deletes tech's | 200; 403 FORBIDDEN 'You can only remove your own attachments'; 200 |
| 25 | an attachment from another ticket is not found through this one | admin uploads to T2; download and delete via T | 404 NOT_FOUND 'Attachment not found' both |
| 26 | own-tier users can't list or upload on others' tickets | own: GET and POST attachments on T (assigned to tech) | 403 ticket both |

- [ ] **Step 3: Add the relations, watchers, custom fields and CSAT cases to `tickets.extras.test.js`**

Below the S3 block. "A" and "B" here are tickets made by the admin in department A with titles `'Alpha'` and `'Bravo'`.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | links two tickets as related by default | tech: POST A/relations `{ relatedTicketId: B }` | 201 `relation` is `{ id, relationType:'related', direction:'outgoing', ticket: (B, with title 'Bravo') }`; A's activity has `['relation_added', null, 'related: Bravo']` |
| 2 | lists a relation from both sides | after 1: GET A and GET B relations | A: one item, outgoing, `ticket.id` B. B: one item, incoming, `ticket.id` A. Each `ticket` has only `id, title, status, priority, type` |
| 3 | stores "parent" as this ticket → its parent | A: `{ relatedTicketId:B, relationType:'parent' }` | response: outgoing, parent. From B: incoming, parent, ticket A |
| 4 | stores "child" from the child's side | A: `{ relatedTicketId:B, relationType:'child' }` | response `direction:'incoming', relationType:'parent'`, ticket B. From B: outgoing, parent, ticket A |
| 5 | accepts caused_by and duplicates | A→B `caused_by`; A→C `duplicates` | both 201 with those types |
| 6 | validates relation input | A: `{}`; `{ relatedTicketId: A }`; `{ relatedTicketId: B, relationType:'blocks' }` | 400 VALIDATION_ERROR 'relatedTicketId is required'; 'A ticket cannot be related to itself'; 'Invalid relation type' |
| 7 | refuses the same stored pair twice | A→B related, then A→B parent; and A child-of B (stores B→A) then B→A related | second call of each pair: 409 `DUPLICATE_RELATION` 'These tickets are already linked' |
| 8 | `[quirk] Q24: links the same two tickets again in the opposite direction` | A→B related; then B→A related | both 201; A lists 2 relations // Likely correct: one link per pair, whatever the direction |
| 9 | removes a relation from either side | A→B; DELETE `/tickets/B/relations/:rid` | `{ ok:true }`; A lists none |
| 10 | a relation is not found through an unrelated ticket | A→B; DELETE `/tickets/C/relations/:rid` | 404 NOT_FOUND 'Relation not found' |
| 11 | create-time links are stored in their documented directions | tech creates N with `parentTicketId:P, childTicketIds:[C], relatedTicketIds:[R]` | from N: P outgoing parent; C incoming parent; R outgoing related |
| 12 | `[quirk] Q18: relation lists show linked tickets the viewer cannot open` | admin links A(dept A)→S(dept B, title 'Secret'); staff(A) GETs A's relations | includes `ticket` `{ id:S, title:'Secret', status:'Open', priority:'medium', type:'request' }` // Likely correct: hide or redact links to tickets the viewer can't open |
| 13 | adds a watcher, and adding again is a no-op | tech: POST A/watchers `{ userId: mgr }` twice | both 201 with the same `watcher.id`; `watcher.user.username:'mgr'`; list has 1 |
| 14 | requires a userId | tech: `{}` | 400 VALIDATION_ERROR 'userId is required' |
| 15 | removes a watcher; removing a non-watcher is fine | DELETE `/tickets/A/watchers/<mgr>` twice | 200 `{ ok:true }` both; list empty |
| 16 | watchers given at create are listed | tech creates with `watcherIds:[mgr, staff]` | list user ids, sorted, equal `[mgr, staff]` sorted. They share a `createdAt` second and the list has no id tiebreak, so the order is not asserted |
| 17 | own-tier users can't read watchers of others' tickets | own: GET A/watchers | 403 ticket |
| 18 | sets, reads and round-trips custom field values | admin creates fields `asset_tag` (text) and `systems` (multiselect, options A,B,C); tech PATCH `/tickets/A/custom-field-values` `{ values:{ asset_tag:'X1', systems:['A','C'] } }` | `customFields` is `{ asset_tag:'X1', systems:['A','C'] }`; GET custom-field-values and GET ticket `.customFields` agree; activity has `['custom_fields', null, null]` |
| 19 | an empty or null value removes the field | then `{ values:{ asset_tag:'', systems:null } }` | `customFields` is `{}` |
| 20 | ignores unknown keys | `{ values:{ nope:'x' } }` | 200, `customFields` is `{}` |
| 21 | rejects a non-object values payload | `{ values:'x' }`; `{ values:['x'] }`; `{}` | 400 VALIDATION_ERROR 'values must be an object of { fieldKey: value }' |
| 22 | accepts custom field values at create | tech creates with `customFieldValues:{ asset_tag:'Y2' }` | `customFields` is `{ asset_tag:'Y2' }` |
| 23 | `[quirk] Q29: stores values the field's type or options don't allow` | number field `rank`; `{ values:{ rank:'abc', systems:['Z'] } }` | 200, stored as sent // Likely correct: 400 for a non-number or an unknown option |
| 24 | won't take a staff CSAT rating until the ticket is closed | tech: POST A/csat `{ rating:'happy' }` on an Open ticket | 400 `NOT_RATEABLE` |
| 25 | validates the rating | A Resolved; `{ rating:'meh' }` | 400 VALIDATION_ERROR 'rating must be happy, neutral, or unhappy' |
| 26 | records and then updates a staff CSAT rating | A Resolved; POST `{ rating:'happy', comment:'Great' }`; POST `{ rating:'unhappy' }` | 201 `csat` has `rating:'happy', comment:'Great', userId:tech`; then 201 `rating:'unhappy', comment:null`; GET A/csat returns the latter |
| 27 | GET csat before any rating | GET A/csat | `{ csat: null }` |

- [ ] **Step 4: Run both files**

Run: `cd backend && npm run test:integration -- tickets.comments.test.js tickets.extras.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/test/integration/tickets.comments.test.js backend/test/integration/tickets.extras.test.js
git commit -m "test(tickets): baseline for comments, attachments, relations, watchers, custom fields, CSAT"
```

---

### Task 9: `tickets.tasks.test.js` — the ticket checklist

**Files:**
- Create: `backend/test/integration/tickets.tasks.test.js`

- [ ] **Step 1: Write the setup and the Q8 worked example**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
let ticket;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Onboard', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const tasksUrl = () => `${API}/tickets/${ticket.id}/tasks`;

// Likely correct: task changes appear on the ticket timeline and in the audit log. Expected to change in sub-project 3.
it('[quirk] Q8: creating and completing a task writes no activity and no audit row', async () => {
  const task = expectOk(await tech.agent.post(tasksUrl()).send({ description: 'Image laptop' }), 201).task;
  expectOk(await tech.agent.patch(`${tasksUrl()}/${task.id}`).send({ completed: true }));
  const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
  expect(activity.map((a) => a.action)).toEqual(['created']);
  // No endpoint reads AuditLogs.
  expect(await models.AuditLog.count({ where: { entityType: 'TicketTask' } })).toBe(0);
});
```

- [ ] **Step 2: Add the remaining cases**

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | creates a task, trimmed, with an assignee | tech: POST `{ description:'  Swap toner  ', assigneeId: tech }` | 201 `task` has `ticketId, description:'Swap toner', completed:false, assigneeId:tech`, and `assignee.username:'tech'` |
| 2 | requires a description | `{}`; `{ description:'   ' }` | 400 VALIDATION_ERROR 'Task description is required' |
| 3 | lists tasks oldest first | freeze; create t1, t2, t3, advancing 1 s each | ids `[t1,t2,t3]` |
| 4 | toggles completed using truthiness | PATCH `{ completed:true }`; `{ completed:0 }`; `{ completed:'yes' }` | `true`, `false`, `true` |
| 5 | reassigns and unassigns | PATCH `{ assigneeId: admin }`; `{ assigneeId: null }`; `{ assigneeId: '' }` | admin id; null; null |
| 6 | edits the description and ignores a blank one | PATCH `{ description:' New ' }`; then `{ description:'  ' }` | `'New'`; still `'New'`, 200 |
| 7 | a task from another ticket is not found through this one | admin: task on T2; PATCH via this ticket | 404 NOT_FOUND 'Task not found' |
| 8 | own-tier users can't touch tasks on others' tickets | own: GET, POST; PATCH an existing task | 403 ticket ×3 |
| 9 | tasks of a missing ticket | GET `/tickets/99999/tasks` | 404 NOT_FOUND 'Ticket not found' |
| 10 | `[quirk] Q8 …` | worked example | — |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- tickets.tasks.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/tickets.tasks.test.js
git commit -m "test(tickets): baseline for the ticket task checklist"
```

---

### Task 10: `projects.core.test.js` — create, codes, get, update, delete, list, tags, stats

**Files:**
- Create: `backend/test/integration/projects.core.test.js`

- [ ] **Step 1: Write the setup and the concurrency worked example**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeStaff, makeOwnTier, makeTicket, makeProject,
  makeTask, makeTeam, projectStatusId, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
});
afterEach(unfreezeClock);
afterAll(closeDb);

describe('project codes', () => {
  it('two creates in one department at the same moment get distinct codes', async () => {
    const send = (name) => tech.agent.post(`${API}/projects`).send({ name, ownerDepartmentId: w.deptA.id });
    const [a, b] = await Promise.all([send('One'), send('Two')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.project.projectCode, b.body.project.projectCode].sort()).toEqual(['SD-P00001', 'SD-P00002']);
  });
});
```

- [ ] **Step 2: Add the remaining cases**

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | applies defaults | tech: `{ name:'  Refresh  ', ownerDepartmentId:A }` | 201 `project` has `name:'Refresh', projectCode:'SD-P00001', status:'Active', forDepartmentId:A, assignedToUserId:null, teamId:null, dueDate:null, tags:null, description:null, createdBy:tech, closedAt:null, members:[]`, `ownerDepartment` `{ id:A, name:'Service Desk' }`, and `stats` `{ completionPercent:0, totalTasks:0, closedTasks:0, totalTimeSeconds:0, totalCost:0, openTicketsCount:0 }` |
| 2 | numbers projects per department | two in A, one in B | `SD-P00001`, `SD-P00002`, `FAC-P00001` |
| 3 | two simultaneous creates get distinct codes | worked example | — |
| 4 | never reuses a deleted project's number | create, admin DELETE, create | second is `SD-P00002` |
| 5 | makes the lead a lead member and the rest members | tech: `assignedToUserId: tech, memberIds:[mgr, staff, tech]` | `members` has 3 rows: tech `lead`; mgr and staff `member`; `lead.username:'tech'` |
| 6 | keeps an explicit status and stamps closedAt for a closed one | `status:'On Hold'`; `status:'Completed'` | `closedAt` null; `closedAt` set |
| 7 | validates input | no name; `'   '`; no ownerDepartmentId; `ownerDepartmentId:99999`; `forDepartmentId:99999` | 400 VALIDATION_ERROR with messages 'Project name is required' (×2), 'Owned by department is required', 'Owned-by department does not exist', 'For-department does not exist' |
| 8 | logs project_created | create | activity is `[{ action:'project_created', detail:{ name:'Refresh', projectCode:'SD-P00001' } }]` |
| 9 | GET a missing or non-numeric project | `/projects/99999`; `/projects/abc` | 404 NOT_FOUND 'Project not found'; 404 |
| 10 | own-tier sees only projects they are a member of | own: GET P (not member) then after admin POST P/members `{ userId: own }` | 403 project; 200 |
| 11 | department-tier sees projects owned by or for their department, or that they belong to | mgr(A): P owned B/for B; Q owned B/for A; R owned B with mgr as member | 403 project; 200; 200 |
| 12 | updates every allowed field | tech: PATCH `name, description, status:'On Hold', ownerDepartmentId:B, forDepartmentId:B, assignedToUserId:mgr, teamId, dueDate:'2026-12-31', tags:['vpn']` | 200 echoing each |
| 13 | an empty tags list is stored as null | PATCH `{ tags: [] }` | `tags: null` |
| 14 | logs a status change and stamps or clears closedAt | PATCH `On Hold`; again `On Hold`; then `Completed`; then `Active` | one `status_changed {from:'Active',to:'On Hold'}` for the first two; `closedAt` set at Completed and null at Active |
| 15 | `[quirk] Q30: changing the lead does not change membership` | P created with `assignedToUserId: tech`; PATCH `{ assignedToUserId: mgr }` | `members` still only tech (`lead`); mgr is not a member // Likely correct: the new lead becomes a lead member |
| 16 | `[quirk] Q25: accepts a status no ProjectStatus row has` | PATCH `{ status:'Bogus' }` | 200, `status:'Bogus'` |
| 17 | `[quirk] Q26: edit access follows the view tier` | tech (`projects.edit_own`, views all) PATCHes a dept-B project they aren't on | 200 |
| 18 | own-tier users can't update others' projects | own: PATCH P | 403 project |
| 19 | admin deletes a project | admin: DELETE | `{ ok:true }`; GET 404 |
| 20 | `[quirk] Q13: deleting a project leaves its tasks and time behind` | P with a task and a 60-minute time entry; admin DELETE P | `models.ProjectTask.count({ where:{ projectId } })` is 1 and `models.ProjectTimeEntry.count(...)` is 1 (no endpoint lists a deleted project's rows) // Likely correct: removed with the project |
| 21 | `[quirk] Q28: delete does not re-check scope` | staff(A) with override `projects.delete: true`: DELETE a dept-B project | 200 // Expected to change in sub-project 2 |
| 22 | lists with the paginated shape and per-project rollups | tech: GET `/projects` | `{ projects, page:1, limit:50, total, totalPages }`; each has `statusColor` (string), `completion: { percent, totalTasks, closedTasks }`, `totalCost`, `members` |
| 23 | filters the list | it.each over the filter table below | the names shown |
| 24 | myProjects with no memberships returns nothing | mgr: `?myProjects=true` | `projects:[]`, `total:0` |
| 25 | scopes the list | own (member of P only) and mgr(A) each GET `/projects` | own: [P]; mgr: projects owned by or for A, plus any they're a member of |
| 26 | own-tier with no memberships gets an empty list | own: GET | `projects:[]`, `total:0` |
| 27 | lists distinct tags the caller can see, sorted | P1 `tags:['vpn','net']`, P2 (dept B) `tags:['zeta','net']`; tech GET `/projects/tags`; own (member of P1 only) GET | tech: `['net','vpn','zeta']`; own: `['net','vpn']` |
| 28 | stats roll up tasks, time, cost and open tickets | P with 2 tasks (one Completed), a 90-minute time entry, an expense of 100, a material 2 × 25, a ticket `projectId:P` Open, and one Resolved | `stats` `{ completionPercent:50, totalTasks:2, closedTasks:1, totalTimeSeconds:5400, totalCost:150, openTicketsCount:1 }` from both GET P and GET P/stats |
| 29 | stats are scope-checked | own: GET P/stats | 403 project |
| 30 | non-numeric project id | tech: PATCH `/projects/abc` | 404 |

Filter table for case 23. Freeze at `2026-03-11T17:00:00Z`; all created by tech:

| name | fields |
|---|---|
| Alpha | `ownerDepartmentId:A, assignedToUserId:tech, dueDate:'2026-03-10', tags:['vpn','urgent']` |
| Bravo | `ownerDepartmentId:B, forDepartmentId:A, description:'boiler swap', tags:['vpn-legacy']` |
| Charlie | `ownerDepartmentId:B, status:'Completed', dueDate:'2026-03-01'` |

| query | names |
|---|---|
| `status=Active` | Alpha, Bravo |
| `status=closed` | Charlie |
| `ownerDept=<B>` | Bravo, Charlie |
| `forDept=<A>` | Alpha, Bravo |
| `assignee=<tech>` | Alpha |
| `myProjects=true` (tech is a member of Alpha as its lead) | Alpha |
| `myDepartment=true` (tech is in A) | Alpha, Bravo |
| `overdue=true` | Alpha |
| `search=boiler` | Bravo |
| `search=FAC-P00002` | Charlie (Bravo is `FAC-P00001`, Alpha `SD-P00001`) |
| `search=urgent` | Alpha |
| `tag=vpn` | Alpha |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- projects.core.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/projects.core.test.js
git commit -m "test(projects): baseline for create/codes/get/update/delete/list/tags/stats"
```

---

### Task 11: `projects.tasks.test.js` — tasks, subtasks, codes, reorder, rollups

**Files:**
- Modify: `backend/test/integration/projects.tasks.test.js` (created in Task 2)

- [ ] **Step 1: Write the Q7 worked example**

```js
describe('status changes on tasks', () => {
  // Likely correct: "3" and 3 are the same status, so nothing changes. Expected to change in sub-project 3.
  it('[quirk] Q7: a string statusId equal to the current one re-stamps completedAt', async () => {
    const proj = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
    const completed = await projectStatusId(w.admin.agent, 'Completed');
    const task = await makeTask(w.admin.agent, proj.id);
    expectOk(await w.admin.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ statusId: completed }));
    // No endpoint sets completedAt directly; backdate it to see whether it moves.
    await models.ProjectTask.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: task.id } });

    const res = expectOk(await w.admin.agent.patch(`${API}/projects/${proj.id}/tasks/${task.id}`).send({ statusId: String(completed) }));
    expect(res.task.completedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });
});
```

Add `models` to this file's `require('./helpers')` destructure.

- [ ] **Step 2: Add the remaining cases**

P is a project in A created by the admin. `ACTIVE`, `ON_HOLD` and `COMPLETED` are status ids from `projectStatusId`. "mgr" is a Manager in A.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | creates a task with defaults | mgr: POST `{ title:'  Audit  ' }` | 201 `task` has `title:'Audit', taskCode:'SD-P00001-T01', statusId:ACTIVE, priority:'medium', position:1, completedAt:null, linkedTicketId:null, createdBy:mgr, subtasks:[]`, `status.name:'Active'` |
| 2 | numbers and positions tasks in creation order | three creates | `T01..T03`, positions 1..3 |
| 3 | requires a title | `{}`; `{ title:'  ' }` | 400 VALIDATION_ERROR 'Task title is required' |
| 4 | logs task_created | create | activity includes `{ action:'task_created', detail:{ taskId, title:'Audit', taskCode:'SD-P00001-T01' } }` |
| 5 | `[quirk] Q31: a task created already closed has no completedAt` | `{ title:'x', statusId: COMPLETED }` | `completedAt:null` // Likely correct: stamped at creation |
| 6 | updates every allowed field | PATCH `title, description, priority:'urgent', assignedToUserId:mgr, dueDate:'2026-12-01', position:7` | echoed |
| 7 | closing stamps completedAt and logs task_closed; reopening clears it silently | PATCH `COMPLETED`; then `ACTIVE` | `completedAt` set and one `task_closed` `{ taskId, title, taskCode }`; then `completedAt:null` and no new activity |
| 8 | `[quirk] Q7 …` | worked example | — |
| 9 | `[quirk] Q15: re-sending the same closed status logs task_closed again` | PATCH `COMPLETED` twice (numbers) | two `task_closed` entries // Likely correct: one |
| 10 | deletes a task and logs it | DELETE | `{ ok:true }`; gone from list; `task_deleted` `{ taskId, title, taskCode }` |
| 11 | a task from another project is not found through this one | PATCH, DELETE and renumber `/projects/P/tasks/<task of Q>` | 404 NOT_FOUND 'Task not found' each |
| 12 | reorders tasks | tasks t1..t3; PATCH `/tasks/reorder` `{ order:[t3,t1,t2] }` | `{ ok:true }`; list order t3, t1, t2 with positions 1, 2, 3 |
| 13 | reorder validation | `{ order:[] }`; `{ order:[t1, taskOfQ] }` | 400 'order must be a non-empty array of task IDs'; 400 'One or more tasks do not belong to this project' |
| 14 | `[quirk] Q32: a partial reorder leaves duplicate positions` | t1..t3; `{ order:[t3] }` | positions t1 1, t3 1, t2 2; list order t1, t3, t2 // Likely correct: the rest renumbered around it |
| 15 | renumbers a task's code without moving it | t1, t2; PATCH t1 `/code` `{ number:5 }`; create t3 | t1 `SD-P00001-T05`, position still 1; t3 gets `T06` |
| 16 | renumber validation | `{ number:0 }`, `{ number:100 }`, `{ number:'x' }` | 400 VALIDATION_ERROR 'Task number must be between 1 and 99' |
| 17 | renumber refuses a taken number but allows its own | t1, t2; t1 → 2; t1 → 1 | 409 `TASK_CODE_CONFLICT` 'Task T02 already exists in this project. Choose a different number.'; 200 |
| 18 | `[quirk] Q20: renumbering a task leaves its subtasks on the old number` | t1 with subtask s1; renumber t1 → 5; add s2 | s1 `SD-P00001-T01-S01`; s2 `SD-P00001-T05-S02` // Likely correct: subtask codes follow the task |
| 19 | creates a subtask with defaults | POST `/tasks/t1/subtasks` `{ title:'  Cable  ' }` | 201 `subtask` has `title:'Cable', subtaskCode:'SD-P00001-T01-S01', statusId:ACTIVE, position:1, completedAt:null` |
| 20 | requires a subtask title | `{ title:' ' }` | 400 VALIDATION_ERROR 'Subtask title is required' |
| 21 | a subtask can't be created under another project's task | POST `/projects/P/tasks/<task of Q>/subtasks` | 404 NOT_FOUND 'Task not found' |
| 22 | closing a subtask stamps completedAt and logs once | PATCH `COMPLETED` twice (numbers); then `ACTIVE` | one `subtask_closed` `{ subtaskId, title, subtaskCode }`; `completedAt` set, then null |
| 23 | `[quirk] Q7: same for a subtask` | after closing, backdate `ProjectSubtask.completedAt`; PATCH `String(COMPLETED)` | `completedAt` moved |
| 24 | subtask routes check both parents | update and renumber via `/tasks/t1/subtasks/<subtask of t2>`; via `/projects/P/tasks/<task of Q>/subtasks/<its subtask>` | 404 'Subtask not found'; 404 'Task not found' |
| 25 | renumbers a subtask | s1, s2; s1 → 5; s1 → 2 | `...-S05`; 409 `SUBTASK_CODE_CONFLICT` 'Subtask S02 already exists in this task. Choose a different number.' |
| 26 | subtask renumber validation | `{ number: 0 }` | 400 'Subtask number must be between 1 and 99' |
| 27 | a task with subtasks is complete when all its subtasks are closed | t1 Active with s1 Completed and s2 Active; then close s2 | `isComplete:false, subtaskPercent:50`; then `isComplete:true, subtaskPercent:100` (task status still Active) |
| 28 | a task without subtasks is complete when its own status is closed | t2 Completed, no subtasks | `isComplete:true, subtaskPercent:null` |
| 29 | project completion is the rounded share of complete tasks | 3 tasks, 1 complete | GET P `stats.completionPercent:33, totalTasks:3, closedTasks:1` |
| 30 | scope applies to every task route | own (not a member): GET tasks, POST task; mgr(A) on a dept-B project: GET tasks | 403 project each |
| 31 | non-numeric ids are 404s | GET `/projects/abc/tasks`; PATCH `/projects/P/tasks/xyz` | 404 both |
| 32 | `[quirk] Q19: task lists show a linked ticket the viewer can't open` | admin links a P task to dept-B ticket 'Secret'; mgr(A) GETs P tasks | `linkedTicket` `{ id, title:'Secret' }` // Likely correct: hidden or redacted |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- projects.tasks.test.js`
Expected: PASS, including the S1 and S4 blocks.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/projects.tasks.test.js
git commit -m "test(projects): baseline for tasks, subtasks, codes, reorder and rollups"
```

---

### Task 12: `projects.extras.test.js` — expenses, materials, members, files

**Files:**
- Modify: `backend/test/integration/projects.extras.test.js` (created in Task 6)

- [ ] **Step 1: Add the cases**

`tech` and `proj` come from the file's `beforeEach`. "Q" is a second project in B.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | logs an expense | tech: POST `/expenses` `{ description:'  Cables  ', amount:'12.5', category:'materials', entryDate:'2026-01-05', taskId: t }` | 201 `expense` has `description:'Cables', amount:12.5, category:'materials', entryDate:'2026-01-05', loggedBy:tech`, `task` `{ id:t, title }`; activity `expense_added` `{ expenseId, description:'Cables', amount:12.5 }` |
| 2 | expense defaults | `{ description:'x', amount:0 }` | `category:'other'`, `entryDate: today`, `amount:0` |
| 3 | expense validation | no description; `'  '`; `amount:-1`; `amount:'abc'`; no amount | 400 VALIDATION_ERROR: 'Description is required' ×2, 'Amount must be a non-negative number' ×3 |
| 4 | lists expenses with a whole-project total | freeze; three expenses (10, 20, 30.5) on entryDates 01-01, 01-03, 01-02; GET `?limit=2` | `expenses` dates `['2026-01-03','2026-01-02']`, `total:3`, `totalAmount:60.5` |
| 5 | updates an expense | PATCH `{ description:'y', amount:7, category:'travel', entryDate:'2026-02-01' }` | echoed |
| 6 | `[quirk] Q33: expense update skips the create-time validation` | PATCH `{ amount:-5 }` | 200, `amount:-5` // Likely correct: 400 as on create |
| 7 | deletes an expense | DELETE | `{ ok:true }`; list empty |
| 8 | an expense from another project is not found through this one | PATCH and DELETE `/projects/proj/expenses/<expense of Q>` | 404 NOT_FOUND 'Expense not found' |
| 9 | adds a material and prices it | `{ itemName:' Switch ', vendor:'Acme', modelNumber:'S1', serialNumber:'SN1', quantity:3, unitCost:19.99, notes:'n' }` | 201 `material` has `itemName:'Switch', serialNumber:['SN1'], quantity:3, unitCost:19.99, totalCost:59.97`; activity `material_added` `{ materialId, itemName:'Switch' }` |
| 10 | material defaults and serial lists | `{ itemName:'x' }`; `{ itemName:'y', serialNumber:['A','',null,'B'] }` | `quantity:1, unitCost:0, totalCost:0, serialNumber:[]`; `serialNumber:['A','B']` |
| 11 | material validation | no itemName; `'  '`; `quantity:0`; `unitCost:-1` | 400: 'Item name is required' ×2; 'Quantity must be a positive number'; 'Unit cost must be a non-negative number' |
| 12 | re-prices when quantity or unit cost changes, not otherwise | material 3 × 19.99; PATCH `{ quantity:2 }`; `{ unitCost:5 }`; `{ notes:'z' }` | `totalCost` 39.98; 10; 10 |
| 13 | `[quirk] Q33: material update skips validation` | PATCH `{ quantity:0 }` | 200, `quantity:0, totalCost:0` |
| 14 | lists materials with a whole-project total | two materials (59.97, 10) | `totalAmount:69.97` |
| 15 | a material from another project is not found through this one | PATCH and DELETE via proj | 404 NOT_FOUND 'Material not found' |
| 16 | adds members | tech: POST `/members` `{ userId: mgr, role:'lead' }`; `{ userId: staff, role:'owner' }` | 201 roles `lead` and `member`; activity `member_added` `{ userId: mgr, displayName:'Test mgr' }` |
| 17 | member validation | `{}`; `{ userId: 99999 }`; a duplicate | 400 'userId is required'; 400 'User does not exist'; 409 `ALREADY_MEMBER` 'User is already a member of this project' |
| 18 | lists leads before members | freeze; add staff (member), advance 1 s, add mgr (lead) | user ids `[mgr, staff]` |
| 19 | removing a member removes their access | own added as member; own GET proj; DELETE `/members/<own>`; own GET proj | 200; `{ ok:true }`; 403 project |
| 20 | removing a non-member | DELETE `/members/<mgr>` | 404 NOT_FOUND 'Member not found' |
| 21 | lists, downloads and deletes a file | upload `notes.txt` ('hello'); GET files; GET `/files/:fid/download`; DELETE; GET files | list has `filename:'notes.txt', filesize:5, uploadedByUser.username:'tech'`; download `res.text` is 'hello'; `{ ok:true }`; empty. Activity has `file_uploaded` `{ fileId, filename:'notes.txt' }` |
| 22 | a file from another project is not found through this one | download and DELETE via proj | 404 NOT_FOUND 'File not found' |
| 23 | `[quirk] Q17: any project editor can delete anyone's file` | tech uploads; mgr(A) (editor, not the uploader) DELETEs | 200 // Likely correct: uploader or a moderator only, as on tickets |
| 24 | scope applies to every extras list | own (not a member): GET expenses, materials, members, files | 403 project ×4 |

- [ ] **Step 2: Run the file**

Run: `cd backend && npm run test:integration -- projects.extras.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/test/integration/projects.extras.test.js
git commit -m "test(projects): baseline for expenses, materials, members and files"
```

---

### Task 13: `time.tickets.test.js` — logging, rounding, logging for others, delete rules

**Files:**
- Create: `backend/test/integration/time.tickets.test.js`

- [ ] **Step 1: Write the setup and the date worked example**

```js
const { resetData, closeDb, ROLE, createUserAndLogin } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeUser, makeOwnTier, makeContractor, makeTicket,
  makeTeam, freezeClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
let ctr;
let ticket;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 75 });
  ticket = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const timeUrl = () => `${API}/tickets/${ticket.id}/time`;

describe('entry dates', () => {
  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  // Likely correct: "today" is the user's local date. Expected to change in sub-project 3.
  it('[quirk] Q14: "today" for entryDate is the UTC date', async () => {
    freezeClock('2026-03-10T03:30:00Z');
    const fresh = await makeTech('late', w.deptA.id); // log in under the frozen clock
    const byDefault = expectOk(await fresh.agent.post(timeUrl()).send({ minutes: 5 }), 201).entry;
    expect(byDefault.entryDate).toBe('2026-03-10');
    expect((await fresh.agent.post(timeUrl()).send({ minutes: 5, entryDate: '2026-03-10' })).status).toBe(201);
    const future = await fresh.agent.post(timeUrl()).send({ minutes: 5, entryDate: '2026-03-11' });
    expect(future.status).toBe(400);
    expect(future.body.message).toBe('Entry date cannot be in the future');
  });
});
```

- [ ] **Step 2: Add the remaining cases**

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | logs minutes | tech: `{ minutes:45, note:'Fuser' }` | 201 `entry` has `ticketId, userId:tech, loggedById:tech, minutes:45, durationSeconds:2700, startTime:null, endTime:null, note:'Fuser', entryDate: today, laborCost:null`, `user.username:'tech'`, `loggedBy.username:'tech'` |
| 2 | accepts minutes as a numeric string and truncates fractions | `{ minutes:'30' }`; `{ minutes:1.9 }` | `minutes:30`; `minutes:1` |
| 3 | rejects minutes that aren't a positive integer | `{ minutes:0 }`, `-5`, `'abc'`, `{}` | 400 VALIDATION_ERROR 'minutes must be a positive integer' each |
| 4 | derives duration from start and end, to the second | ctr: `{ startTime:'2026-01-05T15:00:00Z', endTime:'2026-01-05T16:30:30Z' }` | `durationSeconds:5430, minutes:91` (90.5 rounds up), `startTime:'2026-01-05T15:00:00.000Z', endTime:'2026-01-05T16:30:30.000Z', laborCost:113.13` |
| 5 | a very short span still counts as one minute | ctr: 15:00:00 → 15:00:20 | `durationSeconds:20, minutes:1, laborCost:0.42` |
| 6 | measures across the DST change by the clock, not the wall | tech: `2026-03-08T07:30:00Z` → `08:30:00Z` | `durationSeconds:3600, minutes:60` |
| 7 | measures across midnight UTC | tech: `2026-03-09T23:30:00Z` → `2026-03-10T00:30:00Z` | `durationSeconds:3600` |
| 8 | rejects a backwards, empty or unreadable span | end before start; end equal to start; `startTime:'garbage'` | 400 'End time must be after start time' ×2; 400 'Invalid start/end time' |
| 9 | uses minutes when only one of start and end is given | `{ startTime:'2026-01-05T15:00:00Z', minutes:10 }` | `minutes:10, startTime:null` |
| 10 | keeps a past entryDate and trims a timestamp to its date | `{ minutes:5, entryDate:'2026-01-05' }`; `{ minutes:5, entryDate:'2026-01-05T22:00:00Z' }` | `'2026-01-05'` both |
| 11 | `[quirk] Q14 …` | worked example | — |
| 12 | a user's own id sent as a string is "themselves" | tech: `{ minutes:5, userId: String(tech.user.id) }` | 201, `userId:tech, loggedById:tech` |
| 13 | only admins and team leads log for others | tech: `{ minutes:5, userId: ctr }` | 403 FORBIDDEN 'Only admins and team leads can log time for other users' |
| 14 | an admin logs for someone, and their rate applies | admin: `{ minutes:60, userId: ctr }` | 201 `userId:ctr, loggedById:admin, laborCost:75` |
| 15 | the target must exist and hold projects.log_time | admin: `userId` of a Read Only user (`makeUser('ro', ROLE.READ_ONLY, A)`); `userId: 99999` | 400 VALIDATION_ERROR 'Invalid user to log time for' both |
| 16 | a team lead logs for a teammate | lead = makeTech('lead', A); team `[{ userId:lead, isLead:true }, { userId:tech, isLead:false }]`; lead: `{ minutes:30, userId: tech }` | 201 `userId:tech, loggedById:lead` |
| 17 | `[quirk] Q21: any team lead logs for anyone, teammate or not` | lead as in 16; lead: `{ minutes:30, userId: mgr }` (mgr = makeManager, on no team) | 201 // Likely correct: only for members of a team they lead |
| 18 | a contractor with no rate has no labour cost | `makeContractor(..., { rate: null })` logs 60 min | `laborCost:null` |
| 19 | lists newest first with a whole-ticket total | freeze; log 10, 20, 30 min advancing 1 s each; GET `?limit=1` | `entries` has 1 (the 30), `total:3, totalPages:3, totalMinutes:60` |
| 20 | logs a time_logged activity entry | tech logs 45 | activity has `['time_logged', null, '45m']` with `user.username:'tech'` |
| 21 | a ticket with no time | GET time | `{ entries:[], page:1, limit:25, total:0, totalPages:1, totalMinutes:0 }` |
| 22 | users delete their own entries | tech logs, then DELETEs | `{ ok:true }`; list empty |
| 23 | only admins delete other people's entries | ctr logs; tech DELETEs; admin DELETEs | 403 FORBIDDEN 'You can only remove your own time entries'; 200 |
| 24 | `[quirk] Q4: on tickets, "own entry" means the person it's for` | lead logs 30 for tech (as in 16); lead DELETEs; tech DELETEs | 403; 200 // Likely correct: the logger and the person it's for both may |
| 25 | `[quirk] Q6: logging for others checks the legacy admin role` | `createUserAndLogin({ username:'granular', roleName: ROLE.ADMIN, legacyRole:'technician' })`: `{ minutes:5, userId: tech }` | 403 // Likely correct: a granular permission decides |
| 26 | an entry from another ticket is not found through this one | admin logs on T2; DELETE `/tickets/T/time/<that id>` | 404 NOT_FOUND 'Time entry not found' |
| 27 | own-tier users can't log or list on others' tickets | own: GET and POST time on T (assigned to tech) | 403 ticket both |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- time.tickets.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/time.tickets.test.js
git commit -m "test(time): baseline for ticket time"
```

---

### Task 14: `time.projects.test.js` — project time, task links, editing

**Files:**
- Create: `backend/test/integration/time.projects.test.js`

- [ ] **Step 1: Write the setup and the Q1 worked example**

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeOwnTier, makeContractor, makeProject, makeTask,
  makeTeam, freezeClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
let ctr;
let proj;
let task;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 75 });
  proj = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  task = await makeTask(w.admin.agent, proj.id, { title: 'Rack' });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const url = () => `${API}/projects/${proj.id}/time-entries`;
const span = (start, end) => ({ startTime: `2026-01-05T${start}:00Z`, endTime: `2026-01-05T${end}:00Z` });

// Likely correct: labour cost follows the corrected duration. Expected to change in sub-project 3.
it('[quirk] Q1: editing start/end recomputes duration but not labour cost', async () => {
  const entry = expectOk(await ctr.agent.post(url()).send(span('15:00', '16:30')), 201).entry;
  expect(entry.laborCost).toBe(112.5);
  const edited = expectOk(await ctr.agent.patch(`${url()}/${entry.id}`).send(span('15:00', '15:30'))).entry;
  expect(edited.durationSeconds).toBe(1800);
  expect(edited.laborCost).toBe(112.5);
});
```

- [ ] **Step 2: Add the remaining cases**

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | logs a span against a task | ctr: `span('15:00','16:30')` + `description:'Rack', taskId: task, entryDate:'2026-01-05'` | 201 `entry` has `projectId, taskId:task, userId:ctr, loggedForUserId:ctr, description:'Rack', durationSeconds:5400, entryDate:'2026-01-05', laborCost:112.5`, `task` `{ id, title:'Rack' }` |
| 2 | defaults | tech: `span('09:00','10:00')` | `entryDate: today, description:null, taskId:null, laborCost:null` |
| 3 | requires a valid forward span | `{ minutes:30 }`; `span('16:00','15:00')`; same start and end | 400 'Invalid start/end time'; 400 'End time must be after start time' ×2 |
| 4 | a task must belong to this project | other project Q's task as `taskId` | 400 VALIDATION_ERROR 'Task does not belong to this project' |
| 5 | measures across the DST change by the clock | `2026-03-08T07:30:00Z` → `08:30:00Z` | `durationSeconds:3600` |
| 6 | rejects a future entryDate and pins UTC "today" | freeze `2026-03-10T03:30:00Z`, log in a fresh tech; `entryDate:'2026-03-11'`; then default | 400 'Entry date cannot be in the future'; default `entryDate:'2026-03-10'` (Q14, same comment as Task 13) |
| 7 | logging for others follows the ticket rules | tech for ctr; admin for ctr (`span('15:00','16:00'), loggedForUserId: ctr`); admin for 99999 | 403 'Only admins and team leads can log time for other users'; 201 `userId:admin, loggedForUserId:ctr, laborCost:75`; 400 'Invalid user to log time for' |
| 8 | a user's own id as a string is "themselves" | tech: `loggedForUserId: String(tech.user.id)` | 201 `userId:tech, loggedForUserId:tech` |
| 9 | lists newest first with whole-project totals | tech logs 60 min; GET; ctr logs 90; GET `?limit=1` | first: `totalSeconds:3600, totalLaborCost:null`; second: `entries` length 1, `total:2, totalSeconds:9000, totalLaborCost:112.5` |
| 10 | logs a time_logged activity entry | ctr logs 90 | activity has `{ action:'time_logged', detail:{ minutes:90 } }` |
| 11 | edits description, date, task and span | tech logs; PATCH `{ description:'new', entryDate:'2026-01-04', taskId:null }`, then `span('10:00','10:45')` | echoed; `durationSeconds:2700` |
| 12 | `[quirk] Q1 …` | worked example | — |
| 13 | `[quirk] Q2: editing writes no audit row` | ctr logs; count `AuditLog` with `entityType:'ProjectTimeEntry'` (1); PATCH description; count again | still 1 // Likely correct: `project_time.update` audited |
| 14 | `[quirk] Q3: editing accepts a future entryDate` | PATCH `{ entryDate:'2099-01-01' }` | 200 `entryDate:'2099-01-01'` // Likely correct: 400 as on create |
| 15 | `[quirk] Q22: editing accepts another project's task` | PATCH `{ taskId: <task of Q> }` | 200 // Likely correct: 400 'Task does not belong to this project' |
| 16 | edit validates a given span and ignores a half one | PATCH `{ startTime:'garbage', endTime:'x' }`; `span('11:00','10:00')`; `{ startTime:'2026-01-05T08:00:00Z' }` alone | 400 'Invalid start/end time'; 400 'End time must be after start time'; 200 with duration unchanged |
| 17 | users delete their own entries | tech logs; DELETE | `{ ok:true }`; list empty |
| 18 | only admins edit or delete other people's entries | ctr logs; tech PATCHes and DELETEs; admin PATCHes and DELETEs | 403 'You can only edit your own time entries' / 403 'You can only remove your own time entries'; 200 / 200 |
| 19 | `[quirk] Q4: on projects, "own entry" means the logger` | admin logs for ctr; ctr PATCHes and DELETEs | 403 / 403 // Likely correct: the person it's for may too |
| 20 | an entry from another project is not found through this one | PATCH and DELETE via P for an entry on Q | 404 NOT_FOUND 'Time entry not found' |
| 21 | own-tier users can't log or list on projects they aren't on | own: GET and POST | 403 project both |
| 22 | a project with no time | GET | `{ entries:[], total:0, totalSeconds:0, totalLaborCost:null }` (plus `page`, `limit`, `totalPages`) |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- time.projects.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/time.projects.test.js
git commit -m "test(time): baseline for project time"
```

---

### Task 15: `time.timer.test.js` — start, switch, stop, cancel

**Files:**
- Modify: `backend/test/integration/time.timer.test.js` (created in Task 3)

- [ ] **Step 1: Write the stop worked example**

```js
describe('stopping', () => {
  it('logs the elapsed time against the start', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
    expectOk(await tech.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: t.id, label: 'Working' }), 201);
    advanceClock(125 * 1000);
    const { entry, timer } = expectOk(await tech.agent.post(`${API}/timer/stop`).send({ note: 'Done' }));
    expect(timer).toBeNull();
    expect(entry).toEqual(expect.objectContaining({
      ticketId: t.id, userId: tech.user.id, minutes: 2, durationSeconds: 125, note: 'Done',
      loggedAt: '2026-03-11T15:00:00.000Z', laborCost: null,
    }));
    expect(expectOk(await tech.agent.get(`${API}/timer`)).timer).toBeNull();
  });
});
```

- [ ] **Step 2: Add the remaining cases**

"T" and "T2" are department-A tickets. `tech` is made inside each test, after any `freezeClock`.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | no timer to begin with | tech: GET `/timer` | `{ timer:null }` |
| 2 | validates start | `{ type:'project', id:T }`; `{ type:'ticket' }`; `{ type:'ticket', id:99999 }` | 400 'Invalid timer type'; 400 'A target id is required'; 404 NOT_FOUND 'Ticket not found' |
| 3 | starts a timer | freeze `2026-03-11T15:00:00Z`; `{ type:'ticket', id:T, label:'Working' }` | 201 `{ timer:{ type:'ticket', id:T, label:'Working', startedAt:'2026-03-11T15:00:00.000Z' }, logged:null }`; GET agrees |
| 4 | starting the same ticket again changes nothing | start T; advance 60 s; start T | 200, `startedAt` unchanged, `logged:null` |
| 5 | starting another ticket logs the first | start T; advance 600 s; start T2 | 201 `timer.id:T2`, `timer.startedAt` 15:10; `logged` has `ticketId:T, minutes:10, durationSeconds:600, note:'Timer', loggedAt:'2026-03-11T15:00:00.000Z'` |
| 6 | stopping with no timer | POST `/timer/stop` | `{ timer:null, entry:null }` |
| 7 | logs the elapsed time against the start | worked example | — |
| 8 | under a minute still logs one minute | start; advance 20 s; stop | `minutes:1, durationSeconds:20, note:'Timer'` |
| 9 | charges a contractor for the elapsed time | contractor at 60; start; advance 1800 s; stop | `laborCost:30` |
| 10 | `[quirk] Q5: timer time has no span or logger, and its entryDate is the stop's UTC date` | freeze `2026-03-09T23:50:00Z`; start; advance 1800 s; stop | `startTime:null, endTime:null, loggedById:null`, `loggedAt:'2026-03-09T23:50:00.000Z'`, `entryDate:'2026-03-10'` // Likely correct: same shape as manual time. Expected to change in sub-project 3 |
| 11 | cancel discards without logging | start; DELETE `/timer` | `{ ok:true, timer:null }`; GET `/tickets/T/time` `total:0` |
| 12 | stopping writes the ticket's time_logged entry | start; advance 125 s; stop | T activity has `['time_logged', null, '2m']` |
| 13 | each user has their own timer | tech and ctr each start on T | each GET `/timer` returns their own `startedAt` |
| 14 | `[quirk] Q34: a timer on a deleted ticket can't be stopped or replaced` | start on T2; admin DELETEs T2; stop; start T | 400 `FK_CONSTRAINT` both; GET `/timer` still `id:T2`; DELETE `/timer` then clears it // Likely correct: stop discards it or logs nothing |

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- time.timer.test.js`
Expected: PASS, including the S2 block.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/time.timer.test.js
git commit -m "test(time): baseline for the timer"
```

---

### Task 16: `readers.reports.test.js` — time-billing, team performance, projects report

**Files:**
- Modify: `backend/test/integration/fixtures.js` (add `LEDGER_NOW`, `makeLedger`)
- Create: `backend/test/integration/readers.reports.test.js`

**Interfaces:**
- Produces:
  - `LEDGER_NOW = '2026-03-11T17:00:00Z'`
  - `makeLedger(w) → { tina, carl, ticket, project }`, called with the clock frozen at `LEDGER_NOW`. Task 17 uses both.

- [ ] **Step 1: Add the ledger fixture**

Append to `fixtures.js`, and add `LEDGER_NOW` and `makeLedger` to `module.exports`:

```js
// The shared time-and-money fixture for the reader suites. Every figure is a
// whole number of 6-minute steps, so hours round the same way in every
// reader: any disagreement between readers is a real difference.
//   Ticket "Printer" (dept A, assigned Tina):
//     Tina 90 min (minutes path, entryDate 2026-03-02)
//     Carl 60 min (14:00–15:00Z on 2026-03-11)
//   Project "Refresh" (dept A, lead Tina):
//     Carl 30 min (15:00–15:30Z, entryDate 2026-03-11)
//     Tina 120 min (13:00–15:00Z on 2026-03-10)
//     expense 100.00; material 2 × 25.00
// Carl is a contractor at $75/h. Totals: 5.0 h, of which contractor 1.5 h and
// internal 3.5 h; labour $112.50 ($75.00 ticket + $37.50 project).
// Call with the clock frozen at LEDGER_NOW (a Wednesday), so every loggedAt
// and createdAt is that instant.
const LEDGER_NOW = '2026-03-11T17:00:00Z';
async function makeLedger(w) {
  const tina = await makeTech('tina', w.deptA.id);
  const carl = await makeContractor(w.admin, 'carl', w.deptA.id, { rate: 75 });
  const ticket = await makeTicket(w.admin.agent, {
    title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tina.user.id,
  });
  expectOk(await tina.agent.post(`${API}/tickets/${ticket.id}/time`).send({ minutes: 90, entryDate: '2026-03-02' }), 201);
  expectOk(await carl.agent.post(`${API}/tickets/${ticket.id}/time`).send({
    startTime: '2026-03-11T14:00:00Z', endTime: '2026-03-11T15:00:00Z', entryDate: '2026-03-11',
  }), 201);
  const project = await makeProject(w.admin.agent, {
    name: 'Refresh', ownerDepartmentId: w.deptA.id, assignedToUserId: tina.user.id,
  });
  const pt = `${API}/projects/${project.id}/time-entries`;
  expectOk(await carl.agent.post(pt).send({
    startTime: '2026-03-11T15:00:00Z', endTime: '2026-03-11T15:30:00Z', entryDate: '2026-03-11',
  }), 201);
  expectOk(await tina.agent.post(pt).send({
    startTime: '2026-03-10T13:00:00Z', endTime: '2026-03-10T15:00:00Z', entryDate: '2026-03-10',
  }), 201);
  expectOk(await w.admin.agent.post(`${API}/projects/${project.id}/expenses`).send({ description: 'Cables', amount: 100 }), 201);
  expectOk(await w.admin.agent.post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Switch', quantity: 2, unitCost: 25 }), 201);
  return { tina, carl, ticket, project };
}
```

- [ ] **Step 2: Write the setup and the summary worked example**

```js
const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeManager, makeTicket, makeProject, makeTech,
  freezeClock, advanceClock, unfreezeClock, LEDGER_NOW, makeLedger,
} = require('./fixtures');

afterEach(unfreezeClock);
afterAll(closeDb);

describe('time-billing over the ledger', () => {
  let w;
  beforeEach(async () => {
    freezeClock(LEDGER_NOW);
    await resetData();
    w = await makeWorld();
    await makeLedger(w);
  });

  it('summarises every entry, ticket and project', async () => {
    const { summary, chartData } = expectOk(await w.admin.agent.get(`${API}/reports/time-billing`));
    expect(summary).toEqual({
      totalHours: 5, avgHoursPerTicket: 2.5, entryCount: 4,
      internalHours: 3.5, contractorHours: 1.5, totalLaborCost: 112.5,
    });
    expect(chartData.byTech).toEqual([{ name: 'Test tina', hours: 3.5 }, { name: 'Test carl', hours: 1.5 }]);
    expect(chartData.byType).toEqual([{ name: 'request', hours: 2.5 }, { name: 'Project work', hours: 2.5 }]);
    expect(chartData.byDepartment).toEqual([{ name: 'Service Desk', hours: 5 }]);
    expect(chartData.overTime).toEqual([{ date: '2026-03-11', hours: 5 }]);
    expect(chartData.granularity).toBe('day');
  });
});
```

Every request inside these describes happens under the frozen clock. That is why `freezeClock` comes before `resetData` and the logins.

- [ ] **Step 3: Add the remaining cases**

Cases 1 and 13 go in their own describe, without the ledger. Case 13 makes its own `tina`. Every other case lives in the ledger describe from the worked example. Everything is as the admin unless stated.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | an empty install reports zeros | no ledger: GET time-billing, team-performance, projects | time-billing `summary` all zeros and `tableData.rows:[]`; team-performance `summary` `{ techCount:1, totalClosed:0, avgResolutionHours:null }` (the admin); projects `summary` `{ totalActive:0, totalCompletedInPeriod:0, avgCompletion:0, totalMaterialsCost:0, totalExpensesCost:0 }` |
| 2 | summarises every entry | worked example | — |
| 3 | one row per entry | ledger: GET | `tableData.rows` (ignoring `id`) contains exactly: `{ techName:'Test tina', reference:'#00001 Printer', note:'', date:'2026-03-11', hours:1.5, laborCost:'' }`, `{ 'Test carl', '#00001 Printer', '', '2026-03-11', 1, 75 }`, `{ 'Test carl', 'Project: Refresh', '', '2026-03-11', 0.5, 37.5 }`, `{ 'Test tina', 'Project: Refresh', '', '2026-03-11', 2, '' }` |
| 4 | `[quirk] Q9: dates and date filters use when time was recorded, not the work date` | ledger: GET `?startDate=2026-03-01&endDate=2026-03-05` | `entryCount:0`, even though Tina's ticket entry has `entryDate:'2026-03-02'`; case 3's rows all say `2026-03-11` // Likely correct: `entryDate` |
| 5 | `[quirk] Q36: an endDate means the end of the previous local day west of UTC` | ledger: `?startDate=2026-03-11&endDate=2026-03-11`; then `&endDate=2026-03-12` | `entryCount:0`; then `4` // Likely correct: the whole of the end date |
| 6 | filters by the person the time is for | ledger: `?assigneeId=<carl>` | `entryCount:2, totalLaborCost:112.5` |
| 7 | filters by department | ledger, plus ticket "Boiler" in B with 30 admin minutes: `?departmentId=<B>` | `entryCount:1, totalHours:0.5` |
| 8 | reports.view_own sees only their own time | ledger; staff(A) logs 30 min on the ledger ticket; staff GETs | `entryCount:1, totalHours:0.5` |
| 9 | reports.view_department sees their department's tickets and projects | ledger plus "Boiler" as in 7; mgr(A) GETs | `entryCount:4` |
| 10 | exports the rows as CSV | ledger: GET `/reports/time-billing/export` | 200; `content-type` `text/csv; charset=utf-8`; `content-disposition` `attachment; filename="prism-time-billing.csv"`; `res.text.split('\r\n')` has header `Tech,Ticket/Project,Description,Date,Hours,Labor cost` plus 4 lines, including `Test carl,#00001 Printer,,2026-03-11,1,75` |
| 11 | `[quirk] Q10: team performance counts ticket time only` | ledger: GET `/reports/team-performance` | Tina's row `totalHoursLogged:1.5` (her 2 h of project time is missing); Carl's `1` // Likely correct: all time |
| 12 | team performance per technician | ledger: Tina's row | `{ name:'Test tina', department:'Service Desk', assigned:1, closed:0, overdue:0, workload:1, avgResolutionHours:null, avgFirstResponseHours:null }` |
| 13 | resolution and first-response hours | freeze `2026-03-11T12:00:00Z`; tina; ticket assigned to tina; advance 30 min, tina posts a private comment; advance 30 min, tina posts a reply; advance 2 h, PATCH Resolved; another ticket for tina, `dueDate:'2026-03-10'`, Open | Tina's row `assigned:2, closed:1, overdue:1, workload:1, avgResolutionHours:3, avgFirstResponseHours:1`; `summary.totalClosed:1` |
| 14 | team performance scope | mgr(A) GETs; tech in B exists | rows only for department-A users |
| 15 | exports team performance as CSV | GET `/reports/team-performance/export` | header `Name,Department,Assigned,Closed,Overdue,Avg resolution (hrs),Time logged (hrs),Avg first response (hrs)` |
| 16 | `[quirk] Q11: the projects report's total cost leaves out labour` | ledger: GET `/reports/projects` | row `{ projectCode:'SD-P00001', name:'Refresh', ownedBy:'Service Desk', forDept:'Service Desk', status:'Active', completion:0, dueDate:'', timeLoggedHours:2.5, materialsCost:50, expensesCost:100, totalCost:150 }` (the custom report says 187.5; see Task 17) // Likely correct: one definition of total cost everywhere |
| 17 | projects report summary | ledger | `{ totalActive:1, totalCompletedInPeriod:0, avgCompletion:0, totalMaterialsCost:50, totalExpensesCost:100 }` |
| 18 | counts projects closed in the period | ledger; PATCH project status `Completed`; GET; GET `?startDate=2026-03-12` | `totalCompletedInPeriod:1`; then `0` |
| 19 | projects report scope | ledger plus a dept-B project; mgr(A) GETs; staff(A) GETs | mgr: only Refresh; staff (view_own = projects they lead): none |
| 20 | exports the projects report as CSV | GET `/reports/projects/export` | header `Project,Name,Owned by,For dept,Status,Completion %,Due date,Time logged (hrs),Materials cost,Expenses cost,Total cost` |

- [ ] **Step 4: Run the file**

Run: `cd backend && npm run test:integration -- readers.reports.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/test/integration/fixtures.js backend/test/integration/readers.reports.test.js
git commit -m "test(reports): baseline for time-billing, team performance and projects report"
```

---

### Task 17: `readers.other.test.js` — dashboard, custom reports, PDF data, and the ledger cross-check

**Files:**
- Create: `backend/test/integration/readers.other.test.js`

- [ ] **Step 1: Write the setup and the cross-check worked example**

```js
const { resetData, closeDb, models } = require('./helpers');
const { loadTicketReportData } = require('../../src/services/ticketReport');
const { loadProjectReportData } = require('../../src/services/projectReport');
const {
  API, expectOk, makeWorld, makeOwnTier, makeTicket, freezeClock, unfreezeClock, LEDGER_NOW, makeLedger,
} = require('./fixtures');

afterEach(unfreezeClock);
afterAll(closeDb);

let w;
let L;
const custom = async (body) => expectOk(await w.admin.agent.post(`${API}/reports/custom`).send(body));
const sum = (xs, f) => xs.reduce((s, x) => s + Number(f(x) || 0), 0);

// Case 1 (empty install) goes in its own describe above this one, with a
// beforeEach that freezes the clock and resets but builds no ledger.
describe('over the ledger', () => {
beforeEach(async () => {
  freezeClock(LEDGER_NOW);
  await resetData();
  w = await makeWorld();
  L = await makeLedger(w);
});

// The main protection for the ledger merge (sub-project 3): every reader of
// time and labour must agree on the same ledger. Team performance (Q10) and
// the dashboard (Q12) are left out on purpose: they disagree today, and their
// own quirk tests pin by how much.
it('every reader agrees on the ledger', async () => {
  const a = w.admin.agent;
  const ticketTime = expectOk(await a.get(`${API}/tickets/${L.ticket.id}/time`));
  const ticketList = expectOk(await a.get(`${API}/tickets`)).tickets.find((t) => t.id === L.ticket.id);
  const projectTime = expectOk(await a.get(`${API}/projects/${L.project.id}/time-entries`));
  const projectStats = expectOk(await a.get(`${API}/projects/${L.project.id}/stats`)).stats;
  const billing = expectOk(await a.get(`${API}/reports/time-billing`)).summary;
  const projectsReport = expectOk(await a.get(`${API}/reports/projects`)).tableData.rows[0];
  const customTime = (await custom({ dataSource: 'time_entries' })).summary;
  const customProject = (await custom({ dataSource: 'projects' })).tableData.rows[0];
  const customTicket = (await custom({ dataSource: 'tickets' })).tableData.rows[0];
  const ticketPdf = await loadTicketReportData(L.ticket.id);
  const projectPdf = await loadProjectReportData(L.project.id);

  const ticketHours = [
    ticketTime.totalMinutes / 60, ticketList.timeLoggedMinutes / 60, customTicket.timeLoggedHours,
    sum(ticketPdf.timeEntries, (e) => e.minutes) / 60,
  ];
  const projectHours = [
    projectTime.totalSeconds / 3600, projectStats.totalTimeSeconds / 3600, projectsReport.timeLoggedHours,
    customProject.totalTimeLoggedHours, sum(projectPdf.timeEntries, (e) => e.durationSeconds) / 3600,
  ];
  const projectLabour = [
    projectTime.totalLaborCost, customProject.laborCost, sum(projectPdf.timeEntries, (e) => e.laborCost),
  ];
  expect(new Set(ticketHours)).toEqual(new Set([2.5]));
  expect(new Set(projectHours)).toEqual(new Set([2.5]));
  expect(new Set(projectLabour)).toEqual(new Set([37.5]));
  expect(billing.totalHours).toBe(5);
  expect(customTime.total_durationHours).toBe(5);
  expect(billing.totalLaborCost).toBe(112.5);
  expect(customTime.total_laborCost).toBe(112.5);
});

// ...cases 3–19 go here, inside this describe...
});
```

(Indent the describe body properly in the real file. It is flattened here only to keep the diff readable.)

- [ ] **Step 2: Add the remaining cases**

All cases are run as the admin over the ledger unless stated.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | an empty install reports zeros | own `beforeEach` without the ledger: POST custom `{ dataSource:'time_entries' }`; admin GET `/dashboard?userId=<admin>` | `tableData.rows:[]`, `summary` `{ totalRecords:0, total_durationHours:0, total_laborCost:0 }`; `hours.total:0` |
| 2 | every reader agrees on the ledger | worked example | — |
| 3 | `[quirk] Q12: dashboard hours are ticket time only` | GET `/dashboard?userId=<tina>` | `mode:'admin_filtered'`; `hours` `{ total:1.5, byDay:[Mon 0, Tue 0, Wed 1.5, Thu 0, Fri 0] }` as `{ day, hours }` objects; Tina's 2 h of project time is absent // Likely correct: all of the user's time |
| 4 | `[quirk] Q12: dashboard hours drop the weekend and bucket by UTC date` | tina logs 60 and 30 more minutes; set their `loggedAt` (no endpoint sets it) to `2026-03-14T17:00:00Z` (Saturday) and `2026-03-12T02:00:00Z` (Wednesday 21:00 local); GET | Thu gains 0.5 (UTC date of the Wednesday-night entry); the Saturday hour is in no bucket and not in `total`; `total:2` |
| 5 | own-tier users get the personal dashboard | own: GET `/dashboard` | `mode:'tech'`, has `hours` |
| 6 | own-tier users can't view someone else's dashboard | own: GET `/dashboard?userId=<tina>` | 403 FORBIDDEN "You don't have permission to view another user's dashboard" |
| 7 | custom time_entries: one row per entry, dated by entryDate | POST `{ dataSource:'time_entries' }` | rows (ignoring order) are exactly: `{ id:'t1', date:'2026-03-02', techName:'Test tina', userType:'Internal', ticketNumber:'#00001', projectCode:'', description:'', durationHours:1.5, laborCost:null }`; `{ id:'t2', date:'2026-03-11', 'Test carl', 'Contractor', '#00001', '', '', 1, 75 }`; `{ id:'p1', '2026-03-11', 'Test carl', 'Contractor', '', 'SD-P00001', '', 0.5, 37.5 }`; `{ id:'p2', '2026-03-10', 'Test tina', 'Internal', '', 'SD-P00001', '', 2, null }`; `summary` `{ totalRecords:4, total_durationHours:5, total_laborCost:112.5 }` |
| 8 | custom group by tech | `groupBy:'tech'` | `chartData` contains `{ name:'Test tina', count:2, durationHours:3.5, laborCost:0 }` and `{ name:'Test carl', count:2, durationHours:1.5, laborCost:112.5 }`, length 2 |
| 9 | custom group by project | `groupBy:'project'` | `{ name:'(ticket time)', count:2, durationHours:2.5, laborCost:75 }` and `{ name:'SD-P00001', count:2, durationHours:2.5, laborCost:37.5 }` |
| 10 | custom group by month uses entryDate | `groupBy:'month'` | `[{ name:'2026-03', count:4, durationHours:5, laborCost:112.5 }]` |
| 11 | custom filters | `filters:{ userType:'contractor' }`; `filters:{ assigneeId:<tina> }` | ids `t2,p1`; ids `t1,p2` |
| 12 | `[quirk] Q11: the custom projects source counts labour in total cost` | `{ dataSource:'projects' }` | row `totalTimeLoggedHours:2.5, laborCost:37.5, expensesTotal:100, materialsTotal:50, totalCost:187.5, completionPercent:0, lead:'Test tina'` |
| 13 | custom tickets source reports logged hours | `{ dataSource:'tickets' }` | the ledger ticket's row has `timeLoggedHours:2.5` |
| 14 | rejects an unknown data source | `{ dataSource:'nope' }` | 400 VALIDATION_ERROR 'Invalid dataSource' |
| 15 | exports a custom report as CSV | POST `/reports/custom/export-csv` `{ dataSource:'time_entries', fields:['techName','durationHours'] }` | header `Tech name,Duration`, 4 data lines |
| 16 | the ticket PDF is a PDF, behind the ticket's scope | GET `/tickets/<ticket>/report` with a binary parser; own (not assignee) GETs; GET `/tickets/99999/report` | 200, `content-type` `application/pdf`, body starts `%PDF-`; 403 ticket; 404 |
| 17 | ticket PDF data leaves out internal comments and orders time by work date | tina posts a reply and a private comment; `loadTicketReportData(ticket)` | `comments` has 1, of type `reply`; `timeEntries` minutes `[90, 60]` (by entryDate); `activity` actions `['created']` |
| 18 | the project PDF is a PDF, behind the project's scope | GET `/projects/<project>/report`; own GETs | 200 `application/pdf` starting `%PDF-`; 403 project |
| 19 | project PDF data | `loadProjectReportData(project)` | `timeEntries` `durationSeconds` `[7200, 1800]` (Tina's 03-10 first); `expenses` length 1; `materials` length 1; `completion.percent:0`; `activity` actions `['project_created']` |

Binary parser for cases 16 and 18:

```js
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
// usage: const res = await agent.get(url).buffer(true).parse(binary);
//        expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
```

- [ ] **Step 3: Run the file**

Run: `cd backend && npm run test:integration -- readers.other.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/readers.other.test.js
git commit -m "test(reports): baseline for dashboard, custom reports, PDF data and the ledger cross-check"
```

---

### Task 18: `sideEffects.test.js` — audit, notifications, workflow triggers, CSAT surveys, time-before-close

**Files:**
- Create: `backend/test/integration/sideEffects.test.js`

- [ ] **Step 1: Write the setup and the audit worked example**

```js
const { Op } = require('sequelize');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeContact, makeTicket, makeProject, makeTask,
  makeSubtask, setSettings, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

let w;
let tech;
let t;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

// No endpoint reads AuditLogs (GET /audit-log reads SystemAuditLogs), so
// these read the model directly.
const lastAudit = (action) => models.AuditLog.findOne({ where: { action }, order: [['id', 'DESC']], raw: true });
const auditCount = () => models.AuditLog.count({ where: { action: { [Op.ne]: 'auth.login' } } });

describe('audit rows', () => {
  it('ticket.update records exactly the changed fields', async () => {
    expectOk(await tech.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'high' }));
    expect(await lastAudit('ticket.update')).toEqual(expect.objectContaining({
      userId: tech.user.id, entityType: 'Ticket', entityId: t.id, meta: { priority: 'high' },
    }));
  });
});
```

- [ ] **Step 2: Add the audit table**

Write the audit rows as one `it.each`. Each row is `[action, entityType, perform(), expectedMeta]`. Assert `userId` (the actor), `entityType`, `entityId` (the created or affected record), and `meta`.

| action | entityType | performed by | meta |
|---|---|---|---|
| `ticket.create` | Ticket | admin creates "New" | `{ title:'New' }` |
| `ticket.update` | Ticket | tech PATCH `{ priority:'high' }` | `{ priority:'high' }` |
| `ticket.delete` | Ticket | admin DELETE t | `{ title:'Printer' }` |
| `comment.create` | Comment | tech reply | `{ ticketId, type:'reply' }` |
| `comment.update` | Comment | tech edits own | `{ ticketId }` |
| `comment.delete` | Comment | tech deletes own | `{ ticketId }` |
| `attachment.create` | Attachment | tech uploads notes.txt | `{ ticketId, originalName:'notes.txt' }` |
| `attachment.delete` | Attachment | tech deletes own | `{ ticketId }` |
| `time.create` | TimeEntry | tech logs 45 | `{ ticketId, minutes:45 }` |
| `time.delete` | TimeEntry | tech deletes own | `{ ticketId: String(ticketId) }`, the route param, a string |
| `relation.create` | TicketRelation | tech links t→t2 | `{ ticketId, relatedTicketId, relationType:'related' }` |
| `relation.delete` | TicketRelation | tech DELETE via t | `{ ticketId: String(ticketId) }` |
| `csat.submit` | CsatResponse | tech rates resolved t `happy` (entityId is the ticket id) | `{ rating:'happy' }` |
| `timer.log` | TimeEntry | tech starts and immediately stops | `{ ticketId, minutes:1 }` |
| `project.create` | Project | tech creates "Refresh" | `{ name:'Refresh', projectCode:'SD-P00001' }` |
| `project.update` | Project | tech PATCH `{ name:'Renamed' }` | `{ name:'Renamed' }` |
| `project.delete` | Project | admin DELETE | `{ name:'Refresh' }` |
| `project_time.create` | ProjectTimeEntry | tech logs 09:00–10:00 | `{ projectId, durationSeconds:3600 }` |
| `project_time.delete` | ProjectTimeEntry | tech deletes own | `{ projectId: String(projectId) }` |

Then add `[quirk] Q23: these mutations write no audit row` as an `it.each`. For each mutation, `auditCount()` is the same before and after the one request. The comment above it reads: `// Likely correct: every mutating endpoint is audited (roadmap rule 6). Expected to change in sub-project 3.`

The mutations are:
- ticket watcher add and remove
- custom-field-values PATCH
- project task create, update, delete, reorder and renumber
- subtask create, update, delete and renumber
- expense create, update and delete
- material create, update and delete
- member add and remove
- project file upload and delete

Ticket tasks are Q8, already pinned in Task 9. Project time update is Q2, already pinned in Task 14.

- [ ] **Step 3: Add the notification, workflow, CSAT and time-before-close cases**

"W" is a watcher: `watcher = makeTech('watcher', A)`, added to t with POST `/watchers`. Read notifications with GET `/notifications` as the recipient and compare `[type, message]` pairs.

| # | Test name | Request (as) | Expect |
|---|---|---|---|
| 1 | notifies the assignee of a new ticket, not someone assigning themselves | setup already made Printer, assigned to tech by the admin; tech creates 'Self' assigned to tech | tech's notifications are exactly `[['assigned', 'Ticket assigned to you: Printer']]` |
| 2 | notifies the new assignee on reassignment, once | admin PATCH t `{ assigneeId: mgr }`, then the same again | mgr has one `assigned` |
| 3 | notifies watchers of a new ticket, never the creator | admin creates with `watcherIds:[watcher, admin]` | watcher: `['watcher_update','Ticket created: <title>']`; admin: none |
| 4 | notifies watchers of a status change, but not the actor or assignee | W; tech watches too; admin PATCH `{ status:'In Progress' }` | watcher: `['watcher_update','Status changed to "In Progress" on ticket: Printer']`; tech: nothing new |
| 5 | notifies the assignee and watchers of a comment | W; admin posts a 100-character reply of `x` | tech: `['comment', 'Someone commented on ticket: ' + 'x'.repeat(80) + '…']`; watcher: `['watcher_update', "Someone commented on ticket you're watching: Printer"]` |
| 6 | an internal comment reaches the assignee only | W; admin posts `comment_private` | tech: `['reply','Internal comment added to ticket: Printer']`; watcher: none |
| 7 | the enabled-types setting silences other types | `setSettings(admin, { 'notifications.enabledTypes': JSON.stringify(['comment']) })`; admin creates 'Quiet' assigned to tech; admin comments on it | tech gains one `comment` and no `assigned` for Quiet (Printer's `assigned` from setup is still there) |
| 8 | derives an overdue notification once | freeze `2026-03-11T17:00:00Z`, fresh tech; ticket assigned to tech `dueDate:'2026-03-10'`; GET `/notifications` twice | exactly one `['overdue','Ticket is now overdue: <title>']` |
| 9 | derives due-soon only for tickets on a project | same freeze; `dueDate:'2026-03-12'` with `projectId`, and another without | one `['due_soon','Task due date approaching: <title>']`, for the project ticket |
| 10 | read-all empties the unread list | after 1: PATCH `/notifications/read-all` | GET returns `[]` |
| 11 | each trigger event runs its rules | it.each over the triggers below. Admin POST `/workflow-rules` `{ name, triggerEvent, actions:[{ actionType:'add_tag', actionValue:{ tag:'wf' } }] }`, then perform | ticket `tags` contains `'wf'`; GET `/workflow-rules/:id/logs` has one log with `conditionsMet:true, actionsExecuted:['add_tag']` and the notes shown |
| 12 | ticket_closed fires on entering a closed status only | rule on `ticket_closed`; PATCH Resolved, then Closed | one log |
| 13 | an unmet condition is logged but does nothing | rule `conditions:[{ field:'priority', operator:'equals', value:'high' }]` on `ticket_updated`; PATCH `{ title:'x' }` | log `conditionsMet:false, actionsExecuted:null`; `tags:null` |
| 14 | an inactive rule never runs | `isActive:false` rule on `ticket_updated`; PATCH | no logs |
| 15 | `[quirk] Q16: escalate_to_user always fails` | rule on `ticket_created` with `escalate_to_user { userId: tech }`; admin creates an unassigned ticket | ticket `assigneeId:null, priority:'medium'`; log `conditionsMet:true, actionsExecuted:null`, `notes` contains `Data truncated for column 'priority'` // Likely correct: escalates (ticket priorities have no `urgent`) |
| 16 | no CSAT survey while surveys are off | PATCH t Resolved | GET t `csatSurvey:null` |
| 17 | closing creates one pending survey, token hidden | freeze `2026-03-11T17:00:00Z`, fresh users; `setSettings` `{ 'csat.enabled':'true', 'csat.sendDelayHours':'2' }`; PATCH Resolved | `csatSurvey` has `status:'pending', contactId, assignedToUserId:tech, dueToSendAt:'2026-03-11T19:00:00.000Z'` and no `surveyToken` key |
| 18 | reopening and re-closing doesn't make a second survey | after 17: PATCH Open, then Closed | same `csatSurvey.id` |
| 19 | no survey for a contact without email | csat on; ticket with an email-less contact; close | `csatSurvey:null` |
| 20 | requireBeforeClose blocks closing with no time | `setSettings` `{ 'timeTracking.requireBeforeClose':'true' }`; PATCH Resolved | 400 `TIME_REQUIRED_BEFORE_CLOSE` 'Log time on this ticket before closing it'; GET status `Open` |
| 21 | requireBeforeClose allows closing once time is logged | log 5 min; PATCH Resolved | 200 |
| 22 | requireBeforeClose ignores closed→closed and non-status edits | set on; create ticket X `status:'Resolved'`; PATCH X Closed; PATCH t `{ priority:'low' }` | 200; 200 |
| 23 | `[quirk] Q35: creating a ticket already closed bypasses requireBeforeClose` | set on; tech creates `status:'Closed'` with no time | 201 // Likely correct: 400 TIME_REQUIRED_BEFORE_CLOSE |
| 24 | with the setting off, tickets close freely | PATCH Resolved with no time | 200 |

Triggers for case 11:

| triggerEvent | perform | notes |
|---|---|---|
| `ticket_created` | admin creates a ticket (assert on the new one) | `null` |
| `ticket_updated` | PATCH `{ priority:'high' }` | `'changed: priority'` |
| `ticket_status_changed` | PATCH `{ status:'In Progress' }` | `null` |
| `ticket_priority_changed` | PATCH `{ priority:'high' }` | `null` |
| `ticket_assigned` | PATCH `{ assigneeId: admin }` | `null` |
| `ticket_comment_added` | POST a reply | `null` |
| `ticket_closed` | PATCH `{ status:'Resolved' }` | `null` |

- [ ] **Step 4: Run the file**

Run: `cd backend && npm run test:integration -- sideEffects.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/test/integration/sideEffects.test.js
git commit -m "test: baseline for audit, notifications, workflow triggers, CSAT surveys, time-before-close"
```

---

### Task 19: Write the findings back, then ship

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-test-baseline-design.md`
- Modify: `docs/ROADMAP.md`
- Modify: `UPGRADING.md`

- [ ] **Step 1: Run the whole suite and check sizes**

Run: `cd backend && npm test`
Expected: PASS, every suite. Note the wall time, which the spec expects to be 3–5 minutes.

Run: `wc -l backend/test/integration/*.test.js | sort -n | tail -5`
Expected: no file over about 800 lines. Split any that is over into `<area>.<part>.test.js`, rerun, and include the split in this task's commit.

Run: `grep -rho "\[quirk\] Q[0-9]*" backend/test/integration | sort -u`
Expected: Q1 through Q36, each at least once.

- [ ] **Step 2: Update the spec**

In `docs/superpowers/specs/2026-10-03-test-baseline-design.md`:

1. In **Layout**, add rows for `fixtures.test.js` (harness guards) and `tickets.comments.test.js` (comments and attachments, split from extras). Change `tickets.extras.test.js`'s "Covers" to "Relations, watchers, custom field values, staff CSAT".
2. In **Fixtures**, replace the sentence about creating records through the models with: "Every fixture uses the API: teams via `POST /teams`, contractors via `PATCH /users/:id`, own-tier users via `POST /users/:id/overrides`."
3. In **Decisions**, change the "Where assertions read from" row: replace "`/audit-log`" with "`AuditLog` rows read through the model (no endpoint reads them; `/audit-log` reads `SystemAuditLogs`)".
4. Rename **Security fixes (S1–S4)** to **Security fixes (S1–S5)**. Add this row:
   `| S5 | POST /projects/:id/files skips verifyFileSignature, which ticket attachments run. | A Windows executable renamed .pdf is stored on a project. | Add verifyFileSignature to the route. |`
   Change the S3 and S4 fixes to say that a missing ticket now gets the same answer as an out-of-scope one: 400 `VALIDATION_ERROR` 'Linked ticket not found'. Before, it got 400 `FK_CONSTRAINT` on ticket create, and was accepted on project tasks.
   In the sentence "S1–S4 are the only behaviour changes", change S1–S4 to S1–S5.
5. Replace the **Known quirks** table with the table below.
6. In **Dates**, add: "The suite pins `TZ=America/Chicago` in Jest's globalSetup, so local and CI runs agree."

| # | Quirk | Where | Likely fix in |
|---|---|---|---|
| Q1 | Editing a project time entry's start/end recomputes `durationSeconds` but not `laborCost`. | `projectsController.updateTimeEntry` | 3 |
| Q2 | Editing a project time entry writes no audit row. | `projectsController.updateTimeEntry` | 3 |
| Q3 | Editing a project time entry accepts a future `entryDate`; creating one rejects it. | `projectsController.updateTimeEntry` | 3 |
| Q4 | Ticket time: `userId` = who it's for, `loggedById` = logger. Project time: `userId` = logger, `loggedForUserId` = who it's for. So "only your own entry" means the target on tickets and the logger on projects. | `ticketsController.removeTime`, `projectsController` time handlers | 3 |
| Q5 | Timer-created ticket time has no `startTime`, `endTime` or `loggedById`. `loggedAt` is the timer's start, and `entryDate` is the UTC date the timer stopped. | `timerController.logTimer` | 3 |
| Q6 | Logging for others, and editing or deleting others' time, check the legacy `User.role === 'admin'`, not a granular permission. | `canLogForOthers`, time handlers | 3 |
| Q7 | A task or subtask PATCH whose `statusId` is the current id as a string counts as a status change: `completedAt` is re-stamped. | `projectsController.updateTask` / `updateSubtask` | 3 |
| Q8 | Ticket task create/update writes no activity and no audit row. | `ticketsController.createTask` / `updateTask` | 3 |
| Q9 | Time-billing filters and dates ticket time by `loggedAt` and project time by `createdAt`, never by `entryDate`. The custom report shows `entryDate` but filters the same way. | `reportsController.buildTimeBillingReport`, `customReportEngine.loadTimeEntryRecords` | 3 |
| Q10 | Team performance "time logged" counts ticket time only. | `reportsController.buildTeamPerformanceReport` | 3 |
| Q11 | Project total cost excludes labour in project stats and the projects report, but includes it in the custom report's projects source. | `buildProjectStats`, `buildProjectsReport`, `loadProjectRecords` | 3 |
| Q12 | Dashboard hours count ticket time only, by `loggedAt`, Monday–Friday only, bucketed by UTC date. | `dashboardController.hoursForUser` | 3 |
| Q13 | Deleting a project leaves its tasks, time entries and other child rows behind (no foreign keys). | `projectsController.remove` | 3 |
| Q14 | "Today" for `entryDate` (default and future limit) is the UTC date. | ticket/project time create | 3 |
| Q15 | Re-sending a closed `statusId` on a task logs another `task_closed`. | `projectsController.updateTask` | 3 |
| Q16 | The `escalate_to_user` workflow action always fails: it sets priority `urgent`, which tickets don't have. | `workflowEngine.executeAction` | 3 |
| Q17 | Any project editor can delete anyone's project file. `canModerateProjectContent` exists but is unused. | `projectsController.removeFile` | 3 |
| Q18 | Relation lists show the title, status and priority of linked tickets the viewer can't open. | `ticketsController.listRelations` | 3 |
| Q19 | Project task lists show a linked ticket's title to viewers who can't open it. | `projectsController.listTasks` | 3 |
| Q20 | Renumbering a task leaves its subtasks' codes on the old task number. | `projectsController.renumberTask` | 3 |
| Q21 | A lead of any team can log time for any user, teammate or not. | `canLogForOthers` | 3 |
| Q22 | Editing project time accepts a `taskId` from another project. | `projectsController.updateTimeEntry` | 3 |
| Q23 | Watchers, custom field values, project tasks/subtasks, expenses, materials, members and files are changed without audit rows. | those handlers | 3 |
| Q24 | Two tickets can be linked twice, once in each direction. | `ticketsController.createRelation` | 3 |
| Q25 | Ticket and project `status` accept any string, even one no status row has. | ticket/project create and update | 3 |
| Q26 | Edit access follows the **view** tier: a user with `tickets.edit_own`/`projects.edit_own` can edit anything they can view. | `canAccessTicket` / `canAccessProject` used for writes | 3 |
| Q27 | A `dueTime` sent alongside a cleared `dueDate` is kept. | `ticketsController.update` | 3 |
| Q28 | Ticket and project delete don't re-check scope. | `ticketsController.remove`, `projectsController.remove` | 2 |
| Q29 | Custom field values aren't checked against the field's type or options. | `syncCustomFieldValues` | 3 |
| Q30 | Changing a project's lead doesn't update its members. | `projectsController.update` | 3 |
| Q31 | A task created already closed has no `completedAt`. | `projectsController.createTask` | 3 |
| Q32 | A partial reorder leaves duplicate positions. | `projectsController.reorderTasks` | 3 |
| Q33 | Expense and material updates skip the create-time validation. | `updateExpense` / `updateMaterial` | 3 |
| Q34 | A timer on a deleted ticket can't be stopped or replaced (400 `FK_CONSTRAINT`), only cancelled. | `timerController` | 3 |
| Q35 | Creating a ticket already closed bypasses `timeTracking.requireBeforeClose`. | `ticketsController.create` | 3 |
| Q36 | A report `endDate` becomes the end of the *previous* local day west of UTC. | `reportsController.parseDateRange` | 3 |

- [ ] **Step 3: Update `docs/ROADMAP.md`**

Change sub-project 1's row to status **Shipped**, with Plan linking `[plan](superpowers/plans/2026-10-04-test-baseline.md)`.

- [ ] **Step 4: Record the user-visible changes in `UPGRADING.md`**

Add this directly above `## v0.3.0`. It is folded into `v0.4.0` when Phase 1 is tagged:

```markdown
## Unreleased

Nothing here needs action before upgrading.

### Security fixes

- Deleting a project subtask now checks that its task belongs to the project
  in the URL. Before, a user who could edit one project could delete subtasks
  in any other.
- Starting a timer now needs access to the ticket, as every other ticket
  action does.
- Linking tickets (the Link ticket dialog, and parent/child/related tickets on
  the new-ticket form) and linking a project task to a ticket now only reach
  tickets you can see. A ticket you can't see gets the same "not found" answer
  as one that doesn't exist. **Changed response:** a missing linked ticket on
  ticket create now returns `400 VALIDATION_ERROR` instead of
  `400 FK_CONSTRAINT`, and on project tasks it is now refused instead of
  stored.
- Project file uploads now get the same content check as ticket attachments,
  so an executable renamed to a document extension is refused.
```

- [ ] **Step 5: Commit and push**

```bash
git add docs/superpowers/specs/2026-10-03-test-baseline-design.md docs/ROADMAP.md UPGRADING.md
git commit -m "docs: test baseline shipped; quirk table, S5 and corrections written back"
git push origin dev
```

Confirm with the user before pushing if they haven't already said to push when done.
