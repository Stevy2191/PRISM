# Sub-project 3: One work model — design

Status: approved in brainstorming on 2026-10-05; written for review.
Roadmap: [`docs/ROADMAP.md`](../../ROADMAP.md), Phase 1, sub-project 3.
Roadmap rule this implements: *One work model, one time ledger* in
[the roadmap design](2026-10-03-prism-psa-roadmap-design.md).

## Purpose

Tickets and projects share one task model and one time ledger, so that
everything built later — SLA clocks (4), the full service desk (5), project
management (6), timesheets and billing (Phase 3) — builds on one model
instead of two. Existing tasks and time move into the new model without
loss. Along the way, the test baseline's
[known quirks](2026-10-03-test-baseline-design.md#known-quirks-pinned-not-fixed)
are resolved, and the oversized ticket and project files are split.

Success means:

- a ticket can carry real tasks and subtasks, shown as a compact checklist
  that expands, with time logged per task;
- every minute of work, on a ticket or a project, lives in one table that
  every report, the dashboard and the timer read and write;
- every pinned quirk has a fix and a test that proves it;
- no file in the ticket, project or report code is over about 800 lines.

## Decisions

Made with the user while brainstorming, on 2026-10-05.

| Decision | Choice |
|---|---|
| Ticket tasks | **Same model as project tasks, compact UI.** Ticket tasks become real tasks (status, assignee, due date, estimate, subtasks, time per task). The ticket page shows them as a checklist that expands to full details. |
| Task statuses | **Four separate, editable lists:** ticket statuses, ticket-task statuses, project statuses and project-task statuses. A task's statuses never depend on its parent's list. |
| Billable and work type | **Both, simple.** Every time entry has a Billable flag and a Work type from an editable list. No rates yet; the money phase attaches rates to work types without migrating time again. |
| Time for others | **A permission plus own team.** A new `time.manage_others` permission (System Administrator and Department Manager by default) allows logging, editing and deleting time for anyone the user can see. A team lead without it may do so only for members of their own team(s). |
| Storage | **One `Tasks` table and one `TimeEntries` ledger** (approach A). Old tables are copied in with id maps, then kept read-only for one release. |
| Edit access (Q26) | **Fixed, defaults kept.** Writes check the edit tier, as the permission labels say. The migration grants the seeded System Technician role `tickets.edit_all` and `projects.edit_all`, so default installs behave exactly as before. |
| Order of work | **Split first.** The file splits land first as a pure refactor guarded by browser smoke tests; the model changes follow on the smaller files. |

## Data model

### Status lists

- `TicketStatuses` and `ProjectStatuses` stay as they are.
- New table `TaskStatuses`, the same columns as those two (name, color,
  `behaviorType` open/closed, position, isDefault, isProtected) plus
  `scope` (`ticket` | `project`). Each scope is one editable list.
  - The `ticket` scope is seeded **To do** (open, default), **In progress**
    (open) and **Done** (closed, protected).
  - The `project` scope is seeded as a **copy of today's project statuses**,
    with the same names, colors, behaviors and order, so every existing
    project task keeps its status.
- A status can't be deleted while a task uses it, and each scope keeps at
  least one open and one closed status.

### `Tasks`

One table for every task and subtask.

| Column | Notes |
|---|---|
| `id` | |
| `ticketId` / `projectId` | Exactly one is set (database check). |
| `parentTaskId` | Set on subtasks; the parent has the same ticket or project. One level deep. |
| `code` | Project tasks keep `IT-P00012-T3` / `…-T3-1`. Ticket tasks get `#00012-T1`, their subtasks `#00012-T1-1`. Unique. |
| `title`, `description` | Title required and never blank. |
| `statusId` | From `TaskStatuses` in the matching scope. |
| `priority` | `urgent`, `high`, `medium`, `low`, as project tasks have today. |
| `assigneeId`, `dueDate`, `estimateMinutes`, `position` | |
| `completedAt` | Set when the status becomes a closed one (including on create), cleared when it becomes open. |
| `linkedTicketId` | Project tasks only; same company as the project (plan 2a rule). |
| `createdBy`, `createdAt`, `updatedAt` | |

A task has no `companyId`: it always follows its ticket or project for
company and access.

### `WorkTypes`

`id`, `name`, `billableDefault`, `isActive`, `position`. Seeded **Remote
support**, **On-site**, **Travel** and **Project work** (all billable by
default), and **Admin** (not billable). Editable in Settings; a work type in
use can be deactivated but not deleted.

### `TimeEntries` (the one ledger)

| Column | Notes |
|---|---|
| `id` | |
| `ticketId` / `projectId` | Exactly one is set (database check). |
| `taskId` | Optional; a task or subtask under the same ticket or project. |
| `userId` | Who the time is **for**. |
| `loggedById` | Who **entered** it. |
| `entryDate` | The date the work was done, in the organization's time zone. |
| `startTime`, `endTime` | Set when known (timer, start/end picker); null for a plain duration. |
| `durationSeconds` | Always set; equals `endTime − startTime` when both are set. |
| `billable`, `workTypeId` | Billable defaults from the work type. |
| `note` | |
| `laborCost` | Computed from `userId` (as today's contractor rule); recomputed whenever duration or `userId` changes. |
| `createdAt`, `updatedAt` | "When it was entered" is `createdAt`. |

`ActiveTimers` gains `taskId` (optional).

### Migration

One migration, in a transaction where MariaDB allows it, idempotent like
plan 2a's.

1. **Rename** `TimeEntries` → `legacy_TimeEntries`,
   `ProjectTimeEntries` → `legacy_ProjectTimeEntries`,
   `TicketTasks` → `legacy_TicketTasks`,
   `ProjectTasks` → `legacy_ProjectTasks` and
   `ProjectSubtasks` → `legacy_ProjectSubtasks`.
2. **Create** `TaskStatuses` (seeded as above), `WorkTypes` (seeded),
   `Tasks` and `TimeEntries`, plus `TaskIdMap` and `TimeEntryIdMap`
   (old table, old id → new id).
3. **Tasks:**
   - project tasks keep their ids;
   - project subtasks and ticket tasks get new ids, recorded in `TaskIdMap`;
   - project-task statuses map one-to-one onto the copied project scope;
   - ticket checklist items map to To do or Done, with the description
     becoming the title (`completedAt` = `updatedAt` for done items).
4. **Time:**
   - ticket time keeps its ids;
   - project time gets new ids, recorded in `TimeEntryIdMap`;
   - "who it's for" and "who logged it" are mapped from each table's own
     meaning (fixing Q4): ticket `userId`/`loggedById`, and project
     `loggedForUserId ?? userId` / `userId`;
   - the duration comes from `durationSeconds`, or `minutes × 60`;
   - the work type is Remote support for ticket time and Project work for
     project time, with billable set to yes;
   - `laborCost` is copied as stored (recomputing history is out of scope).
5. **Rewire every reference to a remapped id:** time `taskId`s, activity
   rows that name a task or subtask, `ActiveTimers`, and `linkedTicketId`
   (unchanged ids, so a check only).
6. **Permissions:**
   - add `time.log` and `time.manage_others`;
   - grant `time.log` to every role holding `projects.log_time`, or any ticket
     edit permission;
   - grant `time.manage_others` to System Administrator and Department
     Manager;
   - grant System Technician `tickets.edit_all` and `projects.edit_all`.
7. `down()` restores the legacy tables while no row exists that the
   legacy shape can't hold (a task with a subtask on a ticket, a time entry
   on a ticket task, or a non-default work type), and refuses otherwise.
   This is plan 2a's pattern.

The legacy tables stay, renamed and unread, for one release. The next
release's first migration drops them.

## Behaviour and API

### Tasks

- **One service** (`services/tasks/`) does create, edit, delete, reorder,
  renumber and status rules. `/tickets/:id/tasks` and `/projects/:id/tasks`
  are thin wrappers with the same behaviour on both sides.
- **Subtasks** are tasks with `parentTaskId`. The project subtask URLs
  (`/projects/:id/tasks/:taskId/subtasks…`) stay as aliases for one release.
- **Field names are unified** (`title`, `statusId`, `assigneeId`, `dueDate`,
  `estimateMinutes`, …). This changes the ticket-task and project-task
  request and response bodies; UPGRADING says so for API-key users.
- **Rules:**
  - re-sending the current status is no change (Q7, Q15);
  - a task created closed gets `completedAt` (Q31);
  - reorder takes the full list of a parent's tasks, otherwise 400 (Q32);
  - renumbering a task renumbers its subtasks (Q20);
  - titles are never blank (Q38);
  - `statusId` must exist in the right scope (Q25).
- **Audit:** every create, edit, status change, reorder, renumber and delete
  writes activity and an audit row (Q8, Q23).
- **Access:** reading needs view access to the parent; writing needs edit
  access to the parent (see *Permissions*). The assignee must be able to
  reach the parent's company (plan 2b rule).

### Time

- **One service** (`services/time/`) behind `/tickets/:id/time` and
  `/projects/:id/time-entries`, which take the same body:
  - `durationMinutes` **or** `startTime` + `endTime`;
  - `entryDate`, `note`, `taskId`, `workTypeId`, `billable`, and `userId`
    (who it's for, defaulting to the caller).
- **Edit** (`PATCH …/:entryId`) works on both sides; ticket time had none
  before. Every rule from create is re-checked:
  - the task belongs to the same parent (Q22);
  - `entryDate` is not in the future (Q3), where "today" is the
    organization's (Q14);
  - labour cost is recomputed (Q1);
  - the edit is audited (Q2).
- **Delete** is audited.
- **Timer:**
  - it targets a ticket, a project, or a task on either;
  - stopping writes `startTime`, `endTime`, `loggedById` and the work
    date in the organization's time zone (Q5);
  - a timer whose ticket or project was deleted can be stopped, which
    discards it with a clear message, as well as cancelled (Q34);
  - the timer needs `time.log`.

### Permissions

- **`time.log`:** log your own time on anything you can edit.
- **Logging, editing or deleting someone else's time** (Q6, Q21) needs one
  of:
  - `time.manage_others` (the other person must be someone you can see);
  - being a lead of a team the other person is a member of.
- **Edit tier for writes (Q26):** ticket and project writes, and task and
  time writes on them, check `*.edit_own` / `*.edit_department` /
  `*.edit_all` against the record, not the view tier.
- **Deletes (Q28):** ticket and project deletes re-check the edit tier, as
  well as the company fence that plan 2a added.
- **Project files (Q17):** a file can be deleted by its uploader, or by a
  project moderator (`canModerateProjectContent`: `projects.edit_all`, or
  `projects.edit_department` for a project owned by or for the user's
  department).

### Other fixes

| # | Fix |
|---|---|
| Q9 | Time-billing and the custom report date and filter all time by `entryDate`. |
| Q10 | Team performance counts all time in the ledger. |
| Q11 | Project cost includes labour everywhere (project stats, projects report, custom report). |
| Q12 | Dashboard hours read the ledger by `entryDate`, every day of the week, in the organization's time zone. |
| Q13 | Deleting a project deletes its tasks, time, expenses, materials, files (on disk too), members and activity in one transaction, and is audited. |
| Q16 | `escalate_to_user` sets priority **critical**. |
| Q18, Q19 | A linked ticket the viewer can't open is shown as "Restricted ticket", with its id but no title, status or priority (plan 2a already hides other companies' tickets). |
| Q24 | Two tickets can be linked once, whichever direction. |
| Q27 | Clearing `dueDate` clears `dueTime`. |
| Q29 | Custom field values are checked against the field's type and options. |
| Q30 | A new project lead is added as a member; the old lead stays a member. |
| Q33 | Expense and material edits run the create validation. |
| Q35 | Creating a ticket already closed obeys `timeTracking.requireBeforeClose`. |
| Q36 | Report date ranges are whole days in the organization's time zone. |

The organization's time zone is the existing `company.timezone` setting
(default UTC). One helper converts "today" and date ranges.

## Code structure

### Backend

- **Shared services:** `services/tasks/` and `services/time/` hold the
  rules above.
- **Controllers:**
  - `ticketsController.js` is split into `controllers/tickets/`: core,
    comments, attachments, relations, watchers, tasks, time, PDF report and
    activity;
  - `projectsController.js` is split into `controllers/projects/`: core,
    members, tasks, time, expenses, materials, files and activity;
  - `reportsController.js` is split by report family into
    `controllers/reports/` (tickets, time, projects, contacts, assets,
    shared);
  - route URLs are unchanged.

### Frontend

- **Shared work components** in `components/work/`: `TaskList` (a compact
  checklist that expands into task details with subtasks and time),
  `TimeLog` with one `TimeEntryForm`, and `TimerButton` (which can target a
  task). The ticket and project pages both use them.
- **Page splits:**
  - `TicketDetail.jsx` → `pages/tickets/` and `ProjectDetail.jsx` →
    `pages/projects/`, one file per panel or tab;
  - `Tickets.jsx` is split into a filter bar, table and board;
  - `TicketNew.jsx` is split into form sections.
- **Settings:**
  - Statuses gets four tabs: Tickets, Ticket tasks, Projects, Project tasks;
  - a new Work types page;
  - the role editor lists the two new permissions.
- **Size:** no file over about 800 lines; most under 400.

## Plans

Three plans, each shippable on its own and pushed to `dev` when done:

- **3a — Split and guard.**
  - Browser smoke tests around the ticket and project pages.
  - The backend and frontend splits, with no behaviour change: the full
    suite and the smoke suite pass unchanged after every step.
- **3b — The model.**
  - Task statuses, `Tasks`, work types, `TimeEntries`, and the migration
    with its id maps.
  - The task and time services; `time.log` / `time.manage_others`.
  - Edit-tier access (Q26, Q28) and the System Technician grant.
  - Timer changes; every report and the dashboard on the ledger.
  - The backend quirk fixes; the unified API field names.
- **3c — The screens.**
  - The shared task, time and timer components on both pages.
  - Settings → Statuses tabs, Work types, and the role editor permissions.
  - The frontend side of the quirk fixes ("Restricted ticket", etc.).

## Testing

Integration tests in the existing style, in new files of under about 800
lines each, plus browser smoke tests (`npm run test:smoke`).

- **Migration:** on a database seeded with today's shape,
  - total minutes per ticket, per project and per user, and total labour
    cost, match before and after;
  - every task keeps its status (name and behavior), assignee, due date,
    code, order and subtasks;
  - timers, activity rows and task links point at the new ids;
  - the down/up round trip restores the data while nothing new exists, and
    `down()` refuses once something does.
- **Quirks:** every `[quirk]` test from the baseline is rewritten to assert
  the fixed behaviour. Q28 stays pinned only until 3b fixes it.
- **Permissions:** a matrix for `time.log`, logging for others (by the
  permission, by an own-team lead, and refused for a lead of another team),
  and edit-tier writes and deletes on tickets, projects, tasks and time.
- **Smoke:**
  - ticket and project pages before the split (3a), proving the refactor
    changes nothing;
  - task, time and timer flows after 3c.
- **Regression:** the whole suite passes. Any baseline test that must
  change is a ruling in the plan's ledger.
- **Review:** a fresh whole-branch review and a security review before
  shipping. This sub-project changes edit permissions and labour cost.

## Done when

- Every quirk in the baseline table except Q37 (already fixed) is resolved,
  with a test.
- Nothing reads the legacy tables; they are renamed and dropped in the next
  release.
- No file in the ticket, project or report code exceeds about 800 lines.
- The full suite and the smoke suite pass on Node 24, locally and in CI.
- `docs/ROADMAP.md` marks sub-project 3 **Shipped**.
- `UPGRADING.md` describes:
  - the new permissions and the System Technician grant;
  - the unified API field names;
  - the time-zone change;
  - that the legacy time and task tables go in the next release.

## Security notes

Found during plan 3a's review and fixed straight after it. All of them were
older than the split.
- **S12:** the customer-happiness report ignored the reader's report scope.
- **S13:** project time entries (on update), expenses, materials and files
  accepted a task from another project. That showed the other task's title.
- **S14:** the time & billing report let `?assigneeId` replace an own-scope
  reader's restriction.
- **S15:** CSAT stats and responses let a department-scope reader see other
  departments.
- **S16:** the custom report builder had the same `assigneeId` override for
  tickets, projects and time.
- **S17:** custom expense and material reports had no own-scope
  restriction.

Plan 3b keeps these guarantees on the new tables:
- a task named on a time entry, expense, material or file belongs to the same
  ticket or project;
- report filters are ANDed onto the reader's scope and never merged into it.

## Out of scope

- Rates, timesheet approval and billing (Phase 3).
- SLA clocks (sub-project 4).
- Task dependencies, milestones and the timeline (sub-project 6).
- Recomputing the labour cost of historical time entries.
