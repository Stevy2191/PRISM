# Sub-project 8 — PRISM agent: inventory and the tray app

> Status: design drafted 2026-11-03 from the owner's answers in conversation;
> waiting for the owner's review of the "Decisions to confirm" below before
> the plan is written. Roadmap rows: 8 and 9b in `docs/ROADMAP.md`.
> Reshapes Phase 2: this is the agent without the rest of RMM.

## Intent

Every computer should show up in Assets by itself, with its hardware, OS,
software, network details and usual user kept current, and the people using
those computers should be able to raise a ticket in two clicks from the
system tray without signing in to anything.

That is the PRISM agent: a small Windows service plus a tray app, installed
together. It is the foundation the rest of RMM (monitoring, scripting,
patching, remote access) builds on later, but none of that is in this
sub-project.

## Goals

1. **Enrol a computer** into a company with one install command (GPO, Intune
   or by hand). It becomes an Asset of that company, or claims the existing
   Asset with the same serial number.
2. **Inventory**, refreshed every 6 hours and at service start, into the
   Asset:
   - Hardware: make, model, serial number, CPU (model, cores), memory total,
     each disk's size and free space, BIOS/firmware version.
   - OS: name, edition, version and build (e.g. "Windows 11 Pro", 24H2,
     26100.2314).
   - Network: computer name, domain or workgroup, each active adapter's IPv4
     and MAC address.
   - Installed software: name, version, publisher, install date.
   - Logged-in user: the interactive user's account, matched to a contact.
3. **Online status**: a heartbeat every 5 minutes. Assets show *Online* or
   *Last seen …*.
4. **Tray app**: one click opens a short ticket form, pre-filled with who the
   user is, their company and department, and the computer. The ticket is
   linked to the computer's Asset and carries a **health snapshot**.
5. **Signed updates**: agents update themselves, only to builds signed with
   the install's own update key.

## Non-goals (later sub-projects)

- Checks, monitoring and alerts that open tickets (was in roadmap row 9).
- Scripting, patching, remote shell, remote desktop (Phase 4).
- A separate internet-facing gateway service: agents talk to PRISM's own
  address for now (decided 2026-11-03). Remote access will need the gateway.
- macOS and Linux agents (row 19). The agent is written in Go so they follow.
- The tray app's screenshot button and "My tickets" list (not chosen for v1).

## How it fits together

```
 Windows PC                                   PRISM (existing server)
 ┌──────────────────────────────┐            ┌─────────────────────────────┐
 │ PRISM Agent service (SYSTEM) │── HTTPS ──▶│ /api/v1/agent/*             │
 │  enrol, heartbeat, inventory │  mTLS-like │  enrol, heartbeat,          │
 │  updates, ticket relay       │  device    │  inventory, tickets,        │
 └──────────────▲───────────────┘  cert      │  updates                    │
                │ named pipe (local only)    │ Assets, Contacts, Tickets   │
 ┌──────────────┴───────────────┐            └─────────────────────────────┘
 │ PRISM tray (per user)        │
 │  ticket form, health snapshot│
 └──────────────────────────────┘
```

- **One Go codebase**, two binaries: `prism-agent.exe` (a Windows service
  running as SYSTEM) and `prism-tray.exe` (started at user sign-in). One MSI
  installs both.
- The **tray never talks to PRISM**. It sends the ticket to the service over
  a local named pipe; the service identifies the Windows user from the pipe's
  client token (not from anything the tray says) and relays the ticket with
  the computer's identity. So there is no login, and a user can't raise a
  ticket as someone else.

## Enrolment and identity

- Staff create an **enrolment key** per company (company page → new
  **Devices** tab, or Settings → Agent). It is a long random secret, shown
  once, stored hashed, revocable, optionally expiring.
- Install: `msiexec /i prism-agent.msi /qn PRISM_URL=https://desk.example.com
  ENROLL_KEY=…` (the same command works from GPO or Intune).
- On first start the service generates a key pair (private key in the
  machine's Windows certificate store, not exportable) and sends `enroll`
  with the key, its public key and the hardware identity. PRISM answers with
  a **device certificate** signed by PRISM's own agent CA and a device ID.
- Every later call is signed with that device key: PRISM verifies the request
  signature against the stored public key and the certificate's validity.
  (Implemented as signed requests over ordinary HTTPS, because the server
  normally sits behind a reverse proxy that terminates TLS, where true mutual
  TLS needs proxy changes. Same guarantee: only the enrolled machine can
  speak for itself.)
- Staff can **revoke** a device (it stops being accepted at once) or
  **re-enrol** it.
- **Asset matching on enrol:** an Asset of that company with the same serial
  number is claimed (no duplicate); otherwise a new Asset is created in the
  company's "Computers" category with the next asset tag.

## Inventory into Assets

- Fills the Asset's existing fields: name (computer name), make, model,
  serial number, processor, RAM, storage (total and free summary),
  operating system, OS version, firmware version, IP and MAC (the primary
  adapter).
- New: per-disk detail, all adapters, domain/workgroup, last boot, the
  software list, last seen, agent version — on a new **Device** record linked
  1:1 to the Asset, shown as a **Device** tab on the Asset page.
- **Software**: an `AssetSoftware` table (name, version, publisher, install
  date), replaced as a whole on each inventory; the Asset page lists and
  searches it. (License tracking against it is a later step.)
- **Who uses it:** the logged-in user's UPN or email is matched to a contact
  **of the Asset's company** (by Microsoft object ID if 7b linked them, else
  email). A match sets the Asset's **assigned contact** unless staff set one
  by hand (hand-set wins; shown as "Usually used by"). No contact is created.
- The agent owns the fields it reports: a staff edit to them is overwritten
  at the next inventory, and the edit form says so for an agent-managed
  Asset. Everything else on the Asset (location, purchase, warranty, notes)
  stays staff-owned.
- A computer not heard from for 14 days is flagged *Stale* on the Assets
  list; nothing is retired automatically.

## The tray app

- An icon in the notification area. Click → **Get help** window (WebView2,
  which every supported Windows has): name, company and computer already
  filled in (read-only), a **subject**, a **description**, and **Send**.
- The ticket is created as source `agent`, linked to the Asset, with the
  matched contact as requester. If the user matches no contact, the ticket
  has no contact and says "Raised from PC-1234 by CONTOSO\jsmith" so staff
  can set one (the same rule as inbound email: no contact is invented).
- **Health snapshot** added to the ticket as a private note: OS and build,
  uptime, free space per disk, memory in use, signed-in domain and user,
  IP addresses, agent version, time taken.
- Offline: the tray says the help desk can't be reached and shows the
  portal address and support email from PRISM's branding.

## Updates

- Each install has an **update signing key** (Ed25519) generated on first
  start; agents receive its public key at enrolment.
- Agent builds are produced in CI (Go cross-compile; MSI with WiX on a
  Windows runner), and PRISM serves the latest MSI with a signature it makes
  with the install's key. The agent checks on each heartbeat, verifies the
  signature and the version, and installs.
- **Code signing** stays as decided on 2026-10-03: PRISM signs the binaries
  with its own certificate, and admins push trust for it via GPO/Intune. A
  paid certificate stays a drop-in option.

## Security

- Enrolment keys: random, hashed, revocable, per company; an enrolment
  can only create or claim Assets in that key's company.
- Device requests are signed per device; a revoked device is refused at once;
  request bodies are size-limited and rate-limited per device.
- The agent accepts **no commands** from PRISM in this sub-project other than
  "update available". It is read-and-report only.
- The tray's identity comes from the Windows session (pipe client token), so
  a user can't forge another user's ticket.
- Inventory is data, not instructions: names and versions are stored as
  text and escaped everywhere they are shown.
- New permissions: **Manage devices** (enrolment keys, revoke) for the
  System Administrator role; viewing devices follows Assets' existing view
  permission and company access.

## Staff screens (mockups first, as in 6b and 7)

- Company page → **Devices** tab: enrolment keys (create, copy install
  command, revoke) and the company's devices (online / last seen, agent
  version, revoke).
- Asset page → **Device** tab: the live inventory, the software list, last
  seen.
- Assets list: an **Online** column and an "Agent-managed" filter.
- Ticket page: an Asset chip for agent tickets; the health snapshot note.

## Decisions to confirm

1. **Phase 2 reshaped** to this sub-project (agent, inventory and tray, rows
   8 and 9b), released as `v0.5.0`. Monitoring and alerts (old row 9) move to
   Phase 4 with the rest of RMM.
2. **Signed requests instead of strict mutual TLS**, because of the reverse
   proxy (see Enrolment). Mutual TLS can be added when the gateway arrives.
3. **Agent-owned fields** overwrite staff edits on agent-managed Assets.
4. **Inventory every 6 hours, heartbeat every 5 minutes, stale after 14
   days.**
5. **Phase 1 fixes during this work** ship from a `release/0.4` branch cut
   from `main`, so v0.4.x patches never include unfinished agent code. (Needs
   the owner's go-ahead to push that branch.)

## Done when

- An MSI built in CI installs silently from one command, enrols, and the
  computer appears as an Asset of the right company with its hardware, OS,
  network, software and usual user, and shows Online.
- The tray raises a linked ticket with the health snapshot, as the signed-in
  user's contact.
- A revoked device is refused; an update signed with another key is refused.
- Backend tests cover enrolment, signatures, revocation, inventory mapping,
  contact matching and tray tickets; Go tests cover collection parsing and
  the update check; a smoke test covers the new screens.
