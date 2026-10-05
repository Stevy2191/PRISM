# PRISM roadmap

PRISM is growing from an internal IT help desk into a full PSA (professional
services automation) platform with a built-in RMM (remote monitoring and
management), while staying a first-class tool for internal IT departments.

**Start here when picking the work up anywhere.** This file is the index:
what is being built, in what order, how far along each piece is, and where
its design and plan live. The reasoning behind the shape of the roadmap is in
[the roadmap design](superpowers/specs/2026-10-03-prism-psa-roadmap-design.md);
read that before designing any sub-project.

## How to resume

1. Find the first sub-project below that is not **Shipped**.
2. Open its spec (the design) and its plan (the step-by-step build). A plan's
   checkboxes show exactly which steps are done.
3. If it has no spec yet, it is next to be designed: start a brainstorm for
   it, write the spec to `docs/superpowers/specs/`, then the plan to
   `docs/superpowers/plans/`, and link both here.
4. Keep the status column below current as work moves.

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
| 3 | One work model — tasks and subtasks on tickets and projects alike; one time ledger with time per task and subtask. Must resolve the [baseline's known quirks](superpowers/specs/2026-10-03-test-baseline-design.md#known-quirks-pinned-not-fixed) | Building | [spec](superpowers/specs/2026-10-05-one-work-model-design.md) | [plan 3a](superpowers/plans/2026-10-06-work-model-split.md) (split and guard); plan 3b (the model) and 3c (the screens) next |
| 4 | SLA engine — response and resolution clocks, business hours, pause, breach warnings, escalation | Not started | — | — |
| 5 | Service desk, full feature — queues, dispatch board, canned responses, merge/split, bulk actions, recurring tickets, approvals, CC/BCC, signatures, email templates, technician email notifications | Not started | — | — |
| 6 | Project management, full feature — phases and milestones, dependencies, timeline view, templates, hour budgets, workload view | Not started | — | — |
| 7 | Client portal (desk) — contact logins, submit and track tickets, company tickets by permission, KB | Not started | — | — |

**Testing feedback (Phase 1):** _none yet_

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
