# SLA due dates — design change

Changes the shipped [SLA engine](2026-10-13-sla-engine-design.md)
(sub-project 4) after the user's review on 2026-10-13. Status: awaiting review.

## What the user asked for

> "I dont want technicians to be able to pause the SLA. The SLA is the SLA
> and only should be adjusted by adjusting the due date. The due date should
> be set automatically by the type of ticket and the corresponding SLA. […]
> The tech can only extend the due date but would need to provide a note as
> to why."

> "The default SLA for a incident high priority is set 4 hours from the
> submit […] Incident Low priority is 16 hours […] Requests are different as
> well. Each of these need to be configurable […] per customer company.
> Blueprints are just templates for tickets."

## Decisions (agreed 2026-10-13)

| # | Decision |
|---|---|
| 1 | A policy's targets are per **ticket type × priority** (incident, request, problem, change, task × urgent, high, medium, low), each with assign / first-response / resolve targets. Blank = not tracked. Policies stay per customer company with one default. |
| 2 | Blueprints are unchanged templates; a ticket's SLA follows from the type and priority it ends up with. |
| 3 | Targets are entered as **hours** (business hours) or **days** (business days on the policy's schedule; calendar days on a 24×7 policy). |
| 4 | **No pause.** The "Pauses SLA" status switch is removed. Closing stops the clocks; reopening keeps the original due date (time while closed counts). |
| 5 | The resolution target **sets the ticket's due date** (date and time) when the ticket is created. The due date is the resolution deadline. |
| 6 | Technicians can only **extend** the due date, with a required reason. Each extension is kept (who, when, from, to, reason) and shown in the ticket's activity. Moving a due date earlier, or without a reason, needs the new permission **Adjust SLA due dates** (admins only by default). |
| 7 | Warnings and breach notices follow the **current** due date. The SLA report shows both **% met the original SLA** and **% met the (extended) due date**, plus how many tickets were extended and why. |
| 8 | Priority, type or company changes after creation **don't move** any SLA date. The SLA is fixed when the request is made; someone with Adjust SLA due dates can change it. The "Set SLA policy" workflow action still re-times a ticket (it's an admin's rule, usually on "ticket created"). |
| 9 | The assignment and first-response clocks stay as built, with targets from the same type × priority grid. |

## Changes to the shipped design

**Data**
- `SlaTargets` gains `ticketType` (unique `slaPolicyId, ticketType, priority`)
  and, per clock, a unit (`assignUnit`, `responseUnit`, `resolutionUnit`:
  `minutes` | `business_days`). Targets keep an integer amount
  (`…Minutes` holds minutes, or a day count when the unit is
  `business_days`). Migration copies each existing per-priority target to
  all five types (unit `minutes`).
- `TicketStatuses.pausesSla` is dropped (migration; `down()` restores it,
  false).
- `TicketSlas` gains `resolutionOriginalDueAt` (set at creation, never
  changed except by Set SLA policy).
- New `TicketDueDateChanges`: `id, ticketId, userId (null = system/workflow),
  fromDueAt, toDueAt, reason, kind ('extension' | 'adjustment'), createdAt`.
- New permission `tickets.adjust_sla_due` (granted to System Administrator).

**Business time**
- `addBusinessDays(start, n, calendar)`: the same wall-clock time `n` open
  days later (a start outside open hours counts from the next opening; a
  time past that day's closing lands at closing). Calendar days on 24×7.

**Clocks** (`clock.js` / `ticketSla.js`)
- Resolution clock: `dueAt` is fixed at creation (business minutes or
  days); it no longer pauses or retargets on priority/type/company change.
  Breach = still open after `dueAt`. Reopen keeps `dueAt`.
- Assign/response clocks: unchanged state machine, but targets are read
  once at creation (no retarget on later changes) — decision 8.
- Due date mirror: on creation and every change, `Ticket.dueDate` /
  `dueTime` are written from the resolution `dueAt` in the organization's
  time zone, so the list, calendar and overdue filters keep working. A
  ticket whose policy tracks no resolution target keeps a manual due date
  as today.

**Changing the due date**
- `POST /tickets/:id/due-date` `{ dueDate, dueTime, reason }` — edit tier
  on the ticket. Later than the current due date and a reason (1–1000
  chars) → recorded as `extension`. Earlier, or no reason → needs
  `tickets.adjust_sla_due`, recorded as `adjustment`. Updates `dueAt`,
  clears that clock's `warnedAt`/`breachedAt` so they can fire again for
  the new date, writes activity + audit.
- `PATCH /tickets/:id` no longer accepts `dueDate`/`dueTime` on tickets with
  a resolution SLA (400, pointing at the endpoint above); tickets without one
  keep today's behaviour.
- Workflow `set_due_date` on an SLA ticket is recorded as an `adjustment`
  by the rule ("Workflow rule: <name>").

**Screens**
- Settings → SLAs editor: a tab per ticket type, each with the priority ×
  clock grid; each cell takes an amount and a unit (hours/days).
- Settings → Statuses: "Pauses SLA" removed.
- Ticket page: the due date field becomes "Extend due date" (date, time,
  required reason); users with Adjust SLA due dates get "Change due date".
  The SLA panel lists the original due date and the extensions.
- SLA report: % met original SLA, % met due date, extensions (count, list
  with reasons).

## Security

- New endpoint: view + edit tier on the ticket (existing `canEditTicket`),
  strict date parsing, reason length-capped, audit-logged.
- `tickets.adjust_sla_due` follows the existing grant rules (non-admins
  can't hand out more than they hold).

## Testing

- `addBusinessDays`: weekday, over a weekend, holiday, start after hours,
  24×7.
- Due date set from type × priority at creation; company policy wins over
  default; blueprint ticket gets its type/priority's SLA.
- No pause: a formerly pausing status no longer stops anything; reopen
  keeps the due date.
- Extension: later + reason OK (history, activity, audit, warn/breach
  re-fire); earlier or no reason → 403 without the permission, OK with it;
  PATCH dueDate on an SLA ticket → 400; out-of-scope ticket → same as
  missing.
- Priority/type/company change leaves all SLA dates alone.
- Report: original vs extended figures. Migration round trip.
