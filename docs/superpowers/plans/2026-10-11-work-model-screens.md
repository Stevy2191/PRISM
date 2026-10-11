# One Work Model — The Screens (plan 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the ticket and project pages on shared task, time and timer components; make Settings edit the four status lists and the work types; and show the plan-3b access rules in the screens.

**Architecture:**
- Shared components in `frontend/src/components/work/` talk to the unified task and time API on either side, through one path helper.
- One server-side timer, which gains pause and resume, replaces the ticket page's browser-only timer. It shows in the top bar.
- The ticket and project responses say whether the viewer may edit and moderate that record. Screens hide what the server would refuse.

**Tech Stack:**
- Backend: Express 4, Sequelize 6, MariaDB 11, Jest 30.
- Frontend: React 18, Vite, Tailwind, `@tabler/icons-react`.
- Browser tests: headless Chromium smoke tests through `playwright-core`.
- No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-05-one-work-model-design.md`](../specs/2026-10-05-one-work-model-design.md) — *Code structure → Frontend*, *Plans → 3c*, *Testing → Smoke*, *Done when*.

**User decisions this plan carries:**
- **2026-10-11, one server timer:** one server-side timer for tickets, projects and tasks, replacing the ticket page's browser-only timer. It gains pause and resume. Automatic mode, the minimum-time warning, the prompt before logging and "keep timing" stay. Old browser-only timers are ignored.
- **2026-10-06, own time:** logging your own time needs `time.log` and view access.
- **2026-10-11, moderation:** moderating others' content needs `tickets.moderate` / `projects.moderate`.
- **2026-10-11, time attribution:** the ticket's total is all of its time, and each subtask shows the time worked on it, so you know how long it took.
  - Subtasks get their own timer and Log time.
  - Starting a timer on a subtask while one runs on the same ticket (or another task) logs the time so far where it was worked, then starts fresh on the subtask. The server already does this.
  - That time is never discarded or moved, so the totals stay exact.
  - The Time Entries tab shows a **Time by task** breakdown.

## Global Constraints

- **Shared components:** `components/work/` holds `TaskList`, `TimeLog` with one `TimeEntryForm`, and `TimerButton`, which can target a task. The ticket and project pages both use them.
- **Settings:**
  - Statuses gets four tabs: Tickets, Ticket tasks, Projects, Project tasks.
  - There is a new Work types page.
  - The role editor lists the new permissions: the `time` category, plus `tickets.moderate` / `projects.moderate`, which appear under their categories.
- **Size:** no file over about 800 lines, most under 400. This plan must leave `TicketDetail.jsx` (769 lines today) and `ProjectDetail.jsx` smaller than it found them.
- **Restricted tickets:** a linked ticket the viewer can't open reads **"Restricted ticket"** with its number, and no title, status or priority.
- **Timer:**
  - There is one timer per user, on the server.
  - Pause/resume live on the server (`ActiveTimers.accumulatedSeconds`, `runningSince`). Never reintroduce browser-only timer state.
  - Stopping logs the elapsed time ending now, so `durationSeconds = endTime − startTime`.
- **Time attribution:**
  - a time entry belongs to its ticket or project, and optionally to one task or subtask;
  - totals are sums over the ledger: ticket or project = all entries, task = its own plus its subtasks', subtask = its own;
  - nothing is moved between tasks after the fact.
- **The server decides; the screens follow.** A control is hidden or disabled when `access` says no. Never rely on hiding for security.
- **Tests:**
  - backend integration: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest <file>`;
  - browser smoke: `cd backend && npm run test:smoke -- <files>` (it builds the frontend first). Never run it alongside `npm test`.
- **Commits:** stage explicit paths only, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only when the user says so.

## Review Focus

1. **A timer left paused for days.** Elapsed time must count only running segments. Stopping a paused timer logs what it shows, not the wall-clock gap. *(Task 2 test: pause, advance the clock, stop, and check the duration.)*
2. **A time entry with no start or end** (plain duration, or migrated legacy time) opened for editing. The form must show its duration and save without inventing times. *(Task 4 smoke: editing a duration-only entry.)*
3. **A Department Staff user on an unassigned department ticket.** They see no edit controls for the ticket, its tasks or its links, but can comment and log their own time. *(Task 6 smoke.)*
4. **Deleting a task status that tasks use, from Settings.** The server's refusal must be shown, and the list left unchanged. *(Task 7 smoke.)*
5. **Switching the timer from a ticket to one of its subtasks.**
   - The ticket-level time so far is logged on the ticket and stays out of the subtask's total.
   - The header keeps showing the running timer, now on the subtask, with Pause and Stop.
   *(Task 6 smoke test.)*
6. **The timer running on another ticket when you open this one.** The page says so, and starting here logs the other one. Automatic mode must not silently replace it. *(Task 6 smoke.)*

---

## File map

**Backend**
- **Create:**
  - `backend/migrations/20260101000053-timer-pause.js`
  - `backend/test/integration/work.screens.api.test.js`
  - `backend/test/integration/timer.pause.test.js`
- **Modify:**
  - `backend/src/models/ActiveTimer.js` and `backend/src/controllers/timerController.js`, plus `routes/timer.js`;
  - `backend/src/controllers/tickets/core.js` and `controllers/projects/core.js` (the `access` flags);
  - `backend/src/services/tasks/index.js` (`loggedSeconds`).

**Frontend: create**
- `components/work/`: `workPaths.js`, `TimePicker.jsx`, `TimeEntryForm.jsx`, `TimeLog.jsx`, `TaskList.jsx`, `TaskDetails.jsx`, `TimerButton.jsx`, `TimerIndicator.jsx`, `useAutoTimer.js`, `EditableCode.jsx`, `Avatar.jsx`.
- `pages/settings/WorkTypes.jsx`.

**Frontend: modify**
- `context/TimerContext.jsx`;
- `components/TopNav.jsx` and `components/SidebarCompact.jsx` (the timer indicator);
- `pages/tickets/TicketDetail.jsx` and `pages/projects/ProjectDetail.jsx`;
- `pages/tickets/detail/{Sidebar,AttachmentsTab,RelationshipsTab}.jsx`;
- `pages/projects/detail/{FilesTab,PeopleTab,ExpensesTab,MaterialsTab}.jsx` (the edit gates);
- `pages/settings/Statuses.jsx`, `pages/RoleEditor.jsx`, `pages/SettingsHub.jsx` and `App.jsx`.

**Frontend: delete once nothing imports them**
- `pages/tickets/detail/{TasksTab,TimeEntriesTab,TimerWidget,TimeFields}.jsx`
- `pages/projects/detail/{TasksTab,TaskDetailModal,TimeTab,TimeFields}.jsx`

**Smoke tests**
- **Create:** `backend/test/smoke/work.timer.smoke.js`, `work.time.smoke.js`, `work.tasks.smoke.js`, `work.access.smoke.js`, `work.settings.smoke.js`.
- **Modify:** `work.ledger.smoke.js` and `work.tickets.smoke.js` / `work.projects.smoke.js`, for the replaced controls.

**Docs:** `UPGRADING.md`, `docs/ROADMAP.md`, the spec.

---

### Task 1: The API tells the screens what the viewer may do, and each task's time

**Files:**
- Modify: `backend/src/controllers/tickets/core.js`, `backend/src/controllers/tickets/shared.js`, `backend/src/controllers/projects/core.js`, `backend/src/services/tasks/index.js`
- Create test: `backend/test/integration/work.screens.api.test.js`

**Interfaces:**
- **Produces:**
  - single-ticket responses (GET, POST, PATCH `/tickets/:id`) carry `access: { edit: boolean, moderate: boolean, delete: boolean }`;
  - single-project responses (GET, PATCH `/projects/:id`) carry the same;
  - every task and subtask object from the task API carries `loggedSeconds: number`. On a task, that's its own time plus its subtasks'.

- [ ] **Step 1: Failing test**

`backend/test/integration/work.screens.api.test.js`:

```js
const { resetData, closeDb } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeManager, makeTicket, makeProject, makeTask,
} = require('./fixtures');

// Plan 3c: what the screens need from the API — whether the viewer may edit,
// moderate and delete a ticket or project, and the time logged per task.

let w;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('a ticket says what the viewer may do with it', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  const tech = await makeTech('tech', w.deptA.id);
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
  const access = async (u) => expectOk(await u.agent.get(`${API}/tickets/${t.id}`)).ticket.access;
  expect(await access(staff)).toEqual({ edit: false, moderate: false, delete: false });
  expect(await access(tech)).toEqual({ edit: true, moderate: false, delete: false });
  expect(await access(w.admin)).toEqual({ edit: true, moderate: true, delete: true });
  const patched = expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ priority: 'low' })).ticket;
  expect(patched.access).toEqual({ edit: true, moderate: true, delete: true });
  const created = expectOk(await tech.agent.post(`${API}/tickets`).send({ title: 'New', contactId: w.contact.id }), 201).ticket;
  expect(created.access.edit).toBe(true);
});

it('a project says what the viewer may do with it', async () => {
  const staff = await makeStaff('staff', w.deptA.id);
  const mgr = await makeManager('mgr', w.deptA.id);
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  const access = async (u) => expectOk(await u.agent.get(`${API}/projects/${p.id}`)).project.access;
  expect(await access(staff)).toEqual({ edit: false, moderate: false, delete: false });
  expect(await access(mgr)).toEqual({ edit: true, moderate: true, delete: false });
  expect(expectOk(await w.admin.agent.patch(`${API}/projects/${p.id}`).send({ name: 'Q' })).project.access)
    .toEqual({ edit: true, moderate: true, delete: true });
});

it('tasks carry the time logged on them, a task including its subtasks', async () => {
  const p = await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id });
  const task = await makeTask(w.admin.agent, p.id, { title: 'Parent' });
  const sub = expectOk(await w.admin.agent.post(`${API}/projects/${p.id}/tasks`).send({ title: 'Child', parentTaskId: task.id }), 201).task;
  const log = (body) => w.admin.agent.post(`${API}/projects/${p.id}/time-entries`).send({ durationMinutes: 30, ...body });
  expectOk(await log({ taskId: task.id }), 201);
  expectOk(await log({ taskId: sub.id }), 201);
  expectOk(await log({}), 201);
  const [listed] = expectOk(await w.admin.agent.get(`${API}/projects/${p.id}/tasks`)).tasks;
  expect([listed.loggedSeconds, listed.subtasks[0].loggedSeconds]).toEqual([3600, 1800]);
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  const tt = expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'x' }), 201).task;
  expect(tt.loggedSeconds).toBe(0);
});
```

- [ ] **Step 2: Run it (fails: `access` and `loggedSeconds` are undefined)**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/work.screens.api.test.js`

- [ ] **Step 3: Access flags**

In `backend/src/controllers/tickets/shared.js`, next to `shownTicketFor`:

```js
// What the viewer may do with this ticket, for the screens to follow (the
// server re-checks every request).
async function ticketAccessFor(viewer, ticket) {
  const edit = await canEditTicket(viewer, ticket);
  return {
    edit,
    moderate: await canModerateTicketContent(viewer, ticket),
    delete: edit && (await hasPermission(viewer.id, 'tickets.delete')),
  };
}
```

- Import `canModerateTicketContent` and `hasPermission`, and export `ticketAccessFor`.
- In `tickets/core.js`, every single-ticket response (`create`, `get`, `update`) becomes `{ ticket: { ...(await shownTicketFor(req.user, x)), access: await ticketAccessFor(req.user, x) } }`. Lists don't carry it: a per-row cost the list doesn't need.

In `projects/shared.js`:

```js
async function projectAccessFor(viewer, project) {
  const edit = await canEditProject(viewer, project);
  return {
    edit,
    moderate: await canModerateProjectContent(viewer, project),
    delete: edit && (await hasPermission(viewer.id, 'projects.delete')),
  };
}
```

- Import `canModerateProjectContent`, and export `projectAccessFor`.
- In `projects/core.js`, `get` and `update` respond with `{ project: { ...detail, access: await projectAccessFor(req.user, project) } }`. Here `detail` is the existing `getProjectWithDetail(project.id)` result as a plain object (call `.toJSON?.()` if it is an instance).

- [ ] **Step 4: Time per task**

In `backend/src/services/tasks/index.js`, beside `annotate`:

```js
// Seconds logged per task in a parent, a task counting its subtasks' time.
async function loggedSecondsByTask(parent) {
  const rows = await TimeEntry.findAll({
    where: { ...parent.where, taskId: { [Op.ne]: null } },
    attributes: ['taskId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'seconds']],
    group: ['taskId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.taskId, Number(r.seconds) || 0]));
}
```

`annotate(task, behavior, viewer, logged)` sets the following, and each subtask in `json.subtasks` gets `loggedSeconds = logged.get(sub.id) || 0`:

```js
json.loggedSeconds = (logged.get(task.id) || 0)
  + (task.subtasks || []).reduce((n, s) => n + (logged.get(s.id) || 0), 0);
```

`listTasks` and `loadTask` compute `const logged = await loggedSecondsByTask(parent)` once and pass it. `loadTask` loads a subtask without `subtasks`; its own time is `logged.get(id)`.

- [ ] **Step 5: Run it (pass), then the task, ticket and project suites**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/work.screens.api.test.js test/integration/tickets.core.test.js test/integration/projects.core.test.js test/integration/tickets.tasks.test.js test/integration/projects.tasks.test.js`

Expected: PASS. If a test compares a whole ticket, project or task object with `toEqual`, add `access` / `loggedSeconds` to it, and record a ruling.

- [ ] **Step 6: Commit**

```bash
git add -A -- backend/src backend/test/integration
git commit -m "feat(api): records say what the viewer may do; tasks carry their logged time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The server timer pauses and resumes

**Files:**
- Create: `backend/migrations/20260101000053-timer-pause.js`, `backend/test/integration/timer.pause.test.js`
- Modify: `backend/src/models/ActiveTimer.js`, `backend/src/controllers/timerController.js`, `backend/src/routes/timer.js`

**Interfaces:**
- **Produces:**
  - the timer shape `{ type, id, taskId, label, startedAt, state: 'running' | 'paused', elapsedSeconds }`, where `elapsedSeconds` is computed by the server at response time;
  - `POST /timer/pause` and `POST /timer/resume` → `{ timer }`;
  - `POST /timer/stop { note?, discard? }`: with `discard: true` it cancels without logging (the automatic mode's `sendBeacon` can only POST).

- [ ] **Step 1: Failing test**

`backend/test/integration/timer.pause.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// The server timer pauses and resumes (user decision 2026-10-11): elapsed
// time counts running stretches only, and stopping logs that much, ending now.

let w;
let tech;
let ticket;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterEach(unfreezeClock);
afterAll(closeDb);

const post = async (path, body = {}) => expectOk(await tech.agent.post(`${API}/timer/${path}`).send(body), path === 'start' ? 201 : 200);
const current = async () => expectOk(await tech.agent.get(`${API}/timer`)).timer;

it('counts only running stretches, and stopping a paused timer logs what it showed', async () => {
  freezeClock('2026-03-10T15:00:00Z');
  await post('start', { type: 'ticket', id: ticket.id });
  advanceClock(10 * 60 * 1000);
  expect((await post('pause')).timer).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 600 }));
  advanceClock(3 * 60 * 60 * 1000); // three hours paused
  expect(await current()).toEqual(expect.objectContaining({ state: 'paused', elapsedSeconds: 600 }));
  await post('resume');
  advanceClock(5 * 60 * 1000);
  expect((await current()).elapsedSeconds).toBe(900);
  const { entry } = await post('stop');
  expect(entry.durationSeconds).toBe(900);
  expect(new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()).toBe(900 * 1000);
});

it('pause and resume are idempotent; with no timer they say so', async () => {
  await post('start', { type: 'ticket', id: ticket.id });
  await post('pause');
  expect((await post('pause')).timer.state).toBe('paused');
  await post('resume');
  expect((await post('resume')).timer.state).toBe('running');
  await tech.agent.delete(`${API}/timer`);
  expect((await tech.agent.post(`${API}/timer/pause`)).body).toEqual({ error: true, message: 'No timer is running', code: 'NOT_FOUND' });
});

it('starting elsewhere while paused logs the paused time', async () => {
  freezeClock('2026-03-10T15:00:00Z');
  await post('start', { type: 'ticket', id: ticket.id });
  advanceClock(20 * 60 * 1000);
  await post('pause');
  advanceClock(60 * 60 * 1000);
  const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id, departmentId: w.deptA.id });
  const { logged } = await post('start', { type: 'ticket', id: other.id });
  expect(logged.durationSeconds).toBe(1200);
});

it('stop with discard cancels without logging', async () => {
  await post('start', { type: 'ticket', id: ticket.id });
  expect(await post('stop', { discard: true })).toEqual({ timer: null, entry: null, discarded: true });
  expect(await models.TimeEntry.count()).toBe(0);
  expect(await current()).toBeNull();
});
```

- [ ] **Step 2: Run it (fails: 404 on /timer/pause, no `state`)**

- [ ] **Step 3: The migration**

`backend/migrations/20260101000053-timer-pause.js`:

```js
'use strict';

// The server timer pauses and resumes (plan 3c; user decision 2026-10-11):
// accumulatedSeconds holds finished running stretches, runningSince the start
// of the current one (null while paused). A running timer from before this
// is one stretch that began at startedAt.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('ActiveTimers', 'accumulatedSeconds', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('ActiveTimers', 'runningSince', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.sequelize.query('UPDATE ActiveTimers SET runningSince = startedAt');
  },
  down: async (queryInterface) => {
    // A paused timer can't be expressed without these columns: fold it back
    // into a running one that started its elapsed time ago.
    await queryInterface.sequelize.query(
      'UPDATE ActiveTimers SET startedAt = DATE_SUB(COALESCE(runningSince, NOW()), INTERVAL accumulatedSeconds SECOND)'
    );
    await queryInterface.removeColumn('ActiveTimers', 'runningSince');
    await queryInterface.removeColumn('ActiveTimers', 'accumulatedSeconds');
  },
};
```

In `ActiveTimer.js`, add `accumulatedSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }` and `runningSince: { type: DataTypes.DATE, allowNull: true }`.

- [ ] **Step 4: The controller**

In `timerController.js`:

```js
// Seconds the timer has run: finished stretches plus the current one.
function elapsedOf(t, now = Date.now()) {
  const running = t.runningSince ? Math.max(0, Math.floor((now - new Date(t.runningSince).getTime()) / 1000)) : 0;
  return (t.accumulatedSeconds || 0) + running;
}

function shape(t) {
  return t ? {
    type: t.entityType, id: t.entityId, taskId: t.taskId ?? null, label: t.label, startedAt: t.startedAt,
    state: t.runningSince ? 'running' : 'paused', elapsedSeconds: elapsedOf(t),
  } : null;
}
```

`logTimer` logs `startedAt: new Date(endedAt - elapsedOf(timer) * 1000), endedAt` with `const endedAt = new Date()`, so a paused timer logs exactly its elapsed time.

`start` creates with `runningSince: new Date()`. When the same target is re-sent and its timer is paused, the start resumes it instead of returning it unchanged.

```js
const mine = (req) => ActiveTimer.findOne({ where: { userId: req.user.id } });
const noTimer = () => new ApiError(404, 'No timer is running', 'NOT_FOUND');

// POST /timer/pause
const pause = asyncHandler(async (req, res) => {
  const t = await mine(req);
  if (!t) throw noTimer();
  if (t.runningSince) await t.update({ accumulatedSeconds: elapsedOf(t), runningSince: null });
  res.json({ timer: shape(t) });
});

// POST /timer/resume
const resume = asyncHandler(async (req, res) => {
  const t = await mine(req);
  if (!t) throw noTimer();
  if (!t.runningSince) await t.update({ runningSince: new Date() });
  res.json({ timer: shape(t) });
});
```

In `stop`, before logging:

```js
  if (req.body?.discard === true) {
    await existing.destroy();
    return res.json({ timer: null, entry: null, discarded: true });
  }
```

Export `pause` and `resume`, and add to `routes/timer.js`: `router.post('/pause', ctrl.pause); router.post('/resume', ctrl.resume);`.

- [ ] **Step 5: Migrate, then run this and the timer suite**

Run: `cd backend && (set -a; . ./.env.test; set +a; npm run test:migrate) && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/timer.pause.test.js test/integration/time.timer.test.js test/integration/workmodel.fixpass.test.js`

Expected: PASS. `time.timer.test.js` compares timer shapes in places; add `state` / `elapsedSeconds` where it does, and record a ruling.

- [ ] **Step 6: Commit**

```bash
git add -A -- backend/migrations/20260101000053-timer-pause.js backend/src/models/ActiveTimer.js backend/src/controllers/timerController.js backend/src/routes/timer.js backend/test/integration
git commit -m "feat(timer): the server timer pauses and resumes; stop can discard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One timer in the screens — TimerContext, TimerButton and the top-bar indicator

**Files:**
- Create: `frontend/src/components/work/workPaths.js`, `TimerButton.jsx`, `TimerIndicator.jsx`; `backend/test/smoke/work.timer.smoke.js`
- Modify: `frontend/src/context/TimerContext.jsx`, `components/TopNav.jsx`, `components/SidebarCompact.jsx`, `pages/projects/ProjectDetail.jsx` (a TimerButton in the header)

**Interfaces:**
- **Produces:**
  - `useTimer()` → `{ activeTimer, elapsedSeconds, logVersion, start(type, id, { taskId, label }), pause(), resume(), stop({ note, discard }), cancel(), isRunning(type, id, taskId?), refresh }`. `activeTimer` is the server shape from Task 2, and `elapsedSeconds` ticks locally from the server's value.
  - `workPaths(kind, parentId)` → `{ tasks, task(id), reorder, code(id), time, entry(id) }` (URL strings).
  - `<TimerButton kind parentId taskId? label onStopRequest? anyTask? />`. With `anyTask`, used by a page header, the button treats a timer on any task of this ticket or project as its own: it shows "on <task>" with working Pause/Stop instead of Start.
  - `<TimerIndicator />`.

- [ ] **Step 1: Failing smoke test**

`backend/test/smoke/work.timer.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeProject,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: one server timer. It starts from a project page, pauses and
// resumes, and shows in the top bar on any page.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

let smoke;
let w;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  project = await makeProject(w.admin.agent, { name: 'Timer project', ownerDepartmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('starts, pauses, resumes and shows in the top bar', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await button(page, 'Start timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/start'));
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ type: 'project', id: project.id, state: 'running' }));
  await button(page, 'Pause timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/pause'));
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer.state).toBe('paused');
  await button(page, 'Resume timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/resume'));
  await page.goto('/tickets');
  await page.getByRole('link', { name: /Timer project/ }).filter({ visible: true }).first().waitFor();
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});
```

- [ ] **Step 2: Run it (fails: no "Start timer" button on the project page)**

Run: `cd backend && npm run test:smoke -- work.timer`

- [ ] **Step 3: The path helper**

`frontend/src/components/work/workPaths.js`:

```js
// URLs of the unified task and time API on either side. kind: 'ticket' | 'project'.
export function workPaths(kind, parentId) {
  const base = kind === 'ticket' ? `/tickets/${parentId}` : `/projects/${parentId}`;
  const time = kind === 'ticket' ? `${base}/time` : `${base}/time-entries`;
  return {
    tasks: `${base}/tasks`,
    task: (id) => `${base}/tasks/${id}`,
    reorder: `${base}/tasks/reorder`,
    code: (id) => `${base}/tasks/${id}/code`,
    time,
    entry: (id) => `${time}/${id}`,
  };
}
```

- [ ] **Step 4: TimerContext on the server timer with pause**

In `frontend/src/context/TimerContext.jsx`:
- `activeTimer` holds the server shape.
- Store `syncedAt = Date.now()` whenever a server response sets it.
- The ticking `elapsedSeconds` is `activeTimer.elapsedSeconds + (activeTimer.state === 'running' ? Math.floor((now - syncedAt) / 1000) : 0)`, and the tick interval runs only while the state is `running`.
- The new actions:

```js
  const apply = (timer) => { setActiveTimer(timer); setSyncedAt(Date.now()); };

  const start = useCallback(async (type, id, { taskId = null, label = null } = {}) => {
    try {
      const { data } = await api.post('/timer/start', { type, id, taskId, label });
      apply(data.timer);
      if (data.logged) setLogVersion((v) => v + 1); // a previous timer was logged
      return data;
    } catch (err) {
      alert(errMessage(err, 'Failed to start timer'));
      return null;
    }
  }, []);

  const pause = useCallback(async () => {
    const { data } = await api.post('/timer/pause');
    apply(data.timer);
    return data.timer; // the paused timer, with its frozen elapsedSeconds
  }, []);

  const resume = useCallback(async () => {
    const { data } = await api.post('/timer/resume');
    apply(data.timer);
  }, []);

  const stop = useCallback(async ({ note, discard } = {}) => {
    const { data } = await api.post('/timer/stop', { ...(note ? { note } : {}), ...(discard ? { discard: true } : {}) });
    apply(null);
    if (data.entry) setLogVersion((v) => v + 1);
    return data;
  }, []);

  const cancel = useCallback(async () => {
    try { await api.delete('/timer'); } catch { /* ignore */ }
    apply(null);
  }, []);

  const isRunning = (type, id, taskId) => !!activeTimer && activeTimer.type === type && Number(activeTimer.id) === Number(id)
    && (taskId === undefined || (activeTimer.taskId ?? null) === (taskId ?? null));
```

- `refresh` also calls `apply`.
- The provider also exposes `bumpLogVersion = () => setLogVersion((v) => v + 1)`, for pages that log time themselves.
- Keep `formatElapsed` and `formatHMS`.
- `TimerProvider` requires `user` with `time.log`: replace the `isStaff` checks with `hasPermission('time.log')` from `useAuth`. The `/timer` routes need that permission.

- [ ] **Step 5: TimerButton**

`frontend/src/components/work/TimerButton.jsx`:

```jsx
// The timer control for a ticket, a project or one of their tasks. One server
// timer per user: starting here logs a timer running elsewhere first. Stop
// hands the stopped timer to onStopRequest (the page's Log time form); with
// no handler it logs straight away.
import {
  IconPlayerPlayFilled, IconPlayerPauseFilled, IconPlayerStopFilled,
} from '@tabler/icons-react';
import { useTimer, formatHMS } from '../../context/TimerContext';

export default function TimerButton({ kind, parentId, taskId = null, label, onStopRequest, compact = false, anyTask = false }) {
  const timer = useTimer();
  // A page header (anyTask) owns a timer on any of its tasks too, so it never
  // offers Start while one of them is running.
  const here = anyTask ? timer.isRunning(kind, parentId) : timer.isRunning(kind, parentId, taskId);
  const onTask = here && anyTask && timer.activeTimer.taskId;
  const state = here ? timer.activeTimer.state : 'idle';
  const color = state === 'running' ? 'var(--color-timer)' : state === 'paused' ? 'var(--color-warning)' : 'var(--color-text-muted)';
  const elsewhere = !here && timer.activeTimer;

  const stop = async () => {
    // Freeze it while the form is open; read the paused timer the server
    // returns (the context's value in this closure is from before the pause).
    const paused = state === 'running' ? await timer.pause() : timer.activeTimer;
    if (onStopRequest) onStopRequest({ ...paused, resumeAfter: state === 'running' });
    else await timer.stop();
  };

  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
      title={elsewhere ? `A timer is running on ${timer.activeTimer.label || 'another item'}; starting here logs it first` : undefined}
    >
      {state === 'idle' && (
        <button type="button" aria-label="Start timer" title="Start timer" style={{ color }}
          onClick={() => timer.start(kind, parentId, { taskId, label })}>
          <IconPlayerPlayFilled size={compact ? 13 : 15} />
        </button>
      )}
      {state === 'running' && (
        <button type="button" aria-label="Pause timer" title="Pause timer" style={{ color }} onClick={timer.pause}>
          <IconPlayerPauseFilled size={compact ? 13 : 15} />
        </button>
      )}
      {state === 'paused' && (
        <button type="button" aria-label="Resume timer" title="Resume timer" style={{ color }} onClick={timer.resume}>
          <IconPlayerPlayFilled size={compact ? 13 : 15} />
        </button>
      )}
      {!compact && <span className="font-mono text-sm font-semibold" style={{ color }}>{formatHMS(here ? timer.elapsedSeconds : 0)}</span>}
      {compact && here && <span className="font-mono text-xs" style={{ color }}>{formatHMS(timer.elapsedSeconds)}</span>}
      {onTask && <span className="max-w-[12rem] truncate text-xs" style={{ color }}>on {timer.activeTimer.label?.split(' · ').pop() || 'a task'}</span>}
      {state !== 'idle' && (
        <button type="button" aria-label="Stop timer" title="Stop and log time" style={{ color }} onClick={stop}>
          <IconPlayerStopFilled size={compact ? 13 : 15} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: TimerIndicator in the top bar**

`frontend/src/components/work/TimerIndicator.jsx`:

```jsx
// The running timer, on every page: what it's on and how long, linking there.
import { Link } from 'react-router-dom';
import { IconClockPlay, IconPlayerPauseFilled } from '@tabler/icons-react';
import { useTimer, formatHMS } from '../../context/TimerContext';

export default function TimerIndicator() {
  const { activeTimer, elapsedSeconds } = useTimer();
  if (!activeTimer) return null;
  const to = activeTimer.type === 'ticket' ? `/tickets/${activeTimer.id}` : `/projects/${activeTimer.id}`;
  const paused = activeTimer.state === 'paused';
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-semibold"
      style={{ color: paused ? 'var(--color-warning)' : 'var(--color-timer)', backgroundColor: 'var(--color-hover)' }}
      title={paused ? 'Timer paused' : 'Timer running'}
    >
      {paused ? <IconPlayerPauseFilled size={13} /> : <IconClockPlay size={13} />}
      <span className="max-w-[10rem] truncate font-sans">{activeTimer.label || (activeTimer.type === 'ticket' ? 'Ticket' : 'Project')}</span>
      {formatHMS(elapsedSeconds)}
    </Link>
  );
}
```

- Render `<TimerIndicator />` in `TopNav.jsx` just before `<NotificationsDropdown />`, and in `SidebarCompact.jsx` in its header actions.
- Check that `IconClockPlay` exists in the installed `@tabler/icons-react` (`grep -l IconClockPlay node_modules/@tabler/icons-react/dist/esm/icons/*.mjs`). If not, use `IconClock`, and record a ruling.

- [ ] **Step 7: The project header gets the timer**

In `ProjectDetail.jsx`, inside the header's button group (the `isStaff &&` block), when `canLogTime`:

```jsx
<TimerButton kind="project" parentId={project.id} label={`${project.projectCode} ${project.name}`} onStopRequest={setStoppedTimer} anyTask />
```

- Add `const [stoppedTimer, setStoppedTimer] = useState(null);`.
- Until Task 4 adds the form, `onStopRequest` is wired to a temporary call that logs straight away: `(t) => timer.stop()` via `useTimer()`.
- Task 4 replaces it with the form. Note it in the ledger so it isn't forgotten.

- [ ] **Step 8: Build and run the smoke test (pass)**

Run: `cd backend && npm run test:smoke -- work.timer`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A -- frontend/src/components/work frontend/src/context/TimerContext.jsx frontend/src/components/TopNav.jsx frontend/src/components/SidebarCompact.jsx frontend/src/pages/projects/ProjectDetail.jsx backend/test/smoke/work.timer.smoke.js
git commit -m "feat(screens): one server timer with pause, on projects and in the top bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One time log and one Log time form on both pages

**Files:**
- Create: `frontend/src/components/work/TimePicker.jsx`, `TimeEntryForm.jsx`, `TimeLog.jsx`; `backend/test/smoke/work.time.smoke.js`
- Modify: `pages/tickets/TicketDetail.jsx`, `pages/projects/ProjectDetail.jsx`, `backend/test/smoke/work.ledger.smoke.js`
- Delete: `pages/tickets/detail/TimeEntriesTab.jsx`, `pages/projects/detail/TimeTab.jsx`. Delete each `TimeFields.jsx` only once nothing imports it: the ticket TimerWidget still does until Task 6.

**Interfaces:**
- **Consumes:** `workPaths` and `useTimer` (Task 3); the time API's `{ entries, total, totalSeconds, totalLaborCost }`; entries carry `user`, `loggedBy`, `task {id,title,code}` and `workType {id,name}`.
- **Produces:**
  - `<TimeLog kind parentId tasks canLog canManageOthers currentUser assignableUsers reloadKey onChanged />`. It loads and pages its own entries, and shows a **Time by task** breakdown from `tasks[].loggedSeconds`:
    - general time, on no task;
    - each task with its total, its subtasks indented under it with theirs;
    - the grand total.
  - `<TimeEntryForm kind parentId tasks entry? timer? defaultTaskId? canManageOthers currentUser assignableUsers onSaved onClose onKeepTiming? />`:
    - with `entry` it edits;
    - with `timer` (a stopped timer from TimerButton) it pre-fills from it, and on save logs the entry and then discards the server timer;
    - "Keep timing" resumes the timer.

- [ ] **Step 1: Failing smoke test**

`backend/test/smoke/work.time.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeProject,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: one time log and one Log time form on tickets and projects — work
// type, billable, task, edit (including a duration-only entry) and delete.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();
const dialog = (page) => page.getByRole('dialog').filter({ visible: true }).last();

let smoke;
let w;
let ticket;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Time ticket', contactId: w.contact.id });
  project = await makeProject(w.admin.agent, { name: 'Time project', ownerDepartmentId: w.deptA.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 45, note: 'Plain duration' }), 201);
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('logs time on a ticket with a work type and not billable', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  await button(page, 'Log time').click();
  const d = dialog(page);
  await d.getByLabel('Work type').selectOption({ label: 'On-site' });
  await d.getByLabel('Billable').uncheck();
  await d.getByLabel('Note').fill('Swapped the toner');
  const saved = page.waitForResponse((r) => r.url().includes(`/tickets/${ticket.id}/time`) && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Save time entry' }).click();
  await saved;
  await shown(page, 'Swapped the toner').waitFor();
  const { entries } = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`));
  expect(entries.find((e) => e.note === 'Swapped the toner')).toEqual(expect.objectContaining({ billable: false, workType: expect.objectContaining({ name: 'On-site' }) }));
});

it('edits a duration-only entry without inventing times', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  await page.getByRole('row', { name: /Plain duration/ }).getByRole('button', { name: 'Edit' }).click();
  const d = dialog(page);
  expect(await d.getByLabel('Minutes').inputValue()).toBe('45');
  await d.getByLabel('Minutes').fill('50');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/time/'));
  await d.getByRole('button', { name: 'Save time entry' }).click();
  await saved;
  const entry = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`)).entries.find((e) => e.note === 'Plain duration');
  expect([entry.durationSeconds, entry.startTime]).toEqual([3000, null]);
});

it('logs and deletes time on a project the same way', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await tab(page, /^Time Entries/);
  await button(page, 'Log time').click();
  await dialog(page).getByLabel('Note').fill('Rack and stack');
  await dialog(page).getByRole('button', { name: 'Save time entry' }).click();
  await shown(page, 'Rack and stack').waitFor();
  page.once('dialog', (dlg) => dlg.accept());
  await page.getByRole('row', { name: /Rack and stack/ }).getByRole('button', { name: 'Delete' }).click();
  await shown(page, 'No time logged yet.').waitFor();
});
```

The shared `Modal` must carry `role="dialog"` for `dialog(page)` to work. Add `role="dialog" aria-modal="true"` to the inner panel of `components/Modal.jsx`; the new components use that `Modal`.

- [ ] **Step 2: Run it (fails: no "Log time" button on the ticket page, no Work type field)**

Run: `cd backend && npm run test:smoke -- work.time`

- [ ] **Step 3: TimePicker**

Move `TimePicker` (and its hour/minute helpers) out of `pages/tickets/detail/TimeFields.jsx` into `components/work/TimePicker.jsx` as the default export, unchanged:
- `minutesOfDayToParts`, `partsToMinutesOfDay`;
- the 12-hour, 5-minute selects.

Also export `roundToNearest5(date)` and `localDateTime(dateStr, minutesOfDay)`, the latter being the existing `buildLocalDateTime` from `pages/tickets/theme.js`.

- [ ] **Step 4: TimeEntryForm**

`frontend/src/components/work/TimeEntryForm.jsx`:

```jsx
// The one Log time form: new entries, edits, and a stopped timer. Times are
// a start/end on a date, or a plain duration (entries without times, such as
// older ones, stay that way when edited).
import { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';
import { useOrgToday } from '../../utils/orgDate';
import { useTimer, formatHMS } from '../../context/TimerContext';
import TimePicker, { roundToNearest5, localDateTime } from './TimePicker';
import { workPaths } from './workPaths';

const field = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };
const label = 'mb-1 block text-sm font-medium text-[var(--color-text-primary)]';
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

function initialState({ entry, timer, defaultTaskId, today, currentUser }) {
  if (entry) {
    const start = entry.startTime ? new Date(entry.startTime) : null;
    const end = entry.endTime ? new Date(entry.endTime) : null;
    return {
      mode: start && end ? 'span' : 'duration',
      entryDate: entry.entryDate,
      startMinutes: start ? minutesOfDay(start) : 9 * 60,
      endMinutes: end ? minutesOfDay(end) : 9 * 60 + Math.round(entry.durationSeconds / 60),
      minutes: Math.round(entry.durationSeconds / 60),
      taskId: entry.taskId || '',
      workTypeId: entry.workTypeId || '',
      billable: !!entry.billable,
      userId: entry.userId,
      note: entry.note || '',
    };
  }
  const end = new Date();
  const seconds = timer ? timer.elapsedSeconds : 30 * 60;
  const startMinutes = roundToNearest5(new Date(end.getTime() - seconds * 1000));
  let endMinutes = roundToNearest5(end);
  if (endMinutes <= startMinutes) endMinutes = startMinutes + 5;
  return {
    mode: 'span', entryDate: today, startMinutes, endMinutes, minutes: Math.max(1, Math.round(seconds / 60)),
    taskId: (timer && timer.taskId) || defaultTaskId || '', workTypeId: '', billable: true, userId: currentUser.id, note: '',
  };
}

export default function TimeEntryForm({
  kind, parentId, tasks = [], entry = null, timer = null, defaultTaskId = null,
  canManageOthers, currentUser, assignableUsers = [], onSaved, onClose,
}) {
  const today = useOrgToday();
  const timerCtx = useTimer();
  const paths = workPaths(kind, parentId);
  const [form, setForm] = useState(() => initialState({ entry, timer, defaultTaskId, today, currentUser }));
  const [workTypes, setWorkTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api.get('/work-types').then(({ data }) => {
      setWorkTypes(data.workTypes);
      // A new entry starts on the side's default type, billable as that type says.
      if (!entry) {
        const preferred = kind === 'ticket' ? 'Remote support' : 'Project work';
        const active = data.workTypes.filter((t) => t.isActive);
        const def = active.find((t) => t.name === preferred) || active[0];
        if (def) setForm((f) => ({ ...f, workTypeId: def.id, billable: def.billableDefault }));
      }
    }).catch(() => {});
  }, [entry, kind]);

  // Active types, plus the entry's own type even if it was since deactivated.
  const typeOptions = useMemo(
    () => workTypes.filter((t) => t.isActive || t.id === form.workTypeId),
    [workTypes, form.workTypeId]
  );
  const threshold = currentUser.timerMinThreshold || 0;
  const belowThreshold = !!timer && timer.elapsedSeconds < threshold;
  const spanOk = form.mode === 'duration' ? Number(form.minutes) > 0 : form.endMinutes > form.startMinutes;
  const taskOptions = tasks.flatMap((t) => [t, ...(t.subtasks || []).map((s) => ({ ...s, title: `  ${s.title}` }))]);

  const save = async () => {
    if (!spanOk) return;
    if (form.entryDate > today) { setError('The date cannot be in the future'); return; }
    setSaving(true);
    setError('');
    const body = {
      entryDate: form.entryDate,
      taskId: form.taskId || null,
      workTypeId: form.workTypeId || undefined,
      billable: form.billable,
      note: form.note,
      ...(canManageOthers ? { userId: form.userId } : {}),
      ...(form.mode === 'duration'
        ? { durationMinutes: Number(form.minutes), ...(entry && entry.startTime ? { startTime: null, endTime: null } : {}) }
        : { startTime: localDateTime(form.entryDate, form.startMinutes), endTime: localDateTime(form.entryDate, form.endMinutes) }),
    };
    try {
      if (entry) await api.patch(paths.entry(entry.id), body);
      else await api.post(paths.time, body);
      if (timer) await timerCtx.stop({ discard: true }); // the form logged it
      onSaved?.();
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const discardTimer = async () => { await timerCtx.stop({ discard: true }); onClose(); };
  const keepTiming = async () => { if (timer?.resumeAfter) await timerCtx.resume(); onClose(); };

  return (
    <Modal title={entry ? 'Edit time entry' : 'Log time'} onClose={timer ? keepTiming : onClose}>
      {belowThreshold && (
        <div className="mb-4 flex items-start gap-2 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}>
          <IconAlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>This entry is {formatHMS(timer.elapsedSeconds)}, below your minimum of {formatHMS(threshold)}. You can still log it or discard it.</span>
        </div>
      )}
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <label className={label} htmlFor="te-date">Date</label>
      <input id="te-date" type="date" max={today} value={form.entryDate} onChange={(e) => set({ entryDate: e.target.value })} className="input mb-3" style={field} />
      <div className="mb-2 flex gap-3 text-sm">
        <label className="flex items-center gap-1"><input type="radio" checked={form.mode === 'span'} onChange={() => set({ mode: 'span' })} /> Start and end</label>
        <label className="flex items-center gap-1"><input type="radio" checked={form.mode === 'duration'} onChange={() => set({ mode: 'duration' })} /> Duration</label>
      </div>
      {form.mode === 'span' ? (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div><span className={label}>Start</span><TimePicker minutesOfDay={form.startMinutes} onChange={(m) => set({ startMinutes: m })} /></div>
          <div><span className={label}>End</span><TimePicker minutesOfDay={form.endMinutes} onChange={(m) => set({ endMinutes: m })} /></div>
        </div>
      ) : (
        <div className="mb-3">
          <label className={label} htmlFor="te-minutes">Minutes</label>
          <input id="te-minutes" type="number" min="1" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} className="input" style={field} />
        </div>
      )}
      {!spanOk && <p className="mb-3 text-sm" style={{ color: 'var(--color-danger)' }}>{form.mode === 'span' ? 'End time must be after start time' : 'Enter the minutes worked'}</p>}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="te-type">Work type</label>
          <select id="te-type" className="input" style={field} value={form.workTypeId}
            onChange={(e) => {
              const t = workTypes.find((x) => x.id === Number(e.target.value));
              set({ workTypeId: Number(e.target.value), ...(t ? { billable: t.billableDefault } : {}) });
            }}>
            {typeOptions.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : ' (inactive)'}</option>)}
          </select>
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm" htmlFor="te-billable">
          <input id="te-billable" type="checkbox" checked={form.billable} onChange={(e) => set({ billable: e.target.checked })} /> Billable
        </label>
      </div>
      {taskOptions.length > 0 && (
        <>
          <label className={label} htmlFor="te-task">Task</label>
          <select id="te-task" className="input mb-3" style={field} value={form.taskId} onChange={(e) => set({ taskId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">No specific task</option>
            {taskOptions.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} ` : ''}{t.title}</option>)}
          </select>
        </>
      )}
      {canManageOthers && (
        <>
          <label className={label} htmlFor="te-user">Logged for</label>
          <select id="te-user" className="input mb-3" style={field} value={form.userId} onChange={(e) => set({ userId: Number(e.target.value) })}>
            <option value={currentUser.id}>Yourself ({currentUser.displayName})</option>
            {assignableUsers.filter((u) => u.id !== currentUser.id).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </>
      )}
      <label className={label} htmlFor="te-note">Note</label>
      <textarea id="te-note" className="input mb-4 resize-y" style={{ ...field, minHeight: '60px' }} value={form.note} onChange={(e) => set({ note: e.target.value })} />
      <div className="flex flex-wrap justify-end gap-2">
        {timer ? (
          <>
            <button type="button" onClick={discardTimer} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>Discard</button>
            <button type="button" onClick={keepTiming} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>Keep timing</button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
        )}
        <button type="button" onClick={save} disabled={saving || !spanOk}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: belowThreshold ? 'var(--color-warning)' : 'var(--color-accent)' }}>
          {saving ? 'Saving…' : belowThreshold ? 'Log anyway' : 'Save time entry'}
        </button>
      </div>
    </Modal>
  );
}
```

**Check before relying on the `PATCH` body:** does `updateEntry` accept `startTime: null, endTime: null` with `durationMinutes` to drop the times? Read `readDuration` / `updateEntry` in `services/time/index.js`. If it doesn't, send only `durationMinutes` (the server keeps the existing times otherwise), and record a ruling. The smoke test only edits an entry that has no times, so either way it passes.

- [ ] **Step 5: TimeLog**

`frontend/src/components/work/TimeLog.jsx`:

```jsx
// The time on a ticket or project: entries with who, task, work type,
// billable, duration and cost; edit and delete where the user may; totals
// over the whole ticket or project.
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import LoadMore from '../LoadMore';
import TimeEntryForm from './TimeEntryForm';
import { workPaths } from './workPaths';

const STEP = 25;
export const formatSeconds = (sec) => {
  const m = Math.round((sec || 0) / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TimeLog({
  kind, parentId, tasks = [], canLog, canManageOthers, currentUser, assignableUsers, reloadKey = 0, onChanged,
}) {
  const paths = workPaths(kind, parentId);
  const [data, setData] = useState({ entries: [], total: 0, totalSeconds: 0, totalLaborCost: null });
  const [limit, setLimit] = useState(STEP);
  const [editing, setEditing] = useState(null); // null | 'new' | entry
  const load = useCallback(() => api.get(paths.time, { params: { limit } }).then(({ data: d }) => setData(d)).catch(() => {}), [paths.time, limit]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const mayChange = (e) => e.userId === currentUser.id || e.loggedById === currentUser.id || canManageOthers;
  // Time by task: general time (no task) is the total less every task's time
  // (a task's loggedSeconds already includes its subtasks').
  const onTasks = tasks.reduce((n, t) => n + (t.loggedSeconds || 0), 0);
  const general = Math.max(0, data.totalSeconds - onTasks);
  const changed = () => { load(); onChanged?.(); };
  const remove = async (e) => {
    if (!window.confirm('Delete this time entry?')) return;
    try { await api.delete(paths.entry(e.id)); changed(); } catch (err) { alert(errMessage(err)); }
  };

  return (
    <div className="overflow-x-auto rounded-[10px] border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
      <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="font-semibold text-[var(--color-text-primary)]">Time entries</h2>
        {canLog && <button type="button" onClick={() => setEditing('new')} className="btn-primary">Log time</button>}
      </div>
      {onTasks > 0 && (
        <section aria-label="Time by task" className="border-b p-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
          <p className="mb-2 font-semibold">Time by task</p>
          <ul className="space-y-1">
            <li className="flex justify-between"><span>General ({kind === 'ticket' ? 'the ticket' : 'the project'}, no task)</span><span className="font-mono">{formatSeconds(general)}</span></li>
            {tasks.filter((t) => t.loggedSeconds > 0).map((t) => (
              <li key={t.id}>
                <div className="flex justify-between"><span>{t.code ? `${t.code} ` : ''}{t.title}</span><span className="font-mono">{formatSeconds(t.loggedSeconds)}</span></div>
                {(t.subtasks || []).filter((st) => st.loggedSeconds > 0).map((st) => (
                  <div key={st.id} className="flex justify-between pl-5 text-[var(--color-text-muted)]"><span>{st.code ? `${st.code} ` : ''}{st.title}</span><span className="font-mono">{formatSeconds(st.loggedSeconds)}</span></div>
                ))}
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 font-semibold" style={{ borderColor: 'var(--color-border)' }}><span>Total</span><span className="font-mono">{formatSeconds(data.totalSeconds)}</span></li>
          </ul>
        </section>
      )}
      <table className="min-w-full">
        <thead>
          <tr>{['Date', 'Who', 'Task', 'Work type', 'Note', 'Duration', 'Cost', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.id}>
              <td className="table-td whitespace-nowrap">{e.entryDate}</td>
              <td className="table-td">
                {e.user?.displayName || '—'}
                {e.loggedById && e.loggedById !== e.userId && <span className="block text-xs text-[var(--color-text-muted)]">by {e.loggedBy?.displayName || 'someone'}</span>}
              </td>
              <td className="table-td">{e.task ? `${e.task.code || ''} ${e.task.title}`.trim() : '—'}</td>
              <td className="table-td">
                {e.workType?.name || '—'}
                {!e.billable && <span className="ml-1 rounded bg-[var(--color-hover)] px-1 text-xs">non-billable</span>}
              </td>
              <td className="table-td">{e.note || '—'}</td>
              <td className="table-td font-mono font-semibold">{formatSeconds(e.durationSeconds)}</td>
              <td className="table-td">{e.laborCost != null ? money(e.laborCost) : '—'}</td>
              <td className="table-td whitespace-nowrap text-right">
                {mayChange(e) && (
                  <>
                    <button type="button" onClick={() => setEditing(e)} className="mr-2 text-xs text-[var(--color-accent)]">Edit</button>
                    <button type="button" onClick={() => remove(e)} className="text-xs" style={{ color: 'var(--color-danger)' }}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {data.entries.length === 0 && <tr><td colSpan={8} className="table-td text-[var(--color-text-muted)]">No time logged yet.</td></tr>}
        </tbody>
      </table>
      <LoadMore loaded={data.entries.length} total={data.total} onLoadMore={() => setLimit((n) => n + STEP)} noun="entries" />
      <div className="border-t p-4 text-right text-sm font-semibold" style={{ borderColor: 'var(--color-border)' }}>
        Total: {formatSeconds(data.totalSeconds)}
        {data.totalLaborCost != null && <span className="ml-4">Labor cost: {money(data.totalLaborCost)}</span>}
      </div>
      {editing && (
        <TimeEntryForm
          kind={kind} parentId={parentId} tasks={tasks} entry={editing === 'new' ? null : editing}
          canManageOthers={canManageOthers} currentUser={currentUser} assignableUsers={assignableUsers}
          onSaved={changed} onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

`TimeLog` relies on the page reloading `tasks` when time changes, so `loggedSeconds` is current. Both pages pass an `onChanged` that reloads tasks (Task 5), and `reloadKey` covers timers logged from elsewhere.

The Edit and Delete buttons need accessible names "Edit" and "Delete", which they have as their text. Each row's accessible name includes the note, which the smoke test's `getByRole('row', { name: /…/ })` relies on.

- [ ] **Step 6: The pages use it**

**`TicketDetail.jsx`:**
- the Time Entries tab renders `<TimeLog kind="ticket" parentId={ticket.id} tasks={tasks} canLog={hasPermission('time.log')} canManageOthers={canLogTimeForOthers} currentUser={user} assignableUsers={assignableUsers} reloadKey={timeVersion} onChanged={reloadActivity} />`;
- remove the `time` state, its load in the initial `Promise.all`, `reloadTime`, `addManualTime` and the `TimeEntriesTab` import;
- `timeVersion` is `useTimer().logVersion`, so a timer logged elsewhere refreshes it;
- the tab's count label, if it shows entry totals, reads from a lightweight `GET …/time?limit=1` total kept in state. If no count is shown, nothing more is needed.

**`ProjectDetail.jsx`:**
- the Time Entries tab renders `<TimeLog kind="project" parentId={project.id} tasks={tasks} canLog={canLogTime} canManageOthers={canLogTimeForOthers} currentUser={user} assignableUsers={assignableUsers} reloadKey={logVersion} onChanged={reloadProject} />`;
- remove `timeEntries`, `timeLimit`, `reloadTime`, `showAddTime`, the `AddTimeModal` block and the `TimeTab` import;
- the header `TimerButton`'s `onStopRequest={setStoppedTimer}` now renders `{stoppedTimer && <TimeEntryForm kind="project" parentId={project.id} tasks={tasks} timer={stoppedTimer} canManageOthers={canLogTimeForOthers} currentUser={user} assignableUsers={assignableUsers} onSaved={reloadProject} onClose={() => setStoppedTimer(null)} />}`. This replaces Task 3's temporary straight-to-stop handler.

Delete `pages/tickets/detail/TimeEntriesTab.jsx` and `pages/projects/detail/TimeTab.jsx` (`git rm` is fine here; commit with explicit paths). `pages/projects/detail/TimeFields.jsx` goes too once nothing imports it: `grep -rn "TimeFields" frontend/src`.

Update `work.ledger.smoke.js`: its "the default work date is the organization's today" test clicks "Add manual time entry". It now clicks "Log time", and reads `dialog(page).getByLabel('Date')`.

- [ ] **Step 7: Run the smoke tests (pass)**

Run: `cd backend && npm run test:smoke -- work.time work.ledger work.tickets work.projects work.timer`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A -- frontend/src backend/test/smoke
git commit -m "feat(screens): one time log and Log time form — work type, billable, task, edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: One task list on both pages

**Files:**
- Create: `frontend/src/components/work/TaskList.jsx`, `TaskDetails.jsx`, `EditableCode.jsx`, `Avatar.jsx`; `backend/test/smoke/work.tasks.smoke.js`
- Modify: `pages/tickets/TicketDetail.jsx`, `pages/projects/ProjectDetail.jsx`, `pages/projects/detail/Bits.jsx` (re-export from the new homes), `backend/test/smoke/work.ledger.smoke.js`, `work.tickets.smoke.js`, `work.projects.smoke.js`
- Delete: `pages/tickets/detail/TasksTab.jsx`, `pages/projects/detail/TasksTab.jsx`, `pages/projects/detail/TaskDetailModal.jsx`

**Interfaces:**
- **Consumes:** `workPaths`, `TimerButton`, `TimeEntryForm`; task objects with `status`, `subtasks`, `assignee`, `code`, `isComplete`, `subtaskPercent`, `loggedSeconds` and `linkedTicket` (Task 1).
- **Produces:**
  - `<TaskList kind parentId tasks statuses assignableUsers canEdit canLog canManageOthers currentUser timerLabel onChanged />`;
  - every subtask row in `TaskDetails` has its own compact timer, a "Log time" button and its time total;
  - `<TaskDetails kind parentId task statuses assignableUsers canEdit canLog … onChanged onClose />`, which expands inline under its row.

- [ ] **Step 1: Failing smoke test**

`backend/test/smoke/work.tasks.smoke.js`:

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeProject, makeTask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: one task list on tickets and projects — a compact checklist that
// expands into the task's details, subtasks, time and a timer on the task.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const waitFor = (page, method, part) => page.waitForResponse((r) => r.request().method() === method && r.url().includes(part));

let smoke;
let w;
let ticket;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Task ticket', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Replace drum' }), 201);
  project = await makeProject(w.admin.agent, { name: 'Task project', ownerDepartmentId: w.deptA.id });
  await makeTask(w.admin.agent, project.id, { title: 'First' });
  await makeTask(w.admin.agent, project.id, { title: 'Second' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('a ticket task expands: status, a subtask, and time on the task', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  await shown(page, 'Replace drum').click();
  const details = page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  const statusSaved = waitFor(page, 'PATCH', '/tasks/');
  await details.getByLabel('Status').selectOption({ label: 'In progress' });
  await statusSaved;
  await details.getByPlaceholder('Add a subtask…').fill('Order part');
  const subAdded = waitFor(page, 'POST', '/tasks');
  await details.getByPlaceholder('Add a subtask…').press('Enter');
  await subAdded;
  await details.getByRole('button', { name: 'Log time on this task' }).click();
  const dialog = page.getByRole('dialog').filter({ visible: true }).last();
  await dialog.getByLabel('Note').fill('Drum work');
  await dialog.getByRole('button', { name: 'Save time entry' }).click();
  await waitFor(page, 'POST', `/tickets/${ticket.id}/time`);
  const [task] = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks;
  expect([task.status.name, task.subtasks.map((s) => s.title), task.loggedSeconds > 0]).toEqual(['In progress', ['Order part'], true]);
});

it('a timer can run on a task', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  await shown(page, 'Replace drum').click();
  const details = page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  await details.getByRole('button', { name: 'Start timer' }).click();
  await waitFor(page, 'POST', '/timer/start');
  const [task] = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks;
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ type: 'ticket', taskId: task.id }));
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});

it('a subtask has its own timer and time; switching from the ticket timer keeps each minute where it was worked', async () => {
  const [task] = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks;
  const sub = task.subtasks.find((s) => s.title === 'Order part');
  // A ticket-level timer has been running ten minutes when the subtask timer starts.
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: ticket.id, label: 'Task ticket' }), 201);
  await models.ActiveTimer.update({ runningSince: new Date(Date.now() - 10 * 60 * 1000) }, { where: {} });
  const before = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`)).totalSeconds;
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  await shown(page, 'Replace drum').click();
  const details = page.getByRole('region', { name: 'Task details' }).filter({ visible: true }).first();
  const row = details.getByRole('listitem').filter({ hasText: 'Order part' });
  await row.getByRole('button', { name: 'Start timer' }).click();
  const started = await waitFor(page, 'POST', '/timer/start');
  const { logged } = await started.json();
  // The ten minutes went to the ticket (no task), not to the subtask.
  expect([logged.taskId, logged.durationSeconds >= 600]).toEqual([null, true]);
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toEqual(expect.objectContaining({ taskId: sub.id }));
  // The header still shows the running timer, now on the subtask.
  await page.getByText(/on Order part/).filter({ visible: true }).first().waitFor();
  await page.getByRole('button', { name: 'Pause timer' }).filter({ visible: true }).first().waitFor();
  const after = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/time`)).totalSeconds;
  expect(after - before).toBe(logged.durationSeconds);
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});

it('the Time Entries tab breaks the time down by task and subtask', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  const breakdown = page.getByRole('region', { name: 'Time by task' }).filter({ visible: true }).first();
  await breakdown.getByText(/General/).waitFor();
  await breakdown.getByText('Replace drum').waitFor();
  await breakdown.getByText('Total').waitFor();
});

it('project tasks reorder with the move buttons', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Second').waitFor();
  const saved = waitFor(page, 'PATCH', '/tasks/reorder');
  await page.getByRole('button', { name: 'Move Second up' }).click();
  await saved;
  expect(expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`)).tasks.map((t) => t.title)).toEqual(['Second', 'First']);
});
```

- [ ] **Step 2: Run it (fails: no "Task details" region)**

- [ ] **Step 3: Move the shared bits**

Move `Avatar` and `EditableCode` from `pages/projects/detail/Bits.jsx` into `components/work/Avatar.jsx` and `components/work/EditableCode.jsx` (default exports, code unchanged). `Bits.jsx` re-exports them (`export { default as Avatar } from '../../../components/work/Avatar';`) so the other project tabs keep working.

- [ ] **Step 4: TaskDetails**

`frontend/src/components/work/TaskDetails.jsx`:

```jsx
// A task's details, inline under its row: fields, subtasks, time on the
// task, a timer on it. Saves each field as it changes.
import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import TimerButton from './TimerButton';
import TimeEntryForm from './TimeEntryForm';
import { formatSeconds } from './TimeLog';
import { workPaths } from './workPaths';

const field = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };
const label = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';
const PRIORITIES = [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

export default function TaskDetails({
  kind, parentId, task, tasks, statuses, assignableUsers, canEdit, canLog, canManageOthers, currentUser, timerLabel, onChanged,
}) {
  const paths = workPaths(kind, parentId);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [newSubtask, setNewSubtask] = useState('');
  const [loggingFor, setLoggingFor] = useState(null); // task or subtask id the Log time form is for
  const [stoppedTimer, setStoppedTimer] = useState(null);

  const patch = async (id, changes) => {
    try { await api.patch(paths.task(id), changes); onChanged(); } catch (err) { alert(errMessage(err)); }
  };
  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    try {
      await api.post(paths.tasks, { title: newSubtask.trim(), parentTaskId: task.id });
      setNewSubtask('');
      onChanged();
    } catch (err) { alert(errMessage(err)); }
  };
  const removeTask = async (id, what) => {
    if (!window.confirm(`Delete this ${what}?`)) return;
    try { await api.delete(paths.task(id)); onChanged(); } catch (err) { alert(errMessage(err)); }
  };
  const toggle = (st) => {
    const closed = st.status?.behaviorType === 'closed';
    const next = statuses.find((s) => s.behaviorType === (closed ? 'open' : 'closed'));
    if (next) patch(st.id, { statusId: next.id });
  };

  return (
    <section aria-label="Task details" className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }} onClick={(e) => e.stopPropagation()}>
      <fieldset disabled={!canEdit} className="space-y-3">
        <div>
          <label className={label} htmlFor={`t-title-${task.id}`}>Title</label>
          <input id={`t-title-${task.id}`} className="input" style={field} value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title.trim() !== task.title) patch(task.id, { title: title.trim() }); else setTitle(task.title); }} />
        </div>
        <div>
          <label className={label} htmlFor={`t-desc-${task.id}`}>Description</label>
          <textarea id={`t-desc-${task.id}`} className="input resize-y" style={{ ...field, minHeight: '60px' }} value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => { if (description !== (task.description || '')) patch(task.id, { description }); }} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label className={label} htmlFor={`t-status-${task.id}`}>Status</label>
            <select id={`t-status-${task.id}`} className="input" style={field} value={task.statusId} onChange={(e) => patch(task.id, { statusId: Number(e.target.value) })}>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`t-prio-${task.id}`}>Priority</label>
            <select id={`t-prio-${task.id}`} className="input" style={field} value={task.priority} onChange={(e) => patch(task.id, { priority: e.target.value })}>
              {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`t-assignee-${task.id}`}>Assignee</label>
            <select id={`t-assignee-${task.id}`} className="input" style={field} value={task.assigneeId || ''} onChange={(e) => patch(task.id, { assigneeId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor={`t-due-${task.id}`}>Due date</label>
            <input id={`t-due-${task.id}`} type="date" className="input" style={field} value={task.dueDate || ''} onChange={(e) => patch(task.id, { dueDate: e.target.value || null })} />
          </div>
          <div>
            <label className={label} htmlFor={`t-est-${task.id}`}>Estimate (min)</label>
            <input id={`t-est-${task.id}`} type="number" min="0" className="input" style={field} defaultValue={task.estimateMinutes ?? ''}
              onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (task.estimateMinutes ?? null)) patch(task.id, { estimateMinutes: v }); }} />
          </div>
        </div>
      </fieldset>

      <div>
        <p className={label}>Subtasks</p>
        <ul className="space-y-1">
          {(task.subtasks || []).map((st) => (
            <li key={st.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label={`Complete ${st.title}`} disabled={!canEdit} checked={st.status?.behaviorType === 'closed'} onChange={() => toggle(st)} />
              {st.code && <span className="font-mono text-xs text-[var(--color-text-muted)]">{st.code}</span>}
              <span className="flex-1">{st.title}</span>
              <span className="font-mono text-xs text-[var(--color-text-muted)]" title="Time on this subtask">{formatSeconds(st.loggedSeconds)}</span>
              {canLog && (
                <>
                  <TimerButton kind={kind} parentId={parentId} taskId={st.id} label={`${timerLabel} · ${st.title}`} onStopRequest={setStoppedTimer} compact />
                  <button type="button" aria-label={`Log time on ${st.title}`} onClick={() => setLoggingFor(st.id)} className="text-xs font-medium text-[var(--color-accent)]">Log time</button>
                </>
              )}
              {canEdit && <button type="button" aria-label={`Delete ${st.title}`} onClick={() => removeTask(st.id, 'subtask')} style={{ color: 'var(--color-danger)' }}><IconX size={14} /></button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <input className="input mt-2 h-9 text-sm" style={field} placeholder="Add a subtask…" value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--color-text-muted)]">Time on this task: <span className="font-mono font-semibold text-[var(--color-text-primary)]">{formatSeconds(task.loggedSeconds)}</span></span>
        {canLog && (
          <>
            <TimerButton kind={kind} parentId={parentId} taskId={task.id} label={`${timerLabel} · ${task.title}`} onStopRequest={setStoppedTimer} compact />
            <button type="button" onClick={() => setLoggingFor(task.id)} className="text-sm font-medium text-[var(--color-accent)]">Log time on this task</button>
          </>
        )}
        {canEdit && <button type="button" onClick={() => removeTask(task.id, 'task and its subtasks')} className="ml-auto text-sm" style={{ color: 'var(--color-danger)' }}>Delete task</button>}
      </div>
      {(loggingFor || stoppedTimer) && (
        <TimeEntryForm
          kind={kind} parentId={parentId} tasks={tasks} defaultTaskId={loggingFor || task.id} timer={stoppedTimer}
          canManageOthers={canManageOthers} currentUser={currentUser} assignableUsers={assignableUsers}
          onSaved={onChanged} onClose={() => { setLoggingFor(null); setStoppedTimer(null); }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 5: TaskList**

`frontend/src/components/work/TaskList.jsx` takes the project `TasksTab`'s row as its base, generalised to either side:
- **Drag reorder and the up/down buttons:** the up/down buttons get `aria-label={\`Move ${task.title} up\`}` / `down`.
- **Codes:** the editable code chip uses `EditableCode` with `letter="T"` / `"S"`. Saving calls `api.patch(paths.code(task.id), { number })`.
- **Each row shows:** the status chip, priority dot, assignee avatar, due date, subtask count and progress bar, the linked ticket (with the "Restricted ticket" rule), and `loggedSeconds` when it's over 0.
- **Clicking the row expands it.** One task is open at a time (`openId` state), and the expanded row renders `<TaskDetails …>` under it, inside the same card.
- **The checkbox** toggles between the first open and first closed status, as both pages do today.
- **Adding a task:** an "Add a task…" input at the bottom, shown when `canEdit`. Enter posts `{ title }` to `paths.tasks`.
- **Reorder** posts the full order to `paths.reorder`, optimistically reordering local state. It calls `onChanged` after the response, and on error shows `alert(errMessage(err))`.

Every API call ends in `onChanged()`, which the page wires to reload the tasks (and, on projects, the project stats). The component's props are exactly those in **Interfaces** above. Copy the drag handlers (`handleDragOverTask`, `endDrag`, `dropAtGap`, `moveTask`) from `pages/projects/detail/TasksTab.jsx` verbatim. They depend only on `tasks`, `draggedId` and `overGap`.

- [ ] **Step 6: The pages use it**

**`TicketDetail.jsx`:**
- the Tasks tab renders `<TaskList kind="ticket" parentId={ticket.id} tasks={tasks} statuses={taskStatuses} assignableUsers={assignableUsers} canEdit={ticket.access?.edit} canLog={hasPermission('time.log')} canManageOthers={canLogTimeForOthers} currentUser={user} timerLabel={\`${formatTicketId(ticket)} ${ticket.title}\`} onChanged={reloadTasks} />`;
- `reloadTasks` is `api.get(\`/tickets/${id}/tasks\`).then(({ data }) => setTasks(data.tasks))`;
- remove `addTask`, `toggleTask`, `reassignTask` and the `TasksTab` import.

**`ProjectDetail.jsx`:**
- the Tasks tab renders `<TaskList kind="project" parentId={project.id} … canEdit={project.access?.edit} … onChanged={() => { reloadTasks(); reloadProject(); reloadActivity(); }} />`;
- remove `openTask`, `showAddTask`, `handleReorderTasks`, `toggleTaskComplete`, `toggleSubtaskComplete`, `deleteTask`, the `AddTaskModal` / `TaskDetailModal` blocks and imports.

`TaskList` passes `timerLabel` through to `TaskDetails`.

Delete the three replaced files.

Update the smoke tests that drove the replaced controls:
- **`work.ledger.smoke.js`, project subtask toggle:** click the task row, then the subtask's `Complete Project subtask` checkbox, and wait for a `PATCH` to `/tasks/` (not `/subtasks/`).
- **`work.projects.smoke.js` / `work.tickets.smoke.js`, "a task can be added":** use the "Add a task…" input. Keep the plan-3a intent of each test, and record a ruling for each changed step.

- [ ] **Step 7: Run the smoke tests (pass)**

Run: `cd backend && npm run test:smoke -- work.tasks work.ledger work.tickets work.projects work.time work.timer`

- [ ] **Step 8: Commit**

```bash
git add -A -- frontend/src backend/test/smoke
git commit -m "feat(screens): one task list on tickets and projects — expand, subtasks, time and a timer per task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The ticket page on the server timer, and screens that follow `access`

**Files:**
- Create: `frontend/src/components/work/useAutoTimer.js`; `backend/test/smoke/work.access.smoke.js`
- Modify: `pages/tickets/TicketDetail.jsx`, `pages/tickets/detail/{Sidebar,AttachmentsTab,RelationshipsTab,ConversationTab}.jsx`, `pages/projects/ProjectDetail.jsx`, `pages/projects/detail/{FilesTab,PeopleTab,ExpensesTab,MaterialsTab}.jsx`
- Delete: `pages/tickets/detail/TimerWidget.jsx`, and `pages/tickets/detail/TimeFields.jsx` once nothing imports it

**Interfaces:**
- **Consumes:** `access` (Task 1); `useTimer`, `TimerButton`, `TimeEntryForm`.
- **Produces:** `useAutoTimer({ kind, parentId, label, enabled, user })`.

- [ ] **Step 1: Failing smoke test**

`backend/test/smoke/work.access.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: the ticket page follows what the server allows (Department Staff
// on an unassigned department ticket: view, comment, log own time; no edits),
// and runs on the one server timer.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

let smoke;
let w;
let ticket;
let other;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  await makeStaff('staff', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Not mine', contactId: w.contact.id, departmentId: w.deptA.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Locked task' }), 201);
  other = await makeTicket(w.admin.agent, { title: 'Other ticket', contactId: w.contact.id, departmentId: w.deptA.id });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('staff see the ticket read-only but can log their own time', async () => {
  const page = await smoke.pageAs('staff');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, 'Not mine').waitFor();
  await shown(page, 'View only').waitFor();
  expect(await page.getByLabel('Priority').filter({ visible: true }).first().isDisabled()).toBe(true);
  await tab(page, /^Tasks/);
  expect(await page.getByPlaceholder('Add a task…').count()).toBe(0);
  await tab(page, /^Time Entries/);
  await button(page, 'Log time').waitFor();
  await tab(page, /^Relationships/);
  expect(await page.getByRole('button', { name: /Link ticket/ }).filter({ visible: true }).count()).toBe(0);
});

it('the ticket timer is the server timer, pauses, and stops into the Log time form', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await button(page, 'Start timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/start'));
  await button(page, 'Pause timer').click();
  await page.waitForResponse((r) => r.url().includes('/timer/pause'));
  await button(page, 'Stop timer').click();
  const dialog = page.getByRole('dialog').filter({ visible: true }).last();
  await dialog.getByRole('button', { name: 'Keep timing' }).waitFor();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await page.waitForResponse((r) => r.url().includes('/timer/stop'));
  expect(expectOk(await w.admin.agent.get(`${API}/timer`)).timer).toBeNull();
});

it('a timer on another ticket is named on this one, and starting here logs it', async () => {
  expectOk(await w.admin.agent.post(`${API}/timer/start`).send({ type: 'ticket', id: other.id, label: 'Other ticket' }), 201);
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await shown(page, /Timer running on Other ticket/).waitFor();
  await button(page, 'Start timer').click();
  const started = await page.waitForResponse((r) => r.url().includes('/timer/start'));
  expect((await started.json()).logged).toEqual(expect.objectContaining({ ticketId: other.id }));
  expectOk(await w.admin.agent.delete(`${API}/timer`));
});
```

- [ ] **Step 2: Run it (fails: no "View only", the timer is the browser one)**

- [ ] **Step 3: The ticket header on the server timer**

In `TicketDetail.jsx`:
- remove `useTicketTimer`, `ticketTimerRef`, the automatic-mode `useEffect` and the `TimerWidget` / `OtherTicketTimerBanner` imports and JSX;
- the header shows, when `hasPermission('time.log')`:

```jsx
<TimerButton kind="ticket" parentId={ticket.id} label={`${formatTicketId(ticket)} ${ticket.title}`} onStopRequest={setStoppedTimer} anyTask />
```

- with `{stoppedTimer && <TimeEntryForm kind="ticket" parentId={ticket.id} tasks={tasks} timer={stoppedTimer} … onClose={() => setStoppedTimer(null)} />}`;
- above the tabs, when a timer runs on something else:

```jsx
{activeTimer && !(activeTimer.type === 'ticket' && activeTimer.id === ticket.id) && (
  <div className="flex-shrink-0 px-6 py-2 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, var(--color-bg))', color: 'var(--color-warning)' }}>
    Timer running on {activeTimer.label || 'another item'} ({formatHMS(elapsedSeconds)}). Starting it here logs that time first.
  </div>
)}
```

  Here `activeTimer` and `elapsedSeconds` come from `useTimer()`.
- add `useAutoTimer({ kind: 'ticket', parentId: ticket?.id, label, enabled: user?.timerMode === 'automatic', user })`.

`frontend/src/components/work/useAutoTimer.js`:

```js
// Automatic timer mode: start the server timer when a ticket opens (only when
// no timer is running anywhere — never replace one silently), and stop it when
// the page is left: below the minimum it asks, with "prompt before log" it
// asks, otherwise it logs. A paused timer is left alone. Closing the tab logs
// (or discards below the minimum) with sendBeacon.
import { useEffect, useRef } from 'react';
import { useTimer } from '../../context/TimerContext';

export default function useAutoTimer({ kind, parentId, label, enabled, user }) {
  const timer = useTimer();
  const ref = useRef(timer);
  useEffect(() => { ref.current = timer; }, [timer]);

  useEffect(() => {
    if (!enabled || !parentId) return undefined;
    if (!ref.current.activeTimer) ref.current.start(kind, parentId, { label });
    const mineRunning = () => {
      const t = ref.current.activeTimer;
      return t && t.type === kind && Number(t.id) === Number(parentId) && t.state === 'running' ? ref.current : null;
    };
    const belowMin = (t) => t.elapsedSeconds < (user.timerMinThreshold || 0);

    const onUnload = () => {
      const t = mineRunning();
      if (!t) return;
      const body = belowMin(t) ? { discard: true } : {};
      navigator.sendBeacon('/api/v1/timer/stop', new Blob([JSON.stringify(body)], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      const t = mineRunning();
      if (!t) return;
      const elapsed = t.elapsedSeconds;
      const fmt = `${Math.floor(elapsed / 60)} min`;
      let keep = true;
      if (belowMin(t)) keep = window.confirm(`This entry is ${fmt}, below your minimum. Log it anyway?`);
      else if (user.timerPromptBeforeLog) keep = window.confirm(`Log ${fmt} of time before leaving?`);
      t.stop(keep ? {} : { discard: true }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind, parentId]);
}
```

**Check before relying on the beacon:** does the backend accept `sendBeacon`'s cookie-authenticated POST without a CSRF header? The ticket page's old beacon to `/tickets/:id/time` worked, so the same middleware applies. Confirm with `grep -rn csrf backend/src/middleware`. If a CSRF token is required, fall back to `fetch(..., { keepalive: true, headers })` with that header, and record a ruling.

Delete `pages/tickets/detail/TimerWidget.jsx`, and `pages/tickets/detail/TimeFields.jsx` once `grep -rn "detail/TimeFields" frontend/src` is empty. The old `prism.ticketTimer.v1` localStorage key is cleared once on load, with a `try/catch`, in `TimerContext`'s provider (`localStorage.removeItem('prism.ticketTimer.v1')`), so a stale browser timer can't confuse anyone.

- [ ] **Step 4: Screens follow `access`**

**Tickets.** `const canEdit = !!ticket.access?.edit;`
- `Sidebar` gets `canEdit`. Its editable fields (status, priority, type, assignee, team, department, due date and time, project, custom fields, tags, contact) are wrapped in `<fieldset disabled={!canEdit}>`. When `!canEdit`, the top of the sidebar shows a short muted line: **"View only — you can't edit this ticket."**
  - Watchers keep their own `tickets.manage_watchers` gate.
  - Fields that are links rather than inputs stay clickable.
  - The Priority select must have an accessible label "Priority": add `id` + `htmlFor` if it lacks one.
- `RelationshipsTab` gets `canEdit`; "Link ticket" and the remove buttons show only when it is true. The header's own Link ticket button also uses `canEdit`.
- The resolution editor, the custom-field editor and the ticket delete button (`access.delete`) follow `canEdit` / `access.delete`.
- `AttachmentsTab`'s remove button shows for the uploader or `access.moderate`.
- `ConversationTab` / comment edit and delete show for the author or `access.moderate`: find where comments render their edit/delete controls (`grep -rn "comments/" frontend/src/pages/tickets/detail`) and apply the same rule.

**Projects.** `const canEdit = !!project.access?.edit;`
- Renaming the project, its status, the close-project prompt and Delete (`access.delete`) follow it.
- `PeopleTab`'s add and remove need `canEdit && canManageMembers`.
- `ExpensesTab` / `MaterialsTab` need `canEdit && canManageExpenses`.
- `FilesTab`'s delete shows for the uploader or `access.moderate`; upload stays on `canEditProjectContent` (the route's gate).

- [ ] **Step 5: Run the smoke tests (pass)**

Run: `cd backend && npm run test:smoke -- work.access work.tickets work.projects work.tasks work.time work.timer work.ledger`

- [ ] **Step 6: Commit**

```bash
git add -A -- frontend/src backend/test/smoke
git commit -m "feat(screens): the ticket page on the one server timer; screens follow what the server allows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Settings — four status lists, work types, and the new permissions in the role editor

**Files:**
- Create: `frontend/src/pages/settings/WorkTypes.jsx`, `backend/test/smoke/work.settings.smoke.js`
- Modify: `pages/settings/Statuses.jsx`, `pages/SettingsHub.jsx`, `App.jsx`, `pages/RoleEditor.jsx`

- [ ] **Step 1: Failing smoke test**

`backend/test/smoke/work.settings.smoke.js`:

```js
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3c: Settings edits the ticket-task and project-task status lists and
// the work types, and the role editor shows the time permissions.

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first();

let smoke;
let w;
let seededStatuses;
let seededTypes;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  seededStatuses = await models.TaskStatus.findAll({ raw: true });
  seededTypes = await models.WorkType.findAll({ raw: true });
});
afterAll(async () => {
  // Seeded lists are not reset between files: put them back.
  await models.Task.destroy({ where: {} });
  await models.TimeEntry.destroy({ where: {} });
  await models.TaskStatus.destroy({ where: {} });
  await models.TaskStatus.bulkCreate(seededStatuses);
  await models.WorkType.destroy({ where: {} });
  await models.WorkType.bulkCreate(seededTypes);
  await smoke.stop();
  await closeDb();
});

it('adds a ticket-task status, and refuses to delete one in use', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/statuses');
  await button(page, 'Ticket tasks').click();
  await shown(page, 'In progress').waitFor();
  const added = page.waitForResponse((r) => r.url().endsWith('/task-statuses') && r.request().method() === 'POST');
  await button(page, '+ Add status').click();
  expect((await (await added).json()).status).toEqual(expect.objectContaining({ scope: 'ticket' }));
  const t = await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/tasks`).send({ title: 'uses To do' }), 201);
  await page.reload();
  await button(page, 'Ticket tasks').click();
  await page.getByRole('button', { name: 'Delete To do' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).last().click();
  await shown(page, /used by 1 task/).waitFor();
  expect((await models.TaskStatus.findAll({ where: { scope: 'ticket' } })).map((s) => s.name)).toContain('To do');
});

it('adds, deactivates and deletes work types', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto('/settings/work-types');
  await shown(page, 'Remote support').waitFor();
  await page.getByPlaceholder('New work type').fill('Training');
  await button(page, 'Add').click();
  await shown(page, 'Training').waitFor();
  const deactivated = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/work-types/'));
  await page.getByLabel('Training active').uncheck();
  await deactivated;
  expect((await models.WorkType.findOne({ where: { name: 'Training' } })).isActive).toBe(false);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete Training' }).click();
  await page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/work-types/'));
  expect(await models.WorkType.count({ where: { name: 'Training' } })).toBe(0);
});

it('the role editor lists the time permissions', async () => {
  const page = await smoke.pageAs('admin');
  const { roles } = expectOk(await w.admin.agent.get(`${API}/roles`));
  const tech = roles.find((r) => r.name === 'System Technician');
  await page.goto(`/settings/roles/${tech.id}`);
  await shown(page, /^Time —/).click();
  await shown(page, "Manage others' time").waitFor();
});
```

Check the role editor's real route (`grep -n "RoleEditor" frontend/src/App.jsx`) and the `GET /roles` response key before running. Adjust the URL, and record a ruling.

- [ ] **Step 2: Run it (fails: no Ticket tasks tab, no Work types page)**

- [ ] **Step 3: Statuses — four tabs**

In `pages/settings/Statuses.jsx`, `TABS` becomes:

```js
const TABS = [
  { key: 'ticket', label: 'Tickets', endpoint: '/ticket-statuses' },
  { key: 'ticket-task', label: 'Ticket tasks', endpoint: '/task-statuses', scope: 'ticket' },
  { key: 'project', label: 'Projects', endpoint: '/project-statuses' },
  { key: 'project-task', label: 'Project tasks', endpoint: '/task-statuses', scope: 'project' },
];
```

- **Load:** `api.get(endpoint, { params: tab.scope ? { scope: tab.scope } : {} })`.
- **Add:** posts `{ ...(tab.scope ? { scope: tab.scope } : {}), name: 'New Status', color: '#3b82f6', behaviorType: 'open' }`.
- **Reorder:** sends `{ order, ...(tab.scope ? { scope: tab.scope } : {}) }`.
- **Delete, for a task tab:** the server refuses a status in use (`STATUS_IN_USE`) rather than reassigning. The delete dialog shows `errMessage(err)` in its existing `deleteError` slot and keeps the row; the success alert about reassigned records shows only when `data.reassignedCount` is set.
- **Delete buttons** get `aria-label={\`Delete ${s.name}\`}`.
- **Page intro:** "Define, reorder and recolor the ticket, ticket-task, project and project-task statuses."
- In `SettingsHub.jsx`, the Statuses card description becomes "Ticket, project and task statuses".

- [ ] **Step 4: Work types page**

`frontend/src/pages/settings/WorkTypes.jsx`:

```jsx
// Settings → Work types: the kinds of work time is logged as. A type in use
// can be deactivated (it stays on old entries) but not deleted; one stays active.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

export default function WorkTypes() {
  const [types, setTypes] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const load = () => api.get('/work-types').then(({ data }) => setTypes(data.workTypes)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);

  const patch = async (t, changes) => {
    try {
      const { data } = await api.patch(`/work-types/${t.id}`, changes);
      setTypes((list) => list.map((x) => (x.id === t.id ? data.workType : x)));
    } catch (err) { alert(errMessage(err)); load(); }
  };
  const add = async () => {
    if (!name.trim()) return;
    try {
      const { data } = await api.post('/work-types', { name: name.trim() });
      setTypes((list) => [...list, data.workType]);
      setName('');
    } catch (err) { alert(errMessage(err)); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/work-types/${t.id}`);
      setTypes((list) => list.filter((x) => x.id !== t.id));
    } catch (err) { alert(errMessage(err)); }
  };

  if (!types) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  return (
    <div className="space-y-4">
      <Link to="/settings" className="text-sm text-[var(--color-accent)] hover:underline">← Settings</Link>
      <div>
        <h1 className="page-title">Work types</h1>
        <p className="text-sm text-navy-500">What kind of work time is logged as, and whether it is billable by default. A type in use can be turned off but not deleted.</p>
      </div>
      <div className="card divide-y divide-navy-100">
        {types.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 p-3">
            <input className="input max-w-xs" defaultValue={t.name} aria-label={`${t.name} name`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patch(t, { name: v }); else e.target.value = t.name; }} />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" aria-label={`${t.name} billable`} checked={t.billableDefault} onChange={(e) => patch(t, { billableDefault: e.target.checked })} /> Billable by default
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" aria-label={`${t.name} active`} checked={t.isActive} onChange={(e) => patch(t, { isActive: e.target.checked })} /> Active
            </label>
            <button type="button" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} className="ml-auto text-sm" style={{ color: 'var(--color-danger)' }}>Delete</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input max-w-xs" placeholder="New work type" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button type="button" onClick={add} className="btn-primary">Add</button>
      </div>
    </div>
  );
}
```

- **Route:** in `App.jsx`, `<Route path="/settings/work-types" element={perm(<SettingsWorkTypes />, SYSTEM_KEYS)} />`, with a lazy/regular import matching how `SettingsTimeTracking` is imported.
- **Hub card:** in `SettingsHub.jsx`, next to Time Tracking: `{ label: 'Work types', to: '/settings/work-types', desc: 'Kinds of work and billable defaults', permission: SYSTEM_KEYS }`.

- [ ] **Step 5: The role editor shows the time permissions**

In `pages/RoleEditor.jsx`, `CATEGORY_ORDER` becomes `['tickets', 'projects', 'time', 'people', 'reports', 'settings']`, and `CATEGORY_LABELS` gains `time: 'Time'`.

Check for other categories the API returns that the list omits:

```js
const { data } = await api.get('/permissions'); // run in the browser console or via supertest
```

Simpler: `grep -n "category:" backend/migrations/*.js | sed "s/.*category: '\([a-z_]*\)'.*/\1/" | sort -u`. Add any missing one with a label (for example `assets`, `kb`, `companies`), and record a ruling.

- [ ] **Step 6: Run the smoke tests (pass), then the whole smoke suite**

Run: `cd backend && npm run test:smoke`

- [ ] **Step 7: Commit**

```bash
git add -A -- frontend/src backend/test/smoke/work.settings.smoke.js
git commit -m "feat(settings): four status lists, work types, and the time permissions in the role editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sizes, the whole suite, docs, review

- [ ] **Step 1: File sizes (spec: none over about 800 lines)**

Run: `find frontend/src/pages/tickets frontend/src/pages/projects frontend/src/components/work backend/src/controllers/tickets backend/src/controllers/projects backend/src/controllers/reports backend/src/services/tasks backend/src/services/time -name '*.js*' | xargs wc -l | sort -n | tail -8`
Expected: nothing over 800. If one is, split it along its existing seams, and record a ruling.

- [ ] **Step 2: Nothing reads the legacy tables (spec: Done when)**

Run: `grep -rn "legacy_\|ProjectTimeEntr\|TicketTask\|ProjectSubtask\|ProjectTask\b" backend/src frontend/src | grep -v "^backend/src/models/index.js"`
Expected: no reads, only migrations.

- [ ] **Step 3: Every test**

Run, one after the other in the background: `cd backend && npm test > <scratch>/3c-full.log 2>&1; npm run test:smoke > <scratch>/3c-smoke.log 2>&1`
Expected: both green.

- [ ] **Step 4: Docs**

- **`UPGRADING.md`**, under the work-model sections, add "**Part 3: the screens**":
  - one timer for tickets, projects and tasks, kept on the server. It follows you across devices, pauses and resumes, and shows in the top bar. A timer running only in a browser before the upgrade is not carried over: stop and log it first;
  - ticket tasks are full tasks on the page: they expand to status, priority, assignee, due date, estimate, subtasks, and time and a timer per task;
  - Log time asks for a work type and billable, can log against a task, and entries can be edited;
  - Settings → Statuses has Ticket tasks and Project tasks tabs, and Settings → Work types is new;
  - the role editor shows the Time permissions;
  - ticket and project pages show only what you may change ("View only" otherwise).
- **`docs/ROADMAP.md`:** sub-project 3's status becomes **Shipped**, with `[plan 3c](superpowers/plans/2026-10-11-work-model-screens.md) (the screens)` in its plan column.
- **Spec:**
  - status line: "Shipped (plans 3a, 3b-1, 3b-2, 3c)";
  - under *Plans → 3c*, add "**Decided by the user on 2026-10-11:** one server timer with pause replaces the ticket page's browser timer."

- [ ] **Step 5: Commit the docs**

```bash
git add -A -- UPGRADING.md docs
git commit -m "docs: one work model part 3 — the screens; sub-project 3 shipped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Final review**

Run two fresh reviewers on the most capable model, in parallel:
- the whole branch against this plan and the spec;
- a security review, focusing on the new timer endpoints, the `access` flags, and any screen that could now send a request the old one didn't.

Fix Critical and Important findings in one pass, each with a test that fails first. Push only when the user says so.
