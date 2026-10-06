# Sub-project 1: Test baseline — design

Phase 1, sub-project 1 of the [PSA roadmap](2026-10-03-prism-psa-roadmap-design.md).
Status lives in [`docs/ROADMAP.md`](../../ROADMAP.md).

## Purpose

The rest of Phase 1 rewrites the code that tickets, projects and time run on:
sub-project 2 puts `companyId` on every record and adds a company dimension
to scope checks; sub-project 3 merges `TimeEntry` and `ProjectTimeEntry` into
one ledger and gives ticket tasks subtasks. This sub-project writes down how
that code behaves **today**, as integration tests, so those rewrites fail
loudly when they change something nobody meant to change.

Success: every ticket, project, task, subtask, time and timer behaviour that
a later sub-project could break is pinned by a test that runs in CI, and
every number PRISM shows for time agrees with every other place it is shown.

## Starting point

Surveyed at `c0a169f`:

- 15 suites / 200 tests, all integration-heavy, run against a real MariaDB
  schema through supertest (`backend/test/integration/helpers.js`). They pass
  on Node 24 in about 80 seconds.
- Covered today: auth, SSO, the authorization stack, hardening, migrations,
  pagination. `functional.test.js` checks that a technician *can* call the
  ticket, task, time and project endpoints, but asserts little beyond the
  status code.
- Not covered: what those endpoints actually do — defaults, validation,
  scope, codes, rollups, labor cost, activity, audit, notifications, workflow
  triggers — and the reports, dashboard, custom reports and PDFs that read
  time data.
- No frontend tests exist.

## Decisions

| Decision | Choice |
|---|---|
| Test level | Backend integration tests through the HTTP API, using the existing Jest + supertest + MariaDB setup. No frontend tests. |
| Approach | Behaviour tests with explicit assertions, grouped by area. Not snapshots (sub-project 3 changes response shapes on purpose, which would turn snapshots into noise that gets blindly re-accepted), not service unit tests with mocked models (the risk is in SQL, scope and wiring). |
| Where assertions read from | The API wherever it exposes the result (GETs, activity timelines, `/notifications`, report endpoints, project stats); `AuditLog` rows are read through the model, since no endpoint reads them (`/audit-log` reads `SystemAuditLogs`). Direct database reads only for state no endpoint shows. This keeps the tests valid across the ledger merge, which is when they matter most. |
| Bugs found while writing tests | Security and access bugs are fixed in this sub-project (S1–S8 below), each proven by a failing test first. Everything else is pinned as today's behaviour and tagged `[quirk]`. |
| Scope | Core endpoints plus all four extensions: time/task readers, side effects, project extras, ticket extras. |

## Layout

All new files are in `backend/test/integration/`. No file grows past roughly
800 lines (roadmap rule 6); a file that would is split further.

| File | Covers |
|---|---|
| `fixtures.js` | Builders shared by the files below (see Fixtures). |
| `fixtures.test.js` | Guards for the harness itself: reset, pinned time zone, fixtures. |
| `contacts.department.test.js` | S8: assigning a contact's department (which moves its tickets) is scope-checked. |
| `tickets.core.test.js` | Create (defaults, validation, source restriction, assignment rules), get, update (every allowed field, `dueTime` cleared with `dueDate`, resolution stamping, activity per tracked field), delete, list filters and sorting, board. |
| `tickets.comments.test.js` | Comments (types, edit/delete by author vs moderator, reply email to the contact) and attachments. Split from extras to stay under the size limit. |
| `tickets.extras.test.js` | Relations (stored direction of parent/child, listing from both sides, duplicates rejected), watchers, custom field values, staff CSAT. |
| `tickets.tasks.test.js` | Ticket checklist tasks: create, update (completed, assignee, description), list order, cross-ticket ids. |
| `projects.core.test.js` | Create (project code per department, default status from status behaviour, members and lead), get, update, delete, list filters, tags, stats. Two concurrent creates in one department get distinct codes. |
| `projects.tasks.test.js` | Tasks and subtasks: codes, renumbering and its conflicts, reorder, `completedAt` from status behaviour, completion rollups (task complete when all subtasks closed; percent), activity entries. |
| `projects.extras.test.js` | Expenses, materials (total cost), members, files. |
| `time.tickets.test.js` | Ticket time: minutes vs start/end, rounding, log-for-others (admin / team lead only, target must hold `projects.log_time`), future `entryDate` rejected, labor cost, totals, delete rules. |
| `time.projects.test.js` | Project time: the same, plus task links (task must belong to the project) and editing. |
| `time.timer.test.js` | Start, start-same-ticket no-op, start-other-ticket logs the first, stop, cancel, the shape of the entry a timer produces. |
| `readers.reports.test.js` | Time-billing, team performance, projects report, and their CSV exports. |
| `readers.other.test.js` | Dashboard time figures, custom report engine (time-entry and project sources), ticket and project PDF report data. |
| `sideEffects.test.js` | Audit rows, notifications (assignment, watchers), workflow-rule triggers fired by ticket actions, CSAT survey on close, `timeTracking.requireBeforeClose`. |

### Fixtures

`fixtures.js` holds short builders that create records **through the API**,
so setup exercises the same code paths the tests check: `makeDept`,
`makeTech`, `makeContractor({ rate })`, `makeContact`,
`makeTicket(agent, overrides)`, `makeProject(agent, overrides)`, `makeTask`,
`makeSubtask`. Each returns the response body. Every fixture uses the API: teams via
`POST /teams`, contractors via `PATCH /users/:id`, own-tier users via
`POST /users/:id/overrides`. The shared time-and-money ledger the reader
suites check (`makeLedger`) lives here too.

### Reset

`resetData()` in `helpers.js` additionally truncates `ActiveTimers`,
`TicketActivities`, `ProjectActivities`, `AuditLogs`, `Notifications`,
`WorkflowRules`, `WorkflowConditions`, `WorkflowActions`, `WorkflowRuleLogs`,
`AssignmentRules`, `CsatSurveys`, `CsatResponses`, `ProjectFiles`,
`ProjectIdSequences`, `TicketFieldValues`,
`CustomFields`, `AssetTickets`, `Teams` and `TeamMembers` (none of which
migrations seed — checked against a fresh `prism_test`), and deletes the
`SystemSettings` rows the tests flip (`timeTracking.*`, `csat.*`). Seeded
rows other code depends on (statuses, roles, permissions, other settings)
are left alone.

### Recorders for outbound effects

`ticketsController` destructures `sendMail` and the calendar-push functions
when it loads, so spying after load does nothing. Files that assert on
outbound email or calendar pushes call `jest.mock()` on
`src/services/emailSender` and `src/services/calendarPush` and assert on the
recorded calls. All other files leave them real: SMTP is unconfigured in the
test environment and calendar push is fire-and-forget with no integrations
configured.

## What each test pins down

For every endpoint in scope:

1. **Happy path** — what a valid request returns, and what changed, read back
   through a GET.
2. **Validation** — each 400 the handler can throw, asserting the error
   `code` (`VALIDATION_ERROR`, `TIME_REQUIRED_BEFORE_CLOSE`,
   `TASK_CODE_CONFLICT`, …), since the frontend keys off those.
3. **Access** — every fetch-by-id and mutate-by-id is tried by a user who
   holds the permission but is outside the record's scope (an `own`-tier user
   on another user's ticket; a department-tier user on another department's
   project), expecting today's 403/404. Every nested route
   (`/:id/<child>/:childId`) is also tried with a child id that belongs to a
   *different* parent. Route-level permission denials are already covered by
   `authorization.test.js` and are not repeated.
4. **Side effects** — the activity entry, audit row and notification the
   action produces, asserted by type and payload.

**Time and money** are asserted exactly: durations to the second, minutes
after rounding, labor cost to the cent for a contractor and `null` (not `0`)
for staff. Totals are asserted in every place they appear — the time list's
headline total, project stats, the time-billing report, the dashboard, the
custom report and the PDF data — and must agree with each other. That
cross-check is the main protection for the ledger merge.

**Dates** that depend on "now" (future-date rejection, the `entryDate`
default) use Jest fake timers faking only `Date`, so the database driver's
timers are unaffected, and are tested at fixed instants including one where
the UTC date and the server's local date differ. `entryDate` is derived with
`toISOString()` (UTC) today; that is pinned. The suite pins `TZ=America/Chicago`
in Jest's globalSetup, so local and CI runs agree.

**Quirks.** A test that pins behaviour which is probably wrong has a name
starting `[quirk]` and a one-line comment giving the likely correct behaviour
and the sub-project expected to change it. When a later sub-project changes
it, that commit flips the assertion and drops the tag. The full list is the
quirk table below; sub-project 3's ROADMAP row links to it.

## Security fixes (S1–S8)

A scan of every nested ticket and project route found expenses, materials,
files, members, comments, attachments and watchers correctly checking the
parent. Four gaps remain, and writing the plan found a fifth (S5). Each is fixed test-first: write the test, see it
fail (proving the gap), fix, see it pass. If a test shows a gap is not real,
the test stays as a guard and no code changes.

| # | Gap | Effect | Fix |
|---|---|---|---|
| S1 | `DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId` checks access to project `:id` but never that task `:taskId` belongs to it. | A user with access to project A can delete any subtask in project B. | Load the task with `{ id: taskId, projectId: id }` first and 404 if absent, as `updateSubtask` already does. |
| S2 | `POST /timer/start` checks only that the ticket exists. | A user can run a timer on, and so log time to, a ticket they cannot see. | Check `canAccessTicket`; 403 as on every other ticket route. |
| S3 | `POST /tickets/:id/relations`, and `parentTicketId` / `childTicketIds` / `relatedTicketIds` on ticket create, never scope-check the *other* ticket. | Linking to an arbitrary id and listing relations reveals that ticket's title, status and priority. | An out-of-scope target is treated exactly like a missing one: 404 `Related ticket not found` on the relation endpoint, 400 `VALIDATION_ERROR` 'Linked ticket not found' on create. A link can't be used to read a hidden ticket's title, and the id is parsed strictly (only a plain positive integer; `"1e1"` or `1.6` are refused, never checked as one ticket and stored as another). A *missing* linked ticket now gets that same 400 too (before: 400 `FK_CONSTRAINT`). |
| S4 | `linkedTicketId` on project task create and update is not scope-checked. | The task response includes the linked ticket's title. | Same rule as S3: 400 `VALIDATION_ERROR` 'Linked ticket not found' for out-of-scope and missing tickets alike (before: a missing one was stored as a dangling id). Re-sending a task's existing link unchanged is not re-checked. |
| S5 | `POST /projects/:id/files` skips `verifyFileSignature`, which ticket attachments run. | A Windows executable renamed `.pdf` is stored on a project. | Add `verifyFileSignature` to the route. |
| S6 | A ticket's `projectId` (create and update) is not scope-checked. Found in the final review. | Attaching a ticket to another department's project returns that project's name; a missing id answers `FK_CONSTRAINT`, so project ids can be probed. | `canAccessProject`; out-of-scope and missing both get 400 `VALIDATION_ERROR` 'Project not found'; the checked project's id is stored; re-sending the current value unchanged isn't re-checked. |
| S7 | A ticket's `contactId` (create and update) is not scope-checked. Found in the final review. | The ticket response carries the contact's email and phone, so a department-scoped user could read any contact by walking ids. | The contacts module's own scope: `people.view_all`, or the caller's department, or a no-department contact the caller created (the new-ticket form's quick-create). Otherwise 400 `VALIDATION_ERROR` 'Contact not found', same as missing. |
| S8 | `PATCH /contacts/:id/department` has no scope check, and it moves every ticket the contact owns into the new department. Found while fixing S7. | Anyone with `tickets.create` (Department Staff included) could pull another department's contact, and with it that contact's tickets, into their own department and then read them. | The caller must be able to see the contact (S7's rule; missing and out-of-scope both 404 'Contact not found'), and without `people.view_all` may only assign their own department (403). Tested in `contacts.department.test.js`. |

Deliberately **not** changed: ticket and project delete do not re-check
scope. The `tickets.delete` / `projects.delete` permissions are admin-tier;
the baseline pins the current behaviour and sub-project 2's company scope
revisits it.

S1–S8 are the only behaviour changes in this sub-project and the only
user-visible ones; they are recorded for `v0.4.0` in `UPGRADING.md`.

## Known quirks (pinned, not fixed)

Q1–Q8 were found while designing; Q9–Q36 while planning; Q37 while writing the tests; Q38 in the final review. Note that `GET /tickets/:id` still answers 404 for a missing ticket and 403 for a hidden one, so ticket *existence* remains probeable there; sub-project 2's scope work revisits that. Q17, Q18, Q19, Q21 and Q26 are access-flavoured: the user chose (2026-10-04) to pin them here and revisit them in sub-project 3.

| # | Quirk | Where | Likely fix in |
|---|---|---|---|
| Q1 | Editing a project time entry's start/end recomputes `durationSeconds` but not `laborCost`. | `projectsController.updateTimeEntry` | 3 (fixed in plan 3b-1) |
| Q2 | Editing a project time entry writes no audit row. | `projectsController.updateTimeEntry` | 3 (fixed in plan 3b-1) |
| Q3 | Editing a project time entry accepts a future `entryDate`; creating one rejects it. | `projectsController.updateTimeEntry` | 3 (fixed in plan 3b-1) |
| Q4 | Ticket time: `userId` = who it's for, `loggedById` = logger. Project time: `userId` = logger, `loggedForUserId` = who it's for. So "only your own entry" means the target on tickets and the logger on projects. | `ticketsController.removeTime`, `projectsController` time handlers | 3 (fixed in plan 3b-1) |
| Q5 | Timer-created ticket time has no `startTime`, `endTime` or `loggedById`. `loggedAt` is the timer's start, and `entryDate` is the UTC date the timer stopped. | `timerController.logTimer` | 3 (fixed in plan 3b-1) |
| Q6 | Logging for others, and editing or deleting others' time, check the legacy `User.role === 'admin'`, not a granular permission. | `canLogForOthers`, time handlers | 3 (fixed in plan 3b-1) |
| Q7 | A task or subtask PATCH whose `statusId` is the current id as a string counts as a status change: `completedAt` is re-stamped. | `projectsController.updateTask` / `updateSubtask` | 3 (fixed in plan 3b-1) |
| Q8 | Ticket task create/update writes no activity and no audit row. | `ticketsController.createTask` / `updateTask` | 3 |
| Q9 | Time-billing filters and dates ticket time by `loggedAt` and project time by `createdAt`, never by `entryDate`. The custom report shows `entryDate` but filters the same way. | `reportsController.buildTimeBillingReport`, `customReportEngine.loadTimeEntryRecords` | 3 (fixed in plan 3b-1) |
| Q10 | Team performance "time logged" counts ticket time only. | `reportsController.buildTeamPerformanceReport` | 3 (fixed in plan 3b-1) |
| Q11 | Project total cost excludes labour in project stats and the projects report, but includes it in the custom report's projects source. | `buildProjectStats`, `buildProjectsReport`, `loadProjectRecords` | 3 (fixed in plan 3b-1) |
| Q12 | Dashboard hours count ticket time only, by `loggedAt`, Monday–Friday only, bucketed by UTC date. | `dashboardController.hoursForUser` | 3 (fixed in plan 3b-1) |
| Q13 | Deleting a project leaves its tasks, time entries and other child rows behind (no foreign keys). | `projectsController.remove` | 3 |
| Q14 | "Today" for `entryDate` (default and future limit) is the UTC date. | ticket/project time create | 3 (fixed in plan 3b-1) |
| Q15 | Re-sending a closed `statusId` on a task logs another `task_closed`. | `projectsController.updateTask` | 3 (fixed in plan 3b-1) |
| Q16 | The `escalate_to_user` workflow action always fails: it sets priority `urgent`, which tickets don't have. | `workflowEngine.executeAction` | 3 |
| Q17 | Any project editor can delete anyone's project file. `canModerateProjectContent` exists but is unused. | `projectsController.removeFile` | 3 |
| Q18 | Relation lists show the title, status and priority of linked tickets the viewer can't open. | `ticketsController.listRelations` | 3 |
| Q19 | Project task lists show a linked ticket's title to viewers who can't open it. | `projectsController.listTasks` | 3 |
| Q20 | Renumbering a task leaves its subtasks' codes on the old task number. | `projectsController.renumberTask` | 3 (fixed in plan 3b-1) |
| Q21 | A lead of any team can log time for any user, teammate or not. | `canLogForOthers` | 3 (fixed in plan 3b-1) |
| Q22 | Editing project time accepts a `taskId` from another project. | `projectsController.updateTimeEntry` | 3 (fixed early as S13) |
| Q23 | Watchers, custom field values, project tasks/subtasks, expenses, materials, members and files are changed without audit rows. | those handlers | 3 |
| Q24 | Two tickets can be linked twice, once in each direction. | `ticketsController.createRelation` | 3 |
| Q25 | Ticket and project `status` accept any string, even one no status row has. | ticket/project create and update | 3 |
| Q26 | Edit access follows the **view** tier: a user with `tickets.edit_own`/`projects.edit_own` can edit anything they can view. | `canAccessTicket` / `canAccessProject` used for writes | 3 |
| Q27 | A `dueTime` sent alongside a cleared `dueDate` is kept. | `ticketsController.update` | 3 |
| Q28 | Ticket and project delete don't re-check scope. | `ticketsController.remove`, `projectsController.remove` | 2 |
| Q29 | Custom field values aren't checked against the field's type or options. | `syncCustomFieldValues` | 3 |
| Q30 | Changing a project's lead doesn't update its members. | `projectsController.update` | 3 |
| Q31 | A task created already closed has no `completedAt`. | `projectsController.createTask` | 3 (fixed in plan 3b-1) |
| Q32 | A partial reorder leaves duplicate positions. | `projectsController.reorderTasks` | 3 (fixed in plan 3b-1) |
| Q33 | Expense and material updates skip the create-time validation. | `updateExpense` / `updateMaterial` | 3 |
| Q34 | A timer on a deleted ticket can't be stopped or replaced (400 `FK_CONSTRAINT`), only cancelled. | `timerController` | 3 (fixed in plan 3b-1) |
| Q35 | Creating a ticket already closed bypasses `timeTracking.requireBeforeClose`. | `ticketsController.create` | 3 |
| Q36 | A report `endDate` becomes the end of the *previous* local day west of UTC. | `reportsController.parseDateRange` | 3 (fixed in plan 3b-1) |
| Q37 | ~~Two projects created at the same moment in one department could fail (findOrCreate race on a department's first project; MariaDB 11 snapshot-isolation error 1020 after that).~~ **Fixed in sub-project 1** at the user's request: the counter is one atomic `INSERT … ON DUPLICATE KEY UPDATE` in a READ COMMITTED transaction. | `projectCodeService.nextProjectSequence` | 1 (fixed) |
| Q38 | Updates accept a blank or whitespace-only ticket title, project name, or task/subtask title (create rejects them). | ticket/project/task/subtask update handlers | 3 |

Q8, Q23, Q25 and Q38 are fixed for tasks in plan 3b-1. Their ticket and project halves follow in 3b-2.

## Done when

- Every endpoint in the four scope areas has tests covering the four
  questions above.
- S1–S8 are fixed, each with a test that failed before its fix.
- Every quirk has a `[quirk]` test and a row in the quirk table; sub-project
  3's ROADMAP row links to the table.
- The whole suite passes on Node 24 locally and in CI. The CI workflow does
  not change.
- No test file exceeds roughly 800 lines.
- `docs/ROADMAP.md` marks sub-project 1 **Shipped**, and S1–S8 are noted for
  the `v0.4.0` section of `UPGRADING.md`.

Expected size: roughly 250–350 new tests, taking the suite from about 80
seconds to 3–5 minutes. Where tests only read, fixtures are created once per
`describe` block rather than before every test, to keep that in check.

## Out of scope

- Frontend tests (no framework exists; adding one is its own decision).
- Any behaviour change other than S1–S8.
- Inbound email processing and the scheduled jobs (workflow scheduler, CSAT
  scheduler, calendar sync). The baseline asserts that ticket actions
  *trigger* rule evaluation and CSAT creation, not the schedulers.
- Load and concurrency testing, beyond the one concurrent project-code test.
