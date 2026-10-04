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
| Where assertions read from | The API wherever it exposes the result (GETs, activity timelines, `/audit-log`, `/notifications`, report endpoints, project stats). Direct database reads only for state no endpoint shows. This keeps the tests valid across the ledger merge, which is when they matter most. |
| Bugs found while writing tests | Security and access bugs are fixed in this sub-project (S1–S4 below), each proven by a failing test first. Everything else is pinned as today's behaviour and tagged `[quirk]`. |
| Scope | Core endpoints plus all four extensions: time/task readers, side effects, project extras, ticket extras. |

## Layout

All new files are in `backend/test/integration/`. No file grows past roughly
800 lines (roadmap rule 6); a file that would is split further.

| File | Covers |
|---|---|
| `fixtures.js` | Builders shared by the files below (see Fixtures). |
| `tickets.core.test.js` | Create (defaults, validation, source restriction, assignment rules), get, update (every allowed field, `dueTime` cleared with `dueDate`, resolution stamping, activity per tracked field), delete, list filters and sorting, board. |
| `tickets.extras.test.js` | Comments (types, edit/delete by author vs moderator, reply email to the contact), attachments, relations (stored direction of parent/child, listing from both sides, duplicates rejected), watchers, custom field values. |
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
`makeSubtask`. Each returns the response body. Records with no create
endpoint (a team with a lead, a user's `userType`/`hourlyRate`) are created
through the models, with a comment saying why.

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
`toISOString()` (UTC) today; that is pinned.

**Quirks.** A test that pins behaviour which is probably wrong has a name
starting `[quirk]` and a one-line comment giving the likely correct behaviour
and the sub-project expected to change it. When a later sub-project changes
it, that commit flips the assertion and drops the tag. The full list is the
quirk table below; sub-project 3's ROADMAP row links to it.

## Security fixes (S1–S4)

A scan of every nested ticket and project route found expenses, materials,
files, members, comments, attachments and watchers correctly checking the
parent. Four gaps remain. Each is fixed test-first: write the test, see it
fail (proving the gap), fix, see it pass. If a test shows a gap is not real,
the test stays as a guard and no code changes.

| # | Gap | Effect | Fix |
|---|---|---|---|
| S1 | `DELETE /projects/:id/tasks/:taskId/subtasks/:subtaskId` checks access to project `:id` but never that task `:taskId` belongs to it. | A user with access to project A can delete any subtask in project B. | Load the task with `{ id: taskId, projectId: id }` first and 404 if absent, as `updateSubtask` already does. |
| S2 | `POST /timer/start` checks only that the ticket exists. | A user can run a timer on, and so log time to, a ticket they cannot see. | Check `canAccessTicket`; 403 as on every other ticket route. |
| S3 | `POST /tickets/:id/relations`, and `parentTicketId` / `childTicketIds` / `relatedTicketIds` on ticket create, never scope-check the *other* ticket. | Linking to an arbitrary id and listing relations reveals that ticket's title, status and priority. | An out-of-scope target is treated exactly like a missing one: 404 `Related ticket not found` on the relation endpoint, 400 `VALIDATION_ERROR` on create. Existence cannot be probed. |
| S4 | `linkedTicketId` on project task create and update is not scope-checked. | The task response includes the linked ticket's title. | Same rule as S3: 400 `VALIDATION_ERROR`, same as a missing ticket. |

Deliberately **not** changed: ticket and project delete do not re-check
scope. The `tickets.delete` / `projects.delete` permissions are admin-tier;
the baseline pins the current behaviour and sub-project 2's company scope
revisits it.

S1–S4 are the only behaviour changes in this sub-project and the only
user-visible ones; they are recorded for `v0.4.0` in `UPGRADING.md`.

## Known quirks (pinned, not fixed)

Found while designing; the plan adds any more found while writing tests.

| # | Quirk | Where | Likely fix in |
|---|---|---|---|
| Q1 | Editing a project time entry's start/end recomputes `durationSeconds` but not `laborCost`. | `projectsController.updateTimeEntry` | 3 |
| Q2 | Editing a project time entry writes no audit row (create and delete do). | `projectsController.updateTimeEntry` | 3 |
| Q3 | Editing a project time entry accepts a future `entryDate`; creating one rejects it. | `projectsController.updateTimeEntry` | 3 |
| Q4 | Ticket and project time store "who logged it" and "who it is for" in opposite columns: ticket `userId` = target, `loggedById` = logger; project `userId` = logger, `loggedForUserId` = target. So the "only remove your own entry" check means the target on tickets and the logger on projects. | `ticketsController.removeTime`, `projectsController.updateTimeEntry` / `removeTimeEntry` | 3 |
| Q5 | Timer-created ticket time has no `entryDate`, `startTime`, `endTime` or `loggedById`; manually logged ticket time has all four. | `timerController.logTimer` | 3 |
| Q6 | Time-entry edit and delete permission checks use the legacy `req.user.role === 'admin'` rather than a granular permission. | `ticketsController.removeTime`, `projectsController` time handlers, `canLogForOthers` | 3 |
| Q7 | A project task or subtask PATCH whose `statusId` is the same id sent as a string (`"3"` vs `3`) is treated as a status change: an already-closed task's `completedAt` is reset to now. | `projectsController.updateTask` / `updateSubtask` | 3 |
| Q8 | Ticket task create/update writes no activity entry and no audit row. | `ticketsController.createTask` / `updateTask` | 3 |

## Done when

- Every endpoint in the four scope areas has tests covering the four
  questions above.
- S1–S4 are fixed, each with a test that failed before its fix.
- Every quirk has a `[quirk]` test and a row in the quirk table; sub-project
  3's ROADMAP row links to the table.
- The whole suite passes on Node 24 locally and in CI. The CI workflow does
  not change.
- No test file exceeds roughly 800 lines.
- `docs/ROADMAP.md` marks sub-project 1 **Shipped**, and S1–S4 are noted for
  the `v0.4.0` section of `UPGRADING.md`.

Expected size: roughly 250–350 new tests, taking the suite from about 80
seconds to 3–5 minutes. Where tests only read, fixtures are created once per
`describe` block rather than before every test, to keep that in check.

## Out of scope

- Frontend tests (no framework exists; adding one is its own decision).
- Any behaviour change other than S1–S4.
- Inbound email processing and the scheduled jobs (workflow scheduler, CSAT
  scheduler, calendar sync). The baseline asserts that ticket actions
  *trigger* rule evaluation and CSAT creation, not the schedulers.
- Load and concurrency testing, beyond the one concurrent project-code test.
