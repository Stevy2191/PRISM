# Project Management, Full Feature (6) Implementation Plan

> **Status: approved** 2026-10-25, ready to build (subagent-driven, fresh session). Nothing built yet.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Per the user's token-efficiency rule this plan lists tasks, interfaces and test names, not full code.

**Goal:** Turn projects into real project management: phases, milestones, dependencies, timeline, templates, hour budgets, and a Workload screen with drag-to-dispatch. Build all of it in the new look A.

**Architecture:**
- **Pure scheduling module:** `services/projects/schedule.js` holds all the date logic: phase spans, waiting, cycle checks, downstream chains, shifting and stretching. Controllers stay thin.
- **Phases and dependencies:** these are project-only tables beside `Tasks`. Ticket tasks get none of the new fields, and the task service refuses them on a ticket parent.
- **Workload:** read-only, built by `services/workload/` from the viewer's ticket and project scope. Dispatch reuses the existing ticket PATCH and task PATCH, so their permission, company, audit and SLA checks all apply. The only new write field is `Tickets.plannedDate`.
- **Budgets:** read the one time ledger (`TimeEntries`). One `checkBudgetAlerts(projectId)` runs after every time entry create, update, delete and timer log.
- **Look A:** tokens live in `index.css`, and shared primitives in `frontend/src/components/ui/`. The project screens are rebuilt on those primitives. The rest of the app picks up the tokens only; restyling it is 6b.

**Tech Stack:** Express, Sequelize/MariaDB, React 18 + Vite + Tailwind. Tests are Jest + supertest (backend), `node --test` (frontend pure helpers) and Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-25-project-management-design.md`. Mockups: https://claude.ai/artifact/NXd5ZYb4P98kk8VjxHwx3H (look A boards are the reference for every screen task).

## Global Constraints

- **Dates:** every date is a `DATEONLY` `'YYYY-MM-DD'` string end to end.
  - Never build a JS `Date` from one for day maths. Use the string helpers in `schedule.js`, so there is no time-zone drift (see the open `waiting.smoke.js` bug in ROADMAP).
  - "Today" for workload and overdue comes from a `today` query param the client sends from its local date. If the param is missing or invalid, use the server's local date.
- **Ids:** every id from a body or URL is parsed with `parseRecordId` (`services/permissionService.js`). Phase ids, dependency ids and task ids must belong to the project in the URL, otherwise 404 `NOT_FOUND`. This check runs before any other.
- **Project-only fields:** `phaseId`, `startDate`, `isMilestone` and dependencies are project-task only. Sent on a ticket task → 400 `PROJECT_TASK_ONLY`.
- **Milestones:**
  - `startDate = dueDate` (if only one is sent, both are set to it).
  - `estimateMinutes` is forced to null.
  - No subtasks. Setting the flag on a task that has subtasks → 400 `MILESTONE_HAS_SUBTASKS`; adding a subtask to a milestone → the same error.
- **Dates on a task:**
  - `startDate ≤ dueDate` when both are set, otherwise 400 `START_AFTER_DUE`.
  - A subtask may have dates; it never has a phase (it follows its parent).
- **Dependencies:**
  - Top-level tasks and milestones of the same project only, otherwise 400 `DEPENDENCY_SCOPE`.
  - No self-link and no cycle: 400 `DEPENDENCY_CYCLE`.
  - Unique `(predecessorId, successorId)`: 409 `DEPENDENCY_EXISTS`.
- **Helpers (spec decision 15):** project tasks and subtasks only, otherwise 400 `PROJECT_TASK_ONLY`.
  - A helper can't be the main assignee: adding the assignee as a helper → 409 `ALREADY_ON_TASK`. Naming a helper as the new main assignee removes them from the helpers.
  - **Add:** project edit access **or** being the task's main assignee. **Remove:** the same, or removing yourself.
  - The person added passes `canWorkCompany` (same as `resolveAssignee`). If they aren't a `ProjectMember`, they are added with role `member` in the same transaction (audit `projectMember.autoAdd`).
  - Logged minutes on a task = all users' entries. On Workload, the remaining estimate is shared by the main assignee and the helpers: `remaining / peopleCount`, with the last person taking the rounding remainder.
- **Theme (spec decision 16):** with no stored `prism.theme`, the theme is `dark`, both in `index.html`'s pre-mount script and in `ThemeContext`. A stored `light`, `dark` or `system` is respected unchanged.
- **"Waiting":** a task is waiting while any predecessor's status is not in the done category. It is derived, never stored.
- **Hour budgets:** stored as minutes (`hourBudgetMinutes`, INT, null = none), shown as hours with up to one decimal. Used hours = the sum of `TimeEntries.durationSeconds` for the project, billable or not.
- **Alert levels:**
  - `Projects.budgetAlertLevel` holds 0, 80 or 100.
  - Firing is a conditional `UPDATE … SET budgetAlertLevel=:lvl WHERE id=:id AND budgetAlertLevel < :lvl`. Only the row-count winner notifies.
  - When used hours fall below a level, or the budget changes, the level is recomputed down. That re-arms it but does not notify.
- **Capacity:**
  - `Users.workHours` is JSON keyed by ISO weekday `'1'…'7'`, with minutes 0–1440. Null means the setting `workload.defaultWorkHours` (default `{"1":480,"2":480,"3":480,"4":480,"5":480,"6":0,"7":0}`).
  - Holidays come from lists with `departmentId IS NULL` plus lists with the user's `departmentId`.
- **Default ticket size:** the setting `workload.defaultTicketMinutes` (default `'60'`, 15–1440).
- **Permissions:**
  - **`projects.manage_templates`** (category `projects`, "Manage project templates", "Create, edit and delete project templates"): granted to System Administrator.
  - **`workload.view`** (category `workload`, "View workload", "Open the Workload screen"): granted to every role that has `tickets.view_all` or `projects.view_all`.
  - Use migration 068's permission pattern. `down` deletes RolePermissions and UserPermissionOverrides.
- **New notification types:** `task_unblocked`, `task_added`, `budget_warning` and `budget_reached`. `Notifications.projectId` is a nullable FK.
  - Email events: `budget_warning` → `staff_budget_warning`, `budget_reached` → `staff_budget_reached` and `task_added` → `staff_task_added` (default on); `task_unblocked` → `staff_task_unblocked` (default off).
  - A project notification goes only to someone who can still view the project (`canReachProject`).
- **Audit actions:**
  - `projectPhase.create|update|reorder|delete`
  - `taskDependency.create|delete`
  - `task.helperAdd|helperRemove`, `projectMember.autoAdd`
  - `task.shiftDependents`
  - `project.budget`
  - `projectTemplate.create|update|delete|saveFromProject`
  - `project.createFromTemplate|copy`
  - `ticket.plannedDate`, also written to the ticket activity log
  - `user.workHours`
  - `settings.workload`
- **Migrations:**
  - `20260101000069-project-structure.js`
  - `20260101000070-project-templates.js`
  - `20260101000071-workload.js`
  - Read `sequelize_removecolumn_broken.md` (memory) first. Each needs a working `down` and a round-trip test that re-applies the later migrations in `afterAll` (ROADMAP "Working on the code").
- **Size:** no file past ~800 lines. `ProjectDetail.jsx` is split, not grown.
- **Dependencies:** one new npm dependency, `@fontsource/instrument-sans` (frontend, exact version pinned). No chart, drag or Gantt library.
- **Copy:** sentence case, plain verbs. Use the button and label words from the mockups ("Move 3 tasks", "Leave them", "Not assigned yet", "Counts work you can see", "Save as template", "Start from").
- **Tests:** run only affected tests while building. Run the full backend suite and `npm run test:smoke` once before each push. Never run two suites at once.

## Review Focus

1. **Cross-project ids.** A `phaseId`, a dependency's `predecessorId`, or a `taskId` in the URL that belongs to another project (one the user *can* edit) must be refused, not linked. Test in Task 3: `PATCH task phaseId from another project → 404, phase unchanged`. Test in Task 4: `dependency to a task in another editable project → 400 DEPENDENCY_SCOPE`.
2. **Deleting things that others point at.**
   - Deleting a phase moves its tasks to "No phase" and deletes none of them.
   - Deleting a task removes its links (FK cascade).
   - A successor that was waiting only on the deleted task stops waiting.
   - Tests in Task 3 and Task 4: `DELETE phase → its tasks have phaseId null`, `DELETE predecessor → successor waitingOn is empty`.
3. **Evening time zones.** A client whose local date is a day behind UTC must see its own today on Workload and in "in N days". Test in Task 12: `GET /workload?from=2026-11-02&today=2026-11-02 at 2026-11-03T03:30Z → today column is Nov 2`. Test in Task 2: `addDays('2026-11-01', 1) is '2026-11-02' across the DST change`.
4. **Two people logging at once past 80%.** The lead gets one alert, not two. Test in Task 8: `two concurrent time entries crossing 80% → exactly one budget_warning`.
5. **A helper who later loses access** to the company (moved or restricted). They must drop out of notifications and of the project's Workload rows, and their logged time stays in the totals. Test in Task 3b: `helper who can no longer work the company → no task_added/task_unblocked notification, time still counted`.
6. **Hidden work on Workload.** A ticket assigned to a visible person, in a company or department the viewer can't see, is neither listed nor counted. Test in Task 12: `restricted viewer: other-company ticket assigned to a shown tech → absent from items and from cell minutes`.

---

## Stage 1 — Look A foundation

### Task 1: Look A tokens, font and UI primitives

**Files:**
- Modify: `frontend/src/index.css` (light and dark `--color-*` and navy values set to look A; `--color-waiting`, `--color-waiting-bg`, `--color-accent-soft`; `font-variant-numeric: tabular-nums` on `.num`), `frontend/tailwind.config.js` (`fontFamily.sans` = `['"Instrument Sans"', 'system-ui', …]`; radii 8/10/12), `frontend/src/main.jsx` (import `@fontsource/instrument-sans/{400,500,600,700}.css`), `frontend/package.json`, the top bar component (look A bar from the Main board: nav, search, running-timer chip, avatar; the compact-sidebar preference keeps working).
- Create: `frontend/src/components/ui/` containing `Button.jsx`, `Pill.jsx`, `Tabs.jsx`, `Meter.jsx`, `Avatar.jsx` (moves from `work/Avatar.jsx`, with a re-export left behind), `StatusChip.jsx`, `Tag.jsx`, `Notice.jsx`, `Field.jsx`, `meter.js`.
- Test: `frontend/src/components/ui/meter.test.js`, `frontend/test/smoke/look.smoke.js`

**Interfaces, produced:**
- `meterLevel(used: number, budget: number|null) → 'none'|'ok'|'near'|'over'` (near ≥ 80%, over > 100%)
- `<Button variant="primary|default|quiet|icon" size="sm|md">`, `<Pill on>`, `<Tabs items={[{id,label,count?}]} value onChange>`, `<Meter used budget>`, `<Notice tone="info|warn|bad">`, `<Field label hint>`

- [x] Unit tests: `meterLevel null budget is none`, `79.9% is ok, 80% is near, 100% is near, 100.1% is over`.
- Modify also: `frontend/index.html` (pre-mount default `'dark'`), `frontend/src/context/ThemeContext.jsx` (default `'dark'`), `frontend/src/pages/settings/Preferences.jsx` (option order Dark, Light, Match my system).
- [x] Smoke tests: `fresh browser with no stored theme opens dark (no light flash: data-theme is dark before React mounts)`, `stored light is kept`, `body uses Instrument Sans`, `dark theme sets a dark --color-bg`, `Settings → Appearance custom accent still overrides --color-accent in dark and light`.
- [x] Implement, then run `npm run build` and the smoke file.
- [x] Commit `feat(look): look A tokens, Instrument Sans, shared UI primitives`.

## Stage 2 — Structure: phases, milestones, dependencies

### Task 2: Migration 069, models, schedule module

**Files:**
- Create: `backend/migrations/20260101000069-project-structure.js`. It adds:
  - the `ProjectPhases` table: `id, projectId FK CASCADE, name STRING(100), position INT, hourBudgetMinutes INT null, timestamps`;
  - the `TaskDependencies` table: `id, predecessorId FK Tasks CASCADE, successorId FK Tasks CASCADE, createdBy FK Users SET NULL, createdAt`, with UNIQUE `(predecessorId, successorId)`;
  - on `Tasks`: `phaseId` (FK `ProjectPhases`, SET NULL), `startDate` (DATEONLY null) and `isMilestone` (BOOL default false);
  - on `Projects`: `startDate` (DATEONLY null), `hourBudgetMinutes` (INT null), `budgetAlertLevel` (TINYINT default 0), `budgetAlert80` (BOOL default true) and `budgetAlert100` (BOOL default true);
  - the `TaskAssignees` table: `id, taskId FK Tasks CASCADE, userId FK Users CASCADE, addedBy FK Users SET NULL, createdAt`, with UNIQUE `(taskId, userId)`. This holds the helpers; `Tasks.assigneeId` stays the main assignee;
  - on `Notifications`: the type enum gains `task_unblocked`, `task_added`, `budget_warning` and `budget_reached`, and a `projectId` column is added (FK CASCADE, null).
- Create: `backend/src/models/ProjectPhase.js`, `backend/src/models/TaskDependency.js`, `backend/src/models/TaskAssignee.js` (`Task.belongsToMany(User, { through: TaskAssignee, as: 'helpers' })`). Modify: `models/index.js`, `Task.js`, `Project.js`, `Notification.js`.
- Create: `backend/src/services/projects/schedule.js`
- Test: `backend/test/unit/projectSchedule.test.js`, `backend/test/integration/projectStructure.migration.test.js`

**Interfaces, produced (pure; `deps` = `[{predecessorId, successorId}]`):**
- `addDays(date: string, n: number) → string`, `daysBetween(a, b) → number`, `isoWeekday(date) → 1..7`
- `phaseSpan(tasks) → { startDate, dueDate } | null`
- `waitingOn(taskId, deps, doneIds: Set) → number[]`
- `wouldCycle(deps, predecessorId, successorId) → boolean`
- `downstream(deps, taskId) → number[]` (transitive, each id once, in topological order)
- `shiftTasks(tasks, ids, days) → [{ id, startDate, dueDate }]` (null dates stay null)
- `stretch(offset: number, length: number, ratio: number) → { offset, length }` (rounded, length ≥ 1; milestone length 0 stays 0)

- [x] Unit tests: `addDays across DST and month end`, `phaseSpan ignores undated tasks and is null when none dated`, `waitingOn excludes done predecessors`, `wouldCycle true for self, direct and 3-step loop`, `downstream is transitive and deduplicated on a diamond`, `shiftTasks keeps null dates`, `stretch keeps length ≥ 1 and milestones at 0`.
- [x] Migration test: `up adds tables and columns`, `down removes them and the enum values (rows with new types are deleted first)`, `up again succeeds`.
- [x] Implement, apply the migration to the test DB, and run both test files.
- [x] Commit `feat(projects): phases, dependencies and budget columns; schedule module`.

### Task 3: Phases API and the new task fields

**Files:**
- Create: `backend/src/controllers/projects/phases.js`. Modify: `backend/src/routes/projects.js`, `backend/src/services/tasks/index.js` (validate `phaseId`, `startDate`, `isMilestone` for project parents; refuse them on ticket parents; task JSON gains `phaseId, startDate, isMilestone`).
- Test: `backend/test/integration/projectPhases.test.js`

**Interfaces, produced:**
- `GET /projects/:id/phases` (view) → `[{ id, name, position, hourBudgetMinutes, startDate, dueDate, taskCount, doneCount, loggedMinutes, estimateMinutes }]`
- `POST /projects/:id/phases {name}` (edit) → phase, added at the end
- `PATCH /projects/:id/phases/:phaseId {name?, hourBudgetMinutes?}` (edit)
- `PATCH /projects/:id/phases/reorder {ids: number[]}` (edit; must list every phase exactly once, otherwise 400; route registered before `/:phaseId`)
- `DELETE /projects/:id/phases/:phaseId` (edit) → its tasks get `phaseId: null`
- `PATCH /projects/:id/tasks/:taskId` accepts `phaseId|null, startDate|null, isMilestone`

- [x] Tests:
  - `phases list with derived dates and counts`
  - `create/rename/reorder/delete are audited`
  - `reorder missing an id → 400`
  - `view-only user → 403 on writes`
  - `PATCH task phaseId from another project → 404, phase unchanged`
  - `DELETE phase → its tasks have phaseId null`
  - `ticket task with phaseId → 400 PROJECT_TASK_ONLY`
  - `startDate after dueDate → 400 START_AFTER_DUE`
  - `milestone forces start=due and estimate null`
  - `milestone on a task with subtasks → 400 MILESTONE_HAS_SUBTASKS`
  - `subtask under a milestone → 400 MILESTONE_HAS_SUBTASKS`
  - `subtask phaseId ignored, follows parent`
- [x] Implement and run.
- [x] Commit `feat(projects): phases API, task start dates and milestones`.

### Task 3b: Helpers on project tasks

**Files:**
- Create: `backend/src/services/projects/helpers.js`. Modify: `controllers/projects/tasks.js`, `routes/projects.js`, `services/tasks/index.js` (task JSON gains `helpers: [{id, name, avatar}]` and `loggedBy: number`, the count of distinct people with time; `listTasks` accepts `mine=userId`, which matches the assignee **or** a helper; a new main assignee who was a helper is removed from the helpers), `controllers/projects/shared.js` (`assertCanAddHelper(req, project, task)`).
- Test: `backend/test/integration/taskHelpers.test.js`

**Interfaces, produced:**
- `POST /projects/:id/tasks/:taskId/helpers {userId}` → task. Also works on subtasks: `/tasks/:taskId/subtasks/:subtaskId/helpers`.
- `DELETE /projects/:id/tasks/:taskId/helpers/:userId` (and the subtask form) → task
- `peopleOn(task) → number[]` (the main assignee first, then helpers; no nulls). Used by Tasks 4, 5 and 12.
- `addHelper(req, parent, task, rawUserId) → task`, `removeHelper(req, parent, task, rawUserId) → task`

- [x] Tests:
  - `edit-access user adds a helper; audited task.helperAdd; helper notified task_added`
  - `main assignee without edit access can add a helper`
  - `other non-edit member → 403`
  - `helper can remove themselves but not others`
  - `helper not yet a member becomes a member (projectMember.autoAdd) and can GET the project and log time`
  - `user who can't work the company → 400, no member row`
  - `adding the main assignee → 409 ALREADY_ON_TASK; duplicate helper → 409 ALREADY_ON_TASK`
  - `making a helper the main assignee removes them from helpers`
  - `ticket task helper → 400 PROJECT_TASK_ONLY`
  - `task with 1 h from each of two people: loggedMinutes 120, loggedBy 2, phase and budget used 120`
  - `mine filter includes tasks I help on`
  - `helper who can no longer work the company → no task_added/task_unblocked notification, time still counted`
- [x] Implement and run.
- [x] Commit `feat(projects): helpers on project tasks, person-hours`.

### Task 4: Dependencies, shift dependents, unblocked notifications

**Files:**
- Create: `backend/src/controllers/projects/dependencies.js`, `backend/src/services/projects/dependencies.js`. Modify: `routes/projects.js`, `services/tasks/index.js` (task JSON gains `waitingOn: [{id, code, title, dueDate}]` and `holdingUp: [{id, code, title}]`; a dueDate moved later returns `shiftOffer: { days, tasks: [{id, code, title}] }`; finishing a task calls `notifyUnblocked`), `services/notifications.js` (`createNotification` accepts `projectId`; add `canReachProject`), `services/email/notificationMail.js` and `catalog.js` (three new events and templates, with a project-aware send path beside `sendTicketEmail`).
- Test: `backend/test/integration/taskDependencies.test.js`, `backend/test/unit/notificationMail.test.js` (extend)

**Interfaces, produced:**
- `POST /projects/:id/dependencies {predecessorId, successorId}` (edit) → `{ id, predecessorId, successorId }`
- `DELETE /projects/:id/dependencies/:depId` (edit)
- `GET /projects/:id/dependencies` (view) → list
- `POST /projects/:id/tasks/:taskId/shift-dependents {days: 1..365}` (edit) → `{ moved: [{id, startDate, dueDate}] }` (downstream chain, done tasks skipped, one transaction, audit `task.shiftDependents`)
- `notifyUnblocked(task, actorId) → Promise<void>` in `services/projects/dependencies.js`
- `canReachProject(userId, projectId) → Promise<boolean>` in `services/notifications.js`

- [x] Tests:
  - `create link; duplicate → 409 DEPENDENCY_EXISTS`
  - `self link and loop → 400 DEPENDENCY_CYCLE`
  - `subtask or other-project task → 400 DEPENDENCY_SCOPE`
  - `dependency to a task in another editable project → 400 DEPENDENCY_SCOPE`
  - `waitingOn lists only unfinished predecessors`
  - `DELETE predecessor → successor waitingOn is empty`
  - `moving dueDate 2 days later returns shiftOffer with downstream tasks`
  - `moving earlier returns no shiftOffer`
  - `shift-dependents moves the chain by 2 and skips done tasks`
  - `finishing the last predecessor notifies the successor assignee and its helpers once each`
  - `finishing one of two predecessors notifies nobody`
  - `assignee who lost project access is not notified`
  - Unit: `task_unblocked email default off`, `budget_* email default on`
- [x] Implement and run.
- [x] Commit `feat(projects): finish-to-start dependencies, shift offer, unblocked notifications`.

## Stage 3 — Project page in look A

### Task 5: Project page shell, summary row, Tasks tab, Costs tab

**Files:**
- Modify: `backend/src/controllers/projects/core.js` (`getStats` gains `tasksDone, tasksTotal, loggedMinutes, hourBudgetMinutes, nextMilestone: {id, code, title, dueDate}|null, waitingCount`).
- Split `frontend/src/pages/projects/ProjectDetail.jsx` into:
  - `detail/ProjectHeader.jsx`: actions menu with Edit, Save as template (Task 10 wires it), Report and Delete;
  - `detail/SummaryRow.jsx`;
  - `detail/TasksTab.jsx`: phase sections, filter pills, quick-add per phase, per-row timer;
  - `detail/PhaseSection.jsx`;
  - `detail/CostsTab.jsx`: wraps the existing Expenses and Materials tabs as two sections;
  - `detail/taskFilters.js`.
  - The shared `components/work/TaskList.jsx` stays for ticket tasks.
- Test: `frontend/src/pages/projects/detail/taskFilters.test.js`, `backend/test/integration/projectStats.test.js` (extend), `frontend/test/smoke/projectPage.smoke.js`

**Interfaces, produced:**
- `filterTasks(tasks, filter: 'all'|'mine'|'waiting'|'overdue'|'unassigned'|'done', { userId, today }) → tasks` (mine = assignee or helper)
- `groupByPhase(tasks, phases) → [{ phase|null, tasks }]` (phase order, "No phase" last, empty phases kept)
- `daysUntil(today, date) → number`

- [ ] Tests:
  - Backend: `stats nextMilestone is the earliest open milestone`, `waitingCount counts waiting open tasks`
  - Frontend: `groupByPhase keeps empty phases and puts No phase last`, `filter waiting/overdue/mine`, `mine includes tasks I help on`, `daysUntil uses string dates`
  - Row shows stacked avatars (main first) and "3 h logged by 2 people" when `loggedBy > 1`
  - Smoke: `quick-add in a phase creates a task in that phase`, `Costs tab shows expenses and materials`, `collapsing a phase hides its rows`
- [ ] Implement against the Main board, then run the build and tests.
- [ ] Commit `feat(projects): look A project page, phases on the Tasks tab, Costs tab`.

### Task 6: Docked task panel, quick time, keys, shift banner

**Files:**
- Create: `frontend/src/pages/projects/detail/TaskPanel.jsx`, `detail/QuickTime.jsx`, `detail/ShiftBanner.jsx`, `detail/useListKeys.js`. Modify: `TasksTab.jsx`.
- Test: `frontend/src/pages/projects/detail/useListKeys.test.js` (pure `nextIndex`), `frontend/test/smoke/taskPanel.smoke.js`

**Interfaces:**
- Consumes: helpers endpoints (Task 3b); the task PATCH `shiftOffer` and `POST shift-dependents` (Task 4), and the existing `POST /projects/:id/time-entries {taskId, durationSeconds, entryDate}`.
- Produces: `nextIndex(current, delta, length) → number` (clamped); `<TaskPanel taskId onClose>`.

- [ ] Tests:
  - Unit: `nextIndex clamps at both ends`
  - Smoke: `People field: Add a helper picks a person and shows them; helper can remove themselves`, `clicking a task opens the panel and the list stays clickable`, `J/K move the selection, Esc closes`, `keys ignored while typing in an input`, `30 min logs an entry for today on that task`, `moving a due date later shows the banner; Move 3 tasks shifts them; Leave them dismisses`, `view-only user sees no edit controls but can log time`
- [ ] Implement against the TaskPanel board and run.
- [ ] Commit `feat(projects): docked task panel, quick time, keyboard, shift-dependents banner`.

### Task 7: Timeline tab

**Files:**
- Create: `frontend/src/pages/projects/detail/TimelineTab.jsx`, `detail/timeline/geometry.js`, `detail/timeline/TimelineBars.jsx`, `detail/timeline/DependencyArrows.jsx`, `detail/timeline/useBarDrag.js` (pointer events).
- Test: `frontend/src/pages/projects/detail/timeline/geometry.test.js`, `frontend/test/smoke/timeline.smoke.js`

**Interfaces, produced:**
- `ZOOM = { week: 30, month: 12, quarter: 4 }` (px per day)
- `layout({ from, days, zoom }) → { dayToX(date), xToDay(px) }`
- `barRect(task, layout) → { x, width } | null` (undated → null, listed in "Not scheduled")
- `dragResult(task, mode: 'move'|'start'|'end', dayDelta) → { startDate, dueDate }` (never start > due; a milestone only moves)
- `arrowPath(fromRect, toRect, rowGap) → string` (SVG path)

- [ ] Tests:
  - Unit: `dayToX/xToDay round trip`, `barRect null when undated`, `dragResult end before start clamps to one day`, `milestone resize is a move`
  - Smoke: `dragging a bar 2 days saves new dates and shows the shift banner when it has dependents`, `zoom switch keeps today in view`, `under 768px the timeline scrolls and bars cannot be dragged`
- [ ] Implement against the Timeline board and run.
- [ ] Commit `feat(projects): timeline tab with drag, resize and dependency arrows`.

## Stage 4 — Hour budgets

### Task 8: Budget API and alerts

**Files:**
- Create: `backend/src/services/projects/budget.js`. Modify: `controllers/projects/core.js` (PATCH accepts `hourBudgetMinutes, budgetAlert80, budgetAlert100, startDate`, audited as `project.budget`), `services/time/index.js` (call `checkBudgetAlerts` after create, update, delete and `logTimerEntry` commit), `routes/projects.js`.
- Test: `backend/test/integration/projectBudget.test.js`

**Interfaces, produced:**
- `budgetSummary(projectId) → { budgetMinutes, usedMinutes, billableMinutes, remainingEstimateMinutes, phases: [{id, name, budgetMinutes, usedMinutes}], noTaskMinutes, people: [{userId, name, minutes}] }`
- `checkBudgetAlerts(projectId) → Promise<void>` (atomic level update, then notify the lead with `budget_warning` or `budget_reached`)
- `GET /projects/:id/budget` (view)

- [ ] Tests:
  - `summary splits by phase, by person and billable`
  - `entry on a subtask counts toward the parent's phase`
  - `crossing 80% notifies the lead once with budget_warning`
  - `crossing 100% sends budget_reached`
  - `two concurrent time entries crossing 80% → exactly one budget_warning`
  - `deleting time back under 80% re-arms without notifying`
  - `raising the budget re-arms`
  - `budgetAlert80 off → no 80% alert`
  - `logging past 100% still succeeds`
  - `no budget → no alerts`
  - `phase budget never alerts`
- [ ] Implement and run.
- [ ] Commit `feat(projects): hour budgets with 80%/100% lead alerts`.

### Task 9: Budget UI and projects list

**Files:**
- Create: `frontend/src/pages/projects/detail/BudgetPanel.jsx` (in the Time tab: where the time went, the editor and the notice). Modify: `detail/SummaryRow.jsx` (over-budget notice), `backend/src/controllers/projects/core.js` (`buildProjectListWhere`: filters `mine=lead|member` and `attention=over_budget|milestones_7d|unassigned`; rows gain `loggedMinutes, hourBudgetMinutes, currentPhase: {name, doneCount, taskCount}, nextMilestone`), `GET /projects/attention` → `{ overBudget, milestonesSoon, unassignedTasks }` (scope-limited), `frontend/src/pages/Projects.jsx` (rebuilt on the Projects board; split `pages/projects/list/ProjectRow.jsx` and `AttentionTiles.jsx` out if it nears 800 lines).
- Test: `backend/test/integration/projectList.test.js` (extend), `frontend/test/smoke/projectsList.smoke.js`

- [ ] Tests:
  - Backend: `attention counts respect project scope`, `attention=over_budget lists only over-budget projects`, `currentPhase is the first phase with open tasks`, `mine=lead`
  - Smoke: `clicking the over-budget tile filters the list`, `budget editor saves and the meter turns red over 100%`
- [ ] Implement and run.
- [ ] Commit `feat(projects): budget panel and look A projects list with attention tiles`.

## Stage 5 — Templates

### Task 10: Template storage, instantiate, copy, save-as

**Files:**
- Create: `backend/migrations/20260101000070-project-templates.js`. It adds:
  - `ProjectTemplates (id, name STRING(150) unique, description TEXT, hourBudgetMinutes, tags JSON, sourceProjectId FK SET NULL, createdBy, timestamps)`;
  - `ProjectTemplatePhases (id, templateId CASCADE, name, position, hourBudgetMinutes)`;
  - `ProjectTemplateTasks (id, templateId CASCADE, templatePhaseId SET NULL, parentId self CASCADE, title, description, startDay INT ≥1, lengthDays INT ≥0, estimateMinutes, priority, isMilestone, position)`;
  - `ProjectTemplateDependencies (predecessorId, successorId, CASCADE, unique)`;
  - `Projects.templateId` (SET NULL);
  - the permission `projects.manage_templates`.
- Create: the models; `backend/src/services/projects/templates.js`; `backend/src/controllers/projectTemplates.js`; `backend/src/routes/projectTemplates.js` (mounted at `/project-templates`). Modify: `controllers/projects/core.js` (`create` accepts `templateId` or `copyFromProjectId`, plus `startDate` and `finishDate`).
- Test: `backend/test/integration/projectTemplates.test.js`, `backend/test/integration/projectTemplates.migration.test.js`, `backend/test/unit/templateStretch.test.js`

**Interfaces, produced:**
- `snapshotProject(projectId) → TemplateShape` (`{ phases, tasks, dependencies, hourBudgetMinutes, tags }`). Offsets are counted from the project `startDate`, or else from its earliest task date. Undated tasks get `startDay: 1, lengthDays: 1`.
- `planFromTemplate(shape, { startDate, finishDate? }) → { phases: [...], tasks: [{ ..., startDate, dueDate }], finishDate }` (pure: stretch, then push waiting tasks after their predecessors)
- `instantiate(req, shape, form, transaction) → Project` (new codes through the existing code service; no assignees)
- `GET /project-templates` (`projects.create` or `manage_templates`) → `[{ id, name, description, phaseCount, taskCount, hourBudgetMinutes, usedCount }]`
- `GET /project-templates/:id` (same) and `GET /project-templates/:id/preview?startDate&finishDate` → the `planFromTemplate` output
- `POST`, `PUT /:id` (full replace of the structure in one transaction) and `DELETE /:id` (`manage_templates`)
- `POST /projects/:id/save-as-template {name}` (`manage_templates` + view on the project)

- [ ] Tests:
  - Unit: `plan with no finishDate keeps offsets`, `finishDate double span doubles offsets`, `waiting task pushed after its predecessor`, `milestone keeps one date`
  - Integration:
    - `create from template makes phases, tasks, subtasks, links, budget, tags with no assignees`
    - `copy project needs view on the source; restricted user copying an unseen project → 404`
    - `copy keeps no time, files or costs`
    - `save-as-template without manage_templates → 403`
    - `template structure with a dependency to a task not in the template → 400`
    - `duplicate template name → 409`
    - `audit rows for create/update/delete/saveFromProject/createFromTemplate/copy`
  - Migration: `round trip`
- [ ] Implement, migrate the test DB, and run.
- [ ] Commit `feat(projects): templates, copy a project, save as template`.

### Task 11: Template editor and New project screen

**Files:**
- Create: `frontend/src/pages/settings/ProjectTemplates.jsx` (list), `frontend/src/pages/settings/ProjectTemplateEditor.jsx` (grid with drag reorder; split rows into `settings/templateEditor/Row.jsx` if needed). Modify: `frontend/src/pages/settings/registry.js` (new group `Projects` with `project-templates`, access `projects.manage_templates`, width `wide`, sub-routes `new` and `:id`), `frontend/src/pages/ProjectNew.jsx` (rebuilt: Start from cards, form, preview from `/preview`).
- Test: `frontend/src/pages/settings/registry.test.js` (extend), `frontend/test/smoke/projectTemplates.smoke.js`

- [ ] Tests:
  - Registry: `project-templates is in group Projects and needs projects.manage_templates`
  - Smoke:
    - `edit a template: add a task under a phase, set Waits on, save`
    - `New project from a template: changing finish date updates the preview dates`
    - `Create project lands on the new project with its phases`
    - `Copy an existing project lists only projects I can see`
    - `Save as template from the project menu opens the new template`
- [ ] Implement against the Templates and NewProject boards and run.
- [ ] Commit `feat(projects): template editor in Settings and look A New project`.

## Stage 6 — Workload

### Task 12: Capacity, planned date and the workload API

**Files:**
- Create: `backend/migrations/20260101000071-workload.js`. It adds:
  - `Users.workHours` (JSON null);
  - `Tickets.plannedDate` (DATEONLY null, indexed);
  - the settings `workload.defaultWorkHours` and `workload.defaultTicketMinutes` (inserted only if absent);
  - the permission `workload.view` with its grants.
- Create: `backend/src/services/workload/capacity.js` (pure), `backend/src/services/workload/index.js`, `backend/src/routes/workload.js` (mounted at `/workload`, `requirePermission('workload.view')`).
- Modify: the ticket update path (accepts `plannedDate|null`; audit and activity `ticket.plannedDate`; SLA untouched), `controllers/userController` (`PATCH /users/:id/work-hours`, needs `settings.manage_business_hours`, audit `user.workHours`), the settings controller (validation for the two keys, audit `settings.workload`).
- Test: `backend/test/unit/workloadCapacity.test.js`, `backend/test/integration/workload.test.js`, `backend/test/integration/workload.migration.test.js`

**Interfaces, produced:**
- `capacityFor(workHours|null, defaults, holidays: Set<string>, date) → minutes`
- `spread(minutes, startDate|null, dueDate|null, workingDays: string[], today) → Map<date, minutes>`. Rules:
  - Spread evenly over the person's working days within `[max(start, today), due]`.
  - Due only → all of it on the due date.
  - Past due → all of it on today, flagged overdue.
  - No dates → the `'none'` key.
  - If the window has no working days, everything goes on the due date.
- `itemMinutes(item, defaultTicketMinutes) → minutes`:
  - A task: `max(estimate − logged by everyone, 0)`.
- `shareMinutes(minutes, peopleIds) → Map<userId, minutes>` (even split, the last person takes the remainder). A task appears in the row of each person on it with their share.
  - A ticket: the sum of its open tasks' remaining estimates, or else the default ticket size.
- `buildWorkload(viewer, { from, days: 5|10, today, teamId?, kinds: 'all'|'tickets'|'tasks' }) → { days: [{date, holiday?}], people: [{ id, name, avatar, cells: { [date|'none']: { minutes, capacity, count, overdue } } }], unassigned: [item], items: { [personId]: [item] } }`. Here `item` is `{ kind: 'ticket'|'task', id, projectId?, code, title, company, minutes, startDate, dueDate, plannedDate?, overdue, canEdit }`.
  - **Items:** open tickets inside `ticketScopeWhere`, and open top-level tasks of open projects inside `projectScopeWhere`.
  - **People:** the assignable staff list, filtered by team.
- `GET /workload?from&days&today&teamId&kinds`

- [ ] Tests:
  - Unit:
    - `default hours Mon–Fri 8h, weekend 0`
    - `holiday capacity 0`
    - `spread 6h over 3 working days is 2h each`
    - `spread skips weekend and holiday`
    - `past-due goes to today`
    - `no dates goes to none`
    - `window with no working days goes to due date`
    - `ticket with no tasks uses the default size`
    - `4 h task with a main assignee and one helper → 2 h each`
    - `7 min split between 2 → 3 and 4`
  - Integration:
    - `without workload.view → 403`
    - `task with a helper appears in both people's rows with half the remaining estimate`
    - `restricted viewer: other-company ticket assigned to a shown tech → absent from items and from cell minutes`
    - `GET /workload?from=2026-11-02&today=2026-11-02 at 2026-11-03T03:30Z → today column is Nov 2`
    - `global and own-department holidays count, other departments' do not`
    - `PATCH ticket plannedDate audited and logged, SLA dueDate unchanged`
    - `plannedDate on a ticket without edit access → 403`
    - `work-hours PATCH validates 0–1440 and needs settings.manage_business_hours`
    - `defaultTicketMinutes outside 15–1440 → 400`
  - Migration: `round trip`
- [ ] Implement, migrate the test DB, and run.
- [ ] Commit `feat(workload): capacity, ticket planned date, workload API`.

### Task 13: Workload screen, dispatch, Settings pages, nav

**Files:**
- Create: `frontend/src/pages/workload/Workload.jsx`, `workload/UnassignedLane.jsx`, `workload/WorkloadGrid.jsx`, `workload/CellPopover.jsx`, `workload/dispatch.js`, `frontend/src/pages/settings/WorkHours.jsx` (default week + per-person overrides + default ticket size).
- Modify: `App.jsx` (route `/workload`), the top bar nav (Workload item when `workload.view`), `settings/registry.js` (new group `Workload`: `work-hours` (access `settings.manage_business_hours`) and `holidays` moved into this group with desc "Days off for the SLA clock and workload").
- Test: `frontend/src/pages/workload/dispatch.test.js`, `frontend/test/smoke/workload.smoke.js`

**Interfaces:**
- Consumes: `GET /workload` (Task 12); `PATCH /tickets/:id {assigneeId, plannedDate}`; `PATCH /projects/:id/tasks/:taskId {assigneeId, startDate, dueDate}`.
- Produces: `dropPatch(item, personId, date) → { url, body }`. A ticket gets assignee + plannedDate. A dated task keeps its length with start = date. An undated task gets start = due = date. Dropping on the "No date" column changes only the assignee.

- [ ] Tests:
  - Dragging a task between people changes only the main assignee; helpers stay.
  - Unit: `ticket drop sets plannedDate not dueDate`, `dated task keeps its length`, `undated task gets one day`, `No date column only reassigns`
  - Smoke:
    - `drag an unassigned ticket onto Sam Thu → assigned and planned, lane shrinks`
    - `cell over capacity is red`
    - `clicking a cell lists its items`
    - `items without canEdit are not draggable`
    - `nav shows Workload only with workload.view`
    - `Hours people work saves a 6h override`
    - `Holidays appears under Workload in Settings`
- [ ] Implement against the Workload board and run.
- [ ] Commit `feat(workload): workload screen with drag-to-dispatch, hours people work`.

## Stage 7 — Phone and finish

### Task 14: Phone layout of the project page

**Files:**
- Create: `frontend/src/pages/projects/detail/PhoneTasks.jsx` (cards, Mine/All/Waiting, bottom dock). Modify: `TasksTab.jsx` (switch at `< 768px`), `SummaryRow.jsx` (two tiles on a phone), `Tabs.jsx` (scrollable).
- Test: `frontend/test/smoke/projectPhone.smoke.js` (375×812)

- [ ] Smoke tests: `no horizontal page scroll at 375px`, `timer button is at least 44px and starts a timer`, `Log time in the dock opens the time form`, `Add task in the dock adds to the first open phase`.
- [ ] Implement against the Phone board and run.
- [ ] Commit `feat(projects): phone layout for the project page`.

### Task 15: Docs, full suites, push

**Files:** `UPGRADING.md` (under `## Unreleased`), `docs/ROADMAP.md` (row 6 → Shipped, "Where things stand"), this plan's status line, the spec's status line.

- [ ] Write the UPGRADING notes:
  - three migrations and `npm run migrate`;
  - the new permissions and who got them;
  - the Holidays page moved in Settings;
  - the new font dependency (rebuild the frontend image);
  - budget alert emails on by default;
  - dark is now the default theme for anyone who never picked one;
  - tasks can have helpers, and their time counts as person-hours.
- [ ] Run the full backend suite and `npm run test:smoke` once. Both must be green. Paste the failure output if not.
- [ ] Because this touches scope checks on new endpoints, run a fresh reviewer subagent over the branch with a security focus: id scoping, workload visibility and template copy access. Fix its findings.
- [ ] Commit `docs: sub-project 6 release notes and roadmap`, then push to `dev`.
