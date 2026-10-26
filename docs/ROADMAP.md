# PRISM roadmap

PRISM is growing from an internal IT help desk into a full PSA (professional
services automation) platform with a built-in RMM (remote monitoring and
management), while staying a first-class tool for internal IT departments.

**Start here when picking the work up anywhere.** This file is the index:
what is being built, in what order, how far along each piece is, and where
its design and plan live. The reasoning behind the shape of the roadmap is in
[the roadmap design](superpowers/specs/2026-10-03-prism-psa-roadmap-design.md);
read that before designing any sub-project.

## Where things stand (updated 2026-10-26)

- **Phase 1:** sub-projects 1–6 (including 5d, attachment virus scanning, and 6,
  project management) are **Shipped** to `dev`, untagged. Their release notes
  are under `## Unreleased` in `UPGRADING.md`.
- **Next up: 6b** (restyle the rest of PRISM in look A), then sub-project 7
  (client portal). Then Phase 1 is released as `v0.4.0` (see Releases below)
  and tested by hand before Phase 2 starts.
- **Open items carried forward:**
  - `test/smoke/waiting.smoke.js`, "the report shows the figures…", fails
    when the local date and the UTC date differ, e.g. evenings in US time
    zones. The report's default range and the stored timestamps disagree
    about the day. This was there before 5c/5d; fix it in a quiet moment.
  - Split ticket (5b) now carries the source ticket's category (decided
    2026-10-24).
  - Follow-up from 6: touch and keyboard dispatch on Workload (an "Assign
    to…" action); dragging needs a mouse today.
  - Reports' `fmt()` in `frontend/src/pages/reports/shared.jsx` calls
    `toISOString()` on local midnight, so it shows the wrong day east of UTC.
    Fix it together with the `waiting.smoke.js` evening-time-zone item above,
    before `v0.4.0` hand testing.
  - Decided 2026-10-26: helpers only view and log time (no files). A project's
    lead and members edit it whatever their role (see `UPGRADING.md`).

## How to resume

1. Find the first sub-project below that is not **Shipped**. The status
   column is the source of truth.
2. Open its spec (the design) and its plan (the step-by-step build). For a
   sub-project that is **Building**, the plan's checkboxes show which steps
   are done. Older shipped plans (before the SLA engine) were not ticked
   as they went, and say so at the top.
3. If it has no spec yet, it is next to be designed: start a brainstorm for
   it, write the spec to `docs/superpowers/specs/`, then the plan to
   `docs/superpowers/plans/`, and link both here.
4. Keep the status column below current as work moves, and update "Where
   things stand" above.

## Working on the code

- **Node:** the test suite needs Node 24 (`>=24.9`).
- **Test database:** the backend tests use the MariaDB on `127.0.0.1:3307`
  (`backend/.env.test`). Apply new migrations to it with
  `cd backend && set -a && . ./.env.test && set +a && npx sequelize-cli db:migrate --env test`
  (`npm run test:migrate` alone doesn't load `.env.test`).
- **Running tests:** while building, run only the affected tests
  (`npx cross-env NODE_OPTIONS=--experimental-vm-modules jest <files>`). Run
  the full backend suite (`npm test`, about 25 minutes) and the browser smoke
  suite (`npm run test:smoke`, which builds the frontend first) once before
  each push. Don't run two suites at once: they share one test database.
- **Migration round-trip tests:** a test that runs an older migration's
  `down`/`up` can drop a table and re-create it without the columns that
  later migrations add, which breaks every later test file. Re-apply the
  later migrations in that test's `afterAll`; see the `later` list in
  `test/integration/desktools.migration.test.js`.
- **CI:** a push to `dev` or `main` runs "Build and Publish Docker Images".
  That run calls the test workflow first (the backend suite, not the smoke
  suite) and only builds and publishes the images (`:dev` from `dev`) if it
  passes. A green run means the backend suite passed too.
- **Docs per sub-project:** one spec, one plan (tasks, interfaces and test
  names, not full code), release notes in `UPGRADING.md` under
  `## Unreleased`, and its status row here.

## Decisions so far

| Decision | Choice |
|---|---|
| Audience | One codebase serving both internal IT and MSPs. Client companies always exist; an internal IT install is the one-company case and does not see MSP-only screens unless they are turned on. |
| Build order | Option B: foundation first (desk and projects built sturdy), then RMM core, then money, then the rest of RMM, then docs/reporting. |
| RMM | Built in, not integrated. A PRISM agent covering inventory and monitoring, scripting and automation, patch management, and remote access. |
| Agent platforms | Windows first, written cross-platform (Go) so macOS and Linux follow. |
| Agent signing | Free: PRISM signs the agent with its own certificate, and admins push trust for it (and the agent) via GPO/Intune. A paid code-signing certificate stays a drop-in option, not a requirement. |
| Remote access | Built in, no third-party app: remote shell and file transfer first, then full remote desktop in the browser over WebRTC. |
| End-user tray app | A system-tray helper installed with the agent gives end users a one-click way to submit tickets, pre-filled with who they are and which computer they're on. No separate install or login. |
| Billing | Full billing inside PRISM, including online payments in the client portal. Accounting sync is a connector, not a replacement. |
| Administration | **Owners** (decided 2026-10-11): ownership is a mark on a System Administrator's account, not a role. Exactly one owner (a local account, ideally a service account) marks any number of secondary owners. Owners alone make administrators, change an administrator's account, or change sign-in, mail and integration settings; only the owner marks owners and hands ownership on. A server command recovers a lost owner. |
| Docs | Everything lives in this repo: this roadmap, one spec and one plan per sub-project, release notes in `UPGRADING.md`. |

## Releases

Each phase ships as a minor version; fixes and changes from testing that
phase ship as patch versions of it.

| Phase | Version | Then |
|---|---|---|
| 1. Foundation | `v0.4.0` | `v0.4.1`, `v0.4.2`, … until signed off |
| 2. RMM core | `v0.5.0` | patches as needed |
| 3. Money | `v0.6.0` | patches as needed |
| 4. RMM, the rest | `v0.7.0` | patches as needed |
| 5. Docs and reporting | `v0.8.0` | patches as needed |

- Each finished sub-project is pushed to `dev` untagged.
- When a phase's last sub-project is done, the phase is released the usual way
  (see `RELEASING.md`): its `UPGRADING.md` section is written, `main` is
  fast-forwarded to `dev`, and the version is tagged on `main`.
- The phase is then tested by hand. Bugs, additions and changes found go in
  that phase's **Testing feedback** list below and ship as patch releases.
- The next phase does not start until the current one is signed off.

## Status

Status values: **Not started** → **Designing** → **Planned** → **Building** →
**Shipped** (pushed to `dev`). A phase is **Released** once its version is
tagged.

### Phase 1 — Foundation (`v0.4.0`)

The ticket desk and project management, built to be relied on: full-featured,
consistent between tickets and projects, and covered by tests.

| # | Sub-project | Status | Spec | Plan |
|---|---|---|---|---|
| 1 | Test baseline — tests that pin down how tickets, projects and time behave today | Shipped | [spec](superpowers/specs/2026-10-03-test-baseline-design.md) | [plan](superpowers/plans/2026-10-04-test-baseline.md) |
| 2 | Client companies — companies, sites, contacts under companies; company on every record; vendors as companies | Shipped | [spec](superpowers/specs/2026-10-04-client-companies-design.md) | [plan 2a](superpowers/plans/2026-10-04-client-companies-core.md) (backend core); [plan 2b](superpowers/plans/2026-10-05-client-companies-screens.md) (screens, vendors, merge, import) |
| 3 | One work model — tasks and subtasks on tickets and projects alike; one time ledger with time per task and subtask. Must resolve the [baseline's known quirks](superpowers/specs/2026-10-03-test-baseline-design.md#known-quirks-pinned-not-fixed) | Shipped | [spec](superpowers/specs/2026-10-05-one-work-model-design.md) | [plan 3a](superpowers/plans/2026-10-06-work-model-split.md) (split and guard); [plan 3b-1](superpowers/plans/2026-10-06-work-model-ledger.md) (tasks and the ledger); [plan 3b-2](superpowers/plans/2026-10-06-work-model-access.md) (access and remaining fixes); [plan 3c](superpowers/plans/2026-10-11-work-model-screens.md) (the screens) |
| 4 | SLA engine — assignment, response and resolution clocks, business hours, pause, breach warnings, escalation | Shipped | [spec](superpowers/specs/2026-10-13-sla-engine-design.md); [due-date change](superpowers/specs/2026-10-13-sla-due-dates-design.md) | [plan](superpowers/plans/2026-10-13-sla-engine.md); [due-date plan](superpowers/plans/2026-10-13-sla-due-dates.md) |
| 5 | Service desk, full feature — queues, canned responses, merge/split, bulk actions, recurring tickets, CC/BCC, signatures, email templates, technician email notifications, capturing tech replies sent from their own mailbox, dependent ticket categories. (Dispatch board moved to 6; approvals dropped — see spec) | Shipped | [spec](superpowers/specs/2026-10-14-service-desk-design.md) | [plan 5a](superpowers/plans/2026-10-14-service-desk-email.md) (email + status rework, 2026-10-15); waiting-on-customer time report (2026-10-15, no plan); [plan 5b](superpowers/plans/2026-10-15-service-desk-tools.md) (desk tools: queues + Take it, canned responses, bulk, merge/split, recurring tickets, 2026-10-16); [plan 5c](superpowers/plans/2026-10-24-ticket-categories.md) (ticket categories, 2026-10-24) |
| 5d | Attachment virus scanning (security) — every uploaded file is scanned with ClamAV before it is stored: staff uploads on tickets, projects, assets, contracts, licenses and the KB, plus inbound email attachments. Decided 2026-10-15: runs as a `clamd` container in docker-compose with freshclam signature updates; PRISM streams files to it over TCP (INSTREAM), no new npm dependency; **fails closed** — if the scanner is unreachable, uploads are refused with a clear error and inbound attachments are not saved (the note lists them as not scanned). Built after 5b | Shipped (2026-10-20) | [spec](superpowers/specs/2026-10-16-attachment-virus-scanning-design.md) | [plan](superpowers/plans/2026-10-16-attachment-virus-scanning.md) |
| 6 | Project management, full feature — phases and milestones, dependencies, timeline view, templates, hour budgets, workload view (one screen over tickets and project tasks; absorbs the dispatch board moved from 5). Also lays the look A foundation and builds every project and workload screen in it ([mockups](https://claude.ai/artifact/NXd5ZYb4P98kk8VjxHwx3H)) | Shipped (to dev, 2026-10-26) | [spec](superpowers/specs/2026-10-25-project-management-design.md) | [plan](superpowers/plans/2026-10-25-project-management.md) |
| 6b | Restyle the rest of PRISM in look A — tickets, dashboard, assets, contacts, companies, knowledge, reports, settings and login, on the foundation 6 builds. Added 2026-10-25 | Not started | — | — |
| 7 | Client portal (desk) — contact logins, submit and track tickets, company tickets by permission, KB | Not started | — | — |

**Testing feedback (Phase 1):**
- Accounts (2026-10-11): choose the role and permission overrides when creating an account; usernames can be changed.
- Owners (2026-10-11): the Owner role became a mark on a System Administrator's account (one owner, secondary owners set by the owner, a server command to recover a lost owner).
- Parked fixes (2026-10-12): time-entry controls follow the server, no shared local email addresses, upload area only with edit permission, owner recovery seen at once.
- Timers (2026-10-12): several timers at once, a "My timers" list, reminders for timers left running, and a longest-entry limit (12 hours by default).
- Settings (2026-10-12): one menu with search, regrouped pages, one page layout ([spec](superpowers/specs/2026-10-12-settings-redesign-design.md), [plan](superpowers/plans/2026-10-12-settings-redesign.md)).
- Settings cleanup (2026-10-12): unused settings removed, one organization name, assignment rules folded into workflow rules, Modules & tabs removed.

### Phase 2 — RMM core (`v0.5.0`)

| # | Sub-project | Status | Spec | Plan |
|---|---|---|---|---|
| 8 | Agent gateway and Windows agent — enrollment, mutual TLS, signed updates, Windows service, internet-facing gateway service | Not started | — | — |
| 9 | Inventory and monitoring — automatic hardware/software inventory into Assets (every computer running the agent becomes an Asset, with total owned time and in-service time), heartbeats, checks, alerts that open tickets | Not started | — | — |
| 9b | Tray app — a per-user system-tray helper installed with the agent. One click opens a short ticket form pre-filled with the user's name, company and department and the computer's name, IP and MAC address; the ticket links the computer's Asset and carries a health snapshot (OS version, uptime, free disk, logged-in domain); an optional screenshot; a "My tickets" list showing the user's open tickets and their status | Not started | — | — |

**Testing feedback (Phase 2):** _none yet_

### Phase 3 — Money (`v0.6.0`)

| # | Sub-project | Status | Spec | Plan |
|---|---|---|---|---|
| 10 | Rates and timesheets — work types, roles, rate cards, weekly timesheets with approval | Not started | — | — |
| 11 | Product catalog and procurement — products and services, purchase orders, receiving, stock, assets from receipts | Not started | — | — |
| 12 | Service agreements — managed services, block hours, retainers, T&M, fixed fee, coverage rules | Not started | — | — |
| 13 | Billing and invoicing — billing review, invoices, tax, receivables, online payments, autopay, reminders, accounting sync | Not started | — | — |
| 14 | Sales — opportunities, quotes, e-signature in the portal, convert to project/agreement/order | Not started | — | — |
| 15 | Project billing — fixed fee, T&M, milestones, money budgets | Not started | — | — |

**Testing feedback (Phase 3):** _none yet_

### Phase 4 — RMM, the rest (`v0.7.0`)

| # | Sub-project | Status | Spec | Plan |
|---|---|---|---|---|
| 16 | Scripting and automation — script library, run on device or group, schedules, results | Not started | — | — |
| 17 | Patch management — approval policies, maintenance windows, compliance | Not started | — | — |
| 18a | Remote shell and file transfer — live PowerShell/command prompt and file browse/upload/download from PRISM | Not started | — | — |
| 18b | Remote desktop — screen and input in the browser over WebRTC, user-session helper, login/UAC screens, multi-monitor, clipboard, consent prompt, relay through the gateway | Not started | — | — |
| 19 | macOS and Linux agents | Not started | — | — |

**Testing feedback (Phase 4):** _none yet_

### Phase 5 — Docs and reporting (`v0.8.0`)

| # | Sub-project | Status | Spec | Plan |
|---|---|---|---|---|
| 20 | Client IT documentation and credential vault | Not started | — | — |
| 21 | MSP reporting — profitability, utilization, MRR, receivables aging, quarterly business reviews | Not started | — | — |
| 22 | Integrations — outgoing webhooks, published API docs, Teams/Slack | Not started | — | — |

**Testing feedback (Phase 5):** _none yet_
