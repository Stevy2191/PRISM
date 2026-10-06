# One Work Model — Tasks and the Ledger (plan 3b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three task tables and the two time tables with one `Tasks` table and one `TimeEntries` ledger, behind one task service and one time service. This covers the timer and every reader of time and tasks, plus the task and time quirk fixes. Today's screens keep working on the new API.

**Architecture:**
- **Migration:** one migration renames the five old tables to `legacy_*`, creates `TaskStatuses`, `WorkTypes`, `Tasks`, `TimeEntries` and two id maps, copies the data across set-based, and adds `time.log` / `time.manage_others`.
- **Services:** `services/tasks/` and `services/time/` hold every rule. The ticket and project controllers become thin wrappers that find the parent, check access and call the service.
- **Readers:** reports, the dashboard, the custom report engine, the calendar and the PDF reports switch to the ledger.
- **Frontend:** gets the smallest rewiring that keeps today's pages working. Plan 3c replaces those pages with shared components.

**Tech Stack:** Node 24.9+, Express 4, Sequelize 6 on MariaDB 11 (CommonJS); React 18 + Vite 6. Jest 30 integration tests against the `prism-test-db` container. The browser smoke suite (`npm run test:smoke`, headless Chromium through `playwright-core`). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-05-one-work-model-design.md`](../specs/2026-10-05-one-work-model-design.md). Read *Data model*, *Migration*, *Behaviour and API* and *Security notes* before starting.

**This plan is the first half of the spec's plan 3b:**
- **This half:** everything that has to change together once the old tables are renamed.
- **Plan 3b-2, which follows:**
  - edit-tier access (Q26, Q28) and the System Technician grant;
  - the task-status and work-type settings APIs;
  - the quirks that don't touch tasks or time: Q13, Q16–Q19, the rest of Q23, Q24, Q25 for ticket and project status strings, Q27, Q29, Q30, Q33, Q35, and Q38 for tickets and projects.

## Global Constraints

- **Seeded rows** (spec *Data model*, verbatim):
  - Ticket-task statuses: **To do** (open, default), **In progress** (open) and **Done** (closed, protected).
  - The project scope is a **copy of today's project statuses**, with the same names, colors, behaviors and order. This plan also gives them the same **ids**, so no project task's `statusId` changes.
  - Work types: **Remote support**, **On-site**, **Travel** and **Project work** (all billable by default), and **Admin** (not billable).
- **Permissions** (spec *Migration* step 6):
  - add `time.log` and `time.manage_others`;
  - grant `time.log` to every role holding `projects.log_time` or any ticket edit permission;
  - grant `time.manage_others` to System Administrator and Department Manager.
- **Legacy tables:** `legacy_TimeEntries`, `legacy_ProjectTimeEntries`, `legacy_TicketTasks`, `legacy_ProjectTasks` and `legacy_ProjectSubtasks` stay, renamed and **never read by app code**. The next release drops them.
- **The organization's time zone** is the `company.timezone` setting (default `UTC`). An invalid zone falls back to UTC. "Today", a timer's work date and report day bounds all use it.
- **Unified API field names:**

  | Kind | Fields |
  |---|---|
  | Task | `title`, `description`, `statusId`, `priority`, `assigneeId`, `dueDate`, `estimateMinutes`, `parentTaskId`, `linkedTicketId` (project tasks only) and `code` |
  | Time body | `durationMinutes` **or** `startTime` + `endTime`, plus `entryDate`, `note`, `taskId`, `workTypeId`, `billable` and `userId` (who it's for) |
  | Time response | `user` (who it's for), `loggedBy` (who entered it), `task`, `workType` |
  | Time list | `totalSeconds` and `totalLaborCost` on both sides |

- **Ids from requests** go through `parseRecordId` (MariaDB reads `'12abc'` as 12). A task named on time, an expense, a material or a file must belong to the same ticket or project (S13). Report filters are ANDed onto the reader's scope, never merged into it (S14, S16).
- **Database conventions:** no database foreign keys, which is the project convention since plan 2a. Deletes that the old foreign keys cascaded (ticket → its time and tasks) happen in code.
- **The suite is expected to be red between Task 2 and Task 8.** The migration renames tables that later tasks rewire. Each task's own named test files must pass at its end. Task 10 runs the whole suite and the smoke suite green.
- **Test runs:**
  - `cd backend && npm test` runs everything (about 11 minutes; run it in the background);
  - one file runs with `npx cross-env NODE_OPTIONS=--experimental-vm-modules jest <path>`;
  - never run the smoke suite and `npm test` at the same time, because they share the database.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage explicit paths only (`git add -A -- <paths>`); never `git rm` a file before an unrelated commit. Push only when the user says so.

## Review Focus

1. **Real-world data the migration meets**, which a person upgrading expects to come through without loss or an aborted upgrade:
   - a subtask whose task was deleted;
   - time on a deleted ticket;
   - a project task with a `NULL` code;
   - ticket time with no `durationSeconds`;
   - a ticket with 100 or more checklist items;
   - a ticket id above 99999 (`LPAD` truncates).

   *(Task 2's migration test seeds every one of these.)*
2. **Equal timestamps.** Ordering by `createdAt` alone flips rows written in the same second; this has caused three earlier bugs here. Every list orders by a time column and then `id`. *(Tasks 4 and 6: list tests write rows under a frozen clock.)*
3. **Ids sent as strings, floats or `'12abc'`** for `statusId`, `parentTaskId`, `taskId`, `workTypeId` and `userId`. They must be refused or read as exactly the integer, never cast to a different row. *(Task 4 and Task 6 tests.)*
4. **Work dates near midnight in the organization's zone.** The default `entryDate`, the future check and the timer's work date must use the organization's date, not UTC and not the server's. *(Task 1 unit tests and Task 6/7 tests under a frozen clock with `company.timezone` set.)*
5. **Deleting a task that has time or a running timer** keeps the time, now on no task, and the timer keeps running on the parent. *(Task 4 test.)*

---

## File map

**Create (backend)**
- `utils/orgTime.js`: the organization's time zone, "today" and day bounds.
- `migrations/20260101000050-one-work-model.js`
- `models/Task.js`, `models/TaskStatus.js`, `models/WorkType.js`; `models/TimeEntry.js` is rewritten for the ledger.
- `services/tasks/index.js` (rules), `services/tasks/statuses.js`, `services/tasks/codes.js`
- `services/time/index.js`
- `controllers/workCatalogController.js`, for `GET /task-statuses` and `GET /work-types` (mounted in `routes/index.js`).

**Modify (backend)**
- **Models:** `models/index.js` and `models/ActiveTimer.js`. Delete `models/TicketTask.js`, `ProjectTask.js`, `ProjectSubtask.js` and `ProjectTimeEntry.js`.
- **Controllers:**
  - `controllers/tickets/{tasks,time,core,shared}.js` and `controllers/projects/{tasks,time,shared,expenses,materials,files}.js`;
  - `controllers/timerController.js`, `controllers/authController.js` and `controllers/dashboardController.js`;
  - `controllers/reports/{shared,team,time,projects,tickets,sla,assets,licenses,contacts,happiness}.js`;
  - `controllers/calendarController.js`.
- **Services:** `services/{projectCompletion,statusBehavior,projectCodeService,customReportEngine,ticketReport,projectReport}.js`.
- **Routes:** `routes/{tickets,projects,timer,index}.js`.

**Frontend (Task 9)**
- **Ticket page:** `pages/tickets/TicketDetail.jsx` and `pages/tickets/detail/{TasksTab,TimeEntriesTab,TimerWidget,ActivityTab}.jsx`.
- **Project page:** `pages/projects/ProjectDetail.jsx` and `pages/projects/detail/{TasksTab,TaskDetailModal,TimeTab,ActivityTab}.jsx`.
- **Elsewhere:** `pages/Dashboard*` (the hours chart, if it assumes five days).

**Tests**
- **Create:**
  - `test/unit/orgTime.test.js`;
  - `test/integration/workmodel.migration.test.js`, `workmodel.catalog.test.js` and `time.permissions.test.js`;
  - `test/smoke/work.ledger.smoke.js`.
- **Rewrite:**
  - `tickets.tasks.test.js`, `projects.tasks.test.js`;
  - `time.tickets.test.js`, `time.projects.test.js`, `time.timer.test.js`.
- **Update** (field names and the fixed quirks):
  - `helpers.js`, `fixtures.js`;
  - `readers.reports.test.js`, `readers.other.test.js`;
  - `sideEffects.test.js`, `pagination.test.js`;
  - `authorization.test.js`, `functional.test.js`, `fixtures.test.js`;
  - `companies.reports.test.js`, `companies.review.test.js`, `companies.ticketpeople.test.js`;
  - `projects.core.test.js`, `tickets.core.test.js`, `security.s12-s17.test.js`;
  - `smoke/work.tickets.smoke.js`, `smoke/work.projects.smoke.js`.

**Docs (Task 10):** `UPGRADING.md`, `docs/ROADMAP.md`, and the baseline quirk table in `docs/superpowers/specs/2026-10-03-test-baseline-design.md`.

---

### Task 1: The organization's calendar (`utils/orgTime.js`)

**Files:**
- Create: `backend/src/utils/orgTime.js`
- Test: `backend/test/unit/orgTime.test.js`

**Interfaces:**
- Produces:
  - `orgTimeZone(): Promise<string>`, an IANA zone (UTC when unset or invalid);
  - `dateInZone(instant, tz): 'YYYY-MM-DD'` and `todayInZone(tz, now = new Date())`;
  - `zoneDayStart(dateStr, tz): Date` and `zoneDayEnd(dateStr, tz): Date` (the last millisecond);
  - `addDays(dateStr, n): string`;
  - `toDateString(value): string | null`, which accepts `YYYY-MM-DD` or an ISO timestamp's date and rejects impossible dates;
  - `isValidZone(tz): boolean`.

- [ ] **Step 1: Write the failing unit test**

`backend/test/unit/orgTime.test.js`:

```js
const {
  dateInZone, todayInZone, zoneDayStart, zoneDayEnd, addDays, toDateString, isValidZone,
} = require('../../src/utils/orgTime');

// The organization's calendar: work dates and report days are whole days in
// one configured zone, whatever zone the server or the browser runs in.

describe('dateInZone / todayInZone', () => {
  it('reads an instant on the zone\'s wall calendar', () => {
    const late = new Date('2026-03-10T03:30:00Z'); // 22:30 on the 9th in Chicago
    expect(dateInZone(late, 'UTC')).toBe('2026-03-10');
    expect(dateInZone(late, 'America/Chicago')).toBe('2026-03-09');
    expect(dateInZone(late, 'Asia/Tokyo')).toBe('2026-03-10');
    expect(todayInZone('America/Chicago', late)).toBe('2026-03-09');
  });
});

describe('zoneDayStart / zoneDayEnd', () => {
  it('bounds a day in the zone, as UTC instants', () => {
    expect(zoneDayStart('2026-03-11', 'UTC').toISOString()).toBe('2026-03-11T00:00:00.000Z');
    expect(zoneDayEnd('2026-03-11', 'UTC').toISOString()).toBe('2026-03-11T23:59:59.999Z');
    expect(zoneDayStart('2026-03-11', 'America/Chicago').toISOString()).toBe('2026-03-11T05:00:00.000Z');
    expect(zoneDayStart('2026-03-11', 'Asia/Tokyo').toISOString()).toBe('2026-03-10T15:00:00.000Z');
  });

  it('handles the days the clocks change', () => {
    // US DST starts 2026-03-08: the day is 23 hours long in Chicago.
    expect(zoneDayStart('2026-03-08', 'America/Chicago').toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(zoneDayEnd('2026-03-08', 'America/Chicago').toISOString()).toBe('2026-03-09T04:59:59.999Z');
    // ...and ends 2026-11-01: 25 hours.
    expect(zoneDayStart('2026-11-01', 'America/Chicago').toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(zoneDayEnd('2026-11-01', 'America/Chicago').toISOString()).toBe('2026-11-02T05:59:59.999Z');
  });
});

describe('helpers', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('reads a date string and refuses anything else', () => {
    expect(toDateString('2026-03-10')).toBe('2026-03-10');
    expect(toDateString('2026-03-10T22:00:00Z')).toBe('2026-03-10');
    for (const bad of [undefined, null, '', 'garbage', '2026-02-30', '2026-13-01', '10/03/2026']) {
      expect(toDateString(bad)).toBeNull();
    }
  });

  it('knows a real zone from a typo', () => {
    expect(isValidZone('America/Chicago')).toBe(true);
    expect(isValidZone('UTC')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
    expect(isValidZone('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/unit/orgTime.test.js`
Expected: FAIL with "Cannot find module '../../src/utils/orgTime'".

- [ ] **Step 3: Write the helper**

`backend/src/utils/orgTime.js`:

```js
// The organization's calendar: Settings → company.timezone (an IANA zone,
// default UTC). Work dates ("today", a timer's day) and report day bounds are
// computed in it, not in the server's zone or the browser's.

function isValidZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }); // eslint-disable-line no-new
    return true;
  } catch {
    return false;
  }
}

// Read per call (one indexed row): a settings change applies at once.
async function orgTimeZone() {
  const { SystemSettings } = require('../models'); // eslint-disable-line global-require
  const row = await SystemSettings.findOne({ where: { key: 'company.timezone' }, attributes: ['value'] });
  const tz = row && row.value ? String(row.value).trim() : 'UTC';
  return isValidZone(tz) ? tz : 'UTC';
}

// YYYY-MM-DD of an instant, as a wall calendar in `tz` shows it.
function dateInZone(instant, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
}

function todayInZone(tz, now = new Date()) {
  return dateInZone(now, tz);
}

// How far `tz`'s wall clock is ahead of UTC at `instant`, in milliseconds.
function offsetAt(instant, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

// The UTC instant at which `dateStr` (YYYY-MM-DD) begins in `tz`.
function zoneDayStart(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  let guess = midnightUtc - offsetAt(new Date(midnightUtc), tz);
  // A second pass settles the days on which the offset changes (DST).
  guess = midnightUtc - offsetAt(new Date(guess), tz);
  return new Date(guess);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// The last millisecond of `dateStr` in `tz`.
function zoneDayEnd(dateStr, tz) {
  return new Date(zoneDayStart(addDays(dateStr, 1), tz).getTime() - 1);
}

// A real calendar date as YYYY-MM-DD (also the date part of an ISO
// timestamp), or null. '2026-02-30' is refused, not rolled into March.
function toDateString(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s ? s : null;
}

module.exports = {
  orgTimeZone, isValidZone, dateInZone, todayInZone, zoneDayStart, zoneDayEnd, addDays, toDateString,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/unit/orgTime.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A -- backend/src/utils/orgTime.js backend/test/unit/orgTime.test.js
git commit -m "feat(time): the organization's calendar helper (company.timezone)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: The migration

**Files:**
- Create: `backend/migrations/20260101000050-one-work-model.js`
- Modify: `backend/test/integration/helpers.js` (the `resetData` table lists)
- Test: `backend/test/integration/workmodel.migration.test.js`

**Interfaces:**
- Produces these tables, which every later task uses:
  - `TaskStatuses(id, scope enum('ticket','project'), name, color, behaviorType enum('open','closed','archived'), position, isDefault, isProtected, createdAt)`;
  - `WorkTypes(id, name, billableDefault, isActive, position, createdAt, updatedAt)`;
  - `Tasks(id, ticketId, projectId, parentTaskId, code, title, description, statusId, priority, assigneeId, dueDate, estimateMinutes, position, completedAt, linkedTicketId, createdBy, createdAt, updatedAt)`;
  - `TimeEntries(id, ticketId, projectId, taskId, userId, loggedById, entryDate, startTime, endTime, durationSeconds, billable, workTypeId, note, laborCost, createdAt, updatedAt)`;
  - `TaskIdMap` and `TimeEntryIdMap`, each `(oldTable, oldId, newId)`;
  - `ActiveTimers.taskId`;
  - permissions `time.log` and `time.manage_others`.
- Id rules:
  - project tasks and ticket time keep their ids;
  - project subtasks get `oldId + max(project task id)`;
  - ticket tasks get `oldId + max(project task id) + max(subtask id)`;
  - project time gets `oldId + max(ticket time id)`.

  All of these are recorded in the maps. Auto-increment then continues above every copied id.

- [ ] **Step 1: Write the failing migration test**

`backend/test/integration/workmodel.migration.test.js`:

```js
const Sequelize = require('sequelize');
const { sequelize, closeDb, resetData } = require('./helpers');
const { makeWorld, makeTicket, makeProject } = require('./fixtures');

const migration = require('../../migrations/20260101000050-one-work-model');

// The one-work-model migration (spec: Migration, Testing). Seeds today's
// shape with raw SQL — including the awkward rows a real install has — then
// checks nothing is lost, and that down() round-trips or refuses.

const qi = () => sequelize.getQueryInterface();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
const run = (sql, replacements) => sequelize.query(sql, { replacements });
const one = async (sql, r) => (await q(sql, r))[0];

let w;
let ticket;
let project;
let statuses; // project statuses by name
beforeAll(async () => {
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id });
  project = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  statuses = Object.fromEntries((await q('SELECT id, name FROM ProjectStatuses')).map((s) => [s.name, s.id]));
});
afterAll(async () => {
  // Leave the schema migrated and empty for later suites.
  const names = (await qi().showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!names.includes('legacy_TimeEntries')) await migration.up(qi(), Sequelize);
  await resetData();
  await closeDb();
});

// Today's shape, written straight into the old tables (down() puts them back).
async function seedLegacy() {
  const u = w.admin.user.id;
  await run(`INSERT INTO ProjectTasks (id, projectId, taskCode, title, description, statusId, priority, assignedToUserId, dueDate, linkedTicketId, position, completedAt, createdBy, createdAt, updatedAt) VALUES
    (1, :p, 'SD-P00001-T01', 'Rack', 'Two racks', :active, 'high', :u, '2026-04-01', :t, 1, NULL, :u, '2026-03-01 10:00:00', '2026-03-01 10:00:00'),
    (2, :p, NULL, 'Uncoded', NULL, :completed, 'medium', NULL, NULL, NULL, 2, '2026-03-02 10:00:00', :u, '2026-03-01 11:00:00', '2026-03-02 10:00:00')`,
  { p: project.id, active: statuses.Active, completed: statuses.Completed, u, t: ticket.id });
  await run(`INSERT INTO ProjectSubtasks (id, taskId, subtaskCode, title, statusId, assignedToUserId, dueDate, completedAt, position, createdAt, updatedAt) VALUES
    (1, 1, 'SD-P00001-T01-S01', 'Cable', :completed, :u, NULL, '2026-03-03 10:00:00', 1, '2026-03-01 12:00:00', '2026-03-03 10:00:00'),
    (2, 1, 'SD-P00001-T01-S02', 'Label', :active, NULL, '2026-04-02', NULL, 2, '2026-03-01 12:00:01', '2026-03-01 12:00:01'),
    (3, 999, 'GONE-T01-S01', 'Orphan', :active, NULL, NULL, NULL, 1, '2026-03-01 12:00:02', '2026-03-01 12:00:02')`,
  { active: statuses.Active, completed: statuses.Completed, u });
  // Two checklist items on the ticket, one done; 101 on a deleted ticket with a 6-digit id.
  await run(`INSERT INTO TicketTasks (id, ticketId, description, completed, assigneeId, createdAt, updatedAt) VALUES
    (1, :t, 'Swap toner', 0, :u, '2026-03-01 09:00:00', '2026-03-01 09:00:00'),
    (2, :t, 'Test print', 1, NULL, '2026-03-01 09:00:00', '2026-03-05 09:00:00')`, { t: ticket.id, u });
  // Rows that point at a deleted ticket need the old foreign keys off — on one
  // connection, so inside a transaction.
  const many = Array.from({ length: 101 }, (_, i) => `(${10 + i}, 123456, 'Item ${i + 1}', 0, NULL, '2026-03-01 09:00:00', '2026-03-01 09:00:00')`);
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    await sequelize.query(`INSERT INTO TicketTasks (id, ticketId, description, completed, assigneeId, createdAt, updatedAt) VALUES ${many.join(', ')}`, { transaction });
    // Ticket time: a span, a plain-minutes entry with no durationSeconds, and time on a deleted ticket.
    await sequelize.query(`INSERT INTO TimeEntries (id, ticketId, userId, loggedById, minutes, note, loggedAt, entryDate, startTime, endTime, durationSeconds, laborCost) VALUES
      (1, :t, :u, :u, 91, 'span', '2026-03-05 16:00:00', '2026-03-05', '2026-03-05 15:00:00', '2026-03-05 16:30:30', 5430, 113.13),
      (2, :t, :u, NULL, 45, 'timer', '2026-03-06 09:00:00', '2026-03-06', NULL, NULL, NULL, NULL),
      (3, 777777, :u, :u, 10, 'orphan ticket', '2026-03-06 10:00:00', '2026-03-06', NULL, NULL, 600, NULL)`,
    { replacements: { t: ticket.id, u }, transaction });
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
  });
  // Project time: logged by the admin for themselves, and on a task.
  await run(`INSERT INTO ProjectTimeEntries (id, projectId, taskId, userId, loggedForUserId, description, startTime, endTime, durationSeconds, entryDate, createdAt, laborCost) VALUES
    (1, :p, 1, :u, :u, 'racking', '2026-03-10 13:00:00', '2026-03-10 15:00:00', 7200, '2026-03-10', '2026-03-10 15:00:00', NULL),
    (2, :p, NULL, :u, NULL, 'old row', '2026-03-10 16:00:00', '2026-03-10 16:30:00', NULL, '2026-03-10', '2026-03-10 16:30:00', 37.5)`,
  { p: project.id, u });
  await run(`INSERT INTO ProjectActivities (projectId, userId, action, detail, createdAt) VALUES
    (:p, :u, 'subtask_closed', '{"subtaskId":1,"title":"Cable","subtaskCode":"SD-P00001-T01-S01"}', NOW())`, { p: project.id, u });
  await run('INSERT INTO ActiveTimers (userId, entityType, entityId, label, startedAt) VALUES (:u, \'ticket\', :t, \'Working\', NOW())', { u, t: ticket.id });
}

const totals = async () => ({
  ticketSeconds: Number((await one('SELECT COALESCE(SUM(durationSeconds),0) AS s FROM TimeEntries WHERE ticketId = :t', { t: ticket.id })).s),
  projectSeconds: Number((await one('SELECT COALESCE(SUM(durationSeconds),0) AS s FROM TimeEntries WHERE projectId = :p', { p: project.id })).s),
  labour: Math.round(Number((await one('SELECT COALESCE(SUM(laborCost),0) AS s FROM TimeEntries')).s) * 100) / 100,
});

describe('the one-work-model migration', () => {
  it('copies tasks, subtasks, checklist items and time without loss', async () => {
    await migration.down(qi(), Sequelize);
    await seedLegacy();
    await migration.up(qi(), Sequelize);

    // Time: every second and every cent arrives; who it's for is fixed (Q4).
    expect(await totals()).toEqual({ ticketSeconds: 5430 + 2700, projectSeconds: 7200 + 1800, labour: 150.63 });
    expect(await one('SELECT id, loggedById, durationSeconds FROM TimeEntries WHERE id = 2')).toEqual({ id: 2, loggedById: null, durationSeconds: 2700 });
    expect(Number((await one('SELECT COUNT(*) AS n FROM TimeEntries WHERE ticketId = 777777')).n)).toBe(1);
    const projectTime = await q('SELECT e.id, e.userId, e.loggedById, e.note, w.name AS workType FROM TimeEntries e JOIN WorkTypes w ON w.id = e.workTypeId WHERE e.projectId = :p ORDER BY e.id', { p: project.id });
    expect(projectTime.map((e) => [e.note, e.workType])).toEqual([['racking', 'Project work'], ['old row', 'Project work']]);
    expect(projectTime.every((e) => e.id > 3)).toBe(true); // above every ticket time id
    expect(await q('SELECT oldTable, oldId, newId FROM TimeEntryIdMap ORDER BY oldId')).toEqual([
      { oldTable: 'ProjectTimeEntries', oldId: 1, newId: projectTime[0].id },
      { oldTable: 'ProjectTimeEntries', oldId: 2, newId: projectTime[1].id },
    ]);

    // Project tasks keep their ids, statuses and codes; a missing code is generated.
    const tasks = await q('SELECT id, code, title, statusId, priority, assigneeId, dueDate, position, linkedTicketId FROM Tasks WHERE projectId = :p AND parentTaskId IS NULL ORDER BY id', { p: project.id });
    expect(tasks.map((t) => [t.id, t.code, t.statusId, t.priority])).toEqual([
      [1, 'SD-P00001-T01', statuses.Active, 'high'], [2, 'SD-P00001-T02', statuses.Completed, 'medium'],
    ]);
    expect(tasks[0].linkedTicketId).toBe(ticket.id);
    // The project-scope task statuses are the project statuses, ids and all.
    const scope = await q("SELECT id, name, behaviorType FROM TaskStatuses WHERE scope = 'project' ORDER BY id");
    const projectStatuses = await q('SELECT id, name, behaviorType FROM ProjectStatuses ORDER BY id');
    expect(scope).toEqual(projectStatuses);

    // Subtasks become tasks under their task; the orphan stays behind.
    const subs = await q('SELECT t.id, t.code, t.title, t.parentTaskId, m.oldId FROM Tasks t JOIN TaskIdMap m ON m.newId = t.id AND m.oldTable = \'ProjectSubtasks\' ORDER BY m.oldId');
    expect(subs.map((s) => [s.oldId, s.code, s.parentTaskId])).toEqual([[1, 'SD-P00001-T01-S01', 1], [2, 'SD-P00001-T01-S02', 1]]);
    expect(Number((await one("SELECT COUNT(*) AS n FROM Tasks WHERE title = 'Orphan'")).n)).toBe(0);
    expect(Number((await one('SELECT COUNT(*) AS n FROM legacy_ProjectSubtasks')).n)).toBe(3);

    // Checklist items: To do / Done, numbered per ticket, even past 99 and past ticket 99999.
    const items = await q(`SELECT t.code, t.title, s.name AS status, t.completedAt FROM Tasks t JOIN TaskStatuses s ON s.id = t.statusId
      WHERE t.ticketId = :t ORDER BY t.position`, { t: ticket.id });
    const pad = String(ticket.id).padStart(5, '0');
    expect(items.map((i) => [i.code, i.title, i.status])).toEqual([
      [`#${pad}-T01`, 'Swap toner', 'To do'], [`#${pad}-T02`, 'Test print', 'Done'],
    ]);
    expect(items[1].completedAt).not.toBeNull();
    const big = await q("SELECT code FROM Tasks WHERE ticketId = 123456 ORDER BY position DESC LIMIT 2");
    expect(big.map((b) => b.code)).toEqual(['#123456-T101', '#123456-T100']);

    // Activity naming a subtask, and timers, point at the new ids.
    const [act] = await q("SELECT detail FROM ProjectActivities WHERE action = 'subtask_closed'");
    expect(JSON.parse(act.detail).subtaskId).toBe(subs[0].id);
    expect(await one('SELECT entityType, entityId, taskId FROM ActiveTimers')).toEqual({ entityType: 'ticket', entityId: ticket.id, taskId: null });
  });

  it('grants the time permissions to the roles that could log time', async () => {
    const holders = async (key) => (await q(`SELECT r.name FROM Roles r JOIN RolePermissions rp ON rp.roleId = r.id JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` = :key AND rp.granted = 1 ORDER BY r.name`, { key })).map((r) => r.name);
    const logTime = await holders('projects.log_time');
    for (const name of logTime) expect(await holders('time.log')).toContain(name);
    expect(await holders('time.log')).not.toContain('Read Only');
    expect(await holders('time.manage_others')).toEqual(['Department Manager', 'System Administrator']);
  });

  it('round-trips through down() while nothing new exists', async () => {
    const before = await totals();
    await migration.down(qi(), Sequelize);
    expect(Number((await one('SELECT COUNT(*) AS n FROM TicketTasks WHERE ticketId = :t', { t: ticket.id })).n)).toBe(2);
    expect(await q('SELECT id, taskCode FROM ProjectTasks ORDER BY id')).toEqual([
      { id: 1, taskCode: 'SD-P00001-T01' }, { id: 2, taskCode: 'SD-P00001-T02' },
    ]);
    expect((await q('SELECT id, subtaskCode FROM ProjectSubtasks ORDER BY id')).map((s) => s.id)).toEqual([1, 2]);
    expect(await q('SELECT id, loggedForUserId FROM ProjectTimeEntries ORDER BY id')).toEqual([
      { id: 1, loggedForUserId: w.admin.user.id }, { id: 2, loggedForUserId: w.admin.user.id },
    ]);
    const [act] = await q("SELECT detail FROM ProjectActivities WHERE action = 'subtask_closed'");
    expect(JSON.parse(act.detail).subtaskId).toBe(1);
    await migration.up(qi(), Sequelize);
    expect(await totals()).toEqual(before);
  });

  it('refuses to roll back once something the old tables can\'t hold exists', async () => {
    const [todo] = await q("SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND name = 'To do'");
    const [parentTask] = await q('SELECT id FROM Tasks WHERE ticketId = :t ORDER BY id LIMIT 1', { t: ticket.id });
    await run(`INSERT INTO Tasks (ticketId, parentTaskId, code, title, statusId, priority, position, createdAt, updatedAt)
      VALUES (:t, :parent, 'X-SUB', 'Sub', :todo, 'medium', 1, NOW(), NOW())`, { t: ticket.id, parent: parentTask.id, todo: todo.id });
    await expect(migration.down(qi(), Sequelize)).rejects.toThrow(/ticket tasks with subtasks/);
    expect((await qi().describeTable('Tasks')).id).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/workmodel.migration.test.js`
Expected: FAIL with "Cannot find module '../../migrations/20260101000050-one-work-model'".

- [ ] **Step 3: Write the migration**

`backend/migrations/20260101000050-one-work-model.js`:

```js
'use strict';

// One work model (sub-project 3, plan 3b). Ticket checklist items, project
// tasks and project subtasks become one Tasks table; ticket time and project
// time become one TimeEntries ledger. The old tables are renamed legacy_* and
// kept, unread, for one release; the next release drops them.
// Ids: project tasks and ticket time keep theirs; project subtasks, ticket
// tasks and project time get new ones (old id + an offset), recorded in
// TaskIdMap / TimeEntryIdMap. Conventions: no DB-level FKs, idempotent
// guards, a down() that refuses rather than lose data.
// See docs/superpowers/specs/2026-10-05-one-work-model-design.md.

const RENAMES = [
  ['TimeEntries', 'legacy_TimeEntries'],
  ['ProjectTimeEntries', 'legacy_ProjectTimeEntries'],
  ['TicketTasks', 'legacy_TicketTasks'],
  ['ProjectTasks', 'legacy_ProjectTasks'],
  ['ProjectSubtasks', 'legacy_ProjectSubtasks'],
];
const NEW_TABLES = ['Tasks', 'TimeEntries', 'TaskStatuses', 'WorkTypes', 'TaskIdMap', 'TimeEntryIdMap'];
const TICKET_TASK_STATUSES = [
  { name: 'To do', color: '#64748b', behaviorType: 'open', position: 0, isDefault: true, isProtected: false },
  { name: 'In progress', color: '#2563eb', behaviorType: 'open', position: 1, isDefault: false, isProtected: false },
  { name: 'Done', color: '#16a34a', behaviorType: 'closed', position: 2, isDefault: false, isProtected: true },
];
const WORK_TYPES = [
  { name: 'Remote support', billableDefault: true, position: 0 },
  { name: 'On-site', billableDefault: true, position: 1 },
  { name: 'Travel', billableDefault: true, position: 2 },
  { name: 'Project work', billableDefault: true, position: 3 },
  { name: 'Admin', billableDefault: false, position: 4 },
];
const PERMISSIONS = [
  { key: 'time.log', category: 'time', label: 'Log time', description: 'Log your own time on tickets and projects you can edit' },
  {
    key: 'time.manage_others', category: 'time', label: "Manage others' time",
    description: 'Log, edit and delete time for other people you can see',
  },
];
const LOG_TIME_SOURCES = ['projects.log_time', 'tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all'];
const MANAGE_OTHERS_ROLES = ['System Administrator', 'Department Manager'];
const TASK_COLUMNS = 'id, ticketId, projectId, parentTaskId, code, title, description, statusId, priority, assigneeId, dueDate, estimateMinutes, position, completedAt, linkedTicketId, createdBy, createdAt, updatedAt';
const TIME_COLUMNS = 'id, ticketId, projectId, taskId, userId, loggedById, entryDate, startTime, endTime, durationSeconds, billable, workTypeId, note, laborCost, createdAt, updatedAt';

// Rows the old tables can't hold; down() refuses while any exist.
const MISFITS = [
  ['ticket tasks with subtasks', 'SELECT COUNT(*) AS n FROM Tasks WHERE ticketId IS NOT NULL AND parentTaskId IS NOT NULL'],
  ['ticket tasks with a description, due date, estimate, priority or linked ticket',
    "SELECT COUNT(*) AS n FROM Tasks WHERE ticketId IS NOT NULL AND (description IS NOT NULL OR dueDate IS NOT NULL OR estimateMinutes IS NOT NULL OR priority <> 'medium' OR linkedTicketId IS NOT NULL)"],
  ['ticket tasks in a status other than the first open or first closed one',
    `SELECT COUNT(*) AS n FROM Tasks t WHERE t.ticketId IS NOT NULL AND t.statusId NOT IN (
       (SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND behaviorType = 'open' ORDER BY position, id LIMIT 1),
       (SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND behaviorType = 'closed' ORDER BY position, id LIMIT 1))`],
  ['project tasks with an estimate', 'SELECT COUNT(*) AS n FROM Tasks WHERE projectId IS NOT NULL AND estimateMinutes IS NOT NULL'],
  ['project subtasks with a description, priority or linked ticket',
    "SELECT COUNT(*) AS n FROM Tasks WHERE projectId IS NOT NULL AND parentTaskId IS NOT NULL AND (description IS NOT NULL OR priority <> 'medium' OR linkedTicketId IS NOT NULL)"],
  ['project tasks in a status the project list doesn\'t have',
    'SELECT COUNT(*) AS n FROM Tasks t WHERE t.projectId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ProjectStatuses p WHERE p.id = t.statusId)'],
  ['time on a ticket task', 'SELECT COUNT(*) AS n FROM TimeEntries WHERE ticketId IS NOT NULL AND taskId IS NOT NULL'],
  ['project time on a subtask',
    'SELECT COUNT(*) AS n FROM TimeEntries e JOIN Tasks t ON t.id = e.taskId WHERE e.projectId IS NOT NULL AND t.parentTaskId IS NOT NULL'],
  ['time that is not billable or has a non-default work type',
    `SELECT COUNT(*) AS n FROM TimeEntries e JOIN WorkTypes w ON w.id = e.workTypeId WHERE e.billable = 0
       OR (e.ticketId IS NOT NULL AND w.name <> 'Remote support') OR (e.projectId IS NOT NULL AND w.name <> 'Project work')`],
  ['expenses, materials or files on a subtask',
    `SELECT (SELECT COUNT(*) FROM ProjectExpenses x JOIN Tasks t ON t.id = x.taskId WHERE t.parentTaskId IS NOT NULL)
       + (SELECT COUNT(*) FROM ProjectMaterials x JOIN Tasks t ON t.id = x.taskId WHERE t.parentTaskId IS NOT NULL)
       + (SELECT COUNT(*) FROM ProjectFiles x JOIN Tasks t ON t.id = x.taskId WHERE t.parentTaskId IS NOT NULL) AS n`],
  ['timers on a task or a project', "SELECT COUNT(*) AS n FROM ActiveTimers WHERE taskId IS NOT NULL OR entityType = 'project'"],
];

async function tableNames(queryInterface) {
  return (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt, QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const run = (sql, replacements, transaction) => db.query(sql, { replacements, transaction });
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const one = async (sql, replacements, transaction) => (await select(sql, replacements, transaction))[0];
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    // 1. Rename the old tables out of the way.
    let tables = await tableNames(queryInterface);
    for (const [from, to] of RENAMES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(from) && !tables.includes(to)) await queryInterface.renameTable(from, to);
    }
    tables = await tableNames(queryInterface);

    // 2. Create the new tables.
    if (!tables.includes('TaskStatuses')) {
      await queryInterface.createTable('TaskStatuses', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        scope: { type: dt.ENUM('ticket', 'project'), allowNull: false },
        name: { type: dt.STRING(100), allowNull: false },
        color: { type: dt.STRING(9), allowNull: false, defaultValue: '#3b82f6' },
        behaviorType: { type: dt.ENUM('open', 'closed', 'archived'), allowNull: false, defaultValue: 'open' },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        isDefault: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        isProtected: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: now,
      });
      await queryInterface.addIndex('TaskStatuses', ['scope', 'position'], { name: 'task_statuses_scope_position' });
    }
    if (!tables.includes('WorkTypes')) {
      await queryInterface.createTable('WorkTypes', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(100), allowNull: false, unique: true },
        billableDefault: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!tables.includes('Tasks')) {
      await queryInterface.createTable('Tasks', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: { type: dt.INTEGER, allowNull: true },
        projectId: { type: dt.INTEGER, allowNull: true },
        parentTaskId: { type: dt.INTEGER, allowNull: true },
        code: { type: dt.STRING(60), allowNull: true, unique: true },
        title: { type: dt.STRING(500), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        statusId: { type: dt.INTEGER, allowNull: false },
        priority: { type: dt.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
        assigneeId: { type: dt.INTEGER, allowNull: true },
        dueDate: { type: dt.DATEONLY, allowNull: true },
        estimateMinutes: { type: dt.INTEGER, allowNull: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        completedAt: { type: dt.DATE, allowNull: true },
        linkedTicketId: { type: dt.INTEGER, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      for (const col of ['ticketId', 'projectId', 'parentTaskId', 'assigneeId', 'linkedTicketId']) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex('Tasks', [col], { name: `tasks_${col}` });
      }
      await run('ALTER TABLE `Tasks` ADD CONSTRAINT `tasks_one_parent` CHECK ((`ticketId` IS NULL) <> (`projectId` IS NULL))');
    }
    if (!tables.includes('TimeEntries')) {
      await queryInterface.createTable('TimeEntries', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: { type: dt.INTEGER, allowNull: true },
        projectId: { type: dt.INTEGER, allowNull: true },
        taskId: { type: dt.INTEGER, allowNull: true },
        userId: { type: dt.INTEGER, allowNull: false },
        loggedById: { type: dt.INTEGER, allowNull: true },
        entryDate: { type: dt.DATEONLY, allowNull: false },
        startTime: { type: dt.DATE, allowNull: true },
        endTime: { type: dt.DATE, allowNull: true },
        durationSeconds: { type: dt.INTEGER, allowNull: false },
        billable: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        workTypeId: { type: dt.INTEGER, allowNull: false },
        note: { type: dt.TEXT, allowNull: true },
        laborCost: { type: dt.DECIMAL(10, 2), allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      for (const cols of [['ticketId'], ['projectId'], ['taskId'], ['userId', 'entryDate'], ['entryDate']]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex('TimeEntries', cols, { name: `ledger_${cols.join('_')}` });
      }
      await run('ALTER TABLE `TimeEntries` ADD CONSTRAINT `ledger_one_parent` CHECK ((`ticketId` IS NULL) <> (`projectId` IS NULL))');
    }
    for (const map of ['TaskIdMap', 'TimeEntryIdMap']) {
      if (!tables.includes(map)) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.createTable(map, {
          oldTable: { type: dt.STRING(40), allowNull: false, primaryKey: true },
          oldId: { type: dt.INTEGER, allowNull: false, primaryKey: true },
          newId: { type: dt.INTEGER, allowNull: false },
        });
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addIndex(map, ['newId'], { name: `${map}_new_id` });
      }
    }
    if (!(await queryInterface.describeTable('ActiveTimers')).taskId) {
      await queryInterface.addColumn('ActiveTimers', 'taskId', { type: dt.INTEGER, allowNull: true });
    }

    // 3. Seed the task statuses and work types.
    if (Number((await one('SELECT COUNT(*) AS n FROM TaskStatuses')).n) === 0) {
      // The project scope is today's project statuses, ids and all, so every
      // project task keeps its statusId. The ticket scope is numbered after.
      await run(`INSERT INTO TaskStatuses (id, scope, name, color, behaviorType, position, isDefault, isProtected, createdAt)
        SELECT id, 'project', name, color, behaviorType, position, isDefault, isProtected, createdAt FROM ProjectStatuses`);
      await queryInterface.bulkInsert('TaskStatuses', TICKET_TASK_STATUSES.map((s) => ({ ...s, scope: 'ticket', createdAt: new Date() })));
    }
    if (Number((await one('SELECT COUNT(*) AS n FROM WorkTypes')).n) === 0) {
      await queryInterface.bulkInsert('WorkTypes', WORK_TYPES.map((t) => ({ ...t, isActive: true, createdAt: new Date(), updatedAt: new Date() })));
    }

    // 4. Copy the data, once, in one transaction.
    const started = Number((await one(`SELECT (SELECT COUNT(*) FROM Tasks) + (SELECT COUNT(*) FROM TimeEntries)
      + (SELECT COUNT(*) FROM TaskIdMap) + (SELECT COUNT(*) FROM TimeEntryIdMap) AS n`)).n);
    if (started > 0) return;

    await db.transaction(async (transaction) => {
      const t = transaction;
      const id = async (sql, r) => Number((await one(sql, r, t)).id);
      const max = async (table) => Number((await one(`SELECT COALESCE(MAX(id), 0) AS m FROM \`${table}\``, {}, t)).m);
      const todoId = await id("SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND name = 'To do'");
      const doneId = await id("SELECT id FROM TaskStatuses WHERE scope = 'ticket' AND name = 'Done'");
      const remoteId = await id("SELECT id FROM WorkTypes WHERE name = 'Remote support'");
      const projectWorkId = await id("SELECT id FROM WorkTypes WHERE name = 'Project work'");
      const subOffset = await max('legacy_ProjectTasks');
      const ticketTaskOffset = subOffset + (await max('legacy_ProjectSubtasks'));
      const projectTimeOffset = await max('legacy_TimeEntries');

      // Project tasks keep their ids, codes and statuses.
      await run(`INSERT INTO Tasks (${TASK_COLUMNS})
        SELECT id, NULL, projectId, NULL, taskCode, title, description, statusId, priority, assignedToUserId, dueDate, NULL,
          position, completedAt, linkedTicketId, createdBy, createdAt, updatedAt
        FROM legacy_ProjectTasks`, {}, t);

      // Subtasks become tasks under their task. A subtask whose task is gone
      // was already invisible; it stays only in the legacy table.
      await run(`INSERT INTO TaskIdMap (oldTable, oldId, newId)
        SELECT 'ProjectSubtasks', s.id, s.id + :subOffset FROM legacy_ProjectSubtasks s JOIN legacy_ProjectTasks p ON p.id = s.taskId`,
      { subOffset }, t);
      await run(`INSERT INTO Tasks (${TASK_COLUMNS})
        SELECT s.id + :subOffset, NULL, p.projectId, p.id, s.subtaskCode, s.title, NULL, s.statusId, 'medium', s.assignedToUserId, s.dueDate,
          NULL, s.position, s.completedAt, NULL, NULL, s.createdAt, s.updatedAt
        FROM legacy_ProjectSubtasks s JOIN legacy_ProjectTasks p ON p.id = s.taskId`, { subOffset }, t);

      // Checklist items become ticket tasks: To do or Done, numbered per
      // ticket in creation order. LPAD truncates, so long numbers are written whole.
      await run(`INSERT INTO TaskIdMap (oldTable, oldId, newId)
        SELECT 'TicketTasks', id, id + :ticketTaskOffset FROM legacy_TicketTasks`, { ticketTaskOffset }, t);
      await run(`INSERT INTO Tasks (${TASK_COLUMNS})
        SELECT x.id + :ticketTaskOffset, x.ticketId, NULL, NULL,
          CONCAT('#', IF(x.ticketId < 100000, LPAD(x.ticketId, 5, '0'), x.ticketId), '-T', IF(x.rn < 100, LPAD(x.rn, 2, '0'), x.rn)),
          x.description, NULL, IF(x.completed, :doneId, :todoId), 'medium', x.assigneeId, NULL, NULL, x.rn,
          IF(x.completed, x.updatedAt, NULL), NULL, NULL, x.createdAt, x.updatedAt
        FROM (SELECT tt.*, ROW_NUMBER() OVER (PARTITION BY tt.ticketId ORDER BY tt.createdAt, tt.id) AS rn FROM legacy_TicketTasks tt) x`,
      { ticketTaskOffset, doneId, todoId }, t);

      // Project tasks and subtasks that never got a code get the next free one.
      const uncoded = await select(`SELECT k.id, k.projectId, k.parentTaskId, p.projectCode, parent.code AS parentCode
        FROM Tasks k JOIN Projects p ON p.id = k.projectId LEFT JOIN Tasks parent ON parent.id = k.parentTaskId
        WHERE k.code IS NULL ORDER BY k.parentTaskId IS NOT NULL, k.position, k.id`, {}, t);
      for (const task of uncoded) {
        const prefix = task.parentTaskId ? `${task.parentCode}-S` : `${task.projectCode}-T`;
        // eslint-disable-next-line no-await-in-loop
        const used = await select('SELECT code FROM Tasks WHERE code LIKE :like', { like: `${prefix.replace(/[\\%_]/g, '\\$&')}%` }, t);
        const next = used.reduce((m, r) => Math.max(m, parseInt(r.code.slice(prefix.length), 10) || 0), 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await run('UPDATE Tasks SET code = :code WHERE id = :id', { code: `${prefix}${String(next).padStart(2, '0')}`, id: task.id }, t);
      }

      // Ticket time keeps its ids. Who it's for and who logged it come from
      // each old table's own meaning (Q4).
      await run(`INSERT INTO TimeEntries (${TIME_COLUMNS})
        SELECT id, ticketId, NULL, NULL, userId, loggedById, entryDate, startTime, endTime, COALESCE(durationSeconds, minutes * 60),
          1, :remoteId, note, laborCost, loggedAt, loggedAt
        FROM legacy_TimeEntries`, { remoteId }, t);
      await run(`INSERT INTO TimeEntryIdMap (oldTable, oldId, newId)
        SELECT 'ProjectTimeEntries', id, id + :projectTimeOffset FROM legacy_ProjectTimeEntries`, { projectTimeOffset }, t);
      await run(`INSERT INTO TimeEntries (${TIME_COLUMNS})
        SELECT id + :projectTimeOffset, NULL, projectId, taskId, COALESCE(loggedForUserId, userId), userId, entryDate, startTime, endTime,
          COALESCE(durationSeconds, TIMESTAMPDIFF(SECOND, startTime, endTime), 0), 1, :projectWorkId, description, laborCost, createdAt, createdAt
        FROM legacy_ProjectTimeEntries`, { projectTimeOffset, projectWorkId }, t);

      // Activity rows that name a subtask point at its new id.
      await run(`UPDATE ProjectActivities a JOIN TaskIdMap m
          ON m.oldTable = 'ProjectSubtasks' AND m.oldId = CAST(JSON_VALUE(a.detail, '$.subtaskId') AS INTEGER)
        SET a.detail = JSON_SET(a.detail, '$.subtaskId', m.newId)
        WHERE a.action LIKE 'subtask%' AND JSON_VALUE(a.detail, '$.subtaskId') IS NOT NULL`, {}, t);

      // 5. Permissions (same pattern as the client-companies migration).
      const keys = PERMISSIONS.map((p) => p.key);
      const existing = new Set((await select('SELECT `key` FROM Permissions WHERE `key` IN (:keys)', { keys }, t)).map((r) => r.key));
      const fresh = PERMISSIONS.filter((p) => !existing.has(p.key)).map((p) => ({ ...p, createdAt: new Date() }));
      if (fresh.length) await queryInterface.bulkInsert('Permissions', fresh, { transaction: t });
      const logId = await id("SELECT id FROM Permissions WHERE `key` = 'time.log'");
      const manageId = await id("SELECT id FROM Permissions WHERE `key` = 'time.manage_others'");
      await run(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT DISTINCT rp.roleId, :logId, 1 FROM RolePermissions rp JOIN Permissions p ON p.id = rp.permissionId
        WHERE rp.granted = 1 AND p.\`key\` IN (:sources)
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = rp.roleId AND x.permissionId = :logId)`,
      { logId, sources: LOG_TIME_SOURCES }, t);
      await run(`INSERT INTO RolePermissions (roleId, permissionId, granted)
        SELECT r.id, :manageId, 1 FROM Roles r WHERE r.name IN (:names)
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :manageId)`,
      { manageId, names: MANAGE_OTHERS_ROLES }, t);

      // Per-user overrides carry across: a projects.log_time override decides;
      // otherwise a granted ticket-edit override grants time.log.
      const overrides = await select(`SELECT userId, permissionKey, granted, reason, expiresAt, grantedBy FROM UserPermissionOverrides
        WHERE permissionKey IN (:sources)`, { sources: LOG_TIME_SOURCES }, t);
      const already = new Set((await select("SELECT userId FROM UserPermissionOverrides WHERE permissionKey = 'time.log'", {}, t)).map((r) => r.userId));
      const decided = new Map();
      for (const o of overrides) {
        if (already.has(o.userId)) continue; // eslint-disable-line no-continue
        if (o.permissionKey === 'projects.log_time') decided.set(o.userId, { ...o, fromLogTime: true });
        else if (o.granted && !decided.get(o.userId)?.fromLogTime) decided.set(o.userId, { ...o, fromLogTime: false });
      }
      if (decided.size) {
        await queryInterface.bulkInsert('UserPermissionOverrides', [...decided.values()].map((o) => ({
          userId: o.userId, permissionKey: 'time.log', granted: !!o.granted, reason: o.reason, expiresAt: o.expiresAt,
          grantedBy: o.grantedBy, createdAt: new Date(),
        })), { transaction: t });
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;
    const db = queryInterface.sequelize;
    const run = (sql, replacements, transaction) => db.query(sql, { replacements, transaction });
    const select = (sql, replacements, transaction) => db.query(sql, { type: QueryTypes.SELECT, replacements, transaction });
    const tables = await tableNames(queryInterface);
    if (!tables.includes('Tasks')) return;

    // Refuse rather than drop anything the old tables can't hold.
    const found = [];
    for (const [label, sql] of MISFITS) {
      // eslint-disable-next-line no-await-in-loop
      const [{ n }] = await select(sql);
      if (Number(n) > 0) found.push(`${n} ${label}`);
    }
    if (found.length) {
      throw new Error(`The old task and time tables can't hold: ${found.join('; ')}. Refusing to roll back and lose them.`);
    }

    // Rebuild the old tables from the new ones, so work done since the
    // upgrade survives. Mapped rows take back their old ids; rows created
    // since get fresh ones (inserted second, so they can't collide).
    await db.transaction(async (t) => {
      await run('SET FOREIGN_KEY_CHECKS = 0', {}, t);
      for (const [, legacy] of RENAMES) await run(`DELETE FROM \`${legacy}\``, {}, t); // eslint-disable-line no-await-in-loop
      await run(`INSERT INTO legacy_ProjectTasks (id, projectId, taskCode, title, description, statusId, priority, assignedToUserId, dueDate,
          linkedTicketId, position, completedAt, createdBy, createdAt, updatedAt)
        SELECT id, projectId, code, title, description, statusId, priority, assigneeId, dueDate, linkedTicketId, position, completedAt,
          createdBy, createdAt, updatedAt
        FROM Tasks WHERE projectId IS NOT NULL AND parentTaskId IS NULL`, {}, t);
      const subtaskCols = 'taskId, subtaskCode, title, statusId, assignedToUserId, dueDate, completedAt, position, createdAt, updatedAt';
      const subtaskVals = 'k.parentTaskId, k.code, k.title, k.statusId, k.assigneeId, k.dueDate, k.completedAt, k.position, k.createdAt, k.updatedAt';
      await run(`INSERT INTO legacy_ProjectSubtasks (id, ${subtaskCols}) SELECT m.oldId, ${subtaskVals}
        FROM Tasks k JOIN TaskIdMap m ON m.oldTable = 'ProjectSubtasks' AND m.newId = k.id
        WHERE k.projectId IS NOT NULL AND k.parentTaskId IS NOT NULL`, {}, t);
      await run(`INSERT INTO legacy_ProjectSubtasks (${subtaskCols}) SELECT ${subtaskVals} FROM Tasks k
        WHERE k.projectId IS NOT NULL AND k.parentTaskId IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM TaskIdMap m WHERE m.oldTable = 'ProjectSubtasks' AND m.newId = k.id)`, {}, t);
      const checklistVals = "k.ticketId, k.title, s.behaviorType = 'closed', k.assigneeId, k.createdAt, k.updatedAt";
      await run(`INSERT INTO legacy_TicketTasks (id, ticketId, description, completed, assigneeId, createdAt, updatedAt)
        SELECT m.oldId, ${checklistVals} FROM Tasks k JOIN TaskStatuses s ON s.id = k.statusId
          JOIN TaskIdMap m ON m.oldTable = 'TicketTasks' AND m.newId = k.id
        WHERE k.ticketId IS NOT NULL`, {}, t);
      await run(`INSERT INTO legacy_TicketTasks (ticketId, description, completed, assigneeId, createdAt, updatedAt)
        SELECT ${checklistVals} FROM Tasks k JOIN TaskStatuses s ON s.id = k.statusId
        WHERE k.ticketId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM TaskIdMap m WHERE m.oldTable = 'TicketTasks' AND m.newId = k.id)`, {}, t);
      await run(`INSERT INTO legacy_TimeEntries (id, ticketId, userId, loggedById, minutes, note, loggedAt, entryDate, startTime, endTime,
          durationSeconds, laborCost)
        SELECT id, ticketId, userId, loggedById, GREATEST(1, ROUND(durationSeconds / 60)), note, createdAt, entryDate, startTime, endTime,
          durationSeconds, laborCost
        FROM TimeEntries WHERE ticketId IS NOT NULL`, {}, t);
      const projectTimeCols = 'projectId, taskId, userId, loggedForUserId, description, startTime, endTime, durationSeconds, entryDate, createdAt, laborCost';
      const projectTimeVals = 'e.projectId, e.taskId, COALESCE(e.loggedById, e.userId), e.userId, e.note, e.startTime, e.endTime, e.durationSeconds, e.entryDate, e.createdAt, e.laborCost';
      await run(`INSERT INTO legacy_ProjectTimeEntries (id, ${projectTimeCols}) SELECT m.oldId, ${projectTimeVals}
        FROM TimeEntries e JOIN TimeEntryIdMap m ON m.oldTable = 'ProjectTimeEntries' AND m.newId = e.id WHERE e.projectId IS NOT NULL`, {}, t);
      await run(`INSERT INTO legacy_ProjectTimeEntries (${projectTimeCols}) SELECT ${projectTimeVals} FROM TimeEntries e
        WHERE e.projectId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM TimeEntryIdMap m WHERE m.oldTable = 'ProjectTimeEntries' AND m.newId = e.id)`, {}, t);
      await run(`UPDATE ProjectActivities a JOIN TaskIdMap m
          ON m.oldTable = 'ProjectSubtasks' AND m.newId = CAST(JSON_VALUE(a.detail, '$.subtaskId') AS INTEGER)
        SET a.detail = JSON_SET(a.detail, '$.subtaskId', m.oldId)
        WHERE a.action LIKE 'subtask%' AND JSON_VALUE(a.detail, '$.subtaskId') IS NOT NULL`, {}, t);
      const perms = await select("SELECT id FROM Permissions WHERE `key` IN ('time.log', 'time.manage_others')", {}, t);
      if (perms.length) {
        await run('DELETE FROM RolePermissions WHERE permissionId IN (:ids)', { ids: perms.map((p) => p.id) }, t);
        await run('DELETE FROM Permissions WHERE id IN (:ids)', { ids: perms.map((p) => p.id) }, t);
      }
      await run("DELETE FROM UserPermissionOverrides WHERE permissionKey IN ('time.log', 'time.manage_others')", {}, t);
      await run('SET FOREIGN_KEY_CHECKS = 1', {}, t);
    });

    if ((await queryInterface.describeTable('ActiveTimers')).taskId) await queryInterface.removeColumn('ActiveTimers', 'taskId');
    for (const table of NEW_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(table)) await queryInterface.dropTable(table);
    }
    for (const [from, to] of RENAMES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(to)) await queryInterface.renameTable(to, from);
    }
  },
};
```

- [ ] **Step 4: Keep the test reset in step with the new tables**

In `backend/test/integration/helpers.js` `resetData()`:
- **Truncated list:** replace `'TicketTasks'` with `'Tasks'`, keep `'TimeEntries'` (now the ledger), and remove `'ProjectTimeEntries'`, `'ProjectSubtasks'` and `'ProjectTasks'`.
- **`deleted` list (DELETE, not TRUNCATE):** add the maps and the legacy tables, which are nearly always empty:

```js
    'TaskIdMap', 'TimeEntryIdMap',
    'legacy_TimeEntries', 'legacy_ProjectTimeEntries', 'legacy_TicketTasks', 'legacy_ProjectTasks', 'legacy_ProjectSubtasks',
```

`TaskStatuses` and `WorkTypes` are seeded and are **not** reset, like `TicketStatuses` and `ProjectStatuses`.

- [ ] **Step 5: Migrate the test database and run the test**

Run: `cd backend && (set -a; . ./.env.test; set +a; npm run test:migrate) && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/workmodel.migration.test.js`
Expected: the migration applies, and the test passes with 4 tests.

The rest of the suite now fails, because the app still uses the old models. That is expected until Task 8 (see Global Constraints).

**If a check differs:**
- **`labour`:** 113.13 + 37.5 = 150.63. A float-sum mismatch is the test's arithmetic; round with `Math.round(x * 100) / 100`, never the migration.
- **`JSON_VALUE` or `CAST AS INTEGER` refused:** MariaDB 11 supports both. If the container refuses, use `CAST(... AS SIGNED)` and record a ruling.

- [ ] **Step 6: Commit**

```bash
git add -A -- backend/migrations/20260101000050-one-work-model.js backend/test/integration/workmodel.migration.test.js backend/test/integration/helpers.js
git commit -m "feat(work model): migrate tasks and time into one Tasks table and one ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Models, and the read-only lists of task statuses and work types

**Files:**
- Create: `backend/src/models/Task.js`, `backend/src/models/TaskStatus.js`, `backend/src/models/WorkType.js`, `backend/src/services/tasks/statuses.js`, `backend/src/controllers/workCatalogController.js`
- Rewrite: `backend/src/models/TimeEntry.js`
- Modify: `backend/src/models/ActiveTimer.js`, `backend/src/models/index.js`, `backend/src/routes/index.js`, `backend/test/integration/fixtures.js`
- Delete: `backend/src/models/TicketTask.js`, `ProjectTask.js`, `ProjectSubtask.js`, `ProjectTimeEntry.js`
- Test: `backend/test/integration/workmodel.catalog.test.js`

**Interfaces:**
- **Produces (models):**
  - `Task`: associations `ticket`, `project`, `parentTask`, `subtasks`, `status` (TaskStatus), `assignee`, `creator` and `linkedTicket`.
  - `TimeEntry`: associations `ticket`, `project`, `task`, `user` (who it's for), `loggedBy` and `workType`.
  - `TaskStatus` and `WorkType`.
  - `Ticket.tasks`, `Project.tasks`, `Ticket.timeEntries`, `Project.timeEntries`, `User.timeEntries`, `ActiveTimer.task`, and `task` on `ProjectExpense`, `ProjectMaterial` and `ProjectFile`.
- **Produces (statuses service):** `services/tasks/statuses.js` exports:
  - `listTaskStatuses(scope?)`, ordered by position, then id;
  - `defaultTaskStatus(scope)`, the first open status by position;
  - `taskStatusBehaviorMap()`, a `Map<id, behaviorType>` (ids are unique across scopes);
  - `findTaskStatus(scope, rawId)`, which returns the row or `null` and parses `rawId` with `parseRecordId`.
- **Produces (API):** `GET /api/v1/task-statuses?scope=ticket|project` returns `{ statuses }`; `GET /api/v1/work-types` returns `{ workTypes }`.
- **Produces (fixture):** `taskStatusId(agent, scope, name)` in `fixtures.js`.

Removing the four old models leaves `undefined` wherever a controller still destructures them. They fail when called, not on load; Tasks 4–8 replace each one.

- [ ] **Step 1: Write the failing test**

`backend/test/integration/workmodel.catalog.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld, taskStatusId } = require('./fixtures');
const request = require('supertest');
const { getApp } = require('./helpers');

// The read-only lists task and time forms need: task statuses per scope and
// work types (seeded by the one-work-model migration).

let w;
beforeAll(async () => {
  await resetData();
  w = await makeWorld();
});
afterAll(closeDb);

it('lists the ticket-task statuses in order', async () => {
  const { statuses } = expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=ticket`));
  expect(statuses.map((s) => [s.name, s.behaviorType, s.isDefault, s.isProtected])).toEqual([
    ['To do', 'open', true, false], ['In progress', 'open', false, false], ['Done', 'closed', false, true],
  ]);
  expect(await taskStatusId(w.admin.agent, 'ticket', 'Done')).toBe(statuses[2].id);
});

it('the project scope mirrors the project statuses, ids included', async () => {
  const { statuses } = expectOk(await w.admin.agent.get(`${API}/task-statuses?scope=project`));
  const projectStatuses = expectOk(await w.admin.agent.get(`${API}/project-statuses`)).statuses;
  expect(statuses.map((s) => [s.id, s.name, s.behaviorType])).toEqual(projectStatuses.map((s) => [s.id, s.name, s.behaviorType]));
});

it('lists every scope without a filter, and refuses an unknown one', async () => {
  const all = expectOk(await w.admin.agent.get(`${API}/task-statuses`)).statuses;
  expect(new Set(all.map((s) => s.scope))).toEqual(new Set(['ticket', 'project']));
  const bad = await w.admin.agent.get(`${API}/task-statuses?scope=asset`);
  expect(bad.status).toBe(400);
  expect(bad.body).toEqual({ error: true, message: 'scope must be ticket or project', code: 'VALIDATION_ERROR' });
});

it('lists the work types', async () => {
  const { workTypes } = expectOk(await w.admin.agent.get(`${API}/work-types`));
  expect(workTypes.map((t) => [t.name, t.billableDefault, t.isActive])).toEqual([
    ['Remote support', true, true], ['On-site', true, true], ['Travel', true, true],
    ['Project work', true, true], ['Admin', false, true],
  ]);
});

it('both lists need a login', async () => {
  for (const path of ['task-statuses', 'work-types']) {
    // eslint-disable-next-line no-await-in-loop
    expect((await request(getApp()).get(`${API}/${path}`)).status).toBe(401);
  }
});

it('the new models load with their associations', () => {
  const { Task, TimeEntry } = models;
  expect(Object.keys(Task.associations).sort()).toEqual(
    ['assignee', 'creator', 'linkedTicket', 'parentTask', 'project', 'status', 'subtasks', 'ticket']
  );
  expect(Object.keys(TimeEntry.associations).sort()).toEqual(['loggedBy', 'project', 'task', 'ticket', 'user', 'workType']);
  expect(models.TicketTask).toBeUndefined();
  expect(models.ProjectTimeEntry).toBeUndefined();
});
```

Check `getApp` is exported by `helpers.js` (it is: `module.exports = { getApp, ... }`).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/workmodel.catalog.test.js`
Expected: FAIL. `taskStatusId` is not a function, and the routes are 404.

- [ ] **Step 3: Write the models**

`backend/src/models/Task.js`:

```js
const { DataTypes, Model } = require('sequelize');

// One task model for tickets and projects (sub-project 3). Exactly one of
// ticketId / projectId is set (a database check enforces it); a subtask has
// parentTaskId and the same parent, one level deep. A task has no companyId:
// it follows its ticket or project for company and access.
module.exports = (sequelize) => {
  class Task extends Model {}

  Task.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      parentTaskId: { type: DataTypes.INTEGER, allowNull: true },
      // IT-P00012-T04 on projects, #00012-T04 on tickets; subtasks add -S02.
      code: { type: DataTypes.STRING(60), allowNull: true, unique: true },
      title: { type: DataTypes.STRING(500), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      // TaskStatuses.id, in the scope matching the parent (ticket | project).
      statusId: { type: DataTypes.INTEGER, allowNull: false },
      priority: { type: DataTypes.ENUM('urgent', 'high', 'medium', 'low'), allowNull: false, defaultValue: 'medium' },
      assigneeId: { type: DataTypes.INTEGER, allowNull: true },
      dueDate: { type: DataTypes.DATEONLY, allowNull: true },
      estimateMinutes: { type: DataTypes.INTEGER, allowNull: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      // Project tasks only; same company as the project.
      linkedTicketId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Task', tableName: 'Tasks', timestamps: true }
  );

  return Task;
};
```

`backend/src/models/TaskStatus.js`:

```js
const { DataTypes, Model } = require('sequelize');

// Task statuses: one editable list per scope ('ticket' | 'project'), separate
// from the ticket and project status lists (spec decision: four lists).
module.exports = (sequelize) => {
  class TaskStatus extends Model {}

  TaskStatus.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      scope: { type: DataTypes.ENUM('ticket', 'project'), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#3b82f6' },
      behaviorType: { type: DataTypes.ENUM('open', 'closed', 'archived'), allowNull: false, defaultValue: 'open' },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isProtected: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, modelName: 'TaskStatus', tableName: 'TaskStatuses', timestamps: true, updatedAt: false }
  );

  return TaskStatus;
};
```

`backend/src/models/WorkType.js`:

```js
const { DataTypes, Model } = require('sequelize');

// What kind of work a time entry is (Remote support, On-site, ...). Billable
// defaults from it; the money phase attaches rates here later.
module.exports = (sequelize) => {
  class WorkType extends Model {}

  WorkType.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      billableDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'WorkType', tableName: 'WorkTypes', timestamps: true }
  );

  return WorkType;
};
```

`backend/src/models/TimeEntry.js` (replace the whole file):

```js
const { DataTypes, Model } = require('sequelize');

// The one time ledger (sub-project 3): every minute of work, on a ticket or a
// project, lives here. Exactly one of ticketId / projectId is set (a database
// check enforces it). userId is who the time is FOR; loggedById is who
// entered it. "When it was entered" is createdAt; entryDate is the work date
// in the organization's time zone.
module.exports = (sequelize) => {
  class TimeEntry extends Model {}

  TimeEntry.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      loggedById: { type: DataTypes.INTEGER, allowNull: true },
      entryDate: { type: DataTypes.DATEONLY, allowNull: false },
      // Set when known (timer, start/end picker); null for a plain duration.
      startTime: { type: DataTypes.DATE, allowNull: true },
      endTime: { type: DataTypes.DATE, allowNull: true },
      durationSeconds: { type: DataTypes.INTEGER, allowNull: false },
      billable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      workTypeId: { type: DataTypes.INTEGER, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true },
      // From userId's contractor rate (utils/laborCost.js); null for internal
      // staff, not 0. Recomputed whenever the duration or userId changes.
      laborCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    { sequelize, modelName: 'TimeEntry', tableName: 'TimeEntries', timestamps: true }
  );

  return TimeEntry;
};
```

`backend/src/models/ActiveTimer.js`: add `taskId: { type: DataTypes.INTEGER, allowNull: true },` after `entityId`. Then replace the header comment with:

```js
// A single running timer per user (server-side so it resumes across devices),
// on a ticket or a project, optionally on one of its tasks. Stopping or
// switching writes the elapsed time to the ledger (services/time).
```

Then delete the four old model files:

```bash
rm backend/src/models/TicketTask.js backend/src/models/ProjectTask.js backend/src/models/ProjectSubtask.js backend/src/models/ProjectTimeEntry.js
```

- [ ] **Step 4: Rewire `models/index.js`**

In the requires at the top:
- remove the `ProjectTask`, `ProjectSubtask`, `ProjectTimeEntry` and `TicketTask` lines;
- add:

```js
const Task = require('./Task')(sequelize);
const TaskStatus = require('./TaskStatus')(sequelize);
const WorkType = require('./WorkType')(sequelize);
```

In the exported object, remove the same four names and add `Task`, `TaskStatus` and `WorkType`. `TimeEntry` keeps its name.

Delete these association blocks:
- `// Project <-> ProjectTask <-> ProjectSubtask` (the eleven lines from `Project.hasMany(ProjectTask` to `ProjectSubtask.belongsTo(ProjectStatus`);
- the four `ProjectTimeEntry` lines;
- `ProjectExpense.belongsTo(ProjectTask …)`, `ProjectMaterial.belongsTo(ProjectTask …)` and `ProjectFile.belongsTo(ProjectTask …)`;
- the `// Ticket <-> TimeEntry` block (five lines);
- the three `TicketTask` lines.

Add in their place:

```js
// One task model for tickets and projects; subtasks are tasks with parentTaskId.
Ticket.hasMany(Task, { foreignKey: 'ticketId', as: 'tasks' });
Project.hasMany(Task, { foreignKey: 'projectId', as: 'tasks' });
Task.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
Task.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
Task.belongsTo(Task, { foreignKey: 'parentTaskId', as: 'parentTask' });
Task.hasMany(Task, { foreignKey: 'parentTaskId', as: 'subtasks' });
Task.belongsTo(TaskStatus, { foreignKey: 'statusId', as: 'status' });
Task.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });
Task.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
Task.belongsTo(Ticket, { foreignKey: 'linkedTicketId', as: 'linkedTicket' });
ProjectExpense.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });
ProjectMaterial.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });
ProjectFile.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });

// The one time ledger. No database cascades: deleting a ticket removes its
// time and tasks in code (tickets/core remove); a deleted user's time stays.
Ticket.hasMany(TimeEntry, { foreignKey: 'ticketId', as: 'timeEntries' });
Project.hasMany(TimeEntry, { foreignKey: 'projectId', as: 'timeEntries' });
User.hasMany(TimeEntry, { foreignKey: 'userId', as: 'timeEntries' });
TimeEntry.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TimeEntry.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
TimeEntry.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });
TimeEntry.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TimeEntry.belongsTo(User, { foreignKey: 'loggedById', as: 'loggedBy' });
TimeEntry.belongsTo(WorkType, { foreignKey: 'workTypeId', as: 'workType' });
ActiveTimer.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });
```

Run `grep -n "ProjectTask\|ProjectSubtask\|ProjectTimeEntry\|TicketTask" backend/src/models/index.js`.
Expected: no output.

- [ ] **Step 5: The statuses service and the two read endpoints**

`backend/src/services/tasks/statuses.js`:

```js
// Task statuses: one editable list per scope ('ticket' | 'project'),
// independent of the ticket and project status lists.
const { TaskStatus } = require('../../models');
const { parseRecordId } = require('../permissionService');

const ORDER = [['position', 'ASC'], ['id', 'ASC']];

async function listTaskStatuses(scope) {
  return TaskStatus.findAll({ where: scope ? { scope } : {}, order: ORDER });
}

// What a new task gets when no status is sent: the scope's first open status.
async function defaultTaskStatus(scope) {
  return TaskStatus.findOne({ where: { scope, behaviorType: 'open' }, order: ORDER });
}

// A status in the given scope, or null (a missing id, another scope's id, or
// anything that isn't a plain integer).
async function findTaskStatus(scope, rawId) {
  const id = parseRecordId(rawId);
  return id ? TaskStatus.findOne({ where: { id, scope } }) : null;
}

// id -> behaviorType for every task status (ids are unique across scopes).
async function taskStatusBehaviorMap() {
  const rows = await TaskStatus.findAll({ attributes: ['id', 'behaviorType'] });
  return new Map(rows.map((r) => [r.id, r.behaviorType]));
}

module.exports = { listTaskStatuses, defaultTaskStatus, findTaskStatus, taskStatusBehaviorMap };
```

`backend/src/controllers/workCatalogController.js`:

```js
// Read-only lists for task and time forms: task statuses (per scope) and work
// types. Editing them belongs to Settings (plan 3b-2).
const { WorkType } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { listTaskStatuses } = require('../services/tasks/statuses');

// GET /task-statuses?scope=ticket|project
const taskStatuses = asyncHandler(async (req, res) => {
  const { scope } = req.query;
  if (scope !== undefined && !['ticket', 'project'].includes(scope)) {
    throw new ApiError(400, 'scope must be ticket or project', 'VALIDATION_ERROR');
  }
  res.json({ statuses: await listTaskStatuses(scope) });
});

// GET /work-types — inactive ones included, so old entries still show a name.
const workTypes = asyncHandler(async (req, res) => {
  res.json({ workTypes: await WorkType.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] }) });
});

module.exports = { taskStatuses, workTypes };
```

In `backend/src/routes/index.js`, next to the other requires add `const workCatalog = require('../controllers/workCatalogController');`. After `router.use('/project-statuses', …)` add:

```js
router.get('/task-statuses', guard, workCatalog.taskStatuses);
router.get('/work-types', guard, workCatalog.workTypes);
```

In `backend/test/integration/fixtures.js`, add after `projectStatusId`:

```js
async function taskStatusId(agent, scope, name) {
  const { statuses } = expectOk(await agent.get(`${API}/task-statuses?scope=${scope}`));
  const found = statuses.find((s) => s.name === name);
  if (!found) throw new Error(`${scope} task status "${name}" not seeded`);
  return found.id;
}
```

and add `taskStatusId` to `module.exports`.

- [ ] **Step 6: Run the test**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/workmodel.catalog.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add -A -- backend/src/models backend/src/services/tasks/statuses.js backend/src/controllers/workCatalogController.js backend/src/routes/index.js backend/test/integration/fixtures.js backend/test/integration/workmodel.catalog.test.js
git commit -m "feat(work model): Task, TaskStatus, WorkType and ledger models; task-status and work-type lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The task service, and project tasks on it

**Files:**
- Create: `backend/src/services/tasks/codes.js`, `backend/src/services/tasks/index.js`
- Rewrite: `backend/src/controllers/projects/tasks.js`
- Modify:
  - `backend/src/controllers/projects/{shared,expenses,materials,files}.js`;
  - `backend/src/services/{projectCompletion,projectCodeService,statusBehavior}.js`;
  - `backend/test/integration/companies.review.test.js`.
- Rewrite test: `backend/test/integration/projects.tasks.test.js`

**Interfaces:**
- Consumes: `defaultTaskStatus`, `findTaskStatus` and `taskStatusBehaviorMap` (Task 3), and `parseRecordId`, `findAccessibleTicket` and `parseTicketId` from `permissionService`.
- Produces `services/tasks` exports (Task 5 and Task 6 use these):
  - `ticketParent(ticket)` and `projectParent(project)`, which return `{ kind, record, where, companyId }`. `where` is `{ ticketId }` or `{ projectId }`.
  - `findTask(parent, rawId)`, which returns the plain row or null (any level of that parent).
  - `listTasks(parent)`, which returns top-level tasks with `subtasks`, `isComplete` and `subtaskPercent`.
  - `loadTask(parent, id)` and `createTask(req, parent, body)`.
  - `updateTask(req, parent, task, body)` and `deleteTask(req, parent, task)`.
  - `reorderTasks(req, parent, body)` and `renumberTask(req, parent, task, number)`.
- Produces `services/tasks/codes`: `formatTaskCode(parent, n)`, `formatSubtaskCode(code, n)` and `nextCode(parent, parentTask, transaction)`.
- Produces `projects/shared.js resolveProjectTaskId(project, rawTaskId)`, now any task or subtask of the project (S13).

- [ ] **Step 1: Rewrite the project task tests (they must fail first)**

`backend/test/integration/projects.tasks.test.js` keeps its structure and every test, with these changes.

**1. Mechanical renames throughout the file:**
- imports: `projectStatusId` becomes `taskStatusId`;
- `ACTIVE = await projectStatusId(w.admin.agent, 'Active')` becomes `ACTIVE = await taskStatusId(w.admin.agent, 'project', 'Active')`, and the same for `COMPLETED`;
- on task objects, `taskCode` and `subtaskCode` become `code`, and `assignedToUserId` becomes `assigneeId`;
- `models.ProjectTask.update` and `models.ProjectSubtask.update` become `models.Task.update`.

**2. In the S1 describe, the test name stays.** Subtask responses through the old alias URLs keep the key `subtask`, so `makeSubtask` is unchanged.

**3. Replace these tests:**

```js
  it('creates a task with defaults', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: '  Audit  ' });
    expect(t).toEqual(expect.objectContaining({
      title: 'Audit', code: 'SD-P00001-T01', statusId: ACTIVE, priority: 'medium', position: 1, projectId: P.id,
      ticketId: null, parentTaskId: null, estimateMinutes: null, completedAt: null, linkedTicketId: null,
      createdBy: mgr.user.id, subtasks: [],
    }));
    expect(t.status.name).toBe('Active');
  });

  it('Q31: a task created already closed gets completedAt', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'x', statusId: COMPLETED });
    expect(typeof t.completedAt).toBe('string');
  });

  it('updates every editable field', async () => {
    const t = await makeTask(mgr.agent, P.id);
    const changes = {
      title: 'New', description: 'D', priority: 'urgent', assigneeId: mgr.user.id, dueDate: '2026-12-01', estimateMinutes: 90,
    };
    expect(await patchTask(t, changes)).toEqual(expect.objectContaining(changes));
  });

  it('position is changed by reorder only', async () => {
    const t = await makeTask(mgr.agent, P.id);
    expect((await patchTask(t, { position: 7 })).position).toBe(1);
  });

  it('Q38: task and subtask updates refuse a blank or whitespace title', async () => {
    const t = await makeTask(mgr.agent, P.id);
    const s = await makeSubtask(mgr.agent, P.id, t.id);
    for (const title of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop
      const taskRes = await mgr.agent.patch(taskUrl(t)).send({ title });
      expect(taskRes.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
      // eslint-disable-next-line no-await-in-loop
      const subRes = await mgr.agent.patch(subUrl(t, s)).send({ title });
      expect(subRes.body).toEqual({ error: true, message: 'Subtask title is required', code: 'VALIDATION_ERROR' });
    }
  });

  it('closing stamps completedAt and logs task_closed; reopening clears it and logs task_reopened', async () => {
    const t = await makeTask(mgr.agent, P.id, { title: 'Audit' });
    expect(typeof (await patchTask(t, { statusId: COMPLETED })).completedAt).toBe('string');
    expect((await patchTask(t, { statusId: ACTIVE })).completedAt).toBeNull();
    const detail = { taskId: t.id, title: 'Audit', taskCode: 'SD-P00001-T01' };
    const acts = (await activity()).map((a) => [a.action, a.detail]);
    expect(acts).toContainEqual(['task_closed', detail]);
    expect(acts).toContainEqual(['task_reopened', detail]);
  });

  it('Q7: a string statusId equal to the current one changes nothing', async () => {
    const t = await makeTask(mgr.agent, P.id);
    await patchTask(t, { statusId: COMPLETED });
    await models.Task.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: t.id } });
    expect((await patchTask(t, { statusId: String(COMPLETED) })).completedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('Q15: re-sending the same closed status logs task_closed once', async () => {
    const t = await makeTask(mgr.agent, P.id);
    await patchTask(t, { statusId: COMPLETED });
    await patchTask(t, { statusId: COMPLETED });
    expect((await activity()).filter((a) => a.action === 'task_closed')).toHaveLength(1);
  });
```

Inside `describe('reorder')`, replace the Q32 test:

```js
    it('Q32: a reorder must list every task at its level, once', async () => {
      for (const order of [[t3.id], [t1.id, t2.id, t2.id], [t1.id, t2.id, t3.id, t3.id]]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await reorder(order);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('order must list every task at this level exactly once');
      }
      expect((await listTasks()).map((t) => [t.title, t.position])).toEqual([['t1', 1], ['t2', 2], ['t3', 3]]);
    });

    it('reorders subtasks within their task', async () => {
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id, { title: 's1' });
      const s2 = await makeSubtask(mgr.agent, P.id, t1.id, { title: 's2' });
      expectOk(await mgr.agent.patch(`${API}/projects/${P.id}/tasks/reorder`).send({ parentTaskId: t1.id, order: [s2.id, s1.id] }));
      expect((await listTasks())[0].subtasks.map((s) => s.title)).toEqual(['s2', 's1']);
    });
```

In `describe('codes')`, replace the Q20 test:

```js
    it('Q20: renumbering a task renumbers its subtasks', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s1 = await makeSubtask(mgr.agent, P.id, t1.id);
      expectOk(await renumber(t1, 5));
      const s2 = await makeSubtask(mgr.agent, P.id, t1.id);
      const [fresh] = await listTasks();
      expect(fresh.subtasks.map((s) => [s.id, s.code])).toEqual([[s1.id, 'SD-P00001-T05-S01'], [s2.id, 'SD-P00001-T05-S02']]);
    });
```

In `describe('subtasks')`, replace the subtask Q7 test:

```js
    it('Q7: same for a subtask', async () => {
      const s = await makeSubtask(mgr.agent, P.id, t1.id);
      await patchSub(t1, s, { statusId: COMPLETED });
      await models.Task.update({ completedAt: new Date('2026-01-01T00:00:00Z') }, { where: { id: s.id } });
      expect((await patchSub(t1, s, { statusId: String(COMPLETED) })).completedAt).toBe('2026-01-01T00:00:00.000Z');
    });
```

In `describe('subtasks')`, change the expectation in 'creates a subtask with defaults' to:

```js
      expect(s).toEqual(expect.objectContaining({
        title: 'Cable', code: 'SD-P00001-T01-S01', statusId: ACTIVE, position: 1, completedAt: null, parentTaskId: t1.id,
      }));
```

The Q19 test stays unchanged; 3b-2 fixes it.

**4. Add, at the end of `describe('tasks, subtasks, codes and rollups')`:**

```js
  describe('the unified rules', () => {
    it('Q25: a status from the other scope, a missing one, or a non-integer id is refused', async () => {
      const done = await taskStatusId(w.admin.agent, 'ticket', 'Done');
      const t = await makeTask(mgr.agent, P.id);
      for (const statusId of [done, 99999, '1abc', 1.5]) {
        // eslint-disable-next-line no-await-in-loop
        const created = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'x', statusId });
        expect(created.body).toEqual({ error: true, message: 'Unknown task status', code: 'VALIDATION_ERROR' });
        // eslint-disable-next-line no-await-in-loop
        const patched = await mgr.agent.patch(taskUrl(t)).send({ statusId });
        expect(patched.body).toEqual({ error: true, message: 'Unknown task status', code: 'VALIDATION_ERROR' });
      }
    });

    it('validates priority, due date and estimate', async () => {
      const t = await makeTask(mgr.agent, P.id);
      const cases = [
        [{ priority: 'critical' }, 'Invalid priority'],
        [{ dueDate: 'tomorrow' }, 'Invalid due date'],
        [{ estimateMinutes: -5 }, 'Estimate must be a whole number of minutes'],
        [{ estimateMinutes: 1.5 }, 'Estimate must be a whole number of minutes'],
      ];
      for (const [body, message] of cases) {
        // eslint-disable-next-line no-await-in-loop
        const res = await mgr.agent.patch(taskUrl(t)).send(body);
        expect(res.body).toEqual({ error: true, message, code: 'VALIDATION_ERROR' });
      }
      expect((await patchTask(t, { estimateMinutes: null, dueDate: null })).estimateMinutes).toBeNull();
    });

    it('a subtask is a task with parentTaskId, one level deep', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s = expectOk(await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'Sub', parentTaskId: t1.id }), 201).task;
      expect([s.parentTaskId, s.code]).toEqual([t1.id, 'SD-P00001-T01-S01']);
      const deeper = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'Deeper', parentTaskId: s.id });
      expect(deeper.body).toEqual({ error: true, message: "Subtasks can't have subtasks", code: 'VALIDATION_ERROR' });
      const other = await makeTask(w.admin.agent, Q.id);
      for (const parentTaskId of [other.id, 99999, '1abc']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await mgr.agent.post(`${API}/projects/${P.id}/tasks`).send({ title: 'x', parentTaskId });
        expect(res.body).toEqual({ error: true, message: 'Parent task not found', code: 'VALIDATION_ERROR' });
      }
      // The same subtask is reachable by its own task URL.
      expect(expectOk(await mgr.agent.patch(taskUrl(s)).send({ title: 'Sub 2' })).task.title).toBe('Sub 2');
    });

    it('lists by position, then id, under a frozen clock', async () => {
      freezeClock('2026-03-11T17:00:00Z');
      const fresh = await makeManager('frozen', w.deptA.id);
      const ids = [];
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        ids.push((await makeTask(fresh.agent, P.id)).id);
      }
      const listed = expectOk(await fresh.agent.get(`${API}/projects/${P.id}/tasks`)).tasks;
      expect(listed.map((t) => t.id)).toEqual(ids);
    });

    it('deleting a task keeps its time and a running timer, on no task', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const s = await makeSubtask(mgr.agent, P.id, t1.id);
      const { WorkType, TimeEntry, ActiveTimer } = models;
      const wt = await WorkType.findOne({ where: { name: 'Project work' } });
      const entry = await TimeEntry.create({
        projectId: P.id, taskId: s.id, userId: mgr.user.id, loggedById: mgr.user.id, entryDate: '2026-03-10',
        durationSeconds: 600, billable: true, workTypeId: wt.id,
      });
      await ActiveTimer.create({ userId: mgr.user.id, entityType: 'project', entityId: P.id, taskId: t1.id, startedAt: new Date() });
      expectOk(await mgr.agent.delete(taskUrl(t1)));
      expect((await TimeEntry.findByPk(entry.id)).taskId).toBeNull();
      expect((await ActiveTimer.findOne({ where: { userId: mgr.user.id } })).taskId).toBeNull();
      expect(await models.Task.count({ where: { projectId: P.id } })).toBe(0);
    });

    it('Q23: task create, edit, status change, reorder, renumber and delete are audited', async () => {
      const t1 = await makeTask(mgr.agent, P.id);
      const t2 = await makeTask(mgr.agent, P.id);
      await patchTask(t1, { title: 'Renamed' });
      await patchTask(t1, { statusId: COMPLETED });
      expectOk(await mgr.agent.patch(`${API}/projects/${P.id}/tasks/reorder`).send({ order: [t2.id, t1.id] }));
      expectOk(await mgr.agent.patch(`${taskUrl(t1)}/code`).send({ number: 9 }));
      expectOk(await mgr.agent.delete(taskUrl(t2)));
      const rows = await models.AuditLog.findAll({ where: { entityType: 'Task' }, order: [['id', 'ASC']] });
      expect(rows.map((r) => r.action)).toEqual([
        'task.create', 'task.create', 'task.update', 'task.update', 'task.reorder', 'task.renumber', 'task.delete',
      ]);
    });

    it('an assignee must reach the project\'s company', async () => {
      const acme = await makeCompany(w.admin, { name: 'Acme' });
      const acmeProject = await makeProject(w.admin.agent, { name: 'Acme job', companyId: acme.id, ownerDepartmentId: w.deptA.id });
      const fenced = await makeTech('fenced', w.deptA.id);
      const internalId = (await models.Company.findOne({ where: { isInternal: true } })).id;
      await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
      const res = await w.admin.agent.post(`${API}/projects/${acmeProject.id}/tasks`).send({ title: 'x', assigneeId: fenced.user.id });
      expect(res.body).toEqual({ error: true, message: "Assignee can't see projects for this company", code: 'VALIDATION_ERROR' });
    });
  });
```

Add `makeCompany`, `setCompanyAccess` and `makeTech` to the fixtures import at the top of the file.

In `backend/test/integration/companies.review.test.js`, replace `ProjectTask` with `Task` in the models destructure and in `ProjectTask.update(…)`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/projects.tasks.test.js`
Expected: FAIL. Most tests fail with 500s from the old controller, whose `ProjectTask` model is now `undefined`.

- [ ] **Step 3: Write the code helpers**

`backend/src/services/tasks/codes.js`:

```js
// Task codes. Project tasks: IT-P00012-T04; ticket tasks: #00012-T04.
// Subtasks append -S02 to their task's code. A new number is "current max + 1"
// among siblings, so renumbering (1–99) never drifts out of step.
const { Task } = require('../../models');

const pad2 = (n) => String(n).padStart(2, '0');

function parentPrefix(parent) {
  return parent.kind === 'ticket' ? `#${String(parent.record.id).padStart(5, '0')}` : parent.record.projectCode;
}

function formatTaskCode(parent, number) {
  return `${parentPrefix(parent)}-T${pad2(number)}`;
}

function formatSubtaskCode(taskCode, number) {
  return `${taskCode}-S${pad2(number)}`;
}

function trailingNumber(code, letter) {
  const match = code ? new RegExp(`-${letter}(\\d+)$`).exec(code) : null;
  return match ? parseInt(match[1], 10) : 0;
}

async function nextCode(parent, parentTask, transaction) {
  const where = parentTask ? { parentTaskId: parentTask.id } : { ...parent.where, parentTaskId: null };
  const siblings = await Task.findAll({ where, attributes: ['code'], transaction });
  const letter = parentTask ? 'S' : 'T';
  const next = siblings.reduce((max, s) => Math.max(max, trailingNumber(s.code, letter)), 0) + 1;
  return parentTask ? formatSubtaskCode(parentTask.code, next) : formatTaskCode(parent, next);
}

module.exports = { formatTaskCode, formatSubtaskCode, trailingNumber, nextCode, pad2 };
```

In `backend/src/services/projectCodeService.js`:
- delete `maxTaskNumber`, `maxSubtaskNumber`, `formatTaskCode`, `formatSubtaskCode`, `generateTaskCode`, `generateSubtaskCode` and `parseTrailingNumber`;
- drop `ProjectTask, ProjectSubtask` from its require;
- export only `generateProjectCode`;
- replace the header's "Task/subtask numbers …" sentence with "Task codes live in services/tasks/codes.js."

- [ ] **Step 4: Write the task service**

`backend/src/services/tasks/index.js`:

```js
// The one task service (sub-project 3): create, edit, delete, reorder and
// renumber, with the same rules for ticket tasks and project tasks. The
// ticket and project controllers only find the parent and check access.
const { Op } = require('sequelize');
const {
  Task, TaskStatus, TimeEntry, ActiveTimer, ProjectExpense, ProjectMaterial, ProjectFile, User, Ticket, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../ticketActivity');
const { logProjectActivity } = require('../projectActivity');
const { canWorkCompany } = require('../ticketPeople');
const { parseRecordId, findAccessibleTicket, parseTicketId } = require('../permissionService');
const { defaultTaskStatus, findTaskStatus, taskStatusBehaviorMap } = require('./statuses');
const {
  formatTaskCode, formatSubtaskCode, trailingNumber, nextCode, pad2,
} = require('./codes');
const { toDateString } = require('../../utils/orgTime');
const { isTaskComplete, subtaskCompletionPercent } = require('../projectCompletion');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const ORDER = [['position', 'ASC'], ['id', 'ASC']];

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const given = (v) => v !== undefined && v !== null && v !== '';

function ticketParent(ticket) {
  return { kind: 'ticket', record: ticket, where: { ticketId: ticket.id }, companyId: ticket.companyId };
}

function projectParent(project) {
  return { kind: 'project', record: project, where: { projectId: project.id }, companyId: project.companyId };
}

// A project task's linked ticket shows only while it's in the project's
// company: a link can outlive a move of either end (plan 2a).
function taskIncludes(parent) {
  const status = { model: TaskStatus, as: 'status' };
  const assignee = { model: User, as: 'assignee', attributes: userAttrs };
  const linked = parent.kind === 'project'
    ? [{ model: Ticket, as: 'linkedTicket', attributes: ['id', 'title'], where: { companyId: parent.companyId }, required: false }]
    : [];
  return [
    assignee, status, ...linked,
    { model: Task, as: 'subtasks', separate: true, order: ORDER, include: [assignee, status] },
  ];
}

async function findTask(parent, rawId) {
  const id = parseRecordId(rawId);
  return id ? Task.findOne({ where: { id, ...parent.where } }) : null;
}

function annotate(task, behavior) {
  const json = task.toJSON();
  if (json.parentTaskId === null) {
    json.isComplete = isTaskComplete(task, task.subtasks || [], behavior);
    json.subtaskPercent = subtaskCompletionPercent(task.subtasks || [], behavior);
  }
  return json;
}

async function loadTask(parent, id) {
  const task = await Task.findByPk(id, { include: taskIncludes(parent) });
  return annotate(task, await taskStatusBehaviorMap());
}

async function listTasks(parent) {
  const tasks = await Task.findAll({ where: { ...parent.where, parentTaskId: null }, include: taskIncludes(parent), order: ORDER });
  const behavior = await taskStatusBehaviorMap();
  return tasks.map((t) => annotate(t, behavior));
}

// ---- Field rules ----

function cleanTitle(value, label) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw bad(`${label} title is required`);
  return title;
}

function cleanText(value) {
  if (!given(value)) return null;
  const text = String(value).trim();
  return text || null;
}

function resolvePriority(value) {
  if (!PRIORITIES.includes(value)) throw bad('Invalid priority');
  return value;
}

function resolveDueDate(value) {
  if (!given(value)) return null;
  const date = toDateString(value);
  if (!date || String(value).length > 10) throw bad('Invalid due date');
  return date;
}

function resolveEstimate(value) {
  if (!given(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw bad('Estimate must be a whole number of minutes');
  return n;
}

async function resolveStatus(parent, value) {
  const status = await findTaskStatus(parent.kind, value);
  if (!status) throw bad('Unknown task status');
  return status;
}

// The assignee must be able to open the parent (plan 2b rule). Re-sending
// the current assignee isn't re-checked: a client PATCHing the whole task
// back mustn't be refused for an assignment it didn't make.
async function resolveAssignee(parent, value, current) {
  if (!given(value)) return null;
  const id = parseRecordId(value);
  if (id && id === current) return current;
  const user = id && await canWorkCompany(id, parent.companyId);
  if (!user) throw bad(`Assignee can't see ${parent.kind}s for this company`);
  return user.id;
}

// Project tasks only. Missing and out-of-scope tickets look the same, and
// the checked ticket's own id is what gets stored (S4).
async function resolveLinkedTicket(req, parent, value, current) {
  if (!given(value)) return null;
  if (parent.kind !== 'project') throw bad('Only project tasks can link a ticket');
  if (current && parseTicketId(value) === current) return current;
  const linked = await findAccessibleTicket(req.user, value);
  if (!linked || linked.companyId !== parent.companyId) throw bad('Linked ticket not found');
  return linked.id;
}

// ---- Activity and audit (Q8, Q23) ----

async function recordTaskEvent(req, parent, task, event, extra = {}) {
  const sub = !!task.parentTaskId;
  const action = `${sub ? 'subtask' : 'task'}_${event}`;
  if (parent.kind === 'ticket') {
    const toValue = extra.to !== undefined ? extra.to : `${task.code} ${task.title}`;
    await logActivity(parent.record.id, req.user.id, action, extra.from ?? null, toValue);
  } else {
    const detail = sub
      ? { subtaskId: task.id, title: task.title, subtaskCode: task.code }
      : { taskId: task.id, title: task.title, taskCode: task.code };
    await logProjectActivity(parent.record.id, req.user.id, action, { ...detail, ...(extra.detail || {}) });
  }
}

function audit(req, parent, verb, task, meta = {}) {
  return writeAudit(req, `task.${verb}`, 'Task', task.id, { ...parent.where, ...meta });
}

// ---- Create / update / delete ----

async function createTask(req, parent, body = {}) {
  let parentTask = null;
  if (given(body.parentTaskId)) {
    parentTask = await findTask(parent, body.parentTaskId);
    if (!parentTask) throw bad('Parent task not found');
    if (parentTask.parentTaskId) throw bad("Subtasks can't have subtasks");
  }
  const title = cleanTitle(body.title, parentTask ? 'Subtask' : 'Task');
  const status = given(body.statusId) ? await resolveStatus(parent, body.statusId) : await defaultTaskStatus(parent.kind);
  if (!status) throw bad('No open task status is configured');
  const fields = {
    ...parent.where,
    parentTaskId: parentTask ? parentTask.id : null,
    title,
    description: cleanText(body.description),
    statusId: status.id,
    priority: given(body.priority) ? resolvePriority(body.priority) : 'medium',
    assigneeId: await resolveAssignee(parent, body.assigneeId, null),
    dueDate: resolveDueDate(body.dueDate),
    estimateMinutes: resolveEstimate(body.estimateMinutes),
    linkedTicketId: await resolveLinkedTicket(req, parent, body.linkedTicketId, null),
    completedAt: status.behaviorType === 'closed' ? new Date() : null, // Q31
    createdBy: req.user.id,
  };
  const siblings = { ...parent.where, parentTaskId: fields.parentTaskId };
  const task = await sequelize.transaction(async (transaction) => {
    const maxPos = await Task.max('position', { where: siblings, transaction });
    const code = await nextCode(parent, parentTask, transaction);
    return Task.create({ ...fields, code, position: (Number.isFinite(maxPos) ? maxPos : 0) + 1 }, { transaction });
  });
  await recordTaskEvent(req, parent, task, 'created');
  await audit(req, parent, 'create', task, { title: task.title, code: task.code });
  return loadTask(parent, task.id);
}

const sameDate = (a, b) => (a || null) === (b || null);

async function updateTask(req, parent, task, body = {}) {
  const label = task.parentTaskId ? 'Subtask' : 'Task';
  const changes = {};
  if (body.title !== undefined) changes.title = cleanTitle(body.title, label);
  if (body.description !== undefined) changes.description = cleanText(body.description);
  if (body.priority !== undefined) changes.priority = resolvePriority(body.priority);
  if (body.dueDate !== undefined) changes.dueDate = resolveDueDate(body.dueDate);
  if (body.estimateMinutes !== undefined) changes.estimateMinutes = resolveEstimate(body.estimateMinutes);
  if (body.assigneeId !== undefined) changes.assigneeId = await resolveAssignee(parent, body.assigneeId, task.assigneeId);
  if (body.linkedTicketId !== undefined) {
    changes.linkedTicketId = await resolveLinkedTicket(req, parent, body.linkedTicketId, task.linkedTicketId);
  }
  let statusEvent = null;
  if (body.statusId !== undefined) {
    const status = await resolveStatus(parent, body.statusId);
    if (status.id !== task.statusId) { // Q7, Q15: the same status is no change
      const wasClosed = (await taskStatusBehaviorMap()).get(task.statusId) === 'closed';
      const willClose = status.behaviorType === 'closed';
      changes.statusId = status.id;
      changes.completedAt = willClose ? (wasClosed ? task.completedAt : new Date()) : null;
      if (willClose !== wasClosed) statusEvent = willClose ? 'closed' : 'reopened';
    }
  }
  // Keep only real changes, so a client PATCHing the whole task back logs nothing.
  for (const key of Object.keys(changes)) {
    const same = key === 'dueDate' ? sameDate(changes[key], task.dueDate) : changes[key] === task[key];
    if (same && key !== 'completedAt') delete changes[key];
  }
  if (changes.statusId === undefined) delete changes.completedAt;
  // A status change that stays on the same side (To do -> In progress) is an
  // ordinary edit; crossing into or out of closed has its own event.
  const fields = Object.keys(changes).filter((k) => k !== 'completedAt' && !(k === 'statusId' && statusEvent));
  if (!Object.keys(changes).length) return loadTask(parent, task.id);

  await task.update(changes);
  if (statusEvent) await recordTaskEvent(req, parent, task, statusEvent);
  if (fields.length) {
    await recordTaskEvent(req, parent, task, 'updated', { from: null, to: fields.join(', '), detail: { fields } });
  }
  await audit(req, parent, 'update', task, { fields: Object.keys(changes) });
  return loadTask(parent, task.id);
}

// The task and its subtasks go; their time, expenses, materials, files and
// running timers stay, on no task (the work happened).
async function deleteTask(req, parent, task) {
  await sequelize.transaction(async (transaction) => {
    const subtasks = await Task.findAll({ where: { parentTaskId: task.id }, attributes: ['id'], transaction });
    const ids = [task.id, ...subtasks.map((s) => s.id)];
    const unlink = [TimeEntry, ActiveTimer, ...(parent.kind === 'project' ? [ProjectExpense, ProjectMaterial, ProjectFile] : [])];
    for (const Model of unlink) {
      await Model.update({ taskId: null }, { where: { taskId: ids }, transaction }); // eslint-disable-line no-await-in-loop
    }
    await Task.destroy({ where: { id: ids }, transaction });
  });
  await recordTaskEvent(req, parent, task, 'deleted');
  await audit(req, parent, 'delete', task, { title: task.title, code: task.code });
}

// ---- Reorder and renumber ----

// Body: { order: [taskId, ...], parentTaskId? } — every task at that level,
// exactly once (Q32), so positions stay a clean 1..n.
async function reorderTasks(req, parent, body = {}) {
  const order = Array.isArray(body.order) ? body.order.map(parseRecordId) : [];
  if (!order.length || order.some((id) => !id)) throw bad('order must be a non-empty array of task IDs');
  let parentTaskId = null;
  if (given(body.parentTaskId)) {
    const parentTask = await findTask(parent, body.parentTaskId);
    if (!parentTask || parentTask.parentTaskId) throw bad('Parent task not found');
    parentTaskId = parentTask.id;
  }
  const siblings = await Task.findAll({ where: { ...parent.where, parentTaskId }, attributes: ['id'] });
  const siblingIds = new Set(siblings.map((s) => s.id));
  if (order.some((id) => !siblingIds.has(id))) {
    const ofWhat = parentTaskId ? 'this task' : `this ${parent.kind}`;
    throw bad(`One or more tasks do not belong to ${ofWhat}`);
  }
  if (new Set(order).size !== order.length || order.length !== siblingIds.size) {
    throw bad('order must list every task at this level exactly once');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [idx, id] of order.entries()) {
      await Task.update({ position: idx + 1 }, { where: { id }, transaction }); // eslint-disable-line no-await-in-loop
    }
  });
  if (parent.kind === 'ticket') await logActivity(parent.record.id, req.user.id, 'tasks_reordered', null, null);
  else await logProjectActivity(parent.record.id, req.user.id, 'tasks_reordered', { parentTaskId });
  await writeAudit(req, 'task.reorder', 'Task', parentTaskId, { ...parent.where, parentTaskId, order });
}

async function renumberTask(req, parent, task, rawNumber) {
  const sub = !!task.parentTaskId;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw bad(`${sub ? 'Subtask' : 'Task'} number must be between 1 and 99`);
  }
  const parentTask = sub ? await Task.findByPk(task.parentTaskId) : null;
  const newCode = sub ? formatSubtaskCode(parentTask.code, number) : formatTaskCode(parent, number);
  if (newCode === task.code) return loadTask(parent, task.id);
  if (await Task.findOne({ where: { code: newCode, id: { [Op.ne]: task.id } } })) {
    throw sub
      ? new ApiError(409, `Subtask S${pad2(number)} already exists in this task. Choose a different number.`, 'SUBTASK_CODE_CONFLICT')
      : new ApiError(409, `Task T${pad2(number)} already exists in this ${parent.kind}. Choose a different number.`, 'TASK_CODE_CONFLICT');
  }
  const oldCode = task.code;
  await sequelize.transaction(async (transaction) => {
    await task.update({ code: newCode }, { transaction });
    if (!sub) { // Q20: subtasks follow their task's new number
      const subtasks = await Task.findAll({ where: { parentTaskId: task.id }, order: ORDER, transaction });
      for (const [i, s] of subtasks.entries()) {
        const n = trailingNumber(s.code, 'S') || i + 1;
        await s.update({ code: formatSubtaskCode(newCode, n) }, { transaction }); // eslint-disable-line no-await-in-loop
      }
    }
  });
  await recordTaskEvent(req, parent, task, 'renumbered', { from: oldCode, to: newCode, detail: { fromCode: oldCode } });
  await audit(req, parent, 'renumber', task, { from: oldCode, to: newCode });
  return loadTask(parent, task.id);
}

module.exports = {
  ticketParent, projectParent, findTask, listTasks, loadTask,
  createTask, updateTask, deleteTask, reorderTasks, renumberTask,
};
```

Note the test 'updates every editable field' sends `dueDate: '2026-12-01'`. `resolveDueDate` refuses values longer than 10 characters, so a timestamp is not silently trimmed to its date.

- [ ] **Step 5: Completion on the new model**

In `backend/src/services/projectCompletion.js`:
- change the require to `const { Task } = require('../models');` and `const { taskStatusBehaviorMap } = require('./tasks/statuses');`;
- in `computeProjectCompletion`, use `const statusIdBehavior = await taskStatusBehaviorMap();` and:

```js
  const tasks = await Task.findAll({
    where: { projectId, parentTaskId: null },
    include: [{ model: Task, as: 'subtasks', separate: true, order: [['position', 'ASC'], ['id', 'ASC']] }],
    order: [['position', 'ASC'], ['id', 'ASC']],
  });
```

`services/tasks/index.js` requires `projectCompletion`, and `projectCompletion` requires `tasks/statuses`, not `tasks/index`. So there is no require cycle.

In `backend/src/services/statusBehavior.js`, delete `getProjectStatusIdBehaviorMap` and its comment. Run `grep -rn getProjectStatusIdBehaviorMap backend/src`. Expected: the only remaining users are `controllers/calendarController.js` and `services/projectReport.js`. Task 8 moves both to `taskStatusBehaviorMap`. Until then, leave the export in place and delete it in Task 8.

- [ ] **Step 6: Project task controller on the service**

Replace `backend/src/controllers/projects/tasks.js` entirely:

```js
// Project tasks and subtasks: thin wrappers over services/tasks. The
// /tasks/:taskId/subtasks URLs are aliases kept for one release; a subtask
// is also reachable as /tasks/:subtaskId.
const { Project } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessProject } = require('../../services/permissionService');
const tasks = require('../../services/tasks');

async function projectFor(req) {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  return tasks.projectParent(project);
}

async function taskFor(parent, rawId) {
  const task = await tasks.findTask(parent, rawId);
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  return task;
}

// The alias URLs name the task and its subtask; both must line up.
async function subtaskFor(parent, req) {
  const task = await taskFor(parent, req.params.taskId);
  const subtask = await tasks.findTask(parent, req.params.subtaskId);
  if (!subtask || subtask.parentTaskId !== task.id) throw new ApiError(404, 'Subtask not found', 'NOT_FOUND');
  return subtask;
}

// GET /projects/:id/tasks — top-level tasks with their subtasks
const listTasks = asyncHandler(async (req, res) => {
  res.json({ tasks: await tasks.listTasks(await projectFor(req)) });
});

// POST /projects/:id/tasks — { title, description?, statusId?, priority?, assigneeId?, dueDate?, estimateMinutes?, parentTaskId?, linkedTicketId? }
const createTask = asyncHandler(async (req, res) => {
  res.status(201).json({ task: await tasks.createTask(req, await projectFor(req), req.body) });
});

// PATCH /projects/:id/tasks/:taskId
const updateTask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ task: await tasks.updateTask(req, parent, await taskFor(parent, req.params.taskId), req.body) });
});

// DELETE /projects/:id/tasks/:taskId
const removeTask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  await tasks.deleteTask(req, parent, await taskFor(parent, req.params.taskId));
  res.json({ ok: true });
});

// PATCH /projects/:id/tasks/reorder — { order: [taskId, ...], parentTaskId? }
const reorderTasks = asyncHandler(async (req, res) => {
  await tasks.reorderTasks(req, await projectFor(req), req.body);
  res.json({ ok: true });
});

// PATCH /projects/:id/tasks/:taskId/code — { number }
const renumberTask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ task: await tasks.renumberTask(req, parent, await taskFor(parent, req.params.taskId), req.body?.number) });
});

// ---- Subtask aliases (one release) ----

const createSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  const task = await taskFor(parent, req.params.taskId);
  if (task.parentTaskId) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  res.status(201).json({ subtask: await tasks.createTask(req, parent, { ...req.body, parentTaskId: task.id }) });
});

const updateSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ subtask: await tasks.updateTask(req, parent, await subtaskFor(parent, req), req.body) });
});

const renumberSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  res.json({ subtask: await tasks.renumberTask(req, parent, await subtaskFor(parent, req), req.body?.number) });
});

const removeSubtask = asyncHandler(async (req, res) => {
  const parent = await projectFor(req);
  await tasks.deleteTask(req, parent, await subtaskFor(parent, req));
  res.json({ ok: true });
});

module.exports = {
  listTasks,
  createTask,
  updateTask,
  removeTask,
  reorderTasks,
  renumberTask,
  createSubtask,
  updateSubtask,
  removeSubtask,
  renumberSubtask,
};
```

The S1 test needs the subtask-alias delete to answer 404 'Task not found' for a task from another project. `subtaskFor` does that by resolving the task through the URL's project first.

- [ ] **Step 7: The rest of the project modules on `Task`**

- **`controllers/projects/shared.js`:**
  - replace `ProjectTask`, `ProjectSubtask` and `ProjectStatus` in the models require with `Task` (keep `ProjectStatus` if anything else in the file uses it; check with grep);
  - delete `taskIncludeFor` and its comment, and remove it from the exports;
  - `resolveProjectTaskId` becomes:

```js
async function resolveProjectTaskId(project, taskId) {
  if (taskId === undefined || taskId === null || taskId === '') return null;
  const id = parseRecordId(taskId);
  const task = id && await Task.findOne({ where: { id, projectId: project.id } });
  if (!task) throw new ApiError(400, 'Task does not belong to this project', 'VALIDATION_ERROR');
  return task.id;
}
```

  Import `parseRecordId` from `../../services/permissionService`. In `buildProjectStats`, replace `ProjectTimeEntry.sum('durationSeconds', { where: { projectId } })` with `TimeEntry.sum('durationSeconds', { where: { projectId } })`, and swap `ProjectTimeEntry` for `TimeEntry` in the require. Task 8 adds labour to the cost.
- **`controllers/projects/expenses.js`, `materials.js` and `files.js`:** wherever `ProjectTask` appears (the `task` include and the require), use `Task`, with `attributes: ['id', 'title', 'code']`.

Then run:

```bash
cd backend && grep -rn "ProjectTask\b\|ProjectSubtask\|taskIncludeFor\|generateTaskCode\|generateSubtaskCode" src/controllers/projects src/services/projectCompletion.js src/services/projectCodeService.js
```

Expected: no output.

- [ ] **Step 8: Run the tests**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/projects.tasks.test.js test/integration/companies.review.test.js`
Expected: PASS.

**If the alias-delete S1 test or a 404 message differs, fix the wrapper, not the test.** The alias contract is "same URLs, same 404s".

- [ ] **Step 9: Commit**

```bash
git add -A -- backend/src/services/tasks backend/src/services/projectCompletion.js backend/src/services/projectCodeService.js backend/src/services/statusBehavior.js backend/src/controllers/projects backend/test/integration/projects.tasks.test.js backend/test/integration/companies.review.test.js
git commit -m "feat(work model): one task service; project tasks and subtasks on it (Q7, Q15, Q20, Q23, Q25, Q31, Q32, Q38)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ticket tasks on the service

**Files:**
- Rewrite: `backend/src/controllers/tickets/tasks.js`
- Modify: `backend/src/routes/tickets.js`, `backend/test/integration/companies.ticketpeople.test.js`
- Rewrite test: `backend/test/integration/tickets.tasks.test.js`

**Interfaces:**
- Consumes: `services/tasks` (Task 4).
- Produces routes:
  - `GET`/`POST /tickets/:id/tasks`;
  - `PATCH /tickets/:id/tasks/reorder`;
  - `PATCH`/`DELETE /tickets/:id/tasks/:taskId`;
  - `PATCH /tickets/:id/tasks/:taskId/code`.

  The ticket controller index gains `removeTask`, `reorderTasks` and `renumberTask`.

- [ ] **Step 1: Rewrite the ticket task tests**

Replace `backend/test/integration/tickets.tasks.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeTicket, taskStatusId, freezeClock, unfreezeClock,
} = require('./fixtures');

// Ticket tasks are real tasks now (sub-project 3): statuses, subtasks, codes,
// reorder and renumber, the same service as project tasks.

let w;
let tech;
let ticket;
let TODO;
let DONE;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, { title: 'Onboard', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id });
  TODO = await taskStatusId(w.admin.agent, 'ticket', 'To do');
  DONE = await taskStatusId(w.admin.agent, 'ticket', 'Done');
});
afterEach(unfreezeClock);
afterAll(closeDb);

const tasksUrl = (t = ticket) => `${API}/tickets/${t.id}/tasks`;
const create = async (body, agent = tech.agent, t = ticket) => expectOk(await agent.post(tasksUrl(t)).send(body), 201).task;
const patch = async (task, body) => expectOk(await tech.agent.patch(`${tasksUrl()}/${task.id}`).send(body)).task;
const pad = () => String(ticket.id).padStart(5, '0');
const activity = async () => expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`)).activity;

it('creates a task, trimmed, in To do, with a code and an assignee', async () => {
  const task = await create({ title: '  Swap toner  ', assigneeId: tech.user.id });
  expect(task).toEqual(expect.objectContaining({
    ticketId: ticket.id, projectId: null, title: 'Swap toner', statusId: TODO, code: `#${pad()}-T01`,
    assigneeId: tech.user.id, completedAt: null, position: 1, subtasks: [],
  }));
  expect(task.status.name).toBe('To do');
  expect(task.assignee.username).toBe('tech');
});

it('requires a title', async () => {
  for (const body of [{}, { title: '   ' }, { description: 'old field name' }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await tech.agent.post(tasksUrl()).send(body);
    expect(res.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
  }
});

it('lists tasks in order, with subtasks nested', async () => {
  freezeClock('2026-03-11T17:00:00Z');
  const fresh = await makeTech('frozen', w.deptA.id);
  const one = await create({ title: 'one' }, fresh.agent);
  const two = await create({ title: 'two' }, fresh.agent);
  const sub = await create({ title: 'one.a', parentTaskId: one.id }, fresh.agent);
  expect(sub.code).toBe(`#${pad()}-T01-S01`);
  const { tasks } = expectOk(await tech.agent.get(tasksUrl()));
  expect(tasks.map((t) => [t.id, t.subtasks.map((s) => s.id)])).toEqual([[one.id, [sub.id]], [two.id, []]]);
});

it('completes and reopens by status', async () => {
  const task = await create({ title: 'x' });
  const done = await patch(task, { statusId: DONE });
  expect([done.status.name, typeof done.completedAt]).toEqual(['Done', 'string']);
  expect((await patch(task, { statusId: TODO })).completedAt).toBeNull();
});

it('refuses a project-scope status', async () => {
  const projectActive = await taskStatusId(w.admin.agent, 'project', 'Active');
  const res = await tech.agent.post(tasksUrl()).send({ title: 'x', statusId: projectActive });
  expect(res.body).toEqual({ error: true, message: 'Unknown task status', code: 'VALIDATION_ERROR' });
});

it('reassigns and unassigns', async () => {
  const task = await create({ title: 'x', assigneeId: tech.user.id });
  expect((await patch(task, { assigneeId: w.admin.user.id })).assigneeId).toBe(w.admin.user.id);
  expect((await patch(task, { assigneeId: null })).assigneeId).toBeNull();
  await patch(task, { assigneeId: tech.user.id });
  expect((await patch(task, { assigneeId: '' })).assigneeId).toBeNull();
});

it('Q38: edits the title, and refuses a blank one', async () => {
  const task = await create({ title: 'old' });
  expect((await patch(task, { title: ' New ' })).title).toBe('New');
  const res = await tech.agent.patch(`${tasksUrl()}/${task.id}`).send({ title: '  ' });
  expect(res.body).toEqual({ error: true, message: 'Task title is required', code: 'VALIDATION_ERROR' });
});

it('ticket tasks can\'t link a ticket', async () => {
  const res = await tech.agent.post(tasksUrl()).send({ title: 'x', linkedTicketId: ticket.id });
  expect(res.body).toEqual({ error: true, message: 'Only project tasks can link a ticket', code: 'VALIDATION_ERROR' });
});

it('reorders, renumbers and deletes', async () => {
  const a = await create({ title: 'a' });
  const b = await create({ title: 'b' });
  expectOk(await tech.agent.patch(`${tasksUrl()}/reorder`).send({ order: [b.id, a.id] }));
  expect(expectOk(await tech.agent.get(tasksUrl())).tasks.map((t) => t.title)).toEqual(['b', 'a']);
  const partial = await tech.agent.patch(`${tasksUrl()}/reorder`).send({ order: [a.id] });
  expect(partial.body.message).toBe('order must list every task at this level exactly once');
  expect(expectOk(await tech.agent.patch(`${tasksUrl()}/${a.id}/code`).send({ number: 7 })).task.code).toBe(`#${pad()}-T07`);
  expectOk(await tech.agent.delete(`${tasksUrl()}/${b.id}`));
  expect(expectOk(await tech.agent.get(tasksUrl())).tasks.map((t) => t.title)).toEqual(['a']);
});

it('a task from another ticket is not found through this one', async () => {
  const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
  const other = await create({ title: 'elsewhere' }, w.admin.agent, t2);
  for (const res of [
    await tech.agent.patch(`${tasksUrl()}/${other.id}`).send({ statusId: DONE }),
    await tech.agent.delete(`${tasksUrl()}/${other.id}`),
    await tech.agent.patch(`${tasksUrl()}/${other.id}/code`).send({ number: 3 }),
  ]) {
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: true, message: 'Task not found', code: 'NOT_FOUND' });
  }
});

it('own-tier users can\'t touch tasks on others\' tickets', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  const task = await create({ title: 'x' });
  for (const res of [
    await own.agent.get(tasksUrl()),
    await own.agent.post(tasksUrl()).send({ title: 'y' }),
    await own.agent.patch(`${tasksUrl()}/${task.id}`).send({ statusId: DONE }),
  ]) {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this ticket');
  }
});

it('tasks of a missing ticket', async () => {
  const res = await tech.agent.get(`${API}/tickets/99999/tasks`);
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('Ticket not found');
});

it('Q8: creating and completing a task writes activity and audit rows', async () => {
  const task = await create({ title: 'Image laptop' });
  await patch(task, { statusId: DONE });
  const acts = (await activity()).map((a) => [a.action, a.toValue]);
  expect(acts).toContainEqual(['task_created', `#${pad()}-T01 Image laptop`]);
  expect(acts).toContainEqual(['task_closed', `#${pad()}-T01 Image laptop`]);
  expect(await models.AuditLog.count({ where: { entityType: 'Task' } })).toBe(2);
});
```

In `backend/test/integration/companies.ticketpeople.test.js`, the two ticket-task posts change `{ description: 'step', … }` to `{ title: 'step', … }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/tickets.tasks.test.js`
Expected: FAIL, because the old controller's `TicketTask` model is now `undefined`.

- [ ] **Step 3: Ticket task controller on the service**

Replace `backend/src/controllers/tickets/tasks.js`:

```js
// Ticket tasks: thin wrappers over services/tasks (the same rules as
// project tasks — statuses, subtasks, codes, reorder, renumber).
const { Ticket } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { canAccessTicket } = require('../../services/permissionService');
const tasks = require('../../services/tasks');

async function ticketFor(req) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  return tasks.ticketParent(ticket);
}

async function taskFor(parent, rawId) {
  const task = await tasks.findTask(parent, rawId);
  if (!task) throw new ApiError(404, 'Task not found', 'NOT_FOUND');
  return task;
}

// GET /tickets/:id/tasks — top-level tasks with their subtasks
const listTasks = asyncHandler(async (req, res) => {
  res.json({ tasks: await tasks.listTasks(await ticketFor(req)) });
});

// POST /tickets/:id/tasks — { title, description?, statusId?, priority?, assigneeId?, dueDate?, estimateMinutes?, parentTaskId? }
const createTask = asyncHandler(async (req, res) => {
  res.status(201).json({ task: await tasks.createTask(req, await ticketFor(req), req.body) });
});

// PATCH /tickets/:id/tasks/:taskId
const updateTask = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  res.json({ task: await tasks.updateTask(req, parent, await taskFor(parent, req.params.taskId), req.body) });
});

// DELETE /tickets/:id/tasks/:taskId
const removeTask = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  await tasks.deleteTask(req, parent, await taskFor(parent, req.params.taskId));
  res.json({ ok: true });
});

// PATCH /tickets/:id/tasks/reorder — { order: [taskId, ...], parentTaskId? }
const reorderTasks = asyncHandler(async (req, res) => {
  await tasks.reorderTasks(req, await ticketFor(req), req.body);
  res.json({ ok: true });
});

// PATCH /tickets/:id/tasks/:taskId/code — { number }
const renumberTask = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  res.json({ task: await tasks.renumberTask(req, parent, await taskFor(parent, req.params.taskId), req.body?.number) });
});

module.exports = {
  listTasks,
  createTask,
  updateTask,
  removeTask,
  reorderTasks,
  renumberTask,
};
```

In `backend/src/routes/tickets.js`, replace the three task routes with:

```js
router.get('/:id/tasks', ctrl.listTasks);
router.post('/:id/tasks', editMin, ctrl.createTask);
router.patch('/:id/tasks/reorder', editMin, ctrl.reorderTasks); // must precede /:taskId
router.patch('/:id/tasks/:taskId', editMin, ctrl.updateTask);
router.delete('/:id/tasks/:taskId', editMin, ctrl.removeTask);
router.patch('/:id/tasks/:taskId/code', editMin, ctrl.renumberTask);
```

The tickets controller index (`ticketsController.js`) spreads `./tickets/tasks`, so the new handlers are exported without other changes.

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/tickets.tasks.test.js test/integration/companies.ticketpeople.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A -- backend/src/controllers/tickets/tasks.js backend/src/routes/tickets.js backend/test/integration/tickets.tasks.test.js backend/test/integration/companies.ticketpeople.test.js
git commit -m "feat(work model): ticket tasks are real tasks (statuses, subtasks, codes) on the task service (Q8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: The time service, ticket and project time on it, and who may log for whom

**Files:**
- Create: `backend/src/services/time/index.js`
- Rewrite: `backend/src/controllers/tickets/time.js`, `backend/src/controllers/projects/time.js`
- Modify:
  - `backend/src/routes/{tickets,projects}.js`;
  - `backend/src/controllers/tickets/{shared,core}.js` and `backend/src/controllers/projects/shared.js` (drop `canLogForOthers`; ticket delete removes its time and tasks);
  - `backend/src/controllers/authController.js` (`canLogTimeForOthers`);
  - `backend/test/integration/helpers.js` (reset `company.timezone`).
- Rewrite tests: `backend/test/integration/time.tickets.test.js`, `time.projects.test.js`
- Create test: `backend/test/integration/time.permissions.test.js`

**Interfaces:**
- Consumes: `ticketParent` / `projectParent` from `services/tasks` (Task 4); `orgTimeZone`, `todayInZone`, `dateInZone` and `toDateString` (Task 1).
- Produces `services/time` exports (Task 7 uses `logTimerEntry`):
  - `listEntries(parent, { limit, offset })`, which returns `{ rows, count, totalSeconds, totalLaborCost }`;
  - `findEntry(parent, rawId)`;
  - `createEntry(req, parent, body)`, `updateEntry(req, parent, entry, body)` and `deleteEntry(req, parent, entry)`;
  - `logTimerEntry(req, parent, { startedAt, endedAt, taskId, note })`;
  - `canManageTimeFor(actor, userId)`.
- Produces routes:
  - `GET`/`POST /tickets/:id/time` and `PATCH`/`DELETE /tickets/:id/time/:entryId` (the `PATCH` is new);
  - `GET`/`POST /projects/:id/time-entries` and `PATCH`/`DELETE /projects/:id/time-entries/:entryId`.

  Every write needs `time.log`. The tickets controller index gains `updateTime`.

- [ ] **Step 1: Write the permission matrix (it must fail first)**

`backend/test/integration/time.permissions.test.js`:

```js
const { resetData, closeDb, ROLE, createUserAndLogin, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeManager, makeUser, makeContractor, makeTicket, makeProject, makeTeam,
  makeCompany, setCompanyAccess, makeContact,
} = require('./fixtures');

// Who may log, edit and delete time, and for whom (spec: Permissions; Q4,
// Q6, Q21). The same rules on both sides of the one ledger.

let w;
let tech;
let mgr;
let ctr;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tech = await makeTech('tech', w.deptA.id);
  mgr = await makeManager('mgr', w.deptA.id);
  ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
});
afterAll(closeDb);

const KINDS = {
  ticket: {
    make: async (fields = {}) => makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id, ...fields }),
    url: (p) => `${API}/tickets/${p.id}/time`,
  },
  project: {
    make: async (fields = {}) => makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id, ...fields }),
    url: (p) => `${API}/projects/${p.id}/time-entries`,
  },
};
const forbidden = (message) => ({ error: true, message, code: 'FORBIDDEN' });
const invalidTarget = { error: true, message: 'Invalid user to log time for', code: 'VALIDATION_ERROR' };

describe.each(Object.keys(KINDS))('on a %s', (kind) => {
  const { make, url } = KINDS[kind];
  let parent;
  beforeEach(async () => {
    parent = await make();
  });
  const log = (u, body) => u.agent.post(url(parent)).send({ durationMinutes: 30, ...body });
  const entryUrl = (e) => `${url(parent)}/${e.id}`;

  it('time.log is required to log, edit or delete', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    const res = await log(ro);
    expect(res.status).toBe(403);
    const e = expectOk(await log(tech), 201).entry;
    expect((await ro.agent.patch(entryUrl(e)).send({ note: 'x' })).status).toBe(403);
    expect((await ro.agent.delete(entryUrl(e))).status).toBe(403);
  });

  it('a technician logs their own time but not someone else\'s', async () => {
    const own = expectOk(await log(tech, { userId: String(tech.user.id) }), 201).entry;
    expect([own.userId, own.loggedById]).toEqual([tech.user.id, tech.user.id]);
    const res = await log(tech, { userId: ctr.user.id });
    expect(res.body).toEqual(forbidden('You can only log time for yourself or people you manage'));
  });

  it('Q6: time.manage_others lets a manager log, edit and delete for others', async () => {
    const e = expectOk(await log(mgr, { userId: ctr.user.id }), 201).entry;
    expect([e.userId, e.loggedById, e.laborCost]).toEqual([ctr.user.id, mgr.user.id, 30]);
    const theirs = expectOk(await log(tech), 201).entry;
    expect(expectOk(await mgr.agent.patch(entryUrl(theirs)).send({ note: 'checked' })).entry.note).toBe('checked');
    expectOk(await mgr.agent.delete(entryUrl(theirs)));
  });

  it('Q6: the permission decides, not the legacy admin role', async () => {
    const granular = await createUserAndLogin({ username: 'granular', roleName: ROLE.ADMIN, legacyRole: 'technician' });
    expect((await log(granular, { userId: tech.user.id })).status).toBe(201);
  });

  it('Q21: a team lead manages time for their own team only', async () => {
    const lead = await makeTech('lead', w.deptA.id);
    await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }, { userId: tech.user.id, isLead: false }]);
    expect((await log(lead, { userId: tech.user.id })).status).toBe(201);
    expect((await log(lead, { userId: ctr.user.id })).body).toEqual(forbidden('You can only log time for yourself or people you manage'));
  });

  it('Q4: the logger and the person it is for may both edit and delete it', async () => {
    const lead = await makeTech('lead', w.deptA.id);
    await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }, { userId: tech.user.id, isLead: false }]);
    const a = expectOk(await log(lead, { userId: tech.user.id }), 201).entry;
    const b = expectOk(await log(lead, { userId: tech.user.id }), 201).entry;
    expectOk(await tech.agent.patch(entryUrl(a)).send({ note: 'mine' }));
    expectOk(await tech.agent.delete(entryUrl(a)));
    expectOk(await lead.agent.delete(entryUrl(b)));
  });

  it('someone else can\'t change it', async () => {
    const e = expectOk(await log(tech), 201).entry;
    expect((await ctr.agent.patch(entryUrl(e)).send({ note: 'x' })).body).toEqual(forbidden('You can only edit your own time entries'));
    expect((await ctr.agent.delete(entryUrl(e))).body).toEqual(forbidden('You can only remove your own time entries'));
  });

  it('the person must exist, be active and be able to log time', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    const gone = await makeTech('gone', w.deptA.id);
    await models.User.update({ isActive: false }, { where: { id: gone.user.id } });
    for (const userId of [ro.user.id, gone.user.id, 99999, '12abc', 1.5]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await log(mgr, { userId })).body).toEqual(invalidTarget);
    }
  });

  it('the person must be able to open the parent\'s company', async () => {
    const acme = await makeCompany(w.admin, { name: 'Acme' });
    const ann = await makeContact(w.admin, { firstName: 'Ann', companyId: acme.id });
    const acmeParent = kind === 'ticket'
      ? await makeTicket(w.admin.agent, { title: 'Acme', contactId: ann.id })
      : await makeProject(w.admin.agent, { name: 'Acme job', companyId: acme.id, ownerDepartmentId: w.deptA.id });
    const internalId = (await models.Company.findOne({ where: { isInternal: true } })).id;
    await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internalId] });
    const res = await w.admin.agent.post(url(acmeParent)).send({ durationMinutes: 30, userId: tech.user.id });
    expect(res.body).toEqual(invalidTarget);
  });

  it('moving an entry to someone else follows the same rules, and recosts it', async () => {
    const e = expectOk(await log(tech), 201).entry;
    expect((await tech.agent.patch(entryUrl(e)).send({ userId: ctr.user.id })).body)
      .toEqual(forbidden('You can only log time for yourself or people you manage'));
    const moved = expectOk(await w.admin.agent.patch(entryUrl(e)).send({ userId: ctr.user.id })).entry;
    expect([moved.userId, moved.laborCost]).toEqual([ctr.user.id, 30]);
  });
});

it('the session flag reflects the permission or a team lead role', async () => {
  const lead = await makeTech('lead', w.deptA.id);
  await makeTeam(w.admin, 'Desk', [{ userId: lead.user.id, isLead: true }]);
  const flag = async (u) => expectOk(await u.agent.get(`${API}/auth/me`)).user.canLogTimeForOthers;
  expect([await flag(mgr), await flag(lead), await flag(tech)]).toEqual([true, true, false]);
});
```

If `makeContact` doesn't accept `companyId`, place the contact through `PATCH /contacts/:id` the way `companies.*.test.js` does. Record a ruling.

- [ ] **Step 2: Rewrite the ticket time tests**

Replace `backend/test/integration/time.tickets.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeTicket, setSettings,
  freezeClock, advanceClock, unfreezeClock,
} = require('./fixtures');

// Ticket time on the one ledger (sub-project 3): what is stored, how it is
// costed, edited and deleted. Who may log for whom: time.permissions.test.js.

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

const timeUrl = (t = ticket) => `${API}/tickets/${t.id}/time`;
const log = async (agent, body, t) => expectOk(await agent.post(timeUrl(t)).send(body), 201).entry;
const patch = (agent, e, body) => agent.patch(`${timeUrl()}/${e.id}`).send(body);
const span = (startTime, endTime) => ({ startTime, endTime });
const today = () => new Date().toISOString().slice(0, 10);
const err = (message) => ({ error: true, message, code: 'VALIDATION_ERROR' });

describe('logging a duration', () => {
  it('logs durationMinutes', async () => {
    const e = await log(tech.agent, { durationMinutes: 45, note: 'Fuser' });
    expect(e).toEqual(expect.objectContaining({
      ticketId: ticket.id, projectId: null, taskId: null, userId: tech.user.id, loggedById: tech.user.id,
      durationSeconds: 2700, startTime: null, endTime: null, note: 'Fuser', entryDate: today(), laborCost: null, billable: true,
    }));
    expect([e.user.username, e.loggedBy.username, e.workType.name]).toEqual(['tech', 'tech', 'Remote support']);
  });

  it('accepts a whole number sent as a string', async () => {
    expect((await log(tech.agent, { durationMinutes: '30' })).durationSeconds).toBe(1800);
  });

  it('refuses anything but a positive whole number', async () => {
    for (const durationMinutes of [0, -5, 'abc', 1.9, true, null, '']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await tech.agent.post(timeUrl()).send({ durationMinutes });
      expect(res.body).toEqual(err('durationMinutes must be a positive whole number'));
    }
  });

  it('needs a duration or a span; the old minutes field is not read', async () => {
    for (const body of [{}, { minutes: 30 }]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send(body)).body).toEqual(err('Send durationMinutes, or startTime and endTime'));
    }
  });
});

describe('logging a span', () => {
  it('derives duration from start and end, to the second, and costs it', async () => {
    const e = await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T16:30:30Z'));
    expect(e).toEqual(expect.objectContaining({
      durationSeconds: 5430, laborCost: 113.13, startTime: '2026-01-05T15:00:00.000Z', endTime: '2026-01-05T16:30:30.000Z',
    }));
    expect((await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T15:00:20Z'))).laborCost).toBe(0.42);
  });

  it('measures across the DST change and midnight by the clock', async () => {
    expect((await log(tech.agent, span('2026-03-08T07:30:00Z', '2026-03-08T08:30:00Z'))).durationSeconds).toBe(3600);
    expect((await log(tech.agent, span('2026-03-09T23:30:00Z', '2026-03-10T00:30:00Z'))).durationSeconds).toBe(3600);
  });

  it('rejects a backwards, empty or unreadable span', async () => {
    const cases = [
      [span('2026-01-05T16:00:00Z', '2026-01-05T15:00:00Z'), 'End time must be after start time'],
      [span('2026-01-05T15:00:00Z', '2026-01-05T15:00:00Z'), 'End time must be after start time'],
      [span('garbage', '2026-01-05T15:00:00Z'), 'Invalid start/end time'],
      [{ startTime: '2026-01-05T15:00:00Z' }, 'Send both startTime and endTime'],
    ];
    for (const [body, message] of cases) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send(body)).body).toEqual(err(message));
    }
  });

  it('half a span with a duration uses the duration', async () => {
    const e = await log(tech.agent, { startTime: '2026-01-05T15:00:00Z', durationMinutes: 10 });
    expect([e.durationSeconds, e.startTime]).toEqual([600, null]);
  });
});

describe('entry dates', () => {
  it('keeps a past entryDate, trims a timestamp to its date, and refuses a non-date', async () => {
    expect((await log(tech.agent, { durationMinutes: 5, entryDate: '2026-01-05' })).entryDate).toBe('2026-01-05');
    expect((await log(tech.agent, { durationMinutes: 5, entryDate: '2026-01-05T22:00:00Z' })).entryDate).toBe('2026-01-05');
    for (const entryDate of ['garbage', '2026-02-30']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, entryDate })).body).toEqual(err('Invalid entry date'));
    }
  });

  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  it('Q14: "today" is the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z');
    const late = await makeTech('late', w.deptA.id); // log in under the frozen clock
    expect(expectOk(await late.agent.post(timeUrl()).send({ durationMinutes: 5 }), 201).entry.entryDate).toBe('2026-03-09');
    const future = await late.agent.post(timeUrl()).send({ durationMinutes: 5, entryDate: '2026-03-10' });
    expect(future.body).toEqual(err('Entry date cannot be in the future'));
  });
});

describe('work type, billable and task', () => {
  it('billable defaults from the work type, and can be overridden', async () => {
    const admin = await models.WorkType.findOne({ where: { name: 'Admin' } });
    const e = await log(tech.agent, { durationMinutes: 5, workTypeId: admin.id });
    expect([e.workType.name, e.billable]).toEqual(['Admin', false]);
    expect((await log(tech.agent, { durationMinutes: 5, workTypeId: admin.id, billable: true })).billable).toBe(true);
    expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, billable: 'yes' })).body).toEqual(err('billable must be true or false'));
  });

  it('refuses an unknown or inactive work type', async () => {
    const travel = await models.WorkType.findOne({ where: { name: 'Travel' } });
    await travel.update({ isActive: false });
    try {
      for (const workTypeId of [99999, '1abc', travel.id]) {
        // eslint-disable-next-line no-await-in-loop
        expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, workTypeId })).body).toEqual(err('Unknown work type'));
      }
    } finally {
      await travel.update({ isActive: true }); // work types are seeded, not reset
    }
  });

  it('logs against a ticket task, never another ticket\'s', async () => {
    const task = expectOk(await tech.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Toner' }), 201).task;
    const e = await log(tech.agent, { durationMinutes: 5, taskId: task.id });
    expect(e.task).toEqual({ id: task.id, title: 'Toner', code: task.code });
    const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const otherTask = expectOk(await w.admin.agent.post(`${API}/tickets/${other.id}/tasks`).send({ title: 'x' }), 201).task;
    for (const taskId of [otherTask.id, '1abc']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tech.agent.post(timeUrl()).send({ durationMinutes: 5, taskId })).body).toEqual(err('Task does not belong to this ticket'));
    }
  });
});

describe('editing (new on tickets)', () => {
  it('edits every field, recosts it and audits it', async () => {
    const e = await log(ctr.agent, span('2026-01-05T15:00:00Z', '2026-01-05T16:30:00Z'));
    expect(e.laborCost).toBe(112.5);
    const edited = expectOk(await patch(ctr.agent, e, {
      ...span('2026-01-05T15:00:00Z', '2026-01-05T15:30:00Z'), note: 'shorter', entryDate: '2026-01-04', billable: false,
    })).entry;
    expect(edited).toEqual(expect.objectContaining({ durationSeconds: 1800, laborCost: 37.5, note: 'shorter', entryDate: '2026-01-04', billable: false }));
    expect(await models.AuditLog.count({ where: { entityType: 'TimeEntry', action: 'time.update' } })).toBe(1);
    const toPlain = expectOk(await patch(ctr.agent, e, { durationMinutes: 60 })).entry;
    expect([toPlain.durationSeconds, toPlain.startTime, toPlain.laborCost]).toEqual([3600, null, 75]);
  });

  it('refuses a future work date on edit too', async () => {
    const e = await log(tech.agent, { durationMinutes: 5 });
    expect((await patch(tech.agent, e, { entryDate: '2099-01-01' })).body).toEqual(err('Entry date cannot be in the future'));
    expect((await patch(tech.agent, e, { entryDate: null })).body).toEqual(err('Invalid entry date'));
  });
});

describe('listing and activity', () => {
  it('lists newest first with whole-ticket totals', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const fresh = await makeTech('frozen', w.deptA.id);
    for (const durationMinutes of [10, 20, 30]) {
      // eslint-disable-next-line no-await-in-loop
      await log(fresh.agent, { durationMinutes });
      advanceClock(1000);
    }
    const body = expectOk(await fresh.agent.get(`${timeUrl()}?limit=1`));
    expect(body.entries.map((e) => e.durationSeconds)).toEqual([1800]);
    expect(body).toEqual(expect.objectContaining({ total: 3, totalPages: 3, totalSeconds: 3600, totalLaborCost: null }));
  });

  it('entries written in the same second list newest id first', async () => {
    freezeClock('2026-03-11T17:00:00Z');
    const fresh = await makeTech('frozen', w.deptA.id);
    const a = await log(fresh.agent, { durationMinutes: 1 });
    const b = await log(fresh.agent, { durationMinutes: 2 });
    expect(expectOk(await fresh.agent.get(timeUrl())).entries.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('logs a time_logged activity entry', async () => {
    await log(tech.agent, { durationMinutes: 45 });
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${ticket.id}/activity`));
    const entry = activity.find((a) => a.action === 'time_logged');
    expect([entry.fromValue, entry.toValue, entry.user.username]).toEqual([null, '45m', 'tech']);
  });

  it('a ticket with no time', async () => {
    expect(expectOk(await tech.agent.get(timeUrl()))).toEqual({
      entries: [], page: 1, limit: 25, total: 0, totalPages: 1, totalSeconds: 0, totalLaborCost: null,
    });
  });
});

describe('deleting', () => {
  it('users delete their own entries, audited', async () => {
    const e = await log(tech.agent, { durationMinutes: 5 });
    expect(expectOk(await tech.agent.delete(`${timeUrl()}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(timeUrl())).entries).toEqual([]);
    expect(await models.AuditLog.count({ where: { entityType: 'TimeEntry', action: 'time.delete' } })).toBe(1);
  });

  it('an entry from another ticket is not found through this one', async () => {
    const t2 = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id });
    const e = await log(w.admin.agent, { durationMinutes: 5 }, t2);
    for (const res of [await w.admin.agent.delete(`${timeUrl()}/${e.id}`), await patch(w.admin.agent, e, { note: 'x' })]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Time entry not found', code: 'NOT_FOUND' });
    }
  });

  it('deleting the ticket deletes its time and tasks', async () => {
    await log(tech.agent, { durationMinutes: 5 });
    expectOk(await tech.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'x' }), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${ticket.id}`));
    expect(await models.TimeEntry.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect(await models.Task.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});

it('own-tier users can\'t log or list on others\' tickets', async () => {
  const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
  for (const res of [await own.agent.get(timeUrl()), await own.agent.post(timeUrl()).send({ durationMinutes: 5 })]) {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have access to this ticket');
  }
});
```

`today()` here is the UTC date, which is right because `company.timezone` is reset to its default (UTC) between tests (Step 7).

- [ ] **Step 3: Rewrite the project time tests**

Replace `backend/test/integration/time.projects.test.js`:

```js
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeOwnTier, makeContractor, makeProject, makeTask, makeSubtask,
  setSettings, freezeClock, unfreezeClock,
} = require('./fixtures');

// Project time on the one ledger (sub-project 3): the same body and rules as
// ticket time. Who may log for whom: time.permissions.test.js.

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

const url = (p = proj) => `${API}/projects/${p.id}/time-entries`;
const span = (start, end) => ({ startTime: `2026-01-05T${start}:00Z`, endTime: `2026-01-05T${end}:00Z` });
const log = async (agent, body, p) => expectOk(await agent.post(url(p)).send(body), 201).entry;
const patch = (agent, e, body) => agent.patch(`${url()}/${e.id}`).send(body);
const today = () => new Date().toISOString().slice(0, 10);
const err = (message) => ({ error: true, message, code: 'VALIDATION_ERROR' });

describe('logging', () => {
  it('logs a span against a task', async () => {
    const e = await log(ctr.agent, { ...span('15:00', '16:30'), note: 'Rack', taskId: task.id, entryDate: '2026-01-05' });
    expect(e).toEqual(expect.objectContaining({
      projectId: proj.id, ticketId: null, taskId: task.id, userId: ctr.user.id, loggedById: ctr.user.id, note: 'Rack',
      durationSeconds: 5400, entryDate: '2026-01-05', laborCost: 112.5, billable: true,
    }));
    expect([e.task, e.workType.name]).toEqual([{ id: task.id, title: 'Rack', code: task.code }, 'Project work']);
  });

  it('a plain duration works on projects too', async () => {
    const e = await log(tech.agent, { durationMinutes: 30 });
    expect(e).toEqual(expect.objectContaining({ durationSeconds: 1800, startTime: null, entryDate: today(), note: null, taskId: null }));
  });

  it('logs against a subtask of this project, never another project\'s task', async () => {
    const sub = await makeSubtask(w.admin.agent, proj.id, task.id, { title: 'Cable' });
    expect((await log(tech.agent, { durationMinutes: 5, taskId: sub.id })).taskId).toBe(sub.id);
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const qTask = await makeTask(w.admin.agent, q.id);
    expect((await tech.agent.post(url()).send({ ...span('09:00', '10:00'), taskId: qTask.id })).body)
      .toEqual(err('Task does not belong to this project'));
  });

  it('the old body fields are not read', async () => {
    const e = await log(w.admin.agent, { ...span('15:00', '16:00'), loggedForUserId: ctr.user.id, description: 'old' });
    expect([e.userId, e.note]).toEqual([w.admin.user.id, null]);
  });

  // 03:30 UTC on the 10th is 22:30 on the 9th in America/Chicago.
  it('Q14: "today" is the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z');
    const late = await makeTech('late', w.deptA.id);
    const body = { startTime: '2026-03-10T02:00:00Z', endTime: '2026-03-10T03:00:00Z' };
    expect((await late.agent.post(url()).send({ ...body, entryDate: '2026-03-10' })).body).toEqual(err('Entry date cannot be in the future'));
    expect((await log(late.agent, body)).entryDate).toBe('2026-03-09');
  });

  it('lists newest first with whole-project totals', async () => {
    await log(tech.agent, span('09:00', '10:00'));
    expect(expectOk(await tech.agent.get(url()))).toEqual(expect.objectContaining({ totalSeconds: 3600, totalLaborCost: null }));
    await log(ctr.agent, span('15:00', '16:30'));
    const body = expectOk(await tech.agent.get(`${url()}?limit=1`));
    expect(body.entries).toHaveLength(1);
    expect(body).toEqual(expect.objectContaining({ total: 2, totalSeconds: 9000, totalLaborCost: 112.5 }));
  });

  it('logs a time_logged activity entry', async () => {
    await log(ctr.agent, span('15:00', '16:30'));
    const { activity } = expectOk(await tech.agent.get(`${API}/projects/${proj.id}/activity`));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['time_logged', { minutes: 90 }]);
  });
});

describe('editing', () => {
  it('edits note, date, task and span', async () => {
    const e = await log(tech.agent, { ...span('09:00', '10:00'), taskId: task.id });
    const changes = { note: 'new', entryDate: '2026-01-04', taskId: null };
    expect(expectOk(await patch(tech.agent, e, changes)).entry).toEqual(expect.objectContaining(changes));
    expect(expectOk(await patch(tech.agent, e, span('10:00', '10:45'))).entry.durationSeconds).toBe(2700);
  });

  it('Q1: editing the span recomputes labour cost', async () => {
    const e = await log(ctr.agent, span('15:00', '16:30'));
    const edited = expectOk(await patch(ctr.agent, e, span('15:00', '15:30'))).entry;
    expect([edited.durationSeconds, edited.laborCost]).toEqual([1800, 37.5]);
  });

  it('Q2: editing writes an audit row', async () => {
    const e = await log(ctr.agent, span('15:00', '16:30'));
    expectOk(await patch(ctr.agent, e, { note: 'changed' }));
    const actions = (await models.AuditLog.findAll({ where: { entityType: 'TimeEntry' }, order: [['id', 'ASC']] })).map((r) => r.action);
    expect(actions).toEqual(['time.create', 'time.update']);
  });

  it('Q3: editing refuses a future entryDate', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect((await patch(tech.agent, e, { entryDate: '2099-01-01' })).body).toEqual(err('Entry date cannot be in the future'));
  });

  it('Q22: editing refuses another project\'s task', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const qTask = await makeTask(w.admin.agent, q.id);
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect((await patch(tech.agent, e, { taskId: qTask.id })).body).toEqual(err('Task does not belong to this project'));
  });

  it('edit validates a given span and refuses half of one', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect((await patch(tech.agent, e, { startTime: 'garbage', endTime: 'x' })).body).toEqual(err('Invalid start/end time'));
    expect((await patch(tech.agent, e, span('11:00', '10:00'))).body).toEqual(err('End time must be after start time'));
    expect((await patch(tech.agent, e, { startTime: '2026-01-05T08:00:00Z' })).body).toEqual(err('Send both startTime and endTime'));
  });
});

describe('deleting and scope', () => {
  it('users delete their own entries', async () => {
    const e = await log(tech.agent, span('09:00', '10:00'));
    expect(expectOk(await tech.agent.delete(`${url()}/${e.id}`))).toEqual({ ok: true });
    expect(expectOk(await tech.agent.get(url())).entries).toEqual([]);
  });

  it('an entry from another project is not found through this one', async () => {
    const q = await makeProject(w.admin.agent, { name: 'Q', ownerDepartmentId: w.deptA.id });
    const e = await log(w.admin.agent, span('09:00', '10:00'), q);
    for (const res of [await patch(w.admin.agent, e, { note: 'x' }), await w.admin.agent.delete(`${url()}/${e.id}`)]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: true, message: 'Time entry not found', code: 'NOT_FOUND' });
    }
  });

  it('own-tier users can\'t log or list on projects they aren\'t on', async () => {
    const own = await makeOwnTier(w.admin, 'own', w.deptA.id);
    for (const res of [await own.agent.get(url()), await own.agent.post(url()).send(span('09:00', '10:00'))]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You do not have access to this project');
    }
  });
});
```

- [ ] **Step 4: Run the three files to verify they fail**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/time.permissions.test.js test/integration/time.tickets.test.js test/integration/time.projects.test.js`
Expected: FAIL, with 500s from the old controllers (their models are gone) and 404s for the new `PATCH` route.

- [ ] **Step 5: Write the time service**

`backend/src/services/time/index.js`:

```js
// The one time ledger's rules (sub-project 3): logging, editing and deleting
// time on a ticket or a project, the same on both sides. Controllers find the
// parent and check access; the timer logs through logTimerEntry.
const { Op } = require('sequelize');
const {
  TimeEntry, Task, User, WorkType, TeamMember,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logActivity } = require('../ticketActivity');
const { logProjectActivity } = require('../projectActivity');
const { canWorkCompany } = require('../ticketPeople');
const { hasPermission, parseRecordId } = require('../permissionService');
const { calculateLaborCost } = require('../../utils/laborCost');
const {
  orgTimeZone, todayInZone, dateInZone, toDateString,
} = require('../../utils/orgTime');

const userAttrs = ['id', 'displayName', 'username', 'email'];
const entryInclude = [
  { model: User, as: 'user', attributes: userAttrs },
  { model: User, as: 'loggedBy', attributes: userAttrs },
  { model: Task, as: 'task', attributes: ['id', 'title', 'code'] },
  { model: WorkType, as: 'workType', attributes: ['id', 'name'] },
];
// A new entry's work type when none is sent: by side, else the first active one.
const DEFAULT_WORK_TYPE = { ticket: 'Remote support', project: 'Project work' };
const NEWEST_FIRST = [['createdAt', 'DESC'], ['id', 'DESC']];

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const given = (v) => v !== undefined && v !== null && v !== '';
const cleanNote = (v) => (given(v) ? String(v).trim() || null : null);
const displayMinutes = (seconds) => Math.max(1, Math.round(seconds / 60));

const loadEntry = (id) => TimeEntry.findByPk(id, { include: entryInclude });

async function findEntry(parent, rawId) {
  const id = parseRecordId(rawId);
  return id ? TimeEntry.findOne({ where: { id, ...parent.where } }) : null;
}

async function listEntries(parent, { limit, offset }) {
  const { rows, count } = await TimeEntry.findAndCountAll({
    where: parent.where, include: entryInclude, order: NEWEST_FIRST, limit, offset,
  });
  // The headline totals cover the whole ticket or project, not the page.
  const [seconds, labour] = await Promise.all([
    TimeEntry.sum('durationSeconds', { where: parent.where }),
    TimeEntry.sum('laborCost', { where: parent.where }),
  ]);
  return {
    rows, count, totalSeconds: Number(seconds) || 0, totalLaborCost: labour == null ? null : Number(labour),
  };
}

// ---- Body rules ----

function parseSpan(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad('Invalid start/end time');
  const durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
  if (durationSeconds <= 0) throw bad('End time must be after start time');
  return { startTime: start, endTime: end, durationSeconds };
}

// durationMinutes, or startTime + endTime (a full span wins when both come).
function readDuration(body, required) {
  const hasStart = given(body.startTime);
  const hasEnd = given(body.endTime);
  if (hasStart && hasEnd) return parseSpan(body.startTime, body.endTime);
  if (body.durationMinutes !== undefined) {
    const raw = body.durationMinutes;
    const n = Number(raw);
    if ((typeof raw !== 'number' && typeof raw !== 'string') || raw === '' || !Number.isInteger(n) || n < 1) {
      throw bad('durationMinutes must be a positive whole number');
    }
    return { startTime: null, endTime: null, durationSeconds: n * 60 };
  }
  if (hasStart || hasEnd) throw bad('Send both startTime and endTime');
  if (required) throw bad('Send durationMinutes, or startTime and endTime');
  return null;
}

// The work date: never in the future, where "today" is the organization's (Q3, Q14).
async function resolveEntryDate(value, { onEdit }) {
  const today = todayInZone(await orgTimeZone());
  if (!given(value)) {
    if (onEdit) throw bad('Invalid entry date');
    return today;
  }
  const date = toDateString(value);
  if (!date) throw bad('Invalid entry date');
  if (date > today) throw bad('Entry date cannot be in the future');
  return date;
}

// A task or subtask under the same ticket or project (S13).
async function resolveTaskId(parent, value) {
  if (!given(value)) return null;
  const id = parseRecordId(value);
  const task = id && await Task.findOne({ where: { id, ...parent.where }, attributes: ['id'] });
  if (!task) throw bad(`Task does not belong to this ${parent.kind}`);
  return task.id;
}

async function defaultWorkType(parent) {
  return (await WorkType.findOne({ where: { name: DEFAULT_WORK_TYPE[parent.kind], isActive: true } }))
    || WorkType.findOne({ where: { isActive: true }, order: [['position', 'ASC'], ['id', 'ASC']] });
}

// An inactive work type is refused, unless the entry already has it.
async function resolveWorkType(value, currentId = null) {
  const id = parseRecordId(value);
  const type = id && await WorkType.findByPk(id);
  if (!type || (!type.isActive && type.id !== currentId)) throw bad('Unknown work type');
  return type;
}

function resolveBillable(value) {
  if (value !== true && value !== false) throw bad('billable must be true or false');
  return value;
}

// ---- Who may log for whom (Q4, Q6, Q21) ----

async function isLeadOf(leadId, memberId) {
  const led = await TeamMember.findAll({ where: { userId: leadId, isLead: true }, attributes: ['teamId'] });
  if (!led.length) return false;
  const member = await TeamMember.findOne({
    where: { userId: memberId, teamId: { [Op.in]: led.map((m) => m.teamId) } }, attributes: ['teamId'],
  });
  return !!member;
}

// time.manage_others, or leading a team the person is in.
async function canManageTimeFor(actor, userId) {
  if (!userId) return false;
  if (await hasPermission(actor.id, 'time.manage_others')) return true;
  return isLeadOf(actor.id, userId);
}

// Who the time is for. Someone else needs the right to manage their time,
// and must be active, able to log time, and able to open the parent's company.
async function resolveTarget(req, parent, value) {
  if (!given(value)) return req.user;
  const id = parseRecordId(value);
  if (!id) throw bad('Invalid user to log time for');
  if (id === req.user.id) return req.user;
  if (!(await canManageTimeFor(req.user, id))) {
    throw new ApiError(403, 'You can only log time for yourself or people you manage', 'FORBIDDEN');
  }
  const target = await User.findByPk(id);
  if (!target || !target.isActive || !(await hasPermission(target.id, 'time.log'))
    || !(await canWorkCompany(target.id, parent.companyId))) {
    throw bad('Invalid user to log time for');
  }
  return target;
}

// An entry is yours if it's for you or you entered it (Q4).
async function assertCanChange(req, entry, verb) {
  const own = entry.userId === req.user.id || entry.loggedById === req.user.id;
  if (own || (await canManageTimeFor(req.user, entry.userId))) return;
  throw new ApiError(403, `You can only ${verb} your own time entries`, 'FORBIDDEN');
}

// ---- Create / edit / delete ----

async function logged(req, parent, entry, action) {
  await writeAudit(req, action, 'TimeEntry', entry.id, { ...parent.where, durationSeconds: entry.durationSeconds });
  const minutes = displayMinutes(entry.durationSeconds);
  if (parent.kind === 'ticket') await logActivity(parent.record.id, req.user.id, 'time_logged', null, `${minutes}m`);
  else await logProjectActivity(parent.record.id, req.user.id, 'time_logged', { minutes });
}

async function createEntry(req, parent, body = {}) {
  const duration = readDuration(body, true);
  const target = await resolveTarget(req, parent, body.userId);
  const entryDate = await resolveEntryDate(body.entryDate, { onEdit: false });
  const taskId = await resolveTaskId(parent, body.taskId);
  const workType = given(body.workTypeId) ? await resolveWorkType(body.workTypeId) : await defaultWorkType(parent);
  if (!workType) throw bad('No active work type is configured');
  const entry = await TimeEntry.create({
    ...parent.where,
    taskId,
    userId: target.id,
    loggedById: req.user.id,
    entryDate,
    ...duration,
    billable: body.billable === undefined ? workType.billableDefault : resolveBillable(body.billable),
    workTypeId: workType.id,
    note: cleanNote(body.note),
    laborCost: calculateLaborCost(target, { durationSeconds: duration.durationSeconds }),
  });
  await logged(req, parent, entry, 'time.create');
  return loadEntry(entry.id);
}

async function updateEntry(req, parent, entry, body = {}) {
  await assertCanChange(req, entry, 'edit');
  const changes = {};
  const duration = readDuration(body, false);
  if (duration) Object.assign(changes, duration);
  let target = null;
  if (body.userId !== undefined && parseRecordId(body.userId) !== entry.userId) {
    target = await resolveTarget(req, parent, body.userId);
    changes.userId = target.id;
  }
  if (body.entryDate !== undefined) changes.entryDate = await resolveEntryDate(body.entryDate, { onEdit: true });
  if (body.taskId !== undefined) changes.taskId = await resolveTaskId(parent, body.taskId);
  if (body.workTypeId !== undefined) changes.workTypeId = (await resolveWorkType(body.workTypeId, entry.workTypeId)).id;
  if (body.billable !== undefined) changes.billable = resolveBillable(body.billable);
  if (body.note !== undefined) changes.note = cleanNote(body.note);
  if (changes.durationSeconds !== undefined || changes.userId !== undefined) { // Q1
    const forUser = target || await User.findByPk(entry.userId);
    changes.laborCost = calculateLaborCost(forUser, { durationSeconds: changes.durationSeconds ?? entry.durationSeconds });
  }
  await entry.update(changes);
  await writeAudit(req, 'time.update', 'TimeEntry', entry.id, { ...parent.where, fields: Object.keys(changes) }); // Q2
  return loadEntry(entry.id);
}

async function deleteEntry(req, parent, entry) {
  await assertCanChange(req, entry, 'remove');
  await entry.destroy();
  await writeAudit(req, 'time.delete', 'TimeEntry', entry.id, { ...parent.where, durationSeconds: entry.durationSeconds });
}

// The running timer's time: a span from its start, by the person running it,
// dated on the organization's calendar (Q5). Under a second still counts one.
async function logTimerEntry(req, parent, { startedAt, endedAt, taskId, note }) {
  const start = new Date(startedAt);
  const durationSeconds = Math.max(1, Math.floor((new Date(endedAt).getTime() - start.getTime()) / 1000));
  const task = taskId ? await Task.findOne({ where: { id: taskId, ...parent.where }, attributes: ['id'] }) : null;
  const workType = await defaultWorkType(parent);
  if (!workType) throw bad('No active work type is configured');
  const entry = await TimeEntry.create({
    ...parent.where,
    taskId: task ? task.id : null,
    userId: req.user.id,
    loggedById: req.user.id,
    entryDate: dateInZone(start, await orgTimeZone()),
    startTime: start,
    endTime: new Date(start.getTime() + durationSeconds * 1000),
    durationSeconds,
    billable: workType.billableDefault,
    workTypeId: workType.id,
    note: cleanNote(note) || 'Timer',
    laborCost: calculateLaborCost(req.user, { durationSeconds }),
  });
  await logged(req, parent, entry, 'timer.log');
  return loadEntry(entry.id);
}

module.exports = {
  listEntries, findEntry, createEntry, updateEntry, deleteEntry, logTimerEntry, canManageTimeFor,
};
```

- [ ] **Step 6: Controllers and routes on the service**

Replace `backend/src/controllers/tickets/time.js`:

```js
// Ticket time: thin wrappers over services/time (the one ledger).
const { Ticket } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { parsePagination, paginated } = require('../../utils/pagination');
const { canAccessTicket } = require('../../services/permissionService');
const { ticketParent } = require('../../services/tasks');
const time = require('../../services/time');
const { SUBLIST_LIMIT, SUBLIST_MAX } = require('./shared');

async function ticketFor(req) {
  const ticket = await Ticket.findByPk(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found', 'NOT_FOUND');
  if (!(await canAccessTicket(req.user, ticket))) throw new ApiError(403, 'You do not have access to this ticket', 'FORBIDDEN');
  return ticketParent(ticket);
}

async function entryFor(parent, rawId) {
  const entry = await time.findEntry(parent, rawId);
  if (!entry) throw new ApiError(404, 'Time entry not found', 'NOT_FOUND');
  return entry;
}

// GET /tickets/:id/time
const listTime = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count, totalSeconds, totalLaborCost } = await time.listEntries(parent, { limit, offset });
  res.json({ ...paginated('entries', { rows, count }, { page, limit }), totalSeconds, totalLaborCost });
});

// POST /tickets/:id/time — { durationMinutes | startTime+endTime, entryDate?, note?, taskId?, workTypeId?, billable?, userId? }
const createTime = asyncHandler(async (req, res) => {
  res.status(201).json({ entry: await time.createEntry(req, await ticketFor(req), req.body) });
});

// PATCH /tickets/:id/time/:entryId
const updateTime = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  res.json({ entry: await time.updateEntry(req, parent, await entryFor(parent, req.params.entryId), req.body) });
});

// DELETE /tickets/:id/time/:entryId
const removeTime = asyncHandler(async (req, res) => {
  const parent = await ticketFor(req);
  await time.deleteEntry(req, parent, await entryFor(parent, req.params.entryId));
  res.json({ ok: true });
});

module.exports = {
  listTime,
  createTime,
  updateTime,
  removeTime,
};
```

Replace `backend/src/controllers/projects/time.js` the same way:
- `projectFor` uses `Project` and `canAccessProject`, with the messages 'Project not found' and 'You do not have access to this project';
- `projectParent` replaces `ticketParent`;
- the handlers are named `listTimeEntries`, `createTimeEntry`, `updateTimeEntry` and `removeTimeEntry`;
- `SUBLIST_LIMIT, SUBLIST_MAX` come from `./shared`.

In `backend/src/routes/tickets.js`, after `const manageWatchers…` add `const logTime = requirePermission('time.log');`. Then replace the time routes with:

```js
router.get('/:id/time', ctrl.listTime);
router.post('/:id/time', logTime, ctrl.createTime);
router.patch('/:id/time/:entryId', logTime, ctrl.updateTime);
router.delete('/:id/time/:entryId', logTime, ctrl.removeTime);
```

In `backend/src/routes/projects.js`, change `const logTime = requirePermission('projects.log_time');` to `requirePermission('time.log')`, and change the `POST /:id/time-entries` route to use `logTime`. Update the comment above the time routes to "Time entries (time.log; the same rules as ticket time)".

Remove `canLogForOthers` (its function and its export, and the `TeamMember` import if nothing else uses it) from `controllers/tickets/shared.js` and `controllers/projects/shared.js`. Run `grep -rn canLogForOthers backend/src`. Expected: no output.

In `backend/src/controllers/tickets/core.js` `remove`, inside the existing transaction and before `ticket.destroy`, add:

```js
    // The ledger and tasks have no database cascade (sub-project 3): a
    // ticket's time and tasks go with it, as the old foreign keys did.
    await TimeEntry.destroy({ where: { ticketId: ticket.id }, transaction: t });
    await Task.destroy({ where: { ticketId: ticket.id }, transaction: t });
```

Add `Task` to `core.js`'s models require (`TimeEntry` is already there).

In `backend/src/controllers/authController.js`, replace `serializeUserWithFlags`'s flag and its comment:

```js
// Whether the user may log time for other people: time.manage_others, or
// leading a team (services/time decides per person; this only shows the field).
async function serializeUserWithFlags(user) {
  const canLogTimeForOthers = (await hasPermission(user.id, 'time.manage_others'))
    || !!(await TeamMember.findOne({ where: { userId: user.id, isLead: true } }));
  return { ...user.toJSON(), canLogTimeForOthers };
}
```

Add `hasPermission` to its `permissionService` require.

- [ ] **Step 7: Reset the organization's time zone between tests**

In `backend/test/integration/helpers.js`, the `SystemSettings` cleanup in `resetData` gains `` OR `key` = 'company.timezone' ``.

- [ ] **Step 8: Run the tests**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/time.permissions.test.js test/integration/time.tickets.test.js test/integration/time.projects.test.js`
Expected: PASS.

**If `setSettings` refuses `company.timezone`:** check `settingsController`'s writable keys. It is in `DEFAULTS`, so it should save. If PATCH filters it out, write the row with `models.SystemSettings.upsert` in the test and record a ruling. **Don't** widen what the settings API accepts.

- [ ] **Step 9: Commit**

```bash
git add -A -- backend/src/services/time backend/src/controllers/tickets backend/src/controllers/projects backend/src/routes/tickets.js backend/src/routes/projects.js backend/src/controllers/authController.js backend/test/integration/helpers.js backend/test/integration/time.permissions.test.js backend/test/integration/time.tickets.test.js backend/test/integration/time.projects.test.js
git commit -m "feat(work model): one time service on the ledger; time.log and time.manage_others (Q1-Q4, Q6, Q14, Q21)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The timer on the ledger

**Files:**
- Rewrite: `backend/src/controllers/timerController.js`
- Modify: `backend/src/routes/timer.js`
- Rewrite test: `backend/test/integration/time.timer.test.js`

**Interfaces:**
- Consumes: `services/time.logTimerEntry` (Task 6), and `ticketParent` / `projectParent` (Task 4).
- Produces the endpoints:
  - `GET /timer` returns `{ timer: { type, id, taskId, label, startedAt } | null }`;
  - `POST /timer/start { type: 'ticket'|'project', id, taskId?, label? }`;
  - `POST /timer/stop { note? }` returns `{ timer: null, entry }`, or `{ timer: null, entry: null, discarded: true, message }`;
  - `DELETE /timer`.

  All need `time.log`.

- [ ] **Step 1: Rewrite the timer tests**

Replace `backend/test/integration/time.timer.test.js`:

```js
const { resetData, closeDb, ROLE } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeStaff, makeUser, makeContractor, makeTicket, makeProject, makeTask,
  setSettings, freezeClock, advanceClock, unfreezeClock,
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
    expect([res.status, res.body.timer.id]).toEqual([201, mine.id]);
  });
});

describe('the timer', () => {
  let T;
  let T2;
  let P;
  beforeEach(async () => {
    T = await makeTicket(w.admin.agent, { title: 'Printer', contactId: w.contact.id, departmentId: w.deptA.id });
    T2 = await makeTicket(w.admin.agent, { title: 'Scanner', contactId: w.contact.id, departmentId: w.deptA.id });
    P = await makeProject(w.admin.agent, { name: 'Refresh', ownerDepartmentId: w.deptA.id });
  });
  const start = (u, body) => u.agent.post(`${API}/timer/start`).send(body);
  const onTicket = (u, t, extra = {}) => start(u, { type: 'ticket', id: t.id, ...extra });
  const stop = async (u, body = {}) => expectOk(await u.agent.post(`${API}/timer/stop`).send(body));
  const current = async (u) => expectOk(await u.agent.get(`${API}/timer`)).timer;

  it('needs time.log', async () => {
    const ro = await makeUser('ro', ROLE.READ_ONLY, w.deptA.id);
    expect((await ro.agent.get(`${API}/timer`)).status).toBe(403);
  });

  it('validates start', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    const otherTask = expectOk(await w.admin.agent.post(`${API}/tickets/${T2.id}/tasks`).send({ title: 'x' }), 201).task;
    const cases = [
      [{ type: 'asset', id: T.id }, 400, 'Invalid timer type', 'VALIDATION_ERROR'],
      [{ type: 'ticket' }, 400, 'A target id is required', 'VALIDATION_ERROR'],
      [{ type: 'ticket', id: '1abc' }, 400, 'A target id is required', 'VALIDATION_ERROR'],
      [{ type: 'ticket', id: 99999 }, 404, 'Ticket not found', 'NOT_FOUND'],
      [{ type: 'project', id: 99999 }, 404, 'Project not found', 'NOT_FOUND'],
      [{ type: 'ticket', id: T.id, taskId: otherTask.id }, 400, 'Task does not belong to this ticket', 'VALIDATION_ERROR'],
    ];
    for (const [body, status, message, code] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await start(tech, body);
      expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
    }
  });

  it('starts a timer, on a ticket, a project or a task', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const res = await onTicket(tech, T, { label: 'Working' });
    const timer = { type: 'ticket', id: T.id, taskId: null, label: 'Working', startedAt: '2026-03-11T15:00:00.000Z' };
    expect([res.status, res.body]).toEqual([201, { timer, logged: null }]);
    expect(await current(tech)).toEqual(timer);
    const task = await makeTask(w.admin.agent, P.id, { title: 'Rack' });
    const onTask = expectOk(await start(tech, { type: 'project', id: P.id, taskId: task.id }), 201);
    expect(onTask.timer).toEqual(expect.objectContaining({ type: 'project', id: P.id, taskId: task.id }));
  });

  it('starting the same target again changes nothing', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    advanceClock(60 * 1000);
    const res = await onTicket(tech, T);
    expect([res.status, res.body.timer.startedAt, res.body.logged]).toEqual([200, '2026-03-11T15:00:00.000Z', null]);
  });

  it('starting another target logs the first', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    advanceClock(600 * 1000);
    const res = await onTicket(tech, T2);
    expect(res.status).toBe(201);
    expect(res.body.logged).toEqual(expect.objectContaining({
      ticketId: T.id, durationSeconds: 600, note: 'Timer', startTime: '2026-03-11T15:00:00.000Z', endTime: '2026-03-11T15:10:00.000Z',
    }));
  });

  it('stopping with no timer', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expect(await stop(tech)).toEqual({ timer: null, entry: null });
  });

  it('Q5: stopping logs a span, by the person, on the organization\'s date', async () => {
    await setSettings(w.admin, { 'company.timezone': 'America/Chicago' });
    freezeClock('2026-03-10T03:30:00Z'); // 22:30 on the 9th in Chicago
    const tech = await makeTech('tech', w.deptA.id);
    expectOk(await onTicket(tech, T, { label: 'Working' }), 201);
    advanceClock(125 * 1000);
    const { entry, timer } = await stop(tech, { note: 'Done' });
    expect(timer).toBeNull();
    expect(entry).toEqual(expect.objectContaining({
      ticketId: T.id, userId: tech.user.id, loggedById: tech.user.id, durationSeconds: 125, note: 'Done',
      startTime: '2026-03-10T03:30:00.000Z', endTime: '2026-03-10T03:32:05.000Z', entryDate: '2026-03-09', laborCost: null,
    }));
    expect(entry.workType.name).toBe('Remote support');
    expect(await current(tech)).toBeNull();
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).totalSeconds).toBe(125);
  });

  it('a project timer on a task logs project time on that task', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const task = await makeTask(w.admin.agent, P.id, { title: 'Rack' });
    expectOk(await start(tech, { type: 'project', id: P.id, taskId: task.id }), 201);
    advanceClock(1800 * 1000);
    const { entry } = await stop(tech);
    expect([entry.projectId, entry.taskId, entry.durationSeconds, entry.workType.name]).toEqual([P.id, task.id, 1800, 'Project work']);
    const { activity } = expectOk(await tech.agent.get(`${API}/projects/${P.id}/activity`));
    expect(activity.map((a) => [a.action, a.detail])).toContainEqual(['time_logged', { minutes: 30 }]);
  });

  it('under a second still logs one second; the activity says 1m', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    expect((await stop(tech)).entry.durationSeconds).toBe(1);
    const { activity } = expectOk(await tech.agent.get(`${API}/tickets/${T.id}/activity`));
    expect(activity.map((a) => [a.action, a.toValue])).toContainEqual(['time_logged', '1m']);
  });

  it('charges a contractor for the elapsed time', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await onTicket(ctr, T);
    advanceClock(1800 * 1000);
    expect((await stop(ctr)).entry.laborCost).toBe(30);
  });

  it('cancel discards without logging', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    await onTicket(tech, T);
    expect(expectOk(await tech.agent.delete(`${API}/timer`))).toEqual({ ok: true, timer: null });
    expect(expectOk(await tech.agent.get(`${API}/tickets/${T.id}/time`)).total).toBe(0);
  });

  it('each user has their own timer', async () => {
    freezeClock('2026-03-11T15:00:00Z');
    const tech = await makeTech('tech', w.deptA.id);
    const ctr = await makeContractor(w.admin, 'ctr', w.deptA.id, { rate: 60 });
    await onTicket(tech, T);
    advanceClock(60 * 1000);
    await onTicket(ctr, T);
    expect((await current(tech)).startedAt).toBe('2026-03-11T15:00:00.000Z');
    expect((await current(ctr)).startedAt).toBe('2026-03-11T15:01:00.000Z');
  });

  it('Q34: a timer whose ticket was deleted is discarded, with a reason, by stop or by a new start', async () => {
    const tech = await makeTech('tech', w.deptA.id);
    expectOk(await onTicket(tech, T2), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${T2.id}`));
    expect(await stop(tech)).toEqual({
      timer: null, entry: null, discarded: true,
      message: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
    });
    expectOk(await onTicket(tech, T), 201); // a fresh start works after the discard
    const T3 = await makeTicket(w.admin.agent, { title: 'Gone soon', contactId: w.contact.id, departmentId: w.deptA.id });
    expectOk(await onTicket(tech, T3), 201);
    expectOk(await w.admin.agent.delete(`${API}/tickets/${T3.id}`));
    const replaced = expectOk(await onTicket(tech, T), 201);
    expect(replaced.logged).toBeNull();
    expect((await current(tech)).id).toBe(T.id);
  });

  it('a timer on something the user can no longer open is discarded, with a reason', async () => {
    const staff = await makeStaff('staff', w.deptA.id);
    expectOk(await onTicket(staff, T), 201);
    expectOk(await w.admin.agent.patch(`${API}/tickets/${T.id}`).send({ departmentId: w.deptB.id }));
    expect(await stop(staff)).toEqual({
      timer: null, entry: null, discarded: true,
      message: 'You no longer have access to what this timer was running on, so its time was discarded.',
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/time.timer.test.js`
Expected: FAIL. Examples: the timer shape has no `taskId`; `type: 'project'` answers 'Invalid timer type'; stop fails because `TimeEntry` has no `minutes` column.

- [ ] **Step 3: Rewrite the timer controller**

Replace `backend/src/controllers/timerController.js`:

```js
// The running timer: one per user, on a ticket or a project, optionally on
// one of its tasks. Stopping or switching writes the elapsed time to the
// ledger through services/time.
const { ActiveTimer, Ticket, Project, Task } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { canAccessTicket, canAccessProject, parseRecordId } = require('../services/permissionService');
const { ticketParent, projectParent } = require('../services/tasks');
const time = require('../services/time');

const KINDS = {
  ticket: { Model: Ticket, toParent: ticketParent, canAccess: canAccessTicket, label: 'Ticket' },
  project: { Model: Project, toParent: projectParent, canAccess: canAccessProject, label: 'Project' },
};
const DISCARDED = {
  gone: 'The ticket or project this timer was running on has been deleted, so its time was discarded.',
  denied: 'You no longer have access to what this timer was running on, so its time was discarded.',
};

function shape(t) {
  return t ? {
    type: t.entityType, id: t.entityId, taskId: t.taskId ?? null, label: t.label, startedAt: t.startedAt,
  } : null;
}

// Writes the running timer to the ledger. A parent that was deleted, or that
// the user can no longer open, can't take the time: it's discarded, with the
// reason (Q34).
async function logTimer(req, timer, note) {
  const kind = KINDS[timer.entityType];
  const record = kind && await kind.Model.findByPk(timer.entityId);
  if (!record) return { entry: null, discarded: DISCARDED.gone };
  if (!(await kind.canAccess(req.user, record))) return { entry: null, discarded: DISCARDED.denied };
  const entry = await time.logTimerEntry(req, kind.toParent(record), {
    startedAt: timer.startedAt, endedAt: new Date(), taskId: timer.taskId, note,
  });
  return { entry, discarded: null };
}

// GET /timer — the current user's running timer (or null).
const get = asyncHandler(async (req, res) => {
  res.json({ timer: shape(await ActiveTimer.findOne({ where: { userId: req.user.id } })) });
});

// POST /timer/start { type: 'ticket' | 'project', id, taskId?, label? }
// Starting while another timer runs logs that one first.
const start = asyncHandler(async (req, res) => {
  const { type, label } = req.body || {};
  const kind = KINDS[type];
  if (!kind) throw new ApiError(400, 'Invalid timer type', 'VALIDATION_ERROR');
  const targetId = parseRecordId(req.body?.id);
  if (!targetId) throw new ApiError(400, 'A target id is required', 'VALIDATION_ERROR');
  const record = await kind.Model.findByPk(targetId);
  if (!record) throw new ApiError(404, `${kind.label} not found`, 'NOT_FOUND');
  // A timer logs time there when it stops, so starting one needs access to it.
  if (!(await kind.canAccess(req.user, record))) throw new ApiError(403, `You do not have access to this ${type}`, 'FORBIDDEN');

  let taskId = null;
  const rawTask = req.body?.taskId;
  if (rawTask !== undefined && rawTask !== null && rawTask !== '') {
    const id = parseRecordId(rawTask);
    const task = id && await Task.findOne({ where: { id, ...kind.toParent(record).where }, attributes: ['id'] });
    if (!task) throw new ApiError(400, `Task does not belong to this ${type}`, 'VALIDATION_ERROR');
    taskId = task.id;
  }

  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  let logged = null;
  if (existing) {
    if (existing.entityType === type && existing.entityId === targetId && (existing.taskId ?? null) === taskId) {
      return res.json({ timer: shape(existing), logged: null });
    }
    ({ entry: logged } = await logTimer(req, existing));
    await existing.destroy();
  }

  const created = await ActiveTimer.create({
    userId: req.user.id, entityType: type, entityId: targetId, taskId, label: label || null, startedAt: new Date(),
  });
  res.status(201).json({ timer: shape(created), logged });
});

// POST /timer/stop { note? } — logs and clears the running timer.
const stop = asyncHandler(async (req, res) => {
  const existing = await ActiveTimer.findOne({ where: { userId: req.user.id } });
  if (!existing) return res.json({ timer: null, entry: null });
  const { entry, discarded } = await logTimer(req, existing, req.body?.note);
  await existing.destroy();
  res.json(discarded ? { timer: null, entry: null, discarded: true, message: discarded } : { timer: null, entry });
});

// DELETE /timer — discards the running timer without logging.
const cancel = asyncHandler(async (req, res) => {
  await ActiveTimer.destroy({ where: { userId: req.user.id } });
  res.json({ ok: true, timer: null });
});

module.exports = { get, start, stop, cancel };
```

In `backend/src/routes/timer.js`, use `router.use(requirePermission('time.log'));`, and change the comment to "The timer exists to produce time entries, so it needs time.log."

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/time.timer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A -- backend/src/controllers/timerController.js backend/src/routes/timer.js backend/test/integration/time.timer.test.js
git commit -m "feat(work model): the timer on the ledger; tickets, projects and tasks (Q5, Q34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Every reader on the ledger

**Files:**
- **Backend `controllers/`:**
  - `reports/{shared,time,team,projects,tickets,sla,assets,licenses,contacts,happiness}.js`;
  - `reportsController.js` (the `PUBLIC_HELPERS` list);
  - `projects/shared.js`, `tickets/core.js`, `dashboardController.js` and `calendarController.js`.
- **Backend `services/`:** `customReportEngine.js`, `ticketReport.js`, `projectReport.js` and `statusBehavior.js`.
- **Tests:**
  - `readers.reports.test.js`, `readers.other.test.js` and `fixtures.js` (`makeLedger`);
  - `pagination.test.js`, `projects.core.test.js` and `tickets.core.test.js`;
  - `sideEffects.test.js`, `fixtures.test.js`, `authorization.test.js` and `functional.test.js`;
  - `companies.reports.test.js` and `security.s12-s17.test.js`.

**Interfaces:**
- **Consumes:** the ledger model (Task 3); `taskStatusBehaviorMap` (Task 3); `orgTimeZone`, `todayInZone`, `addDays`, `zoneDayStart`, `zoneDayEnd` and `toDateString` (Task 1).
- **Produces in `reports/shared.js`:**
  - `parseDateRange(query)` is now **async** and returns `{ start, end, startDate, endDate }`: instants bounding whole days in the organization's zone (Q36), plus the date strings;
  - `dateOnlyWhere(field, range)` for DATEONLY columns;
  - `ledgerCompanyWhere(user, companyId)`, which fences time through its ticket **or** its project. It needs `ticket` and `project` includes.

  `dateOnlyWhere`, `ledgerCompanyWhere` and `parseDateRange` are added to the reports index's `PUBLIC_HELPERS`.

- [ ] **Step 1: Move the other test files to the new bodies, and fix the reader quirk tests**

These changes make the tests describe the fixed behaviour. They fail until Steps 2–6.

**Request bodies.** In every file listed below:
- ticket time posts `durationMinutes` instead of `minutes`, and `note` instead of `description`;
- project time posts `userId` instead of `loggedForUserId`, and `note` instead of `description`;
- ticket tasks post `title` instead of `description`.

| File | What changes |
|---|---|
| `fixtures.js` | `makeLedger`'s `{ minutes: 90, entryDate }` |
| `fixtures.test.js` | `{ minutes: 30 }` |
| `authorization.test.js` | the ticket-task and ticket-time bodies |
| `functional.test.js` | the ticket-task and ticket-time bodies, and any assertion on `.minutes` (it becomes `.durationSeconds`) |
| `companies.reports.test.js` | ticket time (`durationMinutes`); project time (`userId`) |
| `readers.reports.test.js` | `boiler()` and the view_own test |
| `tickets.core.test.js` | line ~288 |
| `sideEffects.test.js` | ticket time and timer bodies |
| `security.s12-s17.test.js` | the S14 and S16 setup posts |

**Model use in tests:**
- `pagination.test.js`:
  - the ticket-time seed becomes `TimeEntry.create({ ticketId, userId, loggedById: userId, entryDate: '2026-03-10', durationSeconds: 600, workTypeId })`, with `workTypeId` read once from `models.WorkType.findOne({ where: { name: 'Remote support' } })`;
  - it asserts `totalSeconds: 18000` in place of `totalMinutes: 300`;
  - the project-time seed becomes the same `TimeEntry.create` with `projectId` and the `Project work` type.
- `projects.core.test.js` (the Q13 quirk, still pinned until 3b-2): use `models.Task.count({ where: { projectId: p.id } })` and `models.TimeEntry.count({ where: { projectId: p.id } })`.

**Audit metadata in `sideEffects.test.js`:**
- ticket time create: `{ ticketId: t.id, durationSeconds: 2700 }`;
- ticket time delete: `{ ticketId: t.id, durationSeconds: 2700 }`, with a numeric id;
- timer: `{ ticketId: t.id, durationSeconds: <the elapsed seconds the test advances> }`;
- project time create: `entityType: 'TimeEntry'`, `{ projectId: p.id, durationSeconds: 3600 }`;
- project time delete: `{ projectId: p.id, durationSeconds: 3600 }`.

**Quirk tests in `readers.reports.test.js`** (the ledger: Tina 90 min ticket time dated 03-02; Carl 1 h ticket time and 30 min project time on 03-11; Tina 2 h project time on 03-10; clock frozen at 2026-03-11T17:00Z):

```js
    it('Q9: time is dated and filtered by its work date', async () => {
      const { summary } = await get(w.admin.agent, 'time-billing?startDate=2026-03-01&endDate=2026-03-05');
      expect(summary).toEqual(expect.objectContaining({ entryCount: 1, totalHours: 1.5 }));
    });

    it('Q36: report days are whole days in the organization\'s time zone', async () => {
      // The ledger's ticket was created at 17:00 UTC on the 11th: 02:00 on the 12th in Tokyo.
      const created = async (day) => (await get(w.admin.agent, `ticket-volume?startDate=${day}&endDate=${day}`)).summary.totalCreated;
      expect(await created('2026-03-11')).toBe(1);
      await setSettings(w.admin, { 'company.timezone': 'Asia/Tokyo' });
      expect([await created('2026-03-11'), await created('2026-03-12')]).toEqual([0, 1]);
    });
```

```js
    it('Q10: team performance counts all of a person\'s time', async () => {
      const body = await get(w.admin.agent, 'team-performance');
      expect(rowFor(body, 'Test tina').totalHoursLogged).toBe(3.5);
      expect(rowFor(body, 'Test carl').totalHoursLogged).toBe(1.5);
    });
```

```js
    it('Q11: the projects report\'s total cost includes labour', async () => {
      const [row] = (await get(w.admin.agent, 'projects')).tableData.rows;
      expect(row).toEqual({
        id: L.project.id, projectCode: 'SD-P00001', name: 'Refresh', ownedBy: 'Service Desk', forDept: 'Service Desk',
        status: 'Active', completion: 0, dueDate: '', timeLoggedHours: 2.5, materialsCost: 50, expensesCost: 100,
        laborCost: 37.5, totalCost: 187.5,
      });
    });

    it('projects report summary', async () => {
      expect((await get(w.admin.agent, 'projects')).summary).toEqual({
        totalActive: 1, totalCompletedInPeriod: 0, avgCompletion: 0, totalMaterialsCost: 50, totalExpensesCost: 100, totalLaborCost: 37.5,
      });
    });
```

Add `setSettings` to the file's fixtures import. The time-billing CSV test keeps its expected line `'Test carl,#00001 Printer,,2026-03-11,1,75'`: Carl's ticket entry's work date is 03-11.

**`readers.other.test.js`:**
- In 'every reader agrees on the ledger':
  - `ticketTime.totalMinutes / 60` becomes `ticketTime.totalSeconds / 3600`;
  - `sum(ticketPdf.timeEntries, (e) => e.minutes) / 60` becomes `sum(ticketPdf.timeEntries, (e) => e.durationSeconds) / 3600`.
- Its leading comment drops the "Team performance (Q10) and the dashboard (Q12) are left out" sentence. Add `teamTina` and `dashTina` checks to the same test instead:

```js
    const team = expectOk(await a.get(`${API}/reports/team-performance`)).tableData.rows;
    expect(team.find((r) => r.name === 'Test tina').totalHoursLogged).toBe(3.5);
```

- Replace the `week` helper and the two Q12 tests:

```js
    const week = (byDay = {}) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, hours: byDay[day] || 0 }));

    it('Q12: dashboard hours are all of this week\'s time, by work date', async () => {
      const dash = await hoursFor(L.tina.user.id);
      expect(dash.mode).toBe('admin_filtered');
      // Her 2 h of project time is on Tuesday the 10th; her ticket time is dated the 2nd, last week.
      expect(dash.hours).toEqual({ total: 2, byDay: week({ Tue: 2 }) });
    });

    it('Q12: the weekend counts, and days follow the work date', async () => {
      const url = `${API}/tickets/${L.ticket.id}/time`;
      const sat = expectOk(await L.tina.agent.post(url).send({ durationMinutes: 60 }), 201).entry;
      expectOk(await L.tina.agent.post(url).send({ durationMinutes: 30 }), 201);
      // No endpoint takes a future work date; move one to Saturday directly.
      await models.TimeEntry.update({ entryDate: '2026-03-14' }, { where: { id: sat.id } });
      expect((await hoursFor(L.tina.user.id)).hours).toEqual({ total: 3.5, byDay: week({ Tue: 2, Wed: 0.5, Sat: 1 }) });
    });
```

- The own-tier dashboard test expects `{ total: 0, byDay: week() }`.
- The custom-projects Q11 test's name loses `[quirk]`: "the custom projects source counts labour in total cost". Its expectations are unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/readers.reports.test.js test/integration/readers.other.test.js`
Expected: FAIL. The old readers query `minutes` and `loggedAt`, and `ProjectTimeEntry` is undefined.

- [ ] **Step 3: Shared report helpers**

In `backend/src/controllers/reports/shared.js`:
- add `const { orgTimeZone, zoneDayStart, zoneDayEnd, toDateString } = require('../../utils/orgTime');`;
- add `companyFilterWhere, isEmpty` to the `recordScope` require.

Then replace `parseDateRange` with:

```js
// Report date ranges are whole days in the organization's time zone (Q36):
// from startDate's local midnight to the last moment of endDate. The date
// strings come along for DATEONLY columns (work dates, due dates).
async function parseDateRange(query) {
  const tz = await orgTimeZone();
  const startDate = toDateString(query.startDate);
  const endDate = toDateString(query.endDate);
  return {
    start: startDate ? zoneDayStart(startDate, tz) : null,
    end: endDate ? zoneDayEnd(endDate, tz) : null,
    startDate,
    endDate,
  };
}
```

Add after `dateWhere`:

```js
// The same range on a DATEONLY column.
function dateOnlyWhere(field, range) {
  const clause = {};
  if (range.startDate) clause[Op.gte] = range.startDate;
  if (range.endDate) clause[Op.lte] = range.endDate;
  return Object.getOwnPropertySymbols(clause).length ? { [field]: clause } : {};
}

// Time is fenced through its ticket or its project, whichever it's on. The
// query must include both as `ticket` and `project`.
async function ledgerCompanyWhere(user, companyId) {
  const [onTicket, onProject] = await Promise.all([
    companyFilterWhere(user, companyId, '$ticket.companyId$'),
    companyFilterWhere(user, companyId, '$project.companyId$'),
  ]);
  if (isEmpty(onTicket) && isEmpty(onProject)) return {};
  return {
    [Op.or]: [
      andWhere({ ticketId: { [Op.ne]: null } }, onTicket),
      andWhere({ projectId: { [Op.ne]: null } }, onProject),
    ],
  };
}
```

Export both. In `controllers/reportsController.js`, add `'dateOnlyWhere'` and `'ledgerCompanyWhere'` to `PUBLIC_HELPERS`.

Every `parseDateRange(` call in `controllers/reports/*.js` becomes `await parseDateRange(`. That covers `team`, `sla`, `tickets` (×3), `assets` (×3), `licenses`, `projects`, `contacts`, `happiness` (×2) and `time`; each is inside an `async` builder. For a DATEONLY column, swap `dateWhere` for `dateOnlyWhere`:
- in `assets.js`, the `replacementPlanDate` and `warrantyExpiryDate` filters;
- in `licenses.js`, any expiry/renewal date filter that `grep -n "dateWhere(" licenses.js` shows on a DATEONLY column.

Run `grep -rn "parseDateRange(" backend/src | grep -v "await parseDateRange\|function parseDateRange"`.
Expected: only `controllers/csatController.js`, which has its own local, synchronous `parseDateRange`. Leave that one alone.

- [ ] **Step 4: Time & billing, team performance and the projects report**

`controllers/reports/time.js`: replace the body of `buildTimeBillingReport` from `let ticketWhere` down to the end of `normalized` with:

```js
  // Q9: time is dated and filtered by its work date.
  let where = dateOnlyWhere('entryDate', range);
  const deptOf = (id) => ({ [Op.or]: [{ '$ticket.departmentId$': id }, { '$project.ownerDepartmentId$': id }] });
  if (scope === 'department') where = andWhere(where, deptOf(req.user.departmentId));
  else if (scope === 'own') where = andWhere(where, { userId: req.user.id });
  else if (scope === 'all' && deptId) where = andWhere(where, deptOf(deptId));
  // ANDed, never merged: under 'own' scope the scope itself is on userId (S14).
  if (assigneeId) where = andWhere(where, { userId: assigneeId });
  where = andWhere(where, await ledgerCompanyWhere(req.user, req.query.companyId));

  const entries = await TimeEntry.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: userAttrs },
      {
        model: Ticket, as: 'ticket', attributes: ['id', 'title', 'type', 'departmentId'], required: false,
        include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      },
      {
        model: Project, as: 'project', attributes: ['id', 'name'], required: false,
        include: [{ model: Department, as: 'ownerDepartment', attributes: ['id', 'name'] }],
      },
    ],
    order: [['entryDate', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
  });

  const normalized = entries.map((e) => {
    const isProject = e.projectId != null;
    return {
      date: e.entryDate,
      user: e.user,
      minutes: e.durationSeconds / 60,
      isProject,
      ticketType: isProject ? null : e.ticket?.type || null,
      reference: isProject
        ? (e.project ? `Project: ${e.project.name}` : 'Project')
        : (e.ticket ? `#${String(e.ticket.id).padStart(5, '0')} ${e.ticket.title}` : ''),
      department: isProject ? e.project?.ownerDepartment || null : e.ticket?.department || null,
      note: e.note,
      laborCost: e.laborCost,
    };
  });
```

In the table rows, `date` becomes `e.date || ''`. Fix the requires:
- models: `Ticket, TimeEntry, User, Project, Department` (drop `ProjectTimeEntry`);
- add `const { Op } = require('sequelize');`;
- add `dateOnlyWhere, ledgerCompanyWhere` to the `./shared` import;
- `companyFilterWhere` is no longer needed here.

`controllers/reports/team.js`: replace the `TimeEntry.findAll` in the `Promise.all` and the `timeTicketInclude` const above it with:

```js
    // Q10: all of a person's time in the ledger, by work date, fenced
    // through its ticket or project.
    TimeEntry.findAll({
      where: andWhere(
        { userId: { [Op.in]: techIds }, ...dateOnlyWhere('entryDate', range) },
        await ledgerCompanyWhere(req.user, req.query.companyId)
      ),
      include: [
        { model: Ticket, as: 'ticket', attributes: [], required: false },
        { model: Project, as: 'project', attributes: [], required: false },
      ],
      attributes: ['userId', [fn('SUM', col('TimeEntry.durationSeconds')), 'seconds']],
      group: ['TimeEntry.userId'],
      raw: true,
    }),
```

Change the `timeByTech` line to `const timeByTech = new Map(timeEntries.map((r) => [r.userId, (Number(r.seconds) || 0) / 60]));`. Wherever `timeByTech` minutes become hours later in the function, the existing `/ 60` math stays. Add `Project` and the two helpers to the requires.

`controllers/reports/projects.js`, in the per-project `Promise.all`:

```js
    const [completion, timeSum, laborSum, expenseSum, materialSum] = await Promise.all([
      computeProjectCompletion(p.id),
      TimeEntry.sum('durationSeconds', { where: { projectId: p.id } }),
      TimeEntry.sum('laborCost', { where: { projectId: p.id } }),
      ProjectExpense.sum('amount', { where: { projectId: p.id } }),
      ProjectMaterial.sum('totalCost', { where: { projectId: p.id } }),
    ]);
    const labor = Number(laborSum) || 0;
```

The row gains `laborCost: Math.round(labor * 100) / 100`, and `totalCost` becomes `Math.round((materials + expenses + labor) * 100) / 100` (Q11). In the columns, add `{ key: 'laborCost', label: 'Labor cost' }` before `totalCost`. In the summary, add `totalLaborCost`, the rounded sum of the rows' `laborCost`, after `totalExpensesCost`. Replace `ProjectTimeEntry` with `TimeEntry` in the require.

`controllers/projects/shared.js` `buildProjectStats`: add `TimeEntry.sum('laborCost', { where: { projectId } })` to its `Promise.all`. Set `totalCost: Number(expenseSum || 0) + Number(materialSum || 0) + Number(laborSum || 0)` and add `laborCost: Number(laborSum || 0)` to the returned stats (Q11).

- [ ] **Step 5: Ticket totals, the dashboard, the calendar and the PDF reports**

`controllers/tickets/core.js` `timeLoggedByTicket`:

```js
  const totals = await TimeEntry.findAll({
    where: { ticketId: { [Op.in]: ticketIds } },
    attributes: ['ticketId', [sequelize.fn('SUM', sequelize.col('durationSeconds')), 'total']],
    group: ['ticketId'],
    raw: true,
  });
  return new Map(totals.map((r) => [r.ticketId, Math.round((Number(r.total) || 0) / 60)]));
```

The `requireBeforeClose` count (`TimeEntry.count({ where: { ticketId } })`) already reads the ledger.

`controllers/dashboardController.js`: change `WEEKDAYS` to `['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']`, require `{ orgTimeZone, todayInZone, addDays }` from `../utils/orgTime`, and replace `hoursForUser`:

```js
// This week's hours (Monday first) on the organization's calendar, by work
// date, every day — ticket and project time alike (Q12).
async function hoursForUser(userId) {
  const today = todayInZone(await orgTimeZone());
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = WEEKDAYS.map((label, i) => ({ label, date: addDays(today, i - sinceMonday) }));
  const entries = await TimeEntry.findAll({
    where: { userId, entryDate: { [Op.gte]: days[0].date, [Op.lte]: days[6].date } },
    attributes: ['entryDate', 'durationSeconds'],
  });
  const byDay = days.map(({ label, date }) => {
    const seconds = entries.filter((e) => e.entryDate === date).reduce((sum, e) => sum + e.durationSeconds, 0);
    return { day: label, hours: Math.round((seconds / 3600) * 10) / 10 };
  });
  const total = Math.round(byDay.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
  return { total, byDay };
}
```

Leave `startOfWeek` for its other callers. If nothing else uses it, delete it.

`controllers/calendarController.js`, in the tasks branch:
- the models require swaps `ProjectTask` for `Task`;
- `getProjectStatusIdBehaviorMap` becomes `taskStatusBehaviorMap` (from `../services/tasks/statuses`);
- `ProjectStatus.findAll()` becomes `TaskStatus.findAll({ where: { scope: 'project' } })`;
- the `where` gains `parentTaskId: null`;
- `where.assignedToUserId = assigneeId` becomes `where.assigneeId = assigneeId`;
- the attribute list and `assigneeId: task.assignedToUserId` use `assigneeId`.

`services/ticketReport.js`: order the time by `[['entryDate', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]`. In the renderer, both `e.durationSeconds != null ? e.durationSeconds : (e.minutes || 0) * 60` expressions become `e.durationSeconds`.

`services/projectReport.js`:
- **Tasks:** load them with `Task.findAll({ where: { projectId: project.id, parentTaskId: null }, include: [assignee, { model: TaskStatus, as: 'status' }, { model: Task, as: 'subtasks', separate: true, order: [['position', 'ASC'], ['id', 'ASC']], include: [assignee, { model: TaskStatus, as: 'status' }] }], order: [['position', 'ASC'], ['id', 'ASC']] })`.
- **Time:** load it with `TimeEntry.findAll({ where: { projectId: project.id }, include: [{ model: User, as: 'user', attributes: [...userAttrs, 'userType'] }, { model: Task, as: 'task', attributes: ['id', 'title', 'code'] }], order: [['entryDate', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']] })`.
- **Renderer renames:** `statusIdBehavior` comes from `taskStatusBehaviorMap()`, `t.taskCode` becomes `t.code`, `s.subtaskCode` becomes `s.code`, `e.loggedFor` becomes `e.user` and `e.description` becomes `e.note`.

With calendar and project report moved, delete `getProjectStatusIdBehaviorMap` from `services/statusBehavior.js`.

- [ ] **Step 6: The custom report engine**

In `services/customReportEngine.js`:
- **Date ranges:** each of the five `const range = { start: …, end: … }` lines becomes `const range = await rc.parseDateRange(filters);` (Q36).
- **Tickets source:** `timeTotals` sums the ledger:

```js
  const timeTotals = ticketIds.length
    ? await TimeEntry.findAll({ where: { ticketId: { [Op.in]: ticketIds } }, attributes: ['ticketId', 'durationSeconds'], raw: true })
    : [];
  const minutesByTicket = new Map();
  timeTotals.forEach((r) => minutesByTicket.set(r.ticketId, (minutesByTicket.get(r.ticketId) || 0) + r.durationSeconds / 60));
```

- **Projects source:** the two `ProjectTimeEntry.sum` calls become `TimeEntry.sum(…, { where: { projectId: p.id } })`.
- **`loadTimeEntryRecords`** becomes one ledger query:

```js
async function loadTimeEntryRecords(req, filters) {
  const scope = await getUserReportScope(req.user.id);
  const range = await rc.parseDateRange(filters);
  // Q9: by work date. Filters are ANDed onto the reader's scope (S16).
  let where = rc.dateOnlyWhere('entryDate', range);
  const deptOf = (id) => ({ [Op.or]: [{ '$ticket.departmentId$': id }, { '$project.ownerDepartmentId$': id }] });
  if (scope === 'department') where = andWhere(where, deptOf(req.user.departmentId));
  else if (scope === 'own') where = andWhere(where, { userId: req.user.id });
  else if (scope === 'all' && filters.departmentId) where = andWhere(where, deptOf(filters.departmentId));
  if (filters.assigneeId) where = andWhere(where, { userId: filters.assigneeId });
  where = andWhere(where, await rc.ledgerCompanyWhere(req.user, filters.companyId));

  const entries = await TimeEntry.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: [...userAttrs, 'userType'] },
      { model: Ticket, as: 'ticket', attributes: ['id', 'title', 'departmentId'], required: false },
      { model: Project, as: 'project', attributes: ['id', 'projectCode', 'ownerDepartmentId'], required: false },
    ],
    order: [['entryDate', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
  });

  let records = entries.map((e) => ({
    id: e.id,
    date: e.entryDate,
    techName: e.user?.displayName || 'Unknown',
    userType: e.user?.userType === 'contractor' ? 'Contractor' : 'Internal',
    ticketNumber: e.ticket ? `#${String(e.ticket.id).padStart(5, '0')}` : '',
    projectCode: e.project?.projectCode || '',
    description: e.note || '',
    durationHours: Math.round((e.durationSeconds / 3600) * 10) / 10,
    laborCost: e.laborCost != null ? Number(e.laborCost) : null,
    _userTypeRaw: e.user?.userType || 'internal',
    _techId: e.user?.id ?? 'unknown',
    _month: (e.entryDate || '').slice(0, 7),
  }));
  if (filters.userType) records = records.filter((r) => r._userTypeRaw === filters.userType);
  return records;
}
```

The models require drops `ProjectTimeEntry`. Run `grep -n "ProjectTimeEntry\|minutes\b" backend/src/services/customReportEngine.js`.
Expected: nothing except `minutesByTicket`.

The `groupBy` for `time_entries` keys on `ticketNumber` and `projectCode`, and both still exist. In the engine's `FIELD_DEFS.time_entries`, keep `description` as the field key (it is the column label the saved custom reports reference), filled from `note` as above.

- [ ] **Step 7: Nothing reads the old models any more**

Run:

```bash
cd backend && grep -rn "ProjectTimeEntry\|ProjectSubtask\|\bProjectTask\b\|TicketTask\|loggedForUserId\|assignedToUserId: t\|\.minutes\b\|'minutes'\|getProjectStatusIdBehaviorMap" src | grep -v "^src/migrations"
```

Expected: no output, apart from these legitimate leftovers:
- `assignedToUserId` on `Projects` (a project's lead) and on `Assets` and `CsatSurveys`;
- `minutes` in unrelated code (SLA, business hours).

Read each remaining hit before deciding it's one of those.

- [ ] **Step 8: Run the readers and the rest of the suite**

Run: `cd backend && npx cross-env NODE_OPTIONS=--experimental-vm-modules jest test/integration/readers.reports.test.js test/integration/readers.other.test.js test/integration/companies.reports.test.js test/integration/security.s12-s17.test.js test/integration/pagination.test.js`
Expected: PASS.

Then run the whole backend suite in the background: `cd backend && npm test > /tmp/<scratch>/3b1-t8.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/<scratch>/3b1-t8.log`
Expected: every suite passes.

**If a test fails:**
- **It pins the old shape** (an old field name, an old audit meta, `minutes`): update it to the new contract and record a ruling naming the file and the change.
- **It fails for any other reason:** it's a bug in Tasks 2–8. Fix the code.

- [ ] **Step 9: Commit**

```bash
git add -A -- backend/src backend/test/integration
git commit -m "feat(work model): every reader on the ledger — reports, dashboard, custom reports, calendar, PDFs (Q9-Q12, Q36)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Today's screens on the new API

These are the smallest frontend changes that keep the current ticket and project pages working on the unified API. Plan 3c replaces these pages' task and time parts with shared components; don't redesign anything here.

**Files:**
- **Ticket page:** `frontend/src/pages/tickets/TicketDetail.jsx` and `frontend/src/pages/tickets/detail/{TasksTab,TimeEntriesTab,TimerWidget,ActivityTab}.jsx`.
- **Project page:** `frontend/src/pages/projects/ProjectDetail.jsx` and `frontend/src/pages/projects/detail/{TasksTab,TaskDetailModal,TimeTab,ActivityTab}.jsx`.
- **Smoke tests:** `backend/test/smoke/work.tickets.smoke.js`, `backend/test/smoke/work.projects.smoke.js`; create `backend/test/smoke/work.ledger.smoke.js`.

**Interfaces:**
- Consumes:
  - the Task 4–7 API: `GET /task-statuses?scope=…`;
  - task `title`, `statusId`, `status`, `code` and `assigneeId`;
  - time `durationMinutes`, `note` and `userId`, the `user`/`loggedBy` responses, and the `totalSeconds` list total.

- [ ] **Step 1: Update the guard seeds and write the new smoke test**

In `backend/test/smoke/work.tickets.smoke.js`, the seed posts become:
- `{ durationMinutes: 45, note: 'Seeded time note' }`;
- `{ title: 'Seeded checklist item' }`.

In `backend/test/smoke/work.projects.smoke.js`, the project time seed's `description` becomes `note`.

Create `backend/test/smoke/work.ledger.smoke.js`:

```js
const { resetData, closeDb } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeProject, makeTask, makeSubtask,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');

// Plan 3b-1: today's ticket and project pages work on the unified task and
// time API (checklist toggle, time totals, project task and subtask toggles).

const shown = (page, text) => page.getByText(text).filter({ visible: true }).first();
const tab = (page, name) => page.getByRole('button', { name }).filter({ visible: true }).first().click();

let smoke;
let w;
let ticket;
let project;
beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  w = await makeWorld();
  ticket = await makeTicket(w.admin.agent, { title: 'Ledger ticket', contactId: w.contact.id });
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/tasks`).send({ title: 'Toggle me' }), 201);
  expectOk(await w.admin.agent.post(`${API}/tickets/${ticket.id}/time`).send({ durationMinutes: 90, note: 'Ninety' }), 201);
  project = await makeProject(w.admin.agent, { name: 'Ledger project', ownerDepartmentId: w.deptA.id });
  const task = await makeTask(w.admin.agent, project.id, { title: 'Project task' });
  await makeSubtask(w.admin.agent, project.id, task.id, { title: 'Project subtask' });
});
afterAll(async () => { await smoke.stop(); await closeDb(); });

it('a ticket checklist item ticks to Done and back', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Tasks/);
  const box = page.locator('input[type=checkbox]').filter({ visible: true }).first();
  await box.check();
  await page.waitForResponse((r) => r.url().includes('/tasks/') && r.request().method() === 'PATCH');
  const { tasks } = expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`));
  expect(tasks[0].status.name).toBe('Done');
  await box.uncheck();
  await page.waitForResponse((r) => r.url().includes('/tasks/') && r.request().method() === 'PATCH');
  expect(expectOk(await w.admin.agent.get(`${API}/tickets/${ticket.id}/tasks`)).tasks[0].status.name).toBe('To do');
});

it('the ticket\'s time tab shows the entry and the total', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/tickets/${ticket.id}`);
  await tab(page, /^Time Entries/);
  await shown(page, 'Ninety').waitFor();
  await shown(page, '1h 30m').waitFor();
});

it('a project subtask toggles closed from the task list', async () => {
  const page = await smoke.pageAs('admin');
  await page.goto(`/projects/${project.id}`);
  await shown(page, 'Project task').click();
  await shown(page, 'Project subtask').waitFor();
  const before = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`)).tasks[0].subtasks[0];
  await page.locator('input[type=checkbox]').filter({ visible: true }).last().check();
  await page.waitForResponse((r) => r.url().includes('/subtasks/') && r.request().method() === 'PATCH');
  const after = expectOk(await w.admin.agent.get(`${API}/projects/${project.id}/tasks`)).tasks[0].subtasks[0];
  expect([before.completedAt, typeof after.completedAt]).toEqual([null, 'string']);
});
```

Check the total format (`1h 30m`) against `formatMinutes` in `pages/tickets/theme.js`, and the subtask checkbox's markup in `TaskDetailModal.jsx`, before relying on them. Record any adjusted selector as a ruling.

- [ ] **Step 2: Run the smoke tests to verify they fail**

Run: `cd backend && npm run test:smoke -- work.ledger.smoke.js work.tickets.smoke.js work.projects.smoke.js`
Expected: FAIL. Examples: the checklist reads `t.completed`, the time tab sums `minutes`, and project tasks get their statuses from `/project-statuses`.

- [ ] **Step 3: Rewire the ticket page**

- **`TicketDetail.jsx`:**
  - Add `const [taskStatuses, setTaskStatuses] = useState([]);`. In `load`, fetch `api.get('/task-statuses', { params: { scope: 'ticket' } })` alongside the rest and store `statuses`.
  - `time` state becomes `{ entries: [], totalSeconds: 0 }`, and `time.totalMinutes === 0` becomes `time.totalSeconds === 0`.
  - `addTask(description)` posts `{ title: description }`.
  - `toggleTask(task)` sends the next status:

    ```js
    const closed = task.status?.behaviorType === 'closed';
    const next = taskStatuses.find((s) => s.behaviorType === (closed ? 'open' : 'closed'));
    if (!next) return;
    const { data } = await api.patch(`/tickets/${id}/tasks/${task.id}`, { statusId: next.id });
    ```

  - `addManualTime` keeps its body, which is already `startTime`/`endTime`/`note`/`entryDate`/`userId`. Its state update becomes `setTime((t) => ({ entries: [data.entry, ...t.entries], totalSeconds: t.totalSeconds + data.entry.durationSeconds }))`.
  - The three unmount `api.post(... { minutes })` calls and the `sendBeacon` body send `{ durationMinutes: minutes }`.
  - Pass `totalSeconds={time.totalSeconds}` where `totalMinutes=` was passed.
- **`detail/TasksTab.jsx`:**
  - `checked={t.status?.behaviorType === 'closed'}`;
  - the strike-through tests the same expression;
  - show `t.title` where it showed `t.description`;
  - prefix the title with `t.code` in the muted mono style the project list uses for codes.
- **`detail/TimeEntriesTab.jsx`:**
  - take `totalSeconds` instead of `totalMinutes`;
  - show `formatMinutes(Math.round(totalSeconds / 60))`;
  - each row's minutes are `Math.round(e.durationSeconds / 60)` (drop the `e.minutes` fallback).
- **`detail/TimerWidget.jsx`:** the other-ticket banner's post sends `{ durationMinutes: minutes }`.
- **`detail/ActivityTab.jsx`:** add descriptions so the new rows read well:

```js
  if (a.action === 'task_created' || a.action === 'subtask_created') return `${actor} added task ${a.toValue}`;
  if (a.action === 'task_closed' || a.action === 'subtask_closed') return `${actor} completed task ${a.toValue}`;
  if (a.action === 'task_reopened' || a.action === 'subtask_reopened') return `${actor} reopened task ${a.toValue}`;
  if (a.action === 'task_updated' || a.action === 'subtask_updated') return `${actor} edited a task (${a.toValue})`;
  if (a.action === 'task_deleted' || a.action === 'subtask_deleted') return `${actor} deleted task ${a.toValue}`;
  if (a.action === 'task_renumbered' || a.action === 'subtask_renumbered') return `${actor} renumbered task ${a.fromValue} to ${a.toValue}`;
  if (a.action === 'tasks_reordered') return `${actor} reordered the tasks`;
```

Put these before the `ACTIVITY_FIELD_LABEL` branch.

- [ ] **Step 4: Rewire the project page**

- **`ProjectDetail.jsx`:**
  - Add `taskStatuses` state from `api.get('/task-statuses', { params: { scope: 'project' } })`, next to the `/project-statuses` fetch, which stays for the project's own status.
  - Pass `statuses={taskStatuses}` to `TasksTab`, `AddTaskModal` and `TaskDetailModal`. Those are the three `statuses={statuses}` props at the task components; check each one is a task component before changing it.
  - The task and subtask toggle handlers (around lines 255–280) use `taskStatuses` instead of `statuses`.
  - The time payload from `AddTimeModal` uses `userId` and `note` (see `TimeTab.jsx`).
- **`detail/TasksTab.jsx`:**
  - `task.taskCode` becomes `task.code` and `st.subtaskCode` becomes `st.code`;
  - in `AddTaskModal`, the `assignedToUserId` state and payload key become `assigneeId`.
- **`detail/TaskDetailModal.jsx`:**
  - `task.assignedToUserId` becomes `task.assigneeId` (state and payload);
  - `task.taskCode` becomes `task.code` and `st.subtaskCode` becomes `st.code`.
- **`detail/TimeTab.jsx`:**
  - the row shows `e.user?.displayName` where it showed `e.loggedFor?.displayName`, and `e.note` where it showed `e.description`;
  - `AddTimeModal`'s payload sends `userId: loggedForUserId || undefined` and `note: description || undefined`. The state names may stay.
- **`detail/ActivityTab.jsx`:** add labels for `task_reopened`, `task_updated`, `task_renumbered`, `subtask_created`, `subtask_reopened`, `subtask_updated`, `subtask_deleted`, `subtask_renumbered` and `tasks_reordered`, in the existing `ACTIVITY_LABELS` style ("reopened a task", "edited a task", "renumbered a task", "added a subtask", "reopened a subtask", "edited a subtask", "deleted a subtask", "renumbered a subtask", "reordered tasks").

Then search for leftovers:

```bash
cd frontend/src && grep -rn "taskCode\|subtaskCode\|loggedForUserId\|loggedFor\b\|totalMinutes\|\.completed\b\|{ minutes\b\|{ description }" pages/tickets pages/projects context components | grep -v "^pages/projects/ProjectNew"
```

Expected: no hits on task or time code. A remaining hit must be unrelated: the project form's lead field `assignedToUserId` on `/projects` is the project's own field and stays.

- [ ] **Step 5: Build, then run the smoke suite**

Run: `npm --prefix frontend run build && cd backend && npm run test:smoke`
Expected: the build passes, and every smoke test passes, including the three new ones.

The dashboard hours panel renders `byDay` as given, so seven days show without a change. If its heading says "Mon–Fri", change it to "This week" in the same commit.

- [ ] **Step 6: Commit**

```bash
git add -A -- frontend/src backend/test/smoke
git commit -m "fix(screens): ticket and project pages on the unified task and time API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Whole suite, docs, and the final review

**Files:**
- Modify: `UPGRADING.md`, `docs/ROADMAP.md` and `docs/superpowers/specs/2026-10-03-test-baseline-design.md` (the quirk table's last column).

- [ ] **Step 1: Every test, on the CI runtime**

Run in the background, one after the other:

```bash
cd backend && npm test > /tmp/<scratch>/3b1-full.log 2>&1; npm run test:smoke > /tmp/<scratch>/3b1-smoke.log 2>&1; grep -E "^(FAIL|Tests:)" /tmp/<scratch>/3b1-full.log /tmp/<scratch>/3b1-smoke.log
```

Expected: both green on Node 24 (`node --version` ≥ 24.9).

- [ ] **Step 2: UPGRADING**

Add a section to `UPGRADING.md` for this release (match the file's existing heading style):

```markdown
### One work model, part 1: tasks and the time ledger

- **Data move.** Ticket checklist items, project tasks and project subtasks are now one `Tasks` table, and ticket time and project time one `TimeEntries` ledger. The migration copies everything; the old tables are kept, renamed `legacy_*`, for one release and are dropped by the next release's first migration. Rolling the migration back works until something exists that the old tables can't hold (for example, a subtask on a ticket task); it then refuses with a list.
- **Ticket tasks are real tasks:** statuses (To do, In progress, Done), subtasks, codes (`#00012-T01`), reorder and renumber, the same as project tasks.
- **New permissions:**
  - `time.log` — log your own time. It's granted to every role that could log time before (`projects.log_time` or any ticket edit permission). `projects.log_time` no longer gates anything.
  - `time.manage_others` — log, edit and delete time for other people. It's granted to System Administrator and Department Manager. A team lead without it may do so for members of their own teams only. The legacy `admin` user role no longer decides this.
- **API field names (API-key users):**
  - Tasks use `title`, `statusId` (from `GET /task-statuses?scope=ticket|project`), `assigneeId`, `dueDate`, `estimateMinutes`, `parentTaskId` and `code`. A ticket task's old `description`/`completed` fields and a project task's `assignedToUserId`/`taskCode`/`subtaskCode` are gone.
  - Time takes `durationMinutes` **or** `startTime` + `endTime`, plus `entryDate`, `note`, `taskId`, `workTypeId` (from `GET /work-types`), `billable` and `userId` (who it's for). The old `minutes`, `description` and `loggedForUserId` are not read.
  - Responses carry `user` (who it's for) and `loggedBy` (who entered it). Lists return `totalSeconds` and `totalLaborCost`.
  - The project subtask URLs (`/projects/:id/tasks/:taskId/subtasks…`) still work for this release.
- **Time zone.** "Today" for a work date, a timer's work date and report date ranges now follow Settings → Company → time zone (`company.timezone`, default UTC), not the server's.
- **Deletes.** Deleting a ticket deletes its tasks and time, as before. Deleting a user keeps their time in the ledger; it used to delete their ticket time.
```

- [ ] **Step 3: ROADMAP and the baseline quirk table**

In `docs/ROADMAP.md`, sub-project 3's Plan column becomes:

```
[plan 3a](superpowers/plans/2026-10-06-work-model-split.md) (split and guard); [plan 3b-1](superpowers/plans/2026-10-06-work-model-ledger.md) (tasks and the ledger); 3b-2 (access and remaining fixes) and 3c (the screens) next
```

In `docs/superpowers/specs/2026-10-03-test-baseline-design.md`, the last column of these rows becomes `3 (fixed in plan 3b-1)`: Q1–Q12, Q14, Q15, Q20, Q21, Q31, Q32, Q34 and Q36. Q22 keeps "fixed early as S13".

Then add a sentence under the table:

> Q8, Q23, Q25 and Q38 are fixed for tasks in plan 3b-1. Their ticket and project halves follow in 3b-2.

- [ ] **Step 4: Commit**

```bash
git add -A -- UPGRADING.md docs/ROADMAP.md docs/superpowers/specs/2026-10-03-test-baseline-design.md
git commit -m "docs: one work model part 1 — upgrading notes, roadmap, fixed quirks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final review**

Run two fresh reviewers on the most capable model, in parallel:
- **Whole-branch review** of the plan's range, against this plan and the spec.
- **Security review.** This plan changes who may log, edit and delete time, and labour cost. It also adds new id-taking inputs, raw SQL in the migration, and the timer.

Fix Critical and Important findings in one pass, each with a test that fails first. Defer minors to the ledger. Push only when the user says so.
