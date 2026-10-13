# SLA engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real assignment, first-response and resolution clocks on tickets — business hours, pause, warnings, breaches, workflow escalation, admin-defined policies — stored so reports are cheap.

**Architecture:** A pure business-time calculator (`services/sla/businessTime.js`) on top of `utils/orgTime.js`; one `TicketSlas` row per ticket holding three identical clock state machines, kept current by `Ticket` model hooks plus one explicit first-response call; a 60-second scheduler flags warnings/breaches and fires notifications and workflow triggers.

**Tech Stack:** Express + Sequelize + MariaDB backend, Jest integration tests against the `prism-test-db` container (Node 24), React frontend, Playwright smoke suite.

**Spec:** `docs/superpowers/specs/2026-10-13-sla-engine-design.md` — read it first; this plan lists tasks, interfaces and tests, not full code (user rule: plans without full code).

## Global Constraints

- Node ≥ 24.9; run tests with the repo scripts (`npm test -- <path>`), which set `--experimental-vm-modules`. Jest pins `TZ=America/Chicago`.
- No new npm dependency (timezone maths extends `utils/orgTime.js`).
- Every migration has a working `down()` with a round-trip test in `test/integration/migrations.test.js`. Read memory note "Migration rollback" before writing one (`showAllTables()` returns objects; no `delete meta`).
- Every new mutating endpoint: `requirePermission(...)` + `writeAudit(...)`. Policy endpoints use `settings.manage_system`.
- Ids from request bodies are strict-parsed (`parseRecordId` pattern) and must exist; store the parsed id.
- No new file over ~800 lines. `TicketDetail.jsx` and `tickets/core.js` are already large: SLA code lives in new files and is only wired in.
- Durations are integer **minutes** server-side; UI shows hours + minutes.
- Clock names everywhere: `assign`, `response`, `resolution` (column prefixes, `triggerConfig.clock`, API keys).
- During building run only affected test files; full backend suite + full smoke **once** before the push.

## Review Focus

1. **Customer email reply must not count as first response** — inbound replies are `Comment` type `reply` by the first admin. Test in Task 4: inbound reply leaves `responseMetAt` null.
2. **Ticket created/updated outside business hours or on a holiday** — due time lands at the next open window, not mid-night. Tests in Task 1 (start Friday 18:00 → Monday; holiday Monday → Tuesday).
3. **Scheduler overlap / restart** — a warning or breach fires exactly once even if two passes overlap. Test in Task 5: run the pass twice concurrently → one notification, one workflow log row.
4. **Policy deleted or edited while tickets are open** — tickets fall back to the default policy and keep their used minutes. Test in Task 3 (delete moves companies + open ticket rows) and Task 4 (recalc after target edit keeps used minutes).
5. **Out-of-scope user filtering by `sla=breached`** — filter must not widen scope. Test in Task 6: 'own'-tier user sees only own breached tickets; count matches.

---

### Task 1: Business-time calculator

**Files:**
- Modify: `backend/src/utils/orgTime.js` (add `zoneWallTime`)
- Create: `backend/src/services/sla/businessTime.js`
- Test: `backend/test/unit/orgTime.test.js`, `backend/test/unit/businessTime.test.js`

**Interfaces:**
- Produces: `zoneWallTime(dateStr: 'YYYY-MM-DD', hhmm: 'HH:MM', tz) → Date` (two-pass offset, like `zoneDayStart`).
- Produces: `addBusinessMinutes(start: Date, minutes: int, calendar|null) → Date`; `businessMinutesBetween(a: Date, b: Date, calendar|null) → int` (0 if b ≤ a). `calendar = { timezone, schedule, is24x7, holidays: Set<string> }`; `null` or `is24x7` = plain wall-clock minutes. Schedule shape is `BusinessHours.schedule` (`{ monday: { start, end, enabled }, … }`); a disabled/missing day or a holiday is closed. `end <= start` = closed day (guard). Walk day by day in the zone; cap the walk at 3,700 days and throw if exceeded (an all-closed schedule must not loop forever).

- [ ] Step 1: Write failing tests:
  - `zoneWallTime`: `09:00` Chicago on 2026-03-11 → `14:00Z`; on DST start day 2026-03-08 `09:00` → `14:00Z`; `02:30` on 2026-03-08 (non-existent) resolves to a valid instant after 03:00 local.
  - `businessTime`: `adds within one day`; `rolls past closing into next open day`; `start before opening counts from opening`; `start Friday 18:00 lands Monday`; `skips a holiday`; `24x7 and null calendar are wall-clock`; `businessMinutesBetween counts only open minutes across a weekend`; `round-trips: between(start, add(start, n)) === n` for n in [1, 59, 480, 2000]; `spring-forward and fall-back days count real open minutes`; `all-closed schedule throws`; `zero minutes returns start (or next opening if closed)`.
- [ ] Step 2: Run `npm test -- test/unit/businessTime.test.js test/unit/orgTime.test.js` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Re-run → PASS.
- [ ] Step 5: Commit `feat(sla): business-time calculator`.

### Task 2: Schema — policies, targets, ticket SLA rows

**Files:**
- Create: `backend/migrations/20260101000060-sla-engine.js`
- Create: `backend/src/models/SlaTarget.js`, `backend/src/models/TicketSla.js`
- Modify: `backend/src/models/SlaPolicy.js`, `Company.js`, `TicketStatus.js`, `WorkflowRule.js` (trigger ENUM), `WorkflowAction.js` (action ENUM), `models/index.js` (register + associations)
- Test: `backend/test/integration/migrations.test.js`, `backend/test/integration/sla.migration.test.js`

**Interfaces:**
- Produces models: `SlaPolicy { id, name, isDefault, businessHoursId, warnAtPercent }` hasMany `SlaTarget` as `targets`, belongsTo `BusinessHours` as `businessHours`; `SlaTarget { slaPolicyId, priority, assignMinutes, responseMinutes, resolutionMinutes, useBusinessHours }`; `TicketSla` (columns per spec: `ticketId, slaPolicyId, priority` + for each `c` in assign/response/resolution: `cTargetMinutes, cUsedMinutes (default 0), cRunningSince, cDueAt, cWarnAt, cWarnedAt, cBreachedAt, cMetAt`), `Ticket hasOne TicketSla as 'sla'`; `Company.slaPolicyId`; `TicketStatus.pausesSla`.
- ENUM additions: triggers `sla_warning`, `sla_breached`; action `set_sla_policy`.
- Migration data move: old rows → policy "Standard" (`isDefault: true`, `warnAtPercent: 75`, `businessHoursId` = global schedule (`departmentId IS NULL`, lowest id) or null) with one target per old row (`hours × 60`, `assignMinutes: null`). `down()`: rebuild old per-priority rows from the default policy's targets (`minutes / 60`), delete rules/actions using the new ENUM values before shrinking ENUMs, drop new tables/columns.

- [ ] Step 1: Failing tests: `sla.migration.test.js` — `migrates per-priority rows into a Standard default policy`, `links the global business-hours schedule when one exists`, `new ticket statuses default pausesSla false`; `migrations.test.js` — `sla-engine migration round-trips (down then up)` incl. data survives.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement migration + models; run `npm run test:migrate`.
- [ ] Step 4: Re-run both files → PASS.
- [ ] Step 5: Commit `feat(sla): schema for policies, targets and ticket clocks`.

### Task 3: Policy API and "Pauses SLA" on statuses

**Files:**
- Rewrite: `backend/src/controllers/slaPoliciesController.js`, `backend/src/routes/slaPolicies.js`
- Modify: `backend/src/controllers/statusesController.js` (accept/return `pausesSla`), `backend/src/controllers/companies*` detail response (policy `{ id, name }` read-only)
- Test: `backend/test/integration/sla.policies.test.js`

**Interfaces:**
- `GET /sla-policies` → `{ policies: [{ id, name, isDefault, businessHoursId, businessHours:{id,name}|null, warnAtPercent, targets:[…4 priorities], companies:[{id,name}] }] }`
- `GET /sla-policies/:id`, `POST /sla-policies`, `PATCH /sla-policies/:id`, `DELETE /sla-policies/:id`, `POST /sla-policies/:id/default` (make default). Body: `{ name, businessHoursId|null, warnAtPercent, targets:[{ priority, assignMinutes|null, responseMinutes|null, resolutionMinutes|null, useBusinessHours }], companyIds:[int] }`. All `settings.manage_system`, all audited (`slaPolicy.create|update|delete|setDefault`).
- Validation: name required + unique; `warnAtPercent` int 1–99; target minutes null or int 1–525,600; priorities only the four; `businessHoursId`/`companyIds` strict-parsed and must exist; a company on another policy is moved (one policy per company).
- Delete: refused (409) for the default; otherwise in one transaction set those companies' `slaPolicyId = null` and repoint open tickets' `TicketSla.slaPolicyId` to the default (recalc happens in Task 4 via `recalcTicketSla`; until Task 4 exists, just repoint).
- `recalcForPolicy` is NOT run on edit (spec: applies on next recalculation).

- [ ] Step 1: Failing tests: `lists the Standard policy with four targets`; `creates a policy with targets and companies (audited)`; `rejects duplicate name / bad percent / unknown priority / unknown company id / '12abc' id`; `moving a company to a new policy removes it from the old`; `cannot delete the default`; `deleting a policy moves its companies and open tickets to the default`; `set default switches the flag atomically`; `non-admin gets 403 on every route`; `status PATCH round-trips pausesSla`; `company detail shows its policy name`.
- [ ] Step 2: Run `npm test -- test/integration/sla.policies.test.js` → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Re-run → PASS (plus `settings.status.test.js`).
- [ ] Step 5: Commit `feat(sla): policy API and pausing statuses`.

### Task 4: Clock engine — ticket hooks and first response

**Files:**
- Create: `backend/src/services/sla/calendar.js` (load policy + targets + business hours + holiday dates → per-target calendar; small in-process cache invalidated by policy/business-hours/holiday writes)
- Create: `backend/src/services/sla/clock.js` (pure: `startClock`, `stopClock`, `retarget`, `derive` — no DB)
- Create: `backend/src/services/sla/ticketSla.js`
- Modify: `backend/src/models/Ticket.js` (add `afterCreate`, `afterUpdate` hooks calling `ticketSla` lazily, like the existing `beforeSave`), `backend/src/controllers/tickets/comments.js` (call `recordFirstResponse` for staff `reply`/`comment_public`), `slaPoliciesController.js` delete path → `recalcTicketSla`; `businessHoursController.js`, `holidaysController.js`, `slaPoliciesController.js` writes → `calendar.invalidate()`
- Test: `backend/test/unit/slaClock.test.js`, `backend/test/integration/sla.clocks.test.js`

**Interfaces:**
- Consumes: Task 1 `addBusinessMinutes`, `businessMinutesBetween`; Task 2 models.
- `clock.js`: state `{ targetMinutes, usedMinutes, runningSince, dueAt, warnAt, warnedAt, breachedAt, metAt }`; `startClock(state, now, cal, warnPct)`, `stopClock(state, now, cal)` (banks minutes; sets `breachedAt` if used > target and none yet), `retarget(state, newTarget, now, cal, warnPct)` (bank running spell, set target, restart if was running, breach now if used ≥ target), `derive(state, cal, warnPct)` → fills `dueAt/warnAt` from `runningSince`, `target − used`. A null target leaves the clock untracked (all null).
- `ticketSla.js`:
  - `onTicketCreated(ticket, { transaction })` — choose policy (company's `slaPolicyId` → default), read target for `ticket.priority`, start `response` and `resolution` (resolution only if status open and not pausing), start `assign` if no assignee; insert `TicketSla` with `hooks: false`.
  - `onTicketUpdated(ticket, { transaction })` — no-op without a `TicketSla` row (old tickets = "No SLA"). Uses `ticket.changed()` / `previous()` for `status`, `assigneeId`, `priority`, `companyId`: closed/archived → stop all running; reopen → resume resolution (and assign if unassigned); pausing status ↔ stop/start resolution; assignee set/cleared → stop/start assign; priority → `retarget` all three; companyId → re-select policy then `retarget`.
  - `recordFirstResponse(ticketId, { transaction })` — stop `response` and set `responseMetAt` once.
  - `recalcTicketSla(ticketId, { policyId?, transaction })` — re-select (or set) policy and `retarget`; used by `set_sla_policy` and policy delete.
  - `statusFlags()` — cached `Map<statusName, { behaviorType, pausesSla }>`.
- Ticket hooks pass `options.transaction` through and let SLA errors propagate, so a ticket is never saved with a stale clock (the same transaction rolls back).

- [ ] Step 1: Failing unit tests (`slaClock.test.js`): `start then stop banks business minutes`; `stop after due sets breachedAt = dueAt`; `retarget keeps used minutes`; `retarget below used breaches now`; `null target = untracked`; `warnAt at warnPct of target`.
- [ ] Step 2: Failing integration tests (`sla.clocks.test.js`, use a 24×7 policy unless testing hours): `new unassigned ticket starts all three clocks`; `assigned at create: assign clock not started`; `assigning stops assign clock; unassigning restarts it and keeps used`; `staff public reply stops response clock`; `private note does not`; `inbound email reply does not count as first response` (call the inbound-reply path used in `companies.inbound.test.js`); `pausing status stops resolution only`; `closing stops all; reopening resumes resolution, time closed not counted`; `priority change keeps used minutes and moves dueAt`; `company with its own policy gets it at create`; `ticket created before upgrade (no row) is untouched by updates`; `workflow assign action (no request) still stops the assign clock`; `editing a policy target then changing priority uses the new target`.
- [ ] Step 3: Run → FAIL. Implement. Re-run → PASS. Also run `tickets.core.test.js tickets.comments.test.js` (hooks must not break them).
- [ ] Step 4: Commit `feat(sla): clock engine on ticket and comment events`.

### Task 5: Scheduler, notifications, workflow triggers and action

**Files:**
- Create: `backend/src/services/sla/slaScheduler.js` (start from `index.js`/`app.js` where the other schedulers start)
- Modify: `backend/src/services/workflowEngine.js` (`set_sla_policy` action; export a `fireTimedTrigger(trigger, ticketId, { clock })` helper if the existing `runRuleForTicket` needs a wrapper to apply `triggerConfig.clock`), `backend/src/controllers/workflowRulesController.js` (accept new trigger/action + validate `triggerConfig.clock` ∈ any|assign|response|resolution and `actionValue.slaPolicyId` exists), `backend/src/controllers/settingsController.js` (notification types list: `sla_warning`, `sla_breached`), `backend/src/controllers/schedulesController.js` (list the SLA job, `scheduler.slaLastRun`)
- Test: `backend/test/integration/sla.scheduler.test.js`

**Interfaces:**
- `runSlaPass(now = new Date())` exported for tests; `startSlaScheduler()` (60 s, guarded `started` flag, errors logged not thrown).
- Per clock: `UPDATE TicketSlas SET cWarnedAt = now WHERE id = ? AND cWarnedAt IS NULL` — act only when `affectedRows === 1`; same for `cBreachedAt` (value = `cDueAt`). Candidates: `cRunningSince IS NOT NULL AND cWarnAt <= now AND cWarnedAt IS NULL` (resp. `cDueAt`), batched 200.
- Notifications via `createNotification({ userId, type: 'sla_warning'|'sla_breached', message, ticketId })`: assignee; for `assign` clock, the ticket's team members (`TeamMember`). Message names the clock: "Assignment SLA at risk", "First response SLA breached", etc.
- Workflow: rules with trigger `sla_warning`/`sla_breached` whose `triggerConfig.clock` is `any` or matches.

- [ ] Step 1: Failing tests: `warns once at warnAt and notifies the assignee`; `breaches once at dueAt and fires sla_breached rules`; `two overlapping passes fire once` (Promise.all two `runSlaPass`); `paused or stopped clocks are not flagged`; `assign-clock warning goes to team members when unassigned`; `notification type switched off sends nothing`; `rule with clock=response ignores a resolution breach`; `set_sla_policy action switches policy and retargets`; `rule save rejects unknown clock / unknown slaPolicyId`; `recipient who cannot reach the ticket is skipped`.
- [ ] Step 2: Run → FAIL. Implement. Re-run → PASS; also `settings.cleanup.test.js` and any workflow test files touched.
- [ ] Step 3: Commit `feat(sla): warnings, breaches and workflow escalation`.

### Task 6: Ticket API exposure, list filters, dashboard data

**Files:**
- Create: `backend/src/services/sla/slaView.js` (`toSlaView(ticketSlaRow, now) → { policy:{id,name}, clocks:{ assign|response|resolution: { state: 'running'|'paused'|'met'|'breached'|'untracked', dueAt, metAt, breachedAt, atRisk } } , worst: { clock, dueAt, state } | null }`)
- Modify: ticket detail + list handlers in `backend/src/controllers/tickets/core.js` (include `TicketSla` as `sla`, map through `toSlaView`; `?sla=breached|at_risk` ANDed into the scoped `where` via `andWhere`), `backend/src/controllers/dashboardController.js` (new `slaAtRisk` data: caller-scoped breached + at-risk open tickets, limit 10, oldest due first)
- Test: `backend/test/integration/sla.api.test.js`

**Interfaces:**
- `breached` = any `cBreachedAt` not null on an open ticket; `at_risk` = any running clock with `cWarnAt <= now` and no breach. Use `$sla.col$` with `include: [{ model: TicketSla, as: 'sla', required: true }]` — mind the pagination `findAndCountAll` + include trap (memory "Pagination build": `distinct: true`, `col`).

- [ ] Step 1: Failing tests: `ticket detail includes sla view`; `old ticket returns sla: null`; `list ?sla=breached returns only breached in scope` (own-tier user + another user's breached ticket → excluded, total correct); `?sla=at_risk excludes breached`; `bad sla value → 400`; `dashboard slaAtRisk is scoped`; `paused resolution shows state paused`.
- [ ] Step 2: Run → FAIL. Implement. Re-run → PASS; also `pagination.test.js`, `tickets.core.test.js`.
- [ ] Step 3: Commit `feat(sla): SLA on ticket responses, filters and dashboard data`.

### Task 7: SLA compliance report on real clocks

**Files:**
- Rewrite: `backend/src/controllers/reports/sla.js`
- Test: `backend/test/integration/sla.report.test.js` (and update existing SLA-report assertions in `readers.reports.test.js` / `companies.reports.test.js` if they pin the old due-date shape)

**Interfaces:**
- Range applies to ticket `createdAt`. Summary: per clock `{ tracked, met, breached, pctMet }` + `openAtRisk`, `openBreached`. Charts: `metVsBreachedByTech`, `…ByDept`, `…ByCompany` (resolution clock), `complianceTrend` (resolution). Table: breaches `{ ticketNumber, title, assignee, company, clock, dueAt, breachedAt, overByMinutes }`. Same `ticketScopeWhere`, `companyFilterWhere`, `sendCsv`.

- [ ] Step 1: Failing tests: `counts met and breached per clock`; `tickets without SLA are excluded`; `respects scope and company filter`; `CSV export lists breaches`.
- [ ] Step 2: Run → FAIL. Implement. Re-run → PASS (plus the two existing report files).
- [ ] Step 3: Commit `feat(sla): compliance report on SLA clocks`.

### Task 8: Settings screens

**Files:**
- Rewrite: `frontend/src/pages/settings/SLAs.jsx` (policy list + editor; split an `SlaPolicyEditor.jsx` if > ~400 lines)
- Modify: `frontend/src/pages/settings/Statuses.jsx` ("Pauses SLA" switch, ticket statuses only), `WorkflowRuleEditor.jsx` + `WorkflowRules.jsx` (two triggers with a clock picker; "Set SLA policy" action with policy picker), `Notifications.jsx` (two types), company detail page (read-only "SLA policy" line)
- Test: `backend/test/smoke/sla.settings.smoke.js`

**Interfaces:** consumes Task 3/5 APIs. Target grid: rows = priorities, columns = Assign / Respond / Resolve (hours + minutes inputs, blank = not tracked) + 24×7 toggle. Schedule picker from `GET /business-hours`; company multi-picker from the existing company picker component.

- [ ] Step 1: Failing smoke: `admin creates a policy with targets and a company, sees it listed`; `default policy cannot be deleted (button disabled)`; `Pauses SLA switch saves`; `workflow editor offers SLA triggers and Set SLA policy action`.
- [ ] Step 2: Implement; `npm --prefix frontend run build`; run the smoke file → PASS.
- [ ] Step 3: Commit `feat(sla): settings screens`.

### Task 9: Ticket, list, dashboard and report screens

**Files:**
- Create: `frontend/src/pages/tickets/detail/SlaPanel.jsx`, `frontend/src/components/SlaBadge.jsx` (shared: time-left text from `dueAt`, colour by state — reuse existing status-chip classes, dark-mode tokens)
- Modify: `frontend/src/pages/tickets/detail/Sidebar.jsx` (mount panel), `frontend/src/pages/tickets/list/Cells.jsx` + `ColumnsMenu.jsx` (SLA column), `Tickets.jsx` filters (Breached / At risk → `?sla=`), `frontend/src/pages/Dashboard.jsx` (panel `slaAtRisk` in catalog, default visible for tech and admin), `frontend/src/pages/reports/SlaComplianceReport.jsx`
- Test: `backend/test/smoke/sla.tickets.smoke.js`

- [ ] Step 1: Failing smoke: `ticket page shows three clocks with due times`; `old ticket shows No SLA`; `list Breached filter shows only breached`; `dashboard SLA at risk panel lists a warned ticket`; `report shows per-clock percentages`; `375px width: panel and badge do not overflow`.
- [ ] Step 2: Implement; build; run smoke → PASS.
- [ ] Step 3: Commit `feat(sla): ticket, list, dashboard and report screens`.

### Task 10: Docs, full verification, push

**Files:** `docs/ROADMAP.md` (status Shipped, plan link), `UPGRADING.md` (Phase 1 notes: SLA policies replace per-priority settings, only new tickets get clocks, "Pauses SLA" on statuses — set it on waiting statuses), memory note.

- [ ] Step 1: Security pass over the diff (scope on every new query, strict ids, audit on every mutation, no SLA data outside scoped ticket responses, scheduler can't be driven by request input). Fresh reviewer subagent for the whole branch (security-relevant + large).
- [ ] Step 2: Full backend suite once (`npm test` in `backend/`) + full smoke once (`npm run test:smoke`) on Node 24. Paste results.
- [ ] Step 3: Update docs; commit `docs: SLA engine shipped`; push `dev`.
