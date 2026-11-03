# PRISM agent 8a — the server side and Windows: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows computer gets the PRISM agent from one silent MSI command, enrols into a company, and appears as an Asset with its hardware, OS, network, software, usual user and online status, kept current. Its tray's **Submit a ticket** raises a ticket linked to that Asset with a health snapshot. Agents update themselves, but only to builds signed by the install. macOS (8b) and Linux (8c) follow on the same server side.

**Architecture:**
- **Server:** a new `/api/v1/agent/*` API in the existing backend, outside the staff session.
  - Enrolment uses a per-company key, stored hashed.
  - Each device registers an Ed25519 public key, and every later request is signed with it.
  - Inventory maps into the existing Asset fields, plus a `Device` record and an `AssetSoftware` table.
  - Tray tickets come in through the service with the computer's identity.
  - Updates are packages built in CI, baked into the backend image, and signed at startup with the install's own Ed25519 key.
- **Agent:** one Go module at `agent/` with two programs, `prism-agent` (a Windows service) and `prism-tray` (per user). They talk over a named pipe, and the service identifies the user from the pipe's client token.

**Tech Stack:**
- **Backend:** Node 24, Express, Sequelize, MariaDB (as before). Node's built-in `crypto` does Ed25519, so no new npm dependency is needed.
- **Agent:** Go 1.23 with these modules:
  - `golang.org/x/sys/windows` (service, WTS, DPAPI, registry)
  - `github.com/yusufpapurcu/wmi` (WMI)
  - `github.com/Microsoft/go-winio` (named pipe)
  - `fyne.io/systray` (tray)
  - `github.com/webview/webview_go` (WebView2)
- **Packaging:** WiX 4 on a `windows-latest` runner.

**Spec:** `docs/superpowers/specs/2026-11-03-agent-inventory-tray-design.md`
**Mockups:** `docs/mockups/agent-8/` (approved 2026-11-03). Boards: `Main` (company Devices), `AssetDevice`, `AssetSoftware`, `AssetsList`, `TicketAgent`, `TrayWindows`, `TrayForm`, `TraySent`.

## Global Constraints

- **Read-and-report only.** The agent runs no commands from PRISM. The only thing it acts on is "update available", and only for a package whose Ed25519 signature verifies against the install key it got at enrolment.
- **Device identity is a signed request**, not a session or bearer token:
  - headers `X-Prism-Device`, `X-Prism-Timestamp` (within ±5 minutes), `X-Prism-Nonce` (single-use, kept 10 minutes), `X-Prism-Signature`.
  - The signature covers `METHOD\npath?query\ntimestamp\nnonce\nsha256(body)`.
  - A revoked or unknown device is refused at once.
- **Enrolment keys** are 32 random bytes, shown once, stored as a sha256. They can be revoked or expire. An enrolment creates or claims Assets only in its key's company.
- **Agent-owned Asset fields** are overwritten at every inventory: name, make, model, serial number, processor, RAM, storage, OS, OS version, firmware version, IP and MAC. Everything else stays staff-owned. Usual user: a hand-set assigned contact wins.
- **No real person's contact is ever created** from the agent, whether from inventory or a tray ticket. The one exception is a single placeholder contact per company, **"Unknown tray user"**, created when first needed. Tray tickets from people with no matching contact use it as requester, and staff then reassign them (owner, 2026-11-03). The placeholder has no email and no portal access, and is never matched by inventory.
- **Inventory is untrusted text.** It's size-limited (256 KB a request, 5,000 software rows), stored as text, and escaped wherever it's shown.
- **Rate limits per device:** heartbeat 1 a minute, inventory 1 every 10 minutes, tray tickets 10 an hour.
- **Timings:** heartbeat every 5 minutes, inventory every 6 hours and at service start. "Online" means a heartbeat within 10 minutes; "stale" means silent for 14 days.
- **Go code is split by platform** with build tags (`_windows.go`, plus `_darwin.go` and `_linux.go` stubs that return "not yet"), so 8b and 8c only add files.
- **Everything from earlier sub-projects still applies:** company fences, audit, look A, Node 24, one migration (074) with a round-trip test, and both suites once before each push. Go tests run in CI on `ubuntu-latest` (shared code) and `windows-latest` (Windows code).

## Review Focus

- **Replay and forgery:** a request with an old timestamp, a reused nonce, a body changed after signing, or another device's ID is refused → Task 3.
- **Enrolment scope:** a key from company A can never create or claim an Asset in company B, even when the serial number matches one there → Task 2.
- **Tray identity:** the ticket's requester comes from the named pipe's client token, never from what the tray sends → Task 9.
- **Update trust:** a package signed with another install's key, a wrong hash, or a lower version is refused, and the agent keeps running → Tasks 6 and 10.
- **Key storage:** the device private key is readable only by SYSTEM (DPAPI machine scope plus a SYSTEM-only ACL) → Task 7.

---

### Task 1: Data model, permission and settings

**Files:**
- Create: `backend/migrations/20260101000074-agent.js`, and the models `AgentEnrollmentKey.js`, `Device.js`, `AssetSoftware.js`, `AgentNonce.js`
- Modify: `backend/src/models/Ticket.js` (source enum gains `agent`), `index.js` (associations)
- Test: `backend/test/integration/agent.model.test.js` (+ round trip for 074)

**Interfaces — Produces:**
- `AgentEnrollmentKey { id, companyId, name, keyHash(64) unique, createdById, expiresAt null, revokedAt null, enrolledCount, createdAt }`
- `Device { id, assetId unique, companyId, enrollmentKeyId null, publicKey(64, base64 raw Ed25519), platform ENUM('windows','macos','linux'), arch, agentVersion, hostname, lastSeenAt, lastInventoryAt, revokedAt null, inventory JSON (disks, adapters, domain, lastBootAt, signedInUser), createdAt, updatedAt }`
- `AssetSoftware { id, assetId, name(255), version(100), publisher(255), installDate DATEONLY null }`, indexed `(assetId)` and `(name)`.
- `AgentNonce { deviceId, nonce(32), seenAt }`, unique `(deviceId, nonce)`. Pruned when older than 10 minutes.
- `Tickets.source` gains `'agent'`.
- New permission `devices.manage` ("Manage devices": enrolment keys, revoke), held by System Administrator.
- New setting `agent.updateKey`, created at first use: an Ed25519 private key, encrypted with `tokenCrypto`, never returned by the API.

- [x] **Step 1: Failing tests:** one Device per Asset; nonce pair unique; `devices.manage` is held by System Administrator only; a ticket can be saved with source `agent`; down → up round trip (keeping 073's index rules in mind).
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (apply 074 to the test DB).
- [x] **Step 5: Commit** `feat(agent): devices, enrolment keys, software and the agent ticket source`

**As built (2026-11-03):**
- The enrolment key hides `keyHash` by default (`scope('withHash')` reads it).
- `devices.manage` sits in the `assets` permission category.
- Migration 074's rollback turns tray tickets into `manual` ones rather than deleting them.
- `companies.migration.test.js` now rolls back 074 around 048 as well.
- **Found for Task 5:** every ticket must have a contact (`ticketWrite`: "A contact is required"), so a tray ticket from someone with no matching contact can't be saved without a requester as planned. The owner decides how Task 5 handles that.

### Task 2: Enrolment keys and enrolment

**Files:**
- Create: `backend/src/services/agent/enrollment.js`, `backend/src/controllers/agentKeysController.js`, `backend/src/routes/agent.js` (mounted at `/api/v1/agent`, no staff session)
- Modify: `backend/src/routes/companies.js` (key routes), `backend/src/routes/index.js`
- Test: `backend/test/integration/agent.enroll.test.js`

**Interfaces — Produces:**
- Staff routes (`devices.manage` plus the company fence):
  - `GET /companies/:id/agent-keys` → `{ keys }` (never the secret).
  - `POST /companies/:id/agent-keys { name, expiresAt? }` → `{ key, secret }`, the secret shown once (`pk_enr_` + base64url).
  - `POST /companies/:id/agent-keys/:keyId/revoke`.
- Agent route: `POST /agent/v1/enroll { enrollKey, publicKey, platform, arch, agentVersion, hostname, serialNumber, make, model }` → `{ deviceId, updatePublicKey, intervals: { heartbeatSec, inventorySec } }`.
- Claims an Asset in the key's company with the same serial number (case and spaces ignored) that has no live Device. Otherwise it creates an Asset in "Computers" with `suggestNextAssetTag`.
- Re-enrolling a revoked device's Asset replaces that Device record (new key, revocation cleared, audited).
- Audit: `agent.key_created`, `agent.key_revoked`, `agent.enrolled`.

- [x] **Step 1: Failing tests:** enrolment with a revoked, expired or unknown key → 401 and nothing created; a new serial makes a Computers Asset in the key's company; a matching serial in the same company is claimed (no duplicate); a matching serial in another company is ignored and a new Asset is made; the secret never comes back after creation; a staff member without access to the company can't list or create keys.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): enrolment keys and device enrolment`

**As built (2026-11-03):**
- **Placeholder serials never match.** Makers' stand-ins such as "To be filled by O.E.M.", "Default string" and "0" never claim an Asset.
- **Simultaneous enrolments.** Computers enrolling at the same moment (a Group Policy rollout) can clash on the next asset tag, or on claiming the same Asset. Enrolment retries up to 5 times on a unique-index clash.
- **New limiter.** `agentEnrollLimiter` allows 600 attempts per 15 minutes per IP. It's generous because a rollout comes from one office address, and the 256-bit key is the real guard.
- **Revoking a key** only stops new enrolments. Computers already enrolled with it keep working; a computer is revoked on its own (Task 12).
- **No update key yet.** `updatePublicKey` is `null` until Task 6.
- **Placement.** The staff routes live in `routes/companies.js` and need `devices.manage` plus the company fence. The agent routes are in `routes/agent.js`, mounted outside the staff guard.

### Task 3: Signed requests and the heartbeat

**Files:**
- Create: `backend/src/middleware/agentAuth.js`, `backend/test/integration/agentClient.js` (a test helper that signs like the agent)
- Modify: `backend/src/routes/agent.js`, `backend/src/middleware/rateLimit.js`
- Test: `backend/test/integration/agent.auth.test.js`

**Interfaces — Produces:**
- `agentAuthenticate` sets `req.device`. It checks the device exists and isn't revoked, the timestamp is within ±5 minutes, the nonce is unused (then records it), and the signature verifies with `crypto.verify(null, canonical, publicKey, sig)`. The canonical string is built from the raw body, so `express.json({ verify })` keeps the raw buffer for agent routes.
- `POST /agent/v1/heartbeat { agentVersion, signedInUser? }` → `{ update: null | { version } }`. It sets `lastSeenAt` and the version.

- [x] **Step 1: Failing tests:** a valid signature → 200; an old timestamp, a reused nonce, a changed body, another device's ID, or a revoked device → 401 `AGENT_UNAUTHORIZED`; a second heartbeat within a minute → 429; the staff and portal sessions aren't read on agent routes.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): signed device requests and the heartbeat`

**As built (2026-11-03):**
- **Header format.** The timestamp is unix seconds. The nonce is 16 to 32 base64url characters. The signature is a 64-byte Ed25519 signature in base64. The path that's signed is `req.originalUrl`, the full `/api/v1/agent/...` path with its query string.
- **Order of checks.** Header format, the time window, then the device (exists and isn't revoked), then the signature, and only then the nonce is recorded. Anyone without the key can't fill the nonce table, and every refusal is the same 401 `AGENT_UNAUTHORIZED`.
- **Pruning.** Nonces older than 10 minutes are deleted, at most once a minute.
- **Raw body.** It's kept only for `/api/v1/agent/` paths (the `express.json` `verify` hook in `app.js`). Agent requests are capped at 256 KB, giving 413.
- **Heartbeat limit.** It's 2 a minute per device, not 1, leaving room for one retry after a network blip. It also records the signed-in account in `Device.inventory.signedInUser`.
- **Shared signing vector.** `agent/testdata/signing.json` holds a fixed seed, request, canonical string and signature. The seed is RFC 8032 test 1, so its public key is the RFC's. The Node test checks it now, and the Go agent checks the same file in Task 7.

### Task 4: Inventory into Assets

**Files:**
- Create: `backend/src/services/agent/inventory.js`
- Modify: `backend/src/routes/agent.js` (`POST /agent/v1/inventory`)
- Test: `backend/test/integration/agent.inventory.test.js`

**Interfaces — Produces:**
- `applyInventory(device, payload) → { changedFields, software: { added, removed } }`.
- Payload: `{ hostname, make, model, serialNumber, cpu: { model, cores }, memoryBytes, disks: [{ name, label, kind, sizeBytes, freeBytes }], firmware, os: { name, edition, version, build }, domain, lastBootAt, adapters: [{ name, ipv4: [], mac, primary }], software: [{ name, version, publisher, installDate }], signedInUser: { account, upn?, email? } }`.
- Validation is strict. Unknown keys are dropped and strings are cut to the column sizes.
- Mapping:
  - The Asset's own fields as listed under Global Constraints.
  - `storage` = "476 GB (212 GB free)", `ram` = "16 GB".
  - `operatingSystem` = "Windows 11 Pro", `osVersion` = "24H2 (26100.2314)".
  - Everything else goes in `Device.inventory`.
- Software is replaced as a whole, in one transaction.
- Usual user: the UPN or email is matched to a contact of the Asset's company (Microsoft object ID first, then email). It sets `assignedToContactId` only when that is empty or was set by the agent, which is tracked with `Device.inventory.assignedBy = 'agent'`.

- [x] **Step 1: Failing tests:** fields map (with fixtures from a real Windows 11 and a Windows 10 machine); a staff edit to an agent field is overwritten, but location and notes are kept; 5,001 software rows → 413; software is replaced, not appended; the signed-in user matches a contact in the company, never one in another company; a hand-set assigned contact is kept; a user with no match leaves the assignment alone.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): inventory into Assets, software and the usual user`

**As built (2026-11-03):**
- **Request size.** Inventory may be up to 1 MB: `agentAuth({ maxBody })` sets the cap per route, and other agent routes stay at 256 KB. A list of 5,000 programs doesn't fit in 256 KB.
- **Rate limit.** 3 inventories per 10 minutes per device, allowing a few service restarts.
- **Formats.**
  - `processor` = "13th Gen Intel(R) Core(TM) i5-13500 (14 cores)".
  - `storage` counts internal disks only: external USB or removable drives are left out when there's an internal one, giving "476 GB (212 GB free)". Every disk is still kept in `Device.inventory.disks`.
  - `osVersion` = "24H2 (26100.2314)". MAC addresses are normalised to `AA:BB:…`.
- **Missing values.** A value the agent couldn't read (an empty serial number, say) leaves the field unchanged.
- **Usual user.** A hand-set contact is recognised as any assigned contact that isn't the one the agent set last time (`Device.inventory.agentAssignedContactId`).
- **Placeholder.** The Task 5 placeholder will be skipped by the `isPlaceholder` filter once that column exists.
- **Software.** Programs with the same name and version are counted once. Windows' `YYYYMMDD` install dates are read.
- **Asset activity.** An `agent_inventory` entry is logged only when an Asset field changed, not every 6 hours.

### Task 5: Tickets from the tray

**Files:**
- Create: `backend/src/services/agent/trayTickets.js`
- Modify: `backend/src/routes/agent.js` (`GET /agent/v1/tray/whoami`, `POST /agent/v1/tray/tickets`)
- Test: `backend/test/integration/agent.tray.test.js`

**Interfaces — Produces:**
- `GET /agent/v1/tray/whoami?account=` → `{ name, company, department, computer, helpdesk: { name, email, portalUrl } }`, used to fill the form. The service passes the account taken from the pipe token.
- `POST /agent/v1/tray/tickets { account, upn?, subject, description, snapshot }` → `{ ticketId, number }`.
  - Creates a ticket with `source: 'agent'` in the device's company, links the Asset (`AssetTicket`), sets the requester to the matched contact, and runs the normal new-ticket path (SLA, workflow rules, notifications).
  - With no matching contact, the requester is the company's **Unknown tray user** placeholder, created on first use and marked `Contact.isPlaceholder = true` (a small migration 075 in this task adds the column, with a round-trip test). The placeholder has no email, portal access off, and is skipped by inventory matching, the portal, imports and merge suggestions. The ticket's description starts "Raised from RFC-FD-01 by RIVERSIDE\mchen", so staff can set the right person.
  - The snapshot becomes a private note headed "Health snapshot".

- [x] **Step 1: Failing tests:** a ticket is created and linked with the matched contact; with no match, the requester is the company's one placeholder (created once, reused, with no email and no portal access), and no other contact is created; the snapshot note is private; the subject is required (400); the 11th ticket in an hour → 429; a ticket can't be raised for another company's contact.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): tickets from the tray with a health snapshot`

**As built (2026-11-03):**
- **Shared ticket path.** `createTicket` takes `source: 'agent'` with a contact the caller already checked (`portal: { contact }`), as the portal does, so the system actor's scope isn't used to look it up. Everything else (SLA, workflow rules, notifications, Asset link and its activity) is the normal path.
- **Placeholder.** "Unknown tray user" (first name Unknown, last name tray user), no email, portal access off, a note saying what it is. Created on first use inside a transaction that locks the company row, so two tickets at once make one. Inventory matching filters `isPlaceholder: false`. Imports, merges and the portal need no change: they match by email, and the placeholder has none.
- **Description.** A matched user's ticket keeps their description as written. A placeholder ticket starts "Raised from RFC-FD-01 by RIVERSIDE\mchen", then a blank line, then the description.
- **Snapshot note.** A private note: "Health snapshot from <computer>", then one line each for OS and build, uptime, memory in use, free space per disk, signed-in user, domain, directory or realm, IP addresses, agent version and the time taken. Lines with nothing to show are left out. A snapshot that isn't an object gives just the heading.
- **whoami.** Takes `account` and `upn`. With no match, `name` is the account name and nothing is created. `helpdesk.name` is the organisation name; `email` is the inbound email address when inbound email is on; `portalUrl` is `PUBLIC_APP_URL/portal` when the portal is on (otherwise null). There is no separate support-email setting.
- **Rate limit.** 10 tray tickets an hour per device.

### Task 6: Signed updates (server)

**Files:**
- Create: `backend/src/services/agent/updates.js`
- Modify: `backend/src/routes/agent.js` (`GET /agent/v1/update`, `GET /agent/v1/update/download`), `backend/Dockerfile` (copy `agent-dist/` from the CI build)
- Test: `backend/test/integration/agent.update.test.js`

**Interfaces — Produces:**
- The packages directory comes from `AGENT_DIST_DIR` (default `/app/agent-dist`): `manifest.json` lists `[{ platform, arch, version, file, sha256 }]`.
- `updateKey()` generates and stores `agent.updateKey` on first use, and returns `{ publicKeyB64, sign(buf) }`.
- `GET /agent/v1/update?platform&arch` (signed) → `{ version, sha256, size, signature }`, where the signature is Ed25519 over `platform|arch|version|sha256`. It returns 204 when the agent is up to date.
- The heartbeat's `update` field is filled from this when a newer version exists.
- Download streams the file (signed request), so no package is public.

- [x] **Step 1: Failing tests:** the key is generated once and its private half never appears in any response; the update signature verifies with the public key returned at enrolment; an equal or older version → 204; a missing file → 404 with nothing signed; download needs a valid device signature.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): signed agent updates served by PRISM`

**As built (2026-11-03):**
- **The key.** `agent.updateKey` holds the 32-byte Ed25519 seed, encrypted with `tokenCrypto` like other stored secrets. It is never in `DEFAULTS`, so no settings endpoint returns it. Two first uses at the same moment agree on whichever was stored (the unique-key clash is caught and re-read). Enrolment now returns `updatePublicKey`.
- **Platform and arch** come from the device record, as enrolled, not from query parameters: a device can only be offered its own builds.
- **Checks before signing.** Each manifest entry must have a plain file name (no folders, no `..`), a `x.y.z[-pre]` version and a 64-hex sha256. The newest entry's file must exist and hash to its listed sha256; otherwise `GET /v1/update` and the download are 404 and nothing is signed. The heartbeat treats that as no update instead of failing. File hashes are cached by size and modification time.
- **Versions** compare numerically; a pre-release sorts before its release (0.6.0-rc.2 < 0.6.0).
- **Download** sends `X-Prism-Version` and `X-Prism-Sha256` headers, as `application/octet-stream`.
- **Image.** `AGENT_DIST_DIR=/app/agent-dist`, created empty in the Dockerfile; CI (task 11) puts the packages in `backend/agent-dist/` before the image build. That folder is git-ignored.
- **Not yet:** separate .deb and .rpm packages for Linux need a package format alongside platform and arch. That comes with 8c.

### Task 7: The Go agent's core

**Files:**
- Create: `agent/go.mod`, plus packages:
  - `agent/internal/config` (file `C:\ProgramData\PRISM\agent.json`; Linux and macOS paths stubbed)
  - `agent/internal/keystore` (`keystore_windows.go`: Ed25519 key in a DPAPI-protected file with a SYSTEM-only ACL)
  - `agent/internal/client` (signed HTTP client, retries with backoff and jitter, and the CA bundle from the system store)
  - `agent/internal/schedule` (heartbeat and inventory loops)
  - `agent/cmd/prism-agent/main.go` (commands: `run` for the service, `enroll --url --key`, `collect --json`, `status`)
- Test: `agent/internal/client/client_test.go`, `agent/internal/schedule/schedule_test.go`

**Interfaces — Produces:**
- `client.Sign(method, pathQuery, ts, nonce, body) string`. It must match `agentClient.js` byte for byte; a shared test vector JSON at `agent/testdata/signing.json` is checked by both the Go and Node tests.
- `enroll` sends the payload from Task 2 and saves `{ url, deviceId, updatePublicKey }`.

- [x] **Step 1: Failing tests:** the shared signing vector matches in Go and in Node; enrolment against a fake server saves the config, and is refused without the key; the loops honour intervals and back off on 5xx and 429; the keystore round trip (Windows CI).
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS (`go test ./...` on `ubuntu-latest` and `windows-latest`).
- [x] **Step 5: Commit** `feat(agent): Go agent core: config, keys, signed client, schedules`

**As built (2026-11-03):**
- **Module** `github.com/stevy2191/prism/agent`, Go 1.24. Its one dependency is `golang.org/x/sys` (Windows APIs). The version is stamped with `-ldflags -X …/internal/version.Version=…` and defaults to `dev`.
- **Packages:**
  - `config`: `agent.json` in `C:\ProgramData\PRISM` (Linux `/var/lib/prism-agent`, macOS `/Library/Application Support/PRISM`), or `PRISM_AGENT_DIR` when set. Written atomically. Intervals are clamped to at least 1 minute (heartbeat) and 15 minutes (inventory), with defaults of 5 minutes and 6 hours.
  - `keystore`: `device.key`. On Windows, DPAPI with machine scope (so what an elevated installer wrote, the SYSTEM service can read) plus a SYSTEM-only, non-inherited ACL `D:P(A;;FA;;;SY)`, which is what keeps other local processes out. On macOS and Linux, a 0600 file until 8b and 8c.
  - `client`: `Canonical`, `Sign`, `PublicKeyB64`, `NewNonce` (22 base64url characters). Every attempt gets a fresh timestamp and nonce. Network errors, 5xx and 429 are retried (3 attempts, backoff from 2 s with jitter in [½·ceiling, ceiling], honouring `Retry-After`); other 4xx are not. TLS uses the OS certificate store (Go's default).
  - `enroll`: needs an `https://` address (`http://` only for localhost) and a key starting `pk_enr_`, otherwise nothing is sent. The new key is staged in `<dir>.enrolling` and moved in only after PRISM accepts it, so a refused enrolment leaves any earlier one untouched.
  - `schedule`: one loop per job. Success waits the interval. A retryable failure backs off from `RetryBase` (heartbeat 30 s, inventory 2 min), doubling up to the interval. A refusal (revoked, bad request) waits the full interval. The inventory's first run is delayed 1–2 minutes at random, to spread out an office's agents after a reboot.
- **Commands:** `enroll`, `run` (foreground until Ctrl+C or SIGTERM; becomes the Windows service in Task 8), `collect --json`, `status`, `version`. `collect` sends only the hostname until Task 8 fills the inventory.
- **Windows tests:** a test process isn't SYSTEM, so `TestSystemOnlyACL` checks the real ACL and that the test can't read the key. The round-trip tests widen the ACL to the test's own user through `AllowCurrentUserForTests` (never called by the agent).
- **CI:** an `agent` job in `test.yml` runs `go vet` and `go test -race` on `ubuntu-latest` and `windows-latest`.
- **Checked end to end** against the real backend: a wrong key was refused; then enrol, a signed heartbeat (the device's version and last-seen time updated) and a signed inventory (`lastInventoryAt` set).

### Task 8: Windows inventory and the service

**Files:**
- Create: `agent/internal/inventory/` with `inventory.go` (shared types), `windows.go` (WMI: `Win32_ComputerSystem`, `Win32_BIOS`, `Win32_Processor`, `Win32_LogicalDisk`, `Win32_OperatingSystem`, `Win32_NetworkAdapterConfiguration`; software from the two Uninstall registry hives, 64-bit and 32-bit, without duplicates; signed-in user from `WTSQuerySessionInformation` for the active console session; domain from `NetGetJoinInformation`), and `agent/internal/service/service_windows.go` (`golang.org/x/sys/windows/svc`)
- Test: `agent/internal/inventory/windows_test.go` (parses captured fixtures; one live test on `windows-latest` that `collect` returns a serial, OS and at least one disk)

- [ ] **Step 1: Failing tests:** fixture parsing gives the payload shape from Task 4; software has no duplicates across the hives and skips updates and system components; OS edition and build come out as "Windows 11 Pro", "24H2 (26100.2314)"; `collect --json` on the runner is valid against the schema.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): Windows inventory and the Windows service`

### Task 9: The tray and Submit a ticket (Windows)

**Files:**
- Create: `agent/internal/ipc/pipe_windows.go` (`\\.\pipe\prism-agent`, ACL: interactive users; the client's account comes from `ImpersonateNamedPipeClient` and the thread token, then reverting), `agent/cmd/prism-tray/main.go` (`fyne.io/systray`: **Submit a ticket**, Open the support portal, a status line, About), `agent/internal/trayui/` (the form as embedded HTML and CSS per the `TrayForm` and `TraySent` boards, shown in WebView2 and following the system's light or dark setting)
- Test: `agent/internal/ipc/pipe_windows_test.go`, `agent/internal/trayui/form_test.go`

**Interfaces — Produces:**
- Pipe messages (JSON lines): `whoami` → the Task 5 answer; `submit { subject, description }` → `{ number }` or `{ error: 'offline' | 'refused' }`.
- The service adds `account` and `upn` from the token, and the snapshot it collects itself. It never accepts either from the tray.
- When offline, the draft is kept in `%LOCALAPPDATA%\PRISM\draft.json` and **Try again** is offered (TraySent board).

- [ ] **Step 1: Failing tests:** a `submit` with an `account` field in the message is ignored in favour of the token's; the snapshot has the fields from the spec; an offline answer keeps the draft; the form escapes the help desk name and the computer name.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): tray app and Submit a ticket on Windows`

### Task 10: Self-update (Windows)

**Files:** Create `agent/internal/update/update.go` and `update_windows.go` (download to `C:\ProgramData\PRISM\updates`, check sha256 and the Ed25519 signature with the stored public key, check the version is higher, then run `msiexec /i … /qn` detached so the service restarts itself). Test: `agent/internal/update/update_test.go`.

- [ ] **Step 1: Failing tests:** a good package is accepted; another key's signature, a hash mismatch, or a lower or equal version is refused and the file deleted; a refused update leaves the running version and is logged.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): signed self-update on Windows`

### Task 11: The MSI and CI

**Files:**
- Create: `agent/packaging/windows/prism-agent.wxs` (WiX 4: installs both programs to `Program Files\PRISM\Agent`; registers the service, automatic start, running as LocalSystem; adds the tray to the HKLM Run key; takes the `PRISM_URL` and `ENROLL_KEY` properties and runs `prism-agent enroll` once at install, never storing the key on disk; uninstall removes the service and leaves `ProgramData` only on request)
- Create: `.github/workflows/agent.yml` (Go tests on ubuntu and windows; build `windows/amd64` and `windows/arm64`; WiX; optional signtool step when the `AGENT_SIGNING_PFX` secret exists; uploads `agent-dist/` with `manifest.json`)
- Modify: `.github/workflows/docker-publish.yml` (needs `agent`, downloads `agent-dist` into the backend image build)

- [ ] **Step 1:** a CI job installs the MSI silently on `windows-latest` with a test key against a stub server, checks the service runs and `prism-agent status` reports "enrolled", then uninstalls cleanly.
- [ ] **Step 2:** the version comes from the git tag, or `0.0.0-dev+<sha>` on branches, and is stamped into the binaries and the MSI.
- [ ] **Step 3: Commit** `ci(agent): build, package and test the Windows agent`

### Task 12: Staff screens

**Files:**
- Create: `frontend/src/components/companies/CompanyDevices.jsx` (`Main` board: enrolment keys, the install command with Windows / macOS / Linux tabs where macOS and Linux say "coming in 8b/8c" until then, and the devices table with filters), `frontend/src/components/assets/AssetDevice.jsx` (`AssetDevice` board), `frontend/src/components/assets/AssetSoftware.jsx` (`AssetSoftware` board)
- Modify: the Asset page (Device and Software tabs on agent-managed Assets, the Agent-managed badge, the note on agent fields in the edit form), the Assets list (Online column, the Agent-managed / Online / Stale pills), the ticket page (a "PRISM tray" source label and the Asset chip in the sidebar)
- Backend: `GET /companies/:id/devices`, `GET /assets/:id/device`, `GET /assets/:id/software?q`, `POST /devices/:id/revoke`, and the Assets list's `online` and `agent` filters
- Test: `backend/test/integration/agent.staff.test.js`, `backend/test/smoke/agent.smoke.js`

- [ ] **Step 1: Failing tests:**
  - Integration: devices and software respect company access; revoke needs `devices.manage`.
  - Smoke: create a key and copy the command; an enrolled fake device appears Online; the Asset's Device and Software tabs show its inventory; the Assets list Online filter works; a tray ticket shows the source and the Asset chip.
- [ ] **Step 2–4:** Run → FAIL; implement per the boards; run with `assets.*` and `companies.page` smoke → PASS.
- [ ] **Step 5: Commit** `feat(agent): Devices tab, Asset Device and Software tabs, Online column`

### Task 13: Finish

- [ ] **Step 1:** ROADMAP row 8 → "8a shipped"; UPGRADING `## Unreleased`: migration 074, the `devices.manage` permission, how to create a key and deploy the MSI (GPO and Intune), firewall needs (agents reach `PUBLIC_APP_URL` over HTTPS only), and pushing trust for the self-signed code-signing certificate if one is used.
- [ ] **Step 2:** Full backend and smoke suites, and the agent workflow, all green.
- [ ] **Step 3:** Security review (Review Focus above), fix pass, commit, push to `dev`.
- [ ] **Step 4:** Hand test by the owner on a real Windows 11 machine and a Windows 10 one: install, the Asset appears, a tray ticket arrives, revoke stops it.

## Notes on the spec

- **No X.509 certificate in 8a.** The spec mentions a device certificate from a PRISM CA. With signed requests (decision 2), a registered Ed25519 public key gives the same guarantee, and revocation is a database flag. The CA comes with mutual TLS and the gateway.
- **Key storage on Windows** is a DPAPI-protected file with a SYSTEM-only ACL rather than the machine certificate store, because CNG has no Ed25519 support. The protection is the same: only the machine's SYSTEM account can read the key.
