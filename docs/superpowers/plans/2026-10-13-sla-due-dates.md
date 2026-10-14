# SLA due dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SLA targets per ticket type × priority set a fixed due date at creation; no pausing; technicians can only extend the due date with a reason; the report shows original-SLA and extended-due-date compliance.

**Architecture:** Changes the shipped SLA engine in place. Targets gain `ticketType` and a unit (minutes | business days); the resolution clock's `dueAt` is fixed at creation (plus a never-changing `resolutionOriginalDueAt`) and mirrored into `Ticket.dueDate/dueTime`; a new `POST /tickets/:id/due-date` endpoint is the only way to move it, recording each move in `TicketDueDateChanges`.

**Tech Stack:** Express + Sequelize + MariaDB, Jest integration tests on the `prism-test-db` container (Node 24), React frontend, Playwright smoke suite.

**Spec:** `docs/superpowers/specs/2026-10-13-sla-due-dates-design.md` (changes `…/2026-10-13-sla-engine-design.md`). Plan lists tasks, interfaces and test names, not full code (user rule).

## Global Constraints

- Node ≥ 24.9; run tests with `npm test -- <paths>` from `backend/`. Jest pins `TZ=America/Chicago`. Integration tests run serially on one DB (`maxWorkers: 1`).
- No new npm dependency.
- Migration `20260101000061-sla-due-dates.js` with a working `down()`; round-trip test. **Any test that rolls back 060 must first roll back 061** (060's `down()` removes `pausesSla`, which 061 already dropped).
- A test that rolls back a migration must leave the schema exactly as the full chain leaves it (see `companies.migration.test.js`'s afterAll).
- Mutating endpoints: permission check + `writeAudit`. Fetch-by-id re-checks scope (missing and out-of-scope look the same).
- Ticket types: `incident, request, problem, change, task`. Priorities: `critical, high, medium, low` (shown as Urgent/High/Medium/Low). Clocks: `assign, response, resolution`. Units: `minutes`, `business_days`.
- New permission key: `tickets.adjust_sla_due`, granted to the System Administrator role by the migration.
- During building run only affected test files; full backend + full smoke once before the push. Don't run two suites at once (shared DB).

## Review Focus

1. **A technician crafts a request moving the due date earlier, or omits the reason** → 403 without `tickets.adjust_sla_due`. Test in Task 5.
2. **A day target on a ticket created after hours** (e.g. Tue 20:00, 2 business days) → due at the next opening + 2 open days, same opening time, not 20:00. Test in Task 1.
3. **The mirrored due date across the UTC date line** (due 23:30 Chicago = next day UTC) → `Ticket.dueDate` holds the Chicago date. Test in Task 4.
4. **A ticket whose type × priority has no resolution target** → keeps today's manual due date (PATCH still works). Test in Task 5.
5. **Set SLA policy after an extension** → original and current due recomputed from creation on the new policy; extension history kept. Test in Task 4.

---

### Task 1: Business days

**Files:** Modify `backend/src/services/sla/businessTime.js`; Test `backend/test/unit/businessTime.test.js`

**Interfaces:**
- Produces `addBusinessDays(start: Date, days: int, calendar|null) → Date`. Null/24×7 → `start + days × 24h`. Otherwise: anchor = `start` if inside an open window, else the next opening; walk forward `days` open days; result = the same wall-clock time on that day, clamped into that day's window (before opening → opening, after closing → closing). `days <= 0` → anchor. Same 3,700-day guard.

- [x] Step 1: Failing tests: `adds open days keeping the time of day`; `skips the weekend`; `skips a holiday`; `starts after hours from the next opening (Tue 20:00 + 2 → Fri 09:00)`; `clamps to a shorter day's closing`; `24x7 and null are calendar days`; `zero days returns the anchor`.
- [x] Step 2: `npm test -- test/unit/businessTime.test.js` → FAIL.
- [x] Step 3: Implement. Step 4: re-run → PASS.
- [x] Step 5: Commit `feat(sla): business days`.

### Task 2: Schema — type × priority targets, units, no pause, due date history, permission

**Files:**
- Create `backend/migrations/20260101000061-sla-due-dates.js`, `backend/src/models/TicketDueDateChange.js`
- Modify `backend/src/models/SlaTarget.js`, `TicketSla.js`, `TicketStatus.js` (remove `pausesSla`), `models/index.js`
- Modify `backend/test/integration/sla.migration.test.js` (wrap 060 cases in 061 down/up), `test/integration/helpers.js` (`resetSlaPolicies` seeds per type; add `TicketDueDateChanges` to the truncate list before `Tickets`)
- Test `backend/test/integration/sla.duedates.migration.test.js`

**Interfaces:**
- `SlaTarget`: + `ticketType ENUM(5)`, `assignUnit`, `responseUnit`, `resolutionUnit` (`ENUM('minutes','business_days')`, default `minutes`); unique index `(slaPolicyId, ticketType, priority)` replaces `(slaPolicyId, priority)`.
- `TicketSla`: + `resolutionOriginalDueAt DATE NULL`.
- `TicketDueDateChange`: `id, ticketId (FK cascade), userId (null = system/workflow), fromDueAt, toDueAt, reason TEXT, kind ENUM('extension','adjustment'), createdAt`; `Ticket.hasMany(TicketDueDateChange, as 'dueDateChanges')`, `belongsTo(User, as 'user')`.
- Migration up: for every existing target row, create the other four types as copies (unit `minutes`) — the existing row becomes `incident`; backfill `resolutionOriginalDueAt = resolutionDueAt`; drop `TicketStatuses.pausesSla`; create `TicketDueDateChanges`; insert permission `tickets.adjust_sla_due` (category tickets, label "Adjust SLA due dates", description "Move a ticket's SLA due date earlier, or without a reason") granted to the role named "System Administrator". Down: keep only `incident` rows (minutes; a `business_days` value converts to `days × 1440`), drop the new columns/table/permission, re-add `pausesSla` (false).

- [x] Step 1: Failing tests: `copies each priority target to all five ticket types`; `backfills the original due date`; `drops Pauses SLA from statuses`; `grants Adjust SLA due dates to System Administrator only`; `rolls back and re-applies` (incl. data). Update `sla.migration.test.js` so its cases run with 061 rolled back and restore it in afterAll.
- [x] Step 2: Run → FAIL. Step 3: Implement; apply to the test DB (`set -a; . ./.env.test; set +a; NODE_ENV=test npx sequelize-cli db:migrate --env test`).
- [x] Step 4: `npm test -- test/integration/sla.duedates.migration.test.js test/integration/sla.migration.test.js test/integration/companies.migration.test.js` → PASS.
- [x] Step 5: Commit `feat(sla): schema for type × priority targets and due date history`.

### Task 3: Policy API and statuses

**Files:** Modify `backend/src/controllers/slaPoliciesController.js`, `backend/src/controllers/statusesController.js` (remove `pausesSla` + `syncSla`), `backend/src/services/sla/calendar.js` (targets keyed `${type}:${priority}`); Tests `backend/test/integration/sla.policies.test.js`, `sla.clocks.test.js` (drop the pause/status-sync cases), `sla.api.test.js` (drop pause case)

**Interfaces:**
- Target body: `{ ticketType, priority, assignMinutes, assignUnit, responseMinutes, responseUnit, resolutionMinutes, resolutionUnit }`; amount null = untracked; `minutes` 1–525,600, `business_days` 1–365. Create makes all 20 rows; PATCH updates given `(ticketType, priority)` pairs. `present()` returns targets ordered by type then priority.
- `calendar.getPolicy()` → `targets: Map<'type:priority', target>`.

- [x] Step 1: Failing tests (update existing): `lists Standard with 20 targets`; `creates a policy with a Request/Low 20-business-day resolution target`; `rejects unknown ticket type / unit / 400 business days`; `status PATCH ignores pausesSla` (field gone).
- [x] Step 2: Run → FAIL. Step 3: Implement. Step 4: re-run `sla.policies.test.js settings.status.test.js` → PASS.
- [x] Step 5: Commit `feat(sla): type × priority targets in the policy API; no pausing statuses`.

### Task 4: Fixed due dates in the clock engine

**Files:** Modify `backend/src/services/sla/ticketSla.js`, `clock.js` (resolution start with a fixed `dueAt`), `slaView.js` (`originalDueAt`, `changes` in the view); Test `backend/test/integration/sla.clocks.test.js`, new `backend/test/integration/sla.duedates.test.js`

**Interfaces:**
- `targetFor(policy, ticket, clock) → { amount, unit } | null` using `ticket.type`, `ticket.priority`.
- `dueFrom(start, target, calendar)` → `addBusinessMinutes` or `addBusinessDays`. Warn point = `start + warnAtPercent` of the business minutes between start and due (works for both units).
- Create: resolution `dueAt` and `resolutionOriginalDueAt` from the target; assign/response as before (minutes or days). Then mirror: `Ticket.dueDate/dueTime` = `dueAt` in `orgTimeZone()` (date `YYYY-MM-DD`, time `HH:MM`), written with `hooks: false` in the same transaction.
- Resolution clock no longer pauses and never retargets: running while open; closing stops it (met if before `dueAt`, breached otherwise); reopening restarts it with the **same** `dueAt` (breached at once if past).
- Priority / type / company changes: **no** retarget for any clock (remove that branch from `apply`; keep status/assignee start-stop).
- `recalcTicketSla(ticketId, { policyId })` (Set SLA policy): recompute all three clocks from the ticket's `createdAt` on the new policy, set both `dueAt` and `resolutionOriginalDueAt`, mirror the due date; extension history untouched.
- `toSlaView` adds `clocks.resolution.originalDueAt` and `changes: [{ kind, fromDueAt, toDueAt, reason, user: {id, displayName} | null, createdAt }]` (detail only; list stays light).

- [x] Step 1: Failing tests (`sla.duedates.test.js`): `due date comes from the ticket's type and priority`; `a Request/Low 20-business-day target lands 20 open days later at the same time`; `the company's policy wins over the default`; `a blueprint ticket gets its type/priority SLA`; `Ticket.dueDate/dueTime mirror the due in the org time zone across the UTC date line`; `priority, type and company changes leave every SLA date alone`; `a formerly pausing status no longer stops the clock`; `reopening keeps the original due date and is breached if past it`; `Set SLA policy after an extension recomputes original and current due, keeps history`. Update `sla.clocks.test.js` cases that expected retargeting/pausing.
- [x] Step 2: Run → FAIL. Step 3: Implement. Step 4: re-run `sla.duedates.test.js sla.clocks.test.js sla.scheduler.test.js sla.api.test.js` → PASS.
- [x] Step 5: Commit `feat(sla): due date fixed at creation from type × priority; no pause`.

### Task 5: Changing the due date

**Files:** Create `backend/src/controllers/tickets/dueDate.js`; Modify `backend/src/routes/tickets.js`, `backend/src/controllers/tickets/core.js` (PATCH guard), `backend/src/services/workflowEngine.js` (`set_due_date` on SLA tickets), `backend/src/services/sla/ticketSla.js` (`changeDueDate`); Test `backend/test/integration/sla.duedates.test.js`

**Interfaces:**
- `POST /tickets/:id/due-date` `{ dueDate: 'YYYY-MM-DD', dueTime: 'HH:MM', reason }` (route: same edit-tier middleware as `PATCH /tickets/:id`; handler: load ticket, `canAccessTicket` → 404-equivalent 403 as elsewhere, `assertCanEditTicket`). Parse date/time with `toDateString` + HH:MM regex in `orgTimeZone()` → instant (`zoneWallTime`). Ticket must have a resolution SLA (else 400 "This ticket has no SLA due date; edit the due date directly").
- Rules: `toDueAt > current dueAt` and `reason.trim()` 1–1000 chars → `extension`. Otherwise requires `tickets.adjust_sla_due` (403 `FORBIDDEN` "Only someone who can adjust SLA due dates can move a due date earlier or without a reason") → `adjustment`. Same instant → 400.
- `changeDueDate(ticketId, { toDueAt, userId, reason, kind, transaction })`: sets `resolutionDueAt`, re-derives `resolutionWarnAt`, clears `resolutionWarnedAt`/`resolutionBreachedAt` when the new due is in the future, writes `TicketDueDateChange`, mirrors `Ticket.dueDate/dueTime`. Controller adds `logActivity(ticket.id, user, 'due_date_extended' | 'due_date_adjusted', from, to)` and `writeAudit('ticket.dueDate.change', …, { kind, from, to, reason })`. Response: `{ ticket: <same shape as GET> }`.
- `PATCH /tickets/:id` with `dueDate`/`dueTime` on a ticket that has a resolution SLA → 400 `VALIDATION_ERROR` "Use Extend due date". Tickets without one: unchanged.
- Workflow `set_due_date` on an SLA ticket → `changeDueDate(..., { userId: null, kind: 'adjustment', reason: 'Workflow rule: <name>' })`.

- [x] Step 1: Failing tests: `a later date with a reason extends (history, activity, audit)`; `an earlier date → 403 for a technician, OK for an admin (adjustment)`; `no reason → 403 for a technician, OK for an admin`; `the same date → 400`; `an extension clears warned/breached so they fire again for the new date` (runSlaPass); `PATCH dueDate on an SLA ticket → 400`; `a ticket with no resolution target keeps PATCH dueDate`; `an out-of-scope ticket answers like a missing one`; `a workflow set_due_date is recorded as an adjustment by the rule`; `bad date / time / 1001-char reason → 400`.
- [x] Step 2: Run → FAIL. Step 3: Implement. Step 4: re-run `sla.duedates.test.js tickets.core.test.js` → PASS.
- [x] Step 5: Commit `feat(sla): extend-only due dates with a reason`.

### Task 6: Report

**Files:** Modify `backend/src/controllers/reports/sla.js`; Test `backend/test/integration/sla.report.test.js`

**Interfaces:**
- `summary.resolution` adds `{ metOriginal, pctMetOriginal, metDue, pctMetDue, extended }` (a closed ticket met the original if resolved by `resolutionOriginalDueAt`; met the due date if resolved by the final `resolutionDueAt`). New `tableData`-style `extensions: [{ id, ticketNumber, title, from, to, reason, by, at }]` for tickets in range; CSV export unchanged (breaches).
- [x] Step 1: Failing tests: `an extended ticket resolved after its original but before its new due counts as missed-original, met-due`; `lists extensions with reasons`; `respects scope`.
- [x] Step 2: Run → FAIL. Step 3: Implement. Step 4: re-run → PASS.
- [x] Step 5: Commit `feat(sla): report original SLA vs extended due dates`.

### Task 7: Settings screens

**Files:** Modify `frontend/src/pages/settings/SlaPolicyEditor.jsx` (tabs per ticket type; each cell amount + unit select h/d), `SLAs.jsx` (summary per type), `Statuses.jsx` (remove Pauses SLA); Smoke `backend/test/smoke/sla.settings.smoke.js` (update), `settings.smoke.js` (no change expected)

- [x] Step 1: Update smoke: `an admin sets Request/Low resolution to 20 days and Incident/High to 4 hours`; remove the Pauses SLA case; `Statuses has no Pauses SLA switch`.
- [x] Step 2: Build + run → FAIL. Step 3: Implement. Step 4: build + run → PASS.
- [x] Step 5: Commit `feat(sla): policy editor per ticket type with hours/days`.

### Task 8: Ticket screens and report page

**Files:** Create `frontend/src/pages/tickets/detail/DueDateModal.jsx`; Modify `frontend/src/pages/tickets/detail/Sidebar.jsx` (SLA tickets: due date shown read-only + "Extend due date" button; "Change due date" when the user has `tickets.adjust_sla_due`), `SlaPanel.jsx` (original due, change history), `frontend/src/pages/reports/SlaComplianceReport.jsx` (original vs due cards, extensions table); Smoke `backend/test/smoke/sla.tickets.smoke.js`

- [x] Step 1: Failing smoke: `a technician extends the due date with a reason and sees it in the SLA panel`; `the extend dialog won't save without a reason or with an earlier date`; `an admin can move it earlier`; `the report shows original vs extended figures`; `375px: dialog fits`.
- [x] Step 2: Build + run → FAIL. Step 3: Implement. Step 4: build + run → PASS.
- [x] Step 5: Commit `feat(sla): extend due date on the ticket page; report figures`.

### Task 9: Docs, review, full verification, push

- [x] Step 1: `UPGRADING.md` SLA section: replace the "Pauses SLA" action note with: targets now per type × priority (copied to every type), due dates set automatically, no pausing, Extend due date with a reason, new permission. ROADMAP status Shipped; memory note.
- [x] Step 2: Fresh reviewer (most capable model) on the branch diff — security + Review Focus.
- [x] Step 3: One fix pass (test-first). Full backend suite, then full smoke, once each, not concurrently.
- [x] Step 4: Commit, push `dev`.
