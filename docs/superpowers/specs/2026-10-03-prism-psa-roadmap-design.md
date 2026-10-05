# PRISM PSA roadmap — design

Turns PRISM from an internal IT help desk into a full PSA with a built-in
RMM, without making it worse for the internal IT departments it was built for.

This is the umbrella design. It fixes the decisions and rules that every
sub-project inherits; each sub-project still gets its own spec and plan. The
live status of the work is in [`docs/ROADMAP.md`](../../ROADMAP.md).

## Decisions

| Decision | Choice |
|---|---|
| Audience | One data model for both uses. Client companies always exist. An internal IT install is the one-company case; an MSP adds many. No install-time "mode" switch. |
| Build order | Foundation → RMM core → money → rest of RMM → docs and reporting (option B). RMM core comes early because the agent is the piece most likely to force changes elsewhere, and it is cheaper to learn that before billing exists. |
| RMM scope | Built in. Inventory and monitoring, scripting and automation, patch management, remote access. |
| Agent platforms | Windows first; the agent is written in Go so macOS and Linux are builds of the same code, not rewrites. |
| Agent signing | No paid certificate. PRISM generates its own code-signing certificate; trust for it is pushed to managed machines by GPO/Intune, and the agent is deployed the same way (which also avoids SmartScreen's downloaded-file warning). Buying a certificate later is a drop-in change. |
| Remote access | Built in, no third-party app. Remote shell and file transfer (18a) ship first; full remote desktop in the browser over WebRTC (18b) follows. |
| End-user tray app | A per-user system-tray helper (9b), installed with the agent, lets end users submit a ticket in one click with their identity and the computer's details filled in, and see their open tickets. It talks to PRISM through the agent's connection, so there is no separate installer or login. Added 2026-10-05. |
| Billing scope | Full billing in PRISM including online payments in the client portal. PRISM is not a general ledger; accounting packages are sync targets. |
| Releases | One minor version per phase (`v0.4.0` = Phase 1 … `v0.8.0` = Phase 5); fixes from testing a phase are patch versions of it. |
| Where planning lives | In the repo: `docs/ROADMAP.md`, one spec per sub-project in `docs/superpowers/specs/`, one plan per sub-project in `docs/superpowers/plans/`. |

Out of scope for this roadmap: hosting many unrelated MSPs in one install
(multi-tenant SaaS). One install serves one organization — an internal IT
department or an MSP — and that organization's clients.

## Where PRISM starts from

Surveyed on 2026-10-03 at `894c5b0` (v0.3.0). What the roadmap has to work
with, and work around:

- **Everything is scoped by the organization's own departments.** There is no
  client company. Contacts belong to a department. Ticket and project scope
  checks (`own` / `department` / `all` in `permissionService`) are department
  based.
- **"Contracts" and "Licenses" are spend tracking** — what the organization
  pays vendors. They stay, as vendor-side tools. Client-facing agreements are
  new (sub-project 12).
- **Two time stores.** Ticket time is `TimeEntry`; project time is
  `ProjectTimeEntry`. Different columns, no billable flag, no work type, no
  rate. Both compute `laborCost` from `User.hourlyRate`.
- **Tasks are inconsistent.** Ticket tasks (`TicketTask`) are a flat checklist
  with no subtasks and no time. Project tasks have subtasks, but project time
  can only be logged against a task, not a subtask.
- **SLA policies are configuration only.** `SlaPolicy` rows can be edited in
  Settings but nothing reads them: there is no SLA clock, breach or
  escalation. The "SLA compliance" report measures due dates.
- **Vendors are free text** on contracts, licenses and assets.
- **No client logins.** `Ticket.source` already has a `portal` value that
  nothing sets.
- **Technicians get in-app notifications only.** Outbound email goes only to
  contacts (replies, CSAT, checkout forms, auto-replies).
- **Very large files** in the area Phase 1 rebuilds: `TicketDetail.jsx`
  (~2,600 lines), `ProjectDetail.jsx` (~1,650), `ticketsController.js`
  (~1,400), `projectsController.js` (~1,200).
- **Thin behavioural tests.** The integration suite covers auth, SSO,
  authorization, hardening, migrations and pagination; ticket, project and
  time behaviour is largely untested.

Already in place and worth building on: roles and permissions with
per-user overrides, module visibility, workflow rules, assignment rules,
business hours and holidays, email in and out, CSAT, assets with
per-category fields, a public KB portal, the custom report builder,
`utils/tokenCrypto` for encrypting secrets at rest, and API keys.

## Cross-cutting design rules

Every sub-project spec must follow these, or say explicitly why it departs.

### 1. Companies are the spine

- A `Company` is created for the organization itself by migration, flagged as
  the internal company, and every existing record is backfilled to it. An
  upgraded internal IT install therefore has exactly one company and behaves
  as it does today.
- New records get a company. Tickets, projects, assets, licenses, contracts,
  agreements, invoices and devices all carry `companyId`.
- Departments stay: they are the organization's own internal structure (and
  the basis of today's scope checks). How a client company's own subdivisions
  are modelled — sites only, or departments per company — is decided in
  sub-project 2's spec.
- Vendors become companies of a vendor type rather than free-text strings.
- Permission scope gains a company dimension. Every new or changed
  fetch-by-id handler re-checks scope (the IDOR class fixed in the 2026-07-12
  security audit must not come back).

### 2. MSP surfaces are additive and switchable

Features that only make sense with outside clients — client portal billing,
agreements, invoicing, sales — sit behind module visibility, and the company
picker only appears once there is more than one company. An internal IT
install that never adds a client should not see screens it has no use for.
Internal IT can still use any of them (for example, charging back other
business units).

### 3. One work model, one time ledger

Tickets and projects share the same task model (tasks with subtasks,
assignee, status, due date, estimate) and the same time ledger. Every time
entry belongs to a ticket or a project, optionally to a task or subtask, and
records user, start/end/duration, billable flag, work type and cost. Timers
write to it. Timesheets, utilization, billing and profitability all read from
this one table; nothing later is allowed to start a second one. The two
existing time tables are migrated into it without data loss.

### 4. Money is exact and single-currency to start

Monetary values are stored as fixed-point decimals, never floats. One
currency per install to start; the currency is a setting. Tax is a property
of invoice lines. Card data never touches PRISM's servers: payments use the
processor's hosted fields or checkout, keeping PRISM out of PCI scope beyond
the simplest self-assessment.

### 5. The agent is the highest-risk component and is designed that way

An agent that can run commands on every managed machine makes PRISM the
single most valuable target on its users' networks. Non-negotiable:

- A separate **agent gateway** service in the same Compose stack, sharing the
  database. It holds the long-lived agent connections and is the only part
  exposed to the internet for agents; a crash or compromise there does not
  take down the staff web app.
- Enrollment by one-time, expiring token; each agent then authenticates with
  its own certificate (mutual TLS). Revoking a device revokes its
  certificate.
- Agent binaries and update manifests are signed, and the agent verifies the
  signature before installing an update. Two separate signatures: the
  Windows (Authenticode) signature, made with a certificate PRISM generates
  and admins push trust for; and PRISM's own update-manifest signature,
  which only the agent checks. Neither needs a paid certificate.
- Every remote action (script run, patch install, remote session) is
  permission-checked, attributed to a user, and written to the audit log.
- A global kill switch can stop all remote execution at once.

### 6. Definition of done for every sub-project

A sub-project is not **Shipped** until:

- New behaviour has integration tests, and the tests pass on the CI runtime
  (Node 24 — see the repo's test setup).
- Every migration has a working `down()`, proven by a down/up round-trip
  test in `test/integration/migrations.test.js` (the pattern the SSO
  migration's test already follows).
- Every new mutating endpoint is permission-checked and audit-logged; every
  fetch-by-id re-checks scope.
- No new file grows past roughly 800 lines; large existing files touched by
  the work are split as part of it, not afterwards.
- Anything internet-facing (portal, gateway, payment webhooks) has had a
  security review before it ships.
- `docs/ROADMAP.md` status is updated, and user-visible changes are recorded
  for that phase's `UPGRADING.md` section.

### 7. Upgrades never need hand work

Existing installs upgrade with `docker compose pull && docker compose up -d`.
Data is migrated, not abandoned. A release that does need an action says so
at the top of its `UPGRADING.md` section.

## Phases

The sub-project list, status and links are in `docs/ROADMAP.md`. What each
phase is for, and what its sub-project specs must settle:

**Phase 1 — Foundation (`v0.4.0`).** The desk and project management, made
dependable. The test baseline (sub-project 1) comes first so that the rest of
the phase can change ticket, project and time code with a net under it.
Client companies (2) and the work model and time ledger (3) are the data
changes everything later depends on. SLA (4), the full service desk (5),
full project management (6) and the desk part of the client portal (7) build
on them. Open questions for the specs: how client subdivisions are modelled
(2); whether ticket and project tasks share one table or one shape across
two (3); how SLA clocks are computed and stored so reports are cheap (4).

**Phase 2 — RMM core (`v0.5.0`).** The gateway and Windows agent (8), then
inventory and monitoring (9) feeding Assets and Tickets, then the end-user
tray app (9b). Open questions: transport (WebSocket vs gRPC), how PRISM is
reached by agents outside the LAN (public hostname, TLS termination, gateway
port), metrics retention in MariaDB vs a separate store, and how the
self-signed signing certificate is generated, stored, rotated and pushed to
machines (GPO/Intune instructions).

Inventory (9) makes every computer running the agent an Asset and tracks
how long it has been owned and in service; its spec must define "in
service" (from deployment to retirement, and whether repair time counts).
The tray app (9b) is the first piece of agent code that runs in the user's
session rather than as a service, so it introduces the user-session helper
that remote desktop (18b) later reuses. Its spec must settle how the
logged-in Windows user is matched to a contact (directory account or email,
and what happens when there is no match), how the helper authenticates
through the agent without a separate login, what the health snapshot
contains, and screenshot privacy (taken only when the user asks, and shown
to them before it is sent).

**Phase 3 — Money (`v0.6.0`).** Rates and timesheets (10), catalog and
procurement (11), agreements (12), billing and payments (13), sales (14),
project billing (15). Open questions: payment processor (Stripe is the
default assumption), accounting connectors (QuickBooks Online and Xero first),
and how agreement coverage rules decide billable vs covered time.

**Phase 4 — RMM, the rest (`v0.7.0`).** Scripting (16), patching (17),
remote shell and file transfer (18a), remote desktop (18b), macOS and Linux
(19). Remote access is PRISM's own code, using open-source libraries rather
than a separate app: 18a runs over the agent's existing gateway connection;
18b captures the screen with the Windows capture API, streams it to the
technician's browser over WebRTC (Go's Pion library), and relays through the
gateway when a direct connection fails. 18b's spec must settle the
user-session helper (the agent service cannot see the desktop), login and
UAC screens, multi-monitor, clipboard, and the end-user consent prompt.

**Phase 5 — Docs and reporting (`v0.8.0`).** Client IT documentation and a
credential vault (20, reusing `tokenCrypto`), MSP reporting (21) and
integrations (22).

## Risks

- **Phase 1 is large.** Seven sub-projects in one release. Mitigation: each
  sub-project is shipped to `dev` and usable on its own; the release waits
  for all seven, the work does not.
- **The time-ledger migration touches real data.** Mitigation: it is tested
  against a copy of real rows, keeps the old tables until the migration is
  verified, and has a tested `down()`.
- **Agent security.** Mitigated by the rules in §5 and a security review
  before Phase 2 ships.
- **A self-signed agent can be flagged by antivirus**, and a hand-downloaded
  installer on an unmanaged machine shows a SmartScreen warning.
  Mitigation: deploy through GPO/Intune/scripts, submit each agent release
  to Microsoft's free false-positive portal, and keep a paid certificate as
  a drop-in fallback.
- **Remote desktop (18b) is the hardest single piece.** It ships after 18a so
  a useful remote tool exists even if 18b runs long.
- **Scope creep inside each phase.** The specs keep a written out-of-scope
  list, and testing feedback goes through the phase's feedback list rather
  than straight into code.
