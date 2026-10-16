# Service desk 5b — Desk tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team queues with "Take it", canned responses, a server-side bulk
endpoint, merge and split, and recurring tickets. Also lets staff pick
Email as a ticket's source by hand.

**Architecture:** The ticket create, update and delete logic moves out of
the HTTP handlers into `services/tickets/` (with no change in behaviour).
Bulk, take-it, merge, split and recurring then all go through the same
checks, activity log, workflow rules and notifications as a single edit.
Merge and split are single transactions in their own service modules.
Recurring tickets use a pure `nextRun` schedule function and a 60-s
claim-once scheduler, the same pattern as the SLA and workflow schedulers.

**Tech Stack:** Express + Sequelize + MariaDB, React, Jest (Node 24) and the
Playwright smoke suite.

**Spec:** `docs/superpowers/specs/2026-10-14-service-desk-design.md`
(section "5b — Desk tools" and the side note on ticket source). The plan
lists tasks, interfaces and test names, not full code (user rule).

## Decisions agreed 2026-10-15 (on top of the spec)

| # | Decision |
|---|---|
| D1 | A queue shows only tickets that aren't closed. The nav badge counts unassigned, not-closed tickets in my teams. |
| D2 | Take it also needs `assertCanWorkTicket` (the taker must reach the ticket's company). |
| D3 | Personal canned responses are private, admins included. `tickets.canned.manage` holders manage every team/everyone response in Settings. The picker shows each person their own, their teams' and everyone's. |
| D4 | `tickets.canned.manage` and `tickets.recurring.manage` go to System Administrator by default. |
| D5 | The protected "Closed" status gets `systemKey='closed'`. Bulk close and merge use it, never the name. |
| D6 | "Select all N matching" over 100 is sent in batches of 100, and the results are added up into one summary. |
| D7 | Merged sources close quietly: no CSAT survey, no "resolved" email and no `ticket_closed` rules. Activity is still logged, and "require time before close" is skipped for them. |
| D8 | If a source's contact isn't the target's contact, their email goes on the target's CC list. |
| D9 | A source's description is added to the target as a private note ("From #S: title + description"), timestamped at the source's creation. Custom field values don't move. There's no un-merge. |
| D10 | Moved tasks (and subtasks) get new codes under the target. A target can't be a ticket that has itself been merged. |
| D11 | New `Attachments.commentId` (nullable), filled in by inbound mail. Split moves only the attachments linked to the comment. |
| D12 | A split ticket gets the original's contact, company, department, team, priority, type, source and CC list. It starts unassigned and gets a normal SLA. |
| D13 | Every recurring run re-checks the access of the person it runs as. On failure the rule pauses itself, records `lastError` and sends that person an in-app notice. |
| D14 | The recurring list, editor and run-now only show rules whose contact the viewer can reach. |
| D15 | Recurring titles are fixed text. A new rule's timezone defaults to the organisation's. |
| D16 | Staff can pick Manual, Phone or Email as the source on create. Portal waits for sub-project 7. `recurring` is system-only. |
| D17 | (Plan detail, not in the spec.) A recurring rule **runs as whoever last saved it** (`createdById` is updated on every save, and the editor shows "Runs as X"). Each save is checked against the saver's access, so a rule never runs with access from someone who didn't approve its current contents. |

## Global Constraints

- Node ≥ 24.9. From `backend/`, run `npm test -- <paths>`. Jest pins
  `TZ=America/Chicago`. Integration tests run serially on one DB. Before
  `npm run test:migrate`, load the env: `set -a; . ./.env.test; set +a`.
  The test DB is the `prism-test-db` container (`docker start prism-test-db`).
- No new npm dependency.
- One migration, `20260101000066-service-desk-tools.js`, with a working
  `down()` and a round-trip test that leaves the schema as the full chain
  does. `Tickets.source` is changed with the same `changeEnum` approach as
  migration 060 (it reads the live column and skips columns that aren't
  ENUMs).
- TicketStatuses are **not** reset by `resetData`. A test that changes a
  status must restore it.
- Ids are parsed with `parseTicketId`/`parseRecordId`. A record that's
  missing and one that's out of scope get **the same answer**, in single
  and bulk responses alike.
- Every mutating endpoint checks its permission and calls `writeAudit`.
- Bulk, take-it, merge, split and recurring never write tickets directly:
  they go through `services/tickets/` (Task 2), so activity, workflow rules,
  SLA hooks and notifications always fire.
- Ticket attachment files live in `UPLOAD_ROOT/<ticketId>/`. Whatever moves
  attachment rows (merge, split) moves the files too: they are copied before
  the commit, the originals are removed after it, and the copies are removed
  on rollback.
- Canned-response bodies are plain text (max 10,000 characters) and are
  never rendered as HTML. Titles are at most 200 characters.
- During building, run only the affected test files. Run the full backend
  suite and full smoke once, before the push.

## Review Focus

1. **Bulk with ids the user can't see, mixed with ids that don't exist** →
   both get the identical per-ticket `"Ticket not found"`, and the others
   still apply. Test in Task 5.
2. **A merge where one source is in another company, or isn't editable by
   the user** → the whole merge is refused and nothing moves (no rows, no
   files). Test in Task 6.
3. **Two techs press Take it at the same instant** → exactly one wins. The
   other gets 409 "Already taken by <name>", and the SLA assignment clock
   stops once. Test in Task 3.
4. **A customer replies by email to a ticket that was merged twice
   (A→B→C)**, including the old contact of A → the reply lands on C as a
   contact-side reply. Test in Task 6.
5. **A recurring rule whose run-as user is deactivated or has lost access
   to the contact's company** → no ticket is created, and the rule is paused
   with a readable `lastError`. Test in Task 10.

---

### Task 1: Schema

**Files:**
- Create `backend/migrations/20260101000066-service-desk-tools.js`.
- Create `backend/src/models/CannedResponse.js`, `backend/src/models/RecurringTicket.js`.
- Modify `backend/src/models/index.js`, `Ticket.js`, `Attachment.js`.
- Modify `backend/src/services/statusBehavior.js`.
- Test `backend/test/integration/desktools.migration.test.js`.

**Interfaces:**
- `Tickets.mergedIntoId` INT NULL, FK → Tickets.id ON DELETE SET NULL, indexed.
- `Tickets.source` ENUM gains `'recurring'`.
- `Attachments.commentId` INT NULL, FK → Comments.id ON DELETE SET NULL.
- `TicketStatuses`: the protected, closed-kind row named `Closed` gets
  `systemKey='closed'`. If no such row exists, the migration does nothing
  to statuses; `down()` clears only that key.
- `CannedResponses`: `id, title VARCHAR(200), body TEXT, visibility
  ENUM('personal','team','everyone'), ownerId FK Users, teamId FK Teams NULL
  (ON DELETE CASCADE), createdAt, updatedAt`.
- `RecurringTickets`: the spec's columns, plus `lastError VARCHAR(500) NULL`.
  `tasks` and `weekdays` are JSON. `timeOfDay` is CHAR(5) "HH:MM",
  `timezone` is VARCHAR(64), `startDate`/`endDate` are DATEONLY, and
  `nextRunAt`/`lastRunAt` are DATE. FKs (SET NULL): `contactId`,
  `departmentId`, `teamId`, `assigneeId`, `lastTicketId`. `createdById` is
  NOT NULL. Index on `(active, nextRunAt)`.
- Permissions `tickets.canned.manage` ("Manage shared canned responses")
  and `tickets.recurring.manage` ("Manage recurring tickets"), category
  `tickets`, granted to System Administrator (same seeding pattern as
  migration 061).
- Notification type `recurring_paused` (Task 10) is appended to a saved
  `notifications.enabledTypes` list (same pattern as migration 063), and
  added to the notification type catalogue.
- Associations: `Ticket.belongsTo(Ticket, { as: 'mergedInto', foreignKey:
  'mergedIntoId' })`, `CannedResponse.belongsTo(User as 'owner')`, `(Team as
  'team')`, and `RecurringTicket.belongsTo` Contact/Department/Team/User
  (`assignee`, `createdBy`)/Ticket (`lastTicket`).
- `statusBehavior.closedStatusName() → Promise<string>`: the status with
  `systemKey='closed'`, else the first closed-kind status by `sortOrder`.

- [x] Write the tests:
  - `'adds mergedIntoId, Attachments.commentId and the two tables'`
  - `'source enum accepts recurring'`
  - `'marks the protected Closed status with systemKey closed'`
  - `'grants both new permissions to System Administrator'`
  - `'appends recurring_paused to a saved notifications.enabledTypes list'`
  - `'down then up leaves the schema as the full chain does'`
  - unit `'closedStatusName prefers systemKey closed, falls back to first closed kind'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run `npm run test:migrate` (with `.env.test` loaded) and the tests, and see them pass.
- [x] Commit.

### Task 2: Ticket write services (extraction, plus the source side note)

The handlers in `controllers/tickets/core.js` and `watchers.js` become thin
wrappers. The existing ticket suites are the safety net and must pass
unchanged.

**Files:**
- Create `backend/src/services/tickets/ticketWrite.js`.
- Modify `backend/src/controllers/tickets/core.js`, `watchers.js`.
- Modify `frontend/src/pages/tickets/TicketNew.jsx` (Source: Manual / Phone / Email).
- Test `backend/test/integration/tickets.write.test.js`.

**Interfaces:**
- `createTicket(actor, input, { req, createdById = actor.id, source,
  transaction }) → Promise<Ticket>`:
  - All of today's create checks run against `actor` (contact, project,
    department, watchers, assignee, links, assets).
  - `source` overrides the input's source and is used by the system paths
    (`'recurring'`). Callers' input may be `manual|phone|email`, and anything
    else becomes `manual` (D16).
  - It returns after the side effects (activity, notifications, rules,
    queue notice, calendar push).
- `updateTicket(req, ticket, body) → Promise<Ticket>`: today's `update`
  minus the HTTP. It is split internally into:
  - `prepareTicketUpdate(req, ticket, body) → { changes, before }`, which
    validates and throws `ApiError`.
  - `runTicketUpdateEffects(req, ticket, before, changes, { quiet = false })`,
    which does activity, notifications, rules, CSAT, the resolved email,
    the queue notice and the calendar. With `quiet`, it skips CSAT, the
    resolved email and the `ticket_closed` rules (for D7).
- `deleteTicket(req, ticket) → Promise<void>`.
- `addTicketWatcher(req, ticket, rawUserId) → Promise<{ watcher, created }>`.
- New check in create and update: a `teamId` must be an existing team
  (`400 "Team not found"`). Today a bad id hits the foreign key and returns 500.
- The access check stays where it is today. Callers pass a ticket they've
  already found, and `updateTicket`/`deleteTicket` still call
  `canAccessTicket` + `assertCanEditTicket` themselves.

- [x] Write the tests:
  - `'create accepts source email; portal and recurring become manual'`
  - `'create and update refuse an unknown teamId with 400'`
  - `'updateTicket quiet close skips CSAT, resolved email and ticket_closed rules'`
  - `'createTicket with createdById records the given creator and checks the actor'`
- [x] Run them and see them fail.
- [x] Implement. Move the code without rewriting it, then add the team check and the source change.
- [x] Run the new file plus `tickets.core`, `tickets.extras`, `tickets.ccs`, `tickets.comments`, `companies.ticketpeople`, `email.notifications` and the SLA ticket suites, and see them pass.
- [x] Commit.

### Task 3: Queues and Take it (backend)

**Files:**
- Create `backend/src/controllers/tickets/queue.js`.
- Modify `backend/src/controllers/tickets/core.js` (`buildTicketListWhere`,
  `fetchTicketPage` ordering), `ticketsController.js`, `routes/tickets.js`.
- Test `backend/test/integration/tickets.queue.test.js`.

**Interfaces:**
- `GET /tickets?queue=mine|<teamId>`:
  - `mine` = the teams I'm a member of (`TeamMember`). A team id must be one
    of my teams, unless I have `tickets.view_all`. Any other value gives
    `400`. No teams → an empty list.
  - Without an explicit `status`, closed-kind statuses are excluded (D1).
  - Order: unassigned first, then `TicketSlas.resolutionDueAt` ascending
    (nulls last), then `createdAt`. Done in the id phase of
    `fetchTicketPage` with a fixed-text subquery, like `slaFilterWhere`.
  - Still ANDed with `ticketScopeWhere`.
- `GET /tickets/queue-count → { count }`: unassigned, not-closed tickets in
  my teams, within my scope. Registered before `/:id`.
- `POST /tickets/:id/take` (route `viewMin`) → `{ ticket }`:
  - Missing and no-access both give `404 "Ticket not found"`.
  - Allowed if I can edit it, **or** I can view it and am a member of its
    team. Otherwise `403 "You can't take this ticket"`.
  - `assertCanWorkTicket(me, ticket.companyId)` must pass (D2).
  - Atomic: in a transaction, `SELECT … FOR UPDATE` the ticket row. If it's
    already assigned, `409 { error: "Already taken by <displayName>" }`.
    Otherwise do an instance `update({ assigneeId: me })`, so the SLA hooks
    fire, then call `runTicketUpdateEffects` after commit.
  - Audit `ticket.take`.

- [x] Write the tests:
  - `'queue=mine lists only my teams, unassigned first then earliest SLA due'`
  - `'queue view hides closed tickets unless a status is asked for'`
  - `'queue=<team I am not in> is refused without view_all'`
  - `'queue-count counts unassigned not-closed tickets in my teams within scope'`
  - `'take: edit_own team member claims an unassigned team ticket'`
  - `'take: 409 names the winner when already assigned'`
  - `'take: two concurrent takes, exactly one wins, assignment clock stops once'`
  - `'take: view-only non-member is refused; out of scope looks like missing'`
  - `'take: member fenced out of the ticket company is refused'`
  - `'take: logs assignee activity and fires ticket_assigned rules'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 4: Canned responses (backend)

**Files:**
- Create `backend/src/controllers/cannedResponsesController.js`, `backend/src/routes/cannedResponses.js`.
- Modify `backend/src/routes/index.js`, `routes/tickets.js`, `services/email/templates.js`.
- Test `backend/test/integration/canned.test.js`, `backend/test/unit/cannedRender.test.js`.

**Interfaces:**
- `GET /canned-responses?search=&manage=1 → { responses: [...] }` (picker
  list, not paginated):
  - Without `manage`: my personal ones, those of my teams, and everyone's.
  - With `manage=1` and `tickets.canned.manage`: my personal ones plus
    every team and everyone response.
  - Search uses `LIKE` on the title and body, with `%`/`_` escaped.
- `POST /canned-responses { title, body, visibility, teamId? }`:
  - Anyone can create `personal` (the owner is me and `teamId` is ignored).
  - `team` and `everyone` need `tickets.canned.manage`. `team` needs an
    existing `teamId`.
- `PATCH` / `DELETE /canned-responses/:id`:
  - Personal: owner only.
  - Team/everyone: `tickets.canned.manage` only.
  - A response I can't see → `404`, identical to a missing one.
  - Changing the visibility re-runs the create rules.
- `POST /tickets/:id/canned/:cannedId/render` → `{ text }`:
  - The ticket must be one I can view (`findAccessibleTicket`), and the
    response one I can see (picker rules). Either missing gives
    `404 "Not found"`.
  - Placeholders: `ticket.number`, `ticket.title`, `ticket.status`,
    `ticket.priority`, `ticket.url`, `contact.firstName`, `contact.name`,
    `tech.name` (me), `org.name`.
- `templates.renderPlainText(body, context, allowedNames) → string`: pure.
  Same `{{ }}` syntax as `renderTemplate`, with no HTML escaping (the
  result goes into a textarea, and the reply is escaped when it's sent, by
  5a). Unknown placeholders render empty.
- Audit `canned.create|update|delete`.

- [x] Write the tests:
  - unit `'renderPlainText fills allowed placeholders, blanks unknown ones, does not escape'`
  - `'any user creates a personal response; team/everyone need canned.manage'`
  - `'picker shows own, my teams and everyone; never another user's personal one'`
  - `'admin cannot read or edit another user's personal response (404)'`
  - `'team response needs an existing team; non-member does not see it'`
  - `'manage=1 lists all shared responses for canned.manage holders only'`
  - `'search escapes LIKE wildcards'`
  - `'render fills ticket placeholders; refused with no ticket access or unseen response'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 5: Bulk endpoint (backend)

**Files:**
- Create `backend/src/controllers/tickets/bulk.js`.
- Modify `ticketsController.js`, `routes/tickets.js` (`POST /tickets/bulk`, route `viewMin`).
- Test `backend/test/integration/tickets.bulk.test.js`.

**Interfaces:**
- `POST /tickets/bulk { ids, action, value } → { results: [{ id, ok, error? }] }`:
  - `ids` is an array of 1–100. Each is parsed with `parseTicketId` and
    de-duplicated. An unparseable id gets `{ ok: false, error: "Ticket not found" }`.
  - Tickets are processed **one at a time**, in the given order. Each one
    is fetched, and missing or no-view gives `"Ticket not found"`. Then:
    - `status` → `updateTicket(req, t, { status: value })`
    - `priority` → `{ priority }`
    - `assign` → `{ assigneeId: value || null }`
    - `team` → `{ teamId: value || null }`
    - `close` → `{ status: await closedStatusName() }` (D5)
    - `add_watcher` → needs `tickets.manage_watchers`, then
      `addTicketWatcher(req, t, value)`
    - `delete` → needs `tickets.delete`, then `deleteTicket(req, t)`
    - `merge` → `mergeTickets(req, value, ids)` (Task 6), **all or nothing**:
      every id gets the same result
  - A missing permission makes every id fail with the same message. Any
    `ApiError` becomes that ticket's `error` (its message only). Anything
    else is logged and becomes `"Could not update this ticket"`, with no
    internals leaked.
  - An unknown `action` → `400`.
- `merge` needs Task 6. Until then the action returns `400 "Unknown action"`,
  and Task 6 wires it in with its own test.

- [x] Write the tests:
  - `'refuses more than 100 ids and unknown actions'`
  - `'mixed access: unseen and missing ids get the same error, the rest apply'`
  - `'status bulk matches single PATCH: activity rows and ticket_status_changed rules fire'`
  - `'close uses the systemKey closed status even after it is renamed'` (restores the name)
  - `'assign and team go through the same checks as PATCH (company fence, unknown team)'`
  - `'add_watcher needs manage_watchers; delete needs tickets.delete'`
  - `'require-time-before-close fails only the tickets without time'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 6: Merge (backend + inbound follow)

**Files:**
- Create `backend/src/services/tickets/merge.js`, `backend/src/services/tickets/attachmentFiles.js`.
- Modify `backend/src/controllers/tickets/core.js` or a new `controllers/tickets/merge.js`, `routes/tickets.js`, `controllers/tickets/bulk.js`.
- Modify `backend/src/services/inboundEmailService.js` (follow `mergedIntoId`; pass `commentId` to `saveAttachments`).
- Modify `backend/src/controllers/tickets/shared.js` (`ticketDetailFor` adds `mergedInto: { id, title } | null`, shown only if the viewer can see the target; otherwise `{ id }` only).
- Test `backend/test/integration/tickets.merge.test.js`, plus new cases in `email.inbound.test.js`.

**Interfaces:**
- `attachmentFiles.copyToTicket(rows, toTicketId) → Promise<copiedPaths[]>`,
  `removeFiles(paths)`. Filenames are already unique, so nothing is renamed.
  Paths are built only from the stored `filename` and a number, then checked
  to still be under `UPLOAD_ROOT`.
- `mergeTickets(req, targetRaw, sourceRaws) → Promise<{ target, sourceIds }>`:
  - **Checks, before anything is written:**
    - The target can be viewed and edited, and isn't merged itself.
    - There are 1–50 sources, none equal to the target. Each can be viewed
      and edited, isn't merged already, and has the target's `companyId`.
    - Any failure → `400`/`404` with the same "Ticket not found" for
      missing and no-access ids.
  - **One transaction.** Rows are locked `FOR UPDATE` in id order, then
    moved to the target:
    - Comments (`createdAt` kept) and Attachments (with their files)
    - TimeEntries, Tasks (new codes, D10), and ActiveTimers
      (`entityType='ticket'`)
    - Watchers, CCs and AssetTicket links, with duplicates dropped
    - TicketRelations: re-pointed. Relations among the merged set, any that
      would point a ticket at itself, and repeats of an existing link are
      dropped.
  - **Notes, CCs and closing:**
    - The private note from D9 is added.
    - The source contact's email goes on the target's CC list (D8).
    - Each source gets `mergedIntoId`, `closedStatusName()` and a private
      comment "Merged into #T", and the target gets "Merged #S1, #S2 into
      this ticket", all authored by `req.user`.
  - **After commit:** activity (`merged_into` on sources, `merged` on the
    target), audit `ticket.merge`, and `runTicketUpdateEffects(…, { quiet:
    true })` for each source (D7). Source files are removed after commit;
    copies are removed on rollback.
- `POST /tickets/:id/merge { sourceIds }` (route `editMin`) → `{ ticket }` (the target).
- Inbound: right after the ticket lookup, follow `mergedIntoId` (at most 10
  hops; a loop or a missing link stops at the last live ticket) **before**
  the sender is classified. The contact/CC checks therefore run against the
  live ticket.
- Inbound attachments: comments are created first, and `saveAttachments(…,
  commentId)` stores `commentId` (D11).

- [x] Write the tests:
  - `'moves comments with timestamps, attachments and files, time, tasks with new codes, timers, watchers, CCs, assets, relations'`
  - `'drops relations among merged tickets and duplicate links'`
  - `'refuses across companies, already-merged sources, a merged target, and the target as its own source'`
  - `'one uneditable source refuses the whole merge and moves nothing'`
  - `'sources close quietly with mergedIntoId, notes and activity; no CSAT or resolved email'`
  - `'source contact joins the target CC list when different'`
  - `'source description becomes a private note on the target'`
  - `'target SLA unchanged; source clocks stop'`
  - `'detail shows mergedInto; hides the target title from viewers who cannot see it'`
  - `'bulk merge is all-or-nothing with one result per id'`
  - inbound `'reply to a merged ticket lands on the target (A→B→C)'`
  - inbound `'old contact of a merged source replies → contact-side reply on the target'`
  - inbound `'inbound attachments are stored with their commentId'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them plus the whole `email.inbound.test.js`, and see them pass.
- [x] Commit.

### Task 7: Split (backend)

**Files:**
- Create `backend/src/services/tickets/split.js`.
- Modify `routes/tickets.js`, `ticketsController.js`.
- Test `backend/test/integration/tickets.split.test.js`.

**Interfaces:**
- `splitTicket(req, ticketRaw, commentRaw) → Promise<Ticket>` (the new ticket):
  - The ticket can be viewed and edited, and the comment belongs to it.
    Otherwise `404 "Not found"`.
  - It calls `createTicket(req.user, { title: "Split from #N: <first line,
    max 200>", description: comment body, contactId, departmentId, teamId,
    priority, type }, { req, source: ticket.source })`. Checks are against
    the user.
  - In one transaction after create, the comment moves to the new ticket
    (`createdAt` kept), along with the attachments whose `commentId` is
    that comment (files too). The CC list is copied, and a `related`
    `TicketRelation` is added.
  - Activity `split_to` / `split_from`, and audit `ticket.split`.
- `POST /tickets/:id/split { commentId }` (route `editMin`) → `201 { ticket }`.

- [x] Write the tests:
  - `'creates a linked ticket with the original contact, company, department, team, priority, type, source and CCs; unassigned with an SLA'`
  - `'moves the comment and only its own attachments (with files)'`
  - `'refuses a comment from another ticket the same way as a missing one'`
  - `'refuses without edit rights'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 8: `nextRun` schedule function

**Files:**
- Create `backend/src/services/recurring/schedule.js`.
- Test `backend/test/unit/recurringSchedule.test.js`.

**Interfaces:**
- `nextRun(rule, after: Date) → Date | null`. Pure.
  - `rule` is `{ frequency, interval, weekdays, dayOfMonth, monthOfYear,
    timeOfDay, timezone, startDate, endDate }`.
  - Returns the first run instant strictly after `after`, on or after
    `startDate`, at `timeOfDay` wall time in `timezone` (uses
    `utils/orgTime` `zoneWallTime`). Returns `null` if it would fall after
    `endDate`.
  - Interval counting starts at `startDate`: days, weeks (weeks starting at
    the startDate's week), months or years.
  - `dayOfMonth` above the month's length clamps to its last day.
  - A wall time that doesn't exist (spring forward) runs at the first valid
    minute after it. One that happens twice (fall back) runs at the first one.
- `validateSchedule(input) → { schedule } | throws ApiError`: frequency enum;
  interval is an integer 1–365; weekdays is a non-empty array of 0–6 for
  weekly; dayOfMonth 1–31 for monthly/yearly; monthOfYear 1–12 for yearly;
  `HH:MM`; `isValidZone`; endDate ≥ startDate.
- `previewRuns(rule, from, n = 5) → Date[]`.

- [x] Write the tests:
  - `'daily interval 3 from start date'`
  - `'weekly on Mon/Thu every 2 weeks'`
  - `'monthly on the 31st clamps to Feb 28 and Apr 30'`
  - `'yearly Feb 29 runs Feb 28 in non-leap years'`
  - `'DST spring forward 02:30 runs 03:00 local; fall back 01:30 runs once'`
  - `'strictly after: a run at exactly after is skipped'`
  - `'returns null past endDate'`
  - `'validateSchedule rejects bad frequency, interval 0, empty weekdays, bad zone, end before start'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 9: Recurring tickets API

**Files:**
- Create `backend/src/controllers/recurringTicketsController.js`, `backend/src/routes/recurringTickets.js`, `backend/src/services/recurring/runRule.js`.
- Modify `backend/src/routes/index.js`.
- Test `backend/test/integration/recurring.api.test.js`.

**Interfaces:**
- All routes need `tickets.recurring.manage`.
- `GET /recurring-tickets → { rules }`: only rules whose contact the viewer
  can reach (D14), with `runsAs { id, displayName }`, `nextRunAt`,
  `lastError`, and `lastTicket`.
- `GET /recurring-tickets/:id`: unseen and missing both give `404`.
- `POST` / `PATCH /recurring-tickets/:id`:
  - The template fields are validated against **the saver** (D17), the
    same way as create: `findAccessibleContact`, `findDepartmentInCompany`,
    a team that exists, `assertCanWorkTicket` for the assignee, priority and
    type enums, a title of 1–255 characters, and `tasks` as up to 50
    non-empty titles of at most 255 characters.
  - Then `validateSchedule`.
  - The save sets `createdById = req.user.id`, `nextRunAt =
    nextRun(rule, now)`, `lastError = null`, and `active` (default true).
- `PATCH` with only `{ active }` pauses or resumes. Resuming recomputes
  `nextRunAt` from now and clears `lastError`.
- `DELETE /recurring-tickets/:id`.
- `POST /recurring-tickets/:id/run` → `201 { ticket }`: creates one ticket
  now through `runRule` and doesn't change `nextRunAt`.
- `POST /recurring-tickets/preview { schedule } → { runs: [ISO × 5] }`.
- `runRule(rule) → Promise<Ticket>`:
  - Loads the run-as user. It must be active and have `tickets.create`,
    otherwise `ApiError "The user this rule runs as can no longer create
    tickets"`.
  - Calls `createTicket(runAsUser, template, { req: { user: systemActor },
    createdById: systemActorId, source: 'recurring' })`, then creates the
    tasks through the ticket task service.
  - Sets `lastRunAt` and `lastTicketId`.
- Audit `recurring.create|update|delete|run`.

- [x] Write the tests:
  - `'needs tickets.recurring.manage for every route'`
  - `'list and get hide rules whose contact company the viewer cannot reach'`
  - `'save validates contact, department, team and assignee against the saver'`
  - `'saving sets runsAs to the saver and computes nextRunAt'`
  - `'pause and resume; resume recomputes from now'`
  - `'run now creates a recurring-source ticket with tasks, created by the system actor, nextRunAt unchanged'`
  - `'preview returns five runs and rejects a bad schedule'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 10: Recurring scheduler

**Files:**
- Create `backend/src/services/recurring/recurringScheduler.js`.
- Modify `backend/src/index.js` (start it next to the SLA scheduler; not in tests).
- Test `backend/test/integration/recurring.scheduler.test.js`.

**Interfaces:**
- `runDueRecurring(now = new Date()) → Promise<{ created, paused }>`:
  - Finds rules with `active` set and `nextRunAt ≤ now`.
  - Claims each one with `UPDATE RecurringTickets SET nextRunAt=:next,
    lastRunAt=:now WHERE id=:id AND active=1 AND nextRunAt=:seen`. Only a
    claim with `affectedRows=1` goes on to `runRule`.
  - `:next = nextRun(rule, now)`, computed from **now**, not from the run
    that was due, so there's no backlog. `null` → `active=false` (it ended).
  - When `runRule` throws, the rule is paused (`active=false`) with
    `lastError` set to the message (max 500 characters), and the run-as
    user gets a `createNotification` (type `recurring_paused`, from Task 1).
    Other rules carry on.
- `startRecurringScheduler()`: a 60-s `setInterval`, with errors logged and
  never thrown.

- [x] Write the tests:
  - `'creates one ticket for a due rule and advances nextRunAt'`
  - `'two concurrent ticks create exactly one ticket'`
  - `'after downtime it skips to the next future run (no backlog)'`
  - `'past endDate the rule deactivates after its last run'`
  - `'run-as user deactivated → no ticket, paused with lastError, notified'`
  - `'run-as user lost the contact company → paused, other rules still run'`
- [x] Run them and see them fail.
- [x] Implement.
- [x] Run them and see them pass.
- [x] Commit.

### Task 11: Screens — queues, Take it, source

**Files:**
- Modify `frontend/src/pages/tickets/Tickets.jsx` (Queue picker: All / My queues / each of my teams; with a queue chosen, rows show **Take it** on unassigned rows), `frontend/src/pages/tickets/TicketDetail.jsx` (**Take it** in the header when unassigned and allowed), and the top-nav component (unassigned badge from `GET /tickets/queue-count`, polled with the existing notification poll, hidden at 0).
- `TicketNew.jsx`'s source option is already done in Task 2.
- Test `npm --prefix frontend run build`, plus the smoke in Task 15.

**Interfaces:**
- Take it calls `POST /tickets/:id/take`. On a 409 it shows the server's
  message and reloads.
- The detail page's `access` (from `ticketAccessFor`) gains `canTake:
  boolean`, computed with the same rules as the endpoint (added to `shared.js`).

- [x] Add `canTake` to `ticketAccessFor` with an integration test: `'access.canTake true for a viewing team member on an unassigned ticket, false once assigned'`.
- [x] Build the screens.
- [x] `npm --prefix frontend run build` passes.
- [x] Commit.

### Task 12: Screens — canned responses

**Files:**
- Create `frontend/src/pages/settings/CannedResponses.jsx` and `frontend/src/components/CannedPicker.jsx`.
- Modify `frontend/src/pages/settings/registry.js` (entry `canned-responses`, group "Service desk", `access: {}`), the router, and the ticket reply composer (an **Insert** button opens the picker, which has search; picking calls render and inserts at the cursor). The picker also has "Save as personal response".
- Test `frontend/src/pages/settings/registry.test.js` still passes, and the build passes.

**Interfaces:**
- The Settings page lists mine, and with `tickets.canned.manage` also the
  shared ones (`manage=1`). The editor offers Team/Everyone visibility only
  to people with that permission.
- The body is a plain `<textarea>` with a placeholder help list.

- [x] Build the screens.
- [x] Build passes; `npm --prefix frontend test` passes.
- [x] Commit.

### Task 13: Screens — bulk bar, merge, split

**Files:**
- Modify `frontend/src/pages/tickets/list/BulkActionBar.jsx` and `Tickets.jsx`
  (`applyBulkAction` → `POST /tickets/bulk` in batches of 100 (D6), with
  new actions team, add watcher, merge (pick the target from the selection
  or by number) and delete (with a confirm)). The result summary reads "N
  updated, M failed", plus a list of `#id: error`.
- Create `frontend/src/pages/tickets/detail/MergeDialog.jsx`: search for
  tickets in this ticket's company, multi-select the sources, then confirm
  with a list of what moves.
- Modify `TicketDetail.jsx`: a "Merge…" action (with edit access), a
  merged banner ("Merged into #T" linking to it), and a "Split to new
  ticket" item in each comment's menu (with edit access) that navigates to
  the new ticket.

- [x] Build the screens.
- [x] Build passes.
- [x] Commit.

### Task 14: Screens — recurring tickets

**Files:**
- Create `frontend/src/pages/settings/RecurringTickets.jsx` and `RecurringTicketEditor.jsx`.
- Modify `registry.js` (entry `recurring-tickets`, group "Service desk", `access: { permission: ['tickets.recurring.manage'] }`) and the router.

**Interfaces:**
- The list shows title, contact, schedule summary, next run, runs-as,
  status (Active / Paused / Ended) and `lastError` in red, with
  pause/resume, Run now, edit and delete.
- The editor has the template fields (contact picker, department, team,
  assignee, priority, type, title, description, tasks list), the schedule
  fields (they change with the frequency, using the shared Hour/Min/AM-PM
  time picker), the timezone (default org), start/end dates, and a "Next 5
  runs" panel from `POST /recurring-tickets/preview` (debounced). It also
  shows the note "Runs as you once saved".

- [x] Build the screens.
- [x] Build passes; `npm --prefix frontend test` passes.
- [x] Commit.

### Task 15: Smoke, docs, review, push

**Files:**
- Create `backend/test/smoke/desktools.smoke.js`.
- Modify `docs/ROADMAP.md` (5b → Shipped), the spec (add "built" notes and D17), and `UPGRADING.md` if this repo's practice for unreleased work needs it.

- [x] Smoke tests:
  - `'queue view lists team tickets and Take it assigns me'`
  - `'merge dialog merges a ticket and the source shows the merged banner'`
  - `'recurring editor shows five next runs and saves a rule'`
  - `'canned picker inserts a rendered response into the reply box'`
- [x] Run the full backend suite once (`npm test`) and the full smoke once (`npm run test:smoke`). Both must be green, and the counts get recorded.
- [x] **MODEL SWITCH to Opus.** Then a fresh reviewer subagent goes over the whole branch diff with a security focus (permission checks, company fences, missing equals no-access, transactions and file moves, the scheduler claim).
- [x] Fix the findings test-first, re-run the affected tests, then push to `dev`.
- [x] Update memory (service desk) and `docs/ROADMAP.md`.
