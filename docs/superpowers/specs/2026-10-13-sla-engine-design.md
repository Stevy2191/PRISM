# SLA engine — design

Sub-project 4 of the [PSA roadmap](2026-10-03-prism-psa-roadmap-design.md).
Status: awaiting review (2026-10-13).

## Goal

Tickets get real service-level clocks: how long they sat unassigned, how long
until staff first responded, and how long until they were resolved. Clocks
count business hours, pause while waiting on the customer, warn before a
breach, and escalate through workflow rules. Results are stored on the
ticket's SLA record so reports are cheap.

Projects are out of scope.

## Today

- `SlaPolicy`: one global row per priority (`firstResponseHours`,
  `resolutionHours`, `useBusinessHours`). Edited in Settings → SLAs; nothing
  reads it.
- `BusinessHours` (timezone, weekly schedule JSON, `is24x7`, optional
  `holidayListId`) and `Holiday` (date rows in a list). Nothing calculates
  with them.
- The "SLA compliance" report measures `dueDate`, not SLA targets.
- Inbound email replies from contacts are stored as `Comment` type `reply`
  authored by the first admin. **A comment-based hook can therefore not tell
  a customer reply from a staff reply**, so first response is recorded from
  the staff comment endpoint only (see Clocks).

## Decisions (agreed 2026-10-13)

| # | Decision |
|---|---|
| 1 | Named SLA policies with targets per priority and their own schedule. One default policy; a company can be given its own. Today's per-priority rows become the default policy. |
| 2 | Three clocks: **assignment**, **first response**, **resolution**. No next-response clock (sub-project 5 may add one). |
| 3 | First response = the first `reply` or `comment_public` posted by staff through the ticket comment endpoint. Private notes, status changes and inbound email do not count. |
| 4 | Ticket statuses gain a **Pauses SLA** switch. Pausing stops the resolution clock only. |
| 5 | Priority (or policy) change: targets are re-read for the new priority; minutes already used are kept. |
| 6 | Warning at a per-policy percentage (default 75%) and on breach: in-app notification. Escalation runs through workflow rules: new triggers `sla_warning`, `sla_breached`; new action `set_sla_policy`. |
| 7 | Clock state is stored, recalculated on events; a scheduler only flags warnings and breaches. |
| 8 | Only tickets created after the upgrade get clocks. Older tickets show "No SLA". |
| 9 | The manual `dueDate` stays separate from the SLA resolution target. |
| 10 | Screens: SLA panel on the ticket, time-left badge + "Breached"/"At risk" filters in the ticket list, "SLA at risk" dashboard panel, SLA compliance report on real clocks, Settings policy editor. |

## Data model

**`SlaPolicies`** (reshaped; existing table migrated):
`id, name (unique), isDefault (exactly one true), businessHoursId (nullable =
24×7), warnAtPercent (1–99, default 75), createdAt, updatedAt`.

**`SlaTargets`** (new): `id, slaPolicyId, priority (critical|high|medium|low),
assignMinutes, responseMinutes, resolutionMinutes, useBusinessHours`;
unique `(slaPolicyId, priority)`. Each target is optional per clock (null =
that clock is not tracked for that priority). Minutes, not decimal hours, so
the calculator works in integers; the UI edits hours and minutes.

**`Companies.slaPolicyId`** (nullable, FK). Null = default policy.

**`TicketStatuses.pausesSla`** (boolean, default false).

**`TicketSlas`** (new, one row per ticket that has an SLA; no row = "No SLA"):

- `ticketId` (unique FK, cascade delete), `slaPolicyId`, `priority` (the
  priority the targets were read for)
- per clock `c` in `assign`, `response`, `resolution`:
  `cTargetMinutes`, `cUsedMinutes` (business minutes banked while stopped),
  `cRunningSince` (null when stopped), `cDueAt`, `cWarnAt`, `cWarnedAt`,
  `cBreachedAt`, `cMetAt`
- indexes on each `cDueAt` and `cWarnAt` for the scheduler.

Migration: create new tables/columns, move each old per-priority row into a
"Standard" default policy's targets (hours × 60; `useBusinessHours` kept per
target), link the default policy to the global business-hours schedule
(`departmentId` null) if one exists, otherwise 24×7; drop the old columns.
`down()` restores the old shape from the default policy. Round-trip test in
`migrations.test.js`.

## Clocks

Every clock is the same small state machine: **running** (`runningSince` set)
or **stopped**. When it stops, the business minutes since `runningSince` are
added to `usedMinutes`. While running, `dueAt = addBusinessMinutes(
runningSince, target − used)` and `warnAt` likewise at `warnAtPercent` of the
target. A target of null means the clock is not tracked.

| Clock | Starts at create when | Runs while | Stops for good (`metAt`) |
|---|---|---|---|
| Assignment | no assignee | ticket open and has no assignee; restarts if unassigned again (every unassigned spell counts) | never — it only stops/starts; closes stop it |
| First response | always | until first staff response | first staff `reply`/`comment_public` via `POST /tickets/:id/comments` |
| Resolution | always | ticket status is open-behaviour **and** not `pausesSla` | stops on a closed/archived status; **reopening resumes it** (time while closed does not count) |

Breach: `breachedAt` is set the moment used time passes the target — by the
scheduler for running clocks, or at stop time if a clock stops late.
`breachedAt` is history: it is never cleared, even if a later priority
change raises the target. Met on time = clock stopped (or ticket closed) with
no `breachedAt`.

### Business-time calculator (`services/sla/businessTime.js`)

Pure functions, no DB:
`addBusinessMinutes(start, minutes, calendar)` and
`businessMinutesBetween(a, b, calendar)`, where `calendar` is
`{ timezone, schedule, is24x7, holidays: Set<'YYYY-MM-DD'> }` or `null`
(24×7). Days are walked in the schedule's timezone; holidays are whole closed
days; DST transitions are handled by doing wall-clock arithmetic in the
zone. Builds on the existing, DST-tested `utils/orgTime.js` (`Intl`-based
zone helpers) with one new helper, `zoneWallTime(dateStr, 'HH:MM', tz)`; no
new dependency.
A target with `useBusinessHours = false` uses `null` (24×7).

### When state is recalculated (`services/sla/ticketSla.js`)

- **Ticket create / update** — Sequelize `afterCreate` / `afterUpdate` hooks
  on `Ticket` (same transaction), so every path is covered: the ticket
  controller, workflow actions, inbound email, the asset/licence alert
  scheduler. Watched fields: `status`, `assigneeId`, `priority`,
  `companyId`. The SLA row is written with `hooks: false`.
- **Policy selection** happens once at create: the company's policy, else
  the default. A later single-ticket `companyId` change re-selects it.
  Bulk updates (`Ticket.update` in contact moves, company merge) do not touch
  SLA rows — the policy stays as chosen.
- **First response** — explicit `recordFirstResponse(ticketId, tx)` call in
  the staff comment handler, not a Comment hook (see Today).
- **Priority or policy change** — keep `usedMinutes` (banking any running
  spell first), read the new targets, recompute `dueAt`/`warnAt`; if used
  already exceeds a new target, breach now.
- **Policy edits** in Settings apply to tickets created afterwards and to
  open tickets on their next recalculation; no mass rewrite.

### Scheduler (`services/sla/slaScheduler.js`)

Plain `setInterval`, every 60 s, same pattern as the other schedulers;
records `scheduler.slaLastRun` for the Schedules page. Each pass:

1. Rows with a running clock and `warnAt <= now`, `warnedAt` null → set
   `warnedAt`, notify, fire workflow `sla_warning`.
2. Rows with a running clock and `dueAt <= now`, `breachedAt` null → set
   `breachedAt` (= `dueAt`), notify, fire `sla_breached`.

The `warnedAt`/`breachedAt` update uses `WHERE … IS NULL` and acts only if a
row was affected, so a slow pass never double-fires.

## Notifications and escalation

- New notification types `sla_warning`, `sla_breached` (switchable on the
  Notifications settings page like existing types). Recipient: the assignee;
  for the assignment clock (no assignee) the ticket's team members, if any.
  Recipients are filtered with the existing `canReachTicket` check.
- Workflow triggers `sla_warning`, `sla_breached` with `triggerConfig.clock`
  (`any` | `assign` | `response` | `resolution`). Existing actions (reassign,
  set team, change priority, notify) do the escalation.
- Workflow action `set_sla_policy` (`{ slaPolicyId }`), recalculating as for
  a priority change — covers department- or type-based SLAs.

## API

- `GET/POST/PATCH/DELETE /sla-policies` — `settings.manage_system`,
  audit-logged. Body includes targets and `companyIds` (the companies on this
  policy). Deleting the default policy is refused; deleting another moves its
  companies and open tickets to the default.
- Ticket detail and list responses include `sla` (from `TicketSlas`) for
  tickets the caller can already see — no new fetch-by-id surface.
- Ticket list filters `sla=breached|at_risk` (at risk = any running clock
  past `warnAt`, not breached), applied inside the existing scope `where`.
- `GET /companies/:id` shows the policy name (read-only); assignment is done
  in the policy editor, so changing it needs `settings.manage_system`.

## Screens

- **Settings → SLAs**: list of policies; editor with name, schedule picker,
  warn %, a priority × clock target grid (hours + minutes, blank = not
  tracked, 24×7 toggle per row), companies on the policy, default marker.
- **Settings → Statuses**: "Pauses SLA" switch per status.
- **Ticket page**: SLA panel — each clock's due time / time left / met /
  breached / paused, policy name.
- **Ticket list**: a badge with the most urgent running clock's time left
  (colour at risk / breached), filters Breached and At risk.
- **Dashboard**: "SLA at risk" panel (the caller's scoped breached + at-risk
  tickets).
- **Reports → SLA compliance**: rebuilt on `TicketSlas`: % met per clock,
  met vs breached by technician, department and company, trend, list of
  breaches. Same scope helpers and CSV export as today.

## Security

- Policy CRUD and company assignment: `settings.manage_system`, audited.
- SLA data reaches the client only inside ticket responses that already
  passed scope checks; list filters are ANDed into the scoped `where`.
- Report and dashboard queries use `ticketScopeWhere` / company filter as
  today.
- `slaPolicyId` inputs (company assignment, workflow action) are strict-parsed
  and must exist.
- Notifications go only to users who can reach the ticket.

## Testing

- Unit: `businessTime` — weekday spans, overnight, weekends, holidays, 24×7,
  DST spring-forward/fall-back in America/Chicago, start outside hours.
- Integration: clock lifecycle (create assigned/unassigned, unassign again,
  first response via endpoint, inbound email reply does **not** count, pause
  status, close and reopen), priority change keeps used time, late stop
  breaches, scheduler warn/breach fires once, workflow triggers and
  `set_sla_policy`, company policy selection, policy CRUD permissions and
  audit, list filters respect scope, report numbers, migration round trip.

## Out of scope

Next-response clock, SLA on projects, per-department policy selection beyond
the workflow action, backfilling clocks for old tickets, technician email
notifications (sub-project 5).
