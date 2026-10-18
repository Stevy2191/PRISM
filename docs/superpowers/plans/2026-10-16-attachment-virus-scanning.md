# Attachment Virus Scanning (5d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Per the user's token-efficiency rule this plan lists tasks, interfaces and test names, not full code.

**Goal:** Scan every uploaded and emailed file with ClamAV before it is stored; fail closed; warn admins.

**Architecture:** `services/virusScan.js` speaks clamd INSTREAM over `net`. A `scanUpload(entityType)` middleware runs last before the controller on all 9 multer routes; inbound email scans buffers before writing. Two always-on admin notification types; a status endpoint and card on Settings → System info; a `clamav/clamav:1.5` compose service.

**Tech Stack:** Node `net`/`fs` (no new dependency), Express, Sequelize/MariaDB, React, Jest + supertest, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-16-attachment-virus-scanning-design.md`

## Global Constraints

- No new npm dependency.
- Env only: `CLAMAV_HOST` (default `clamav`), `CLAMAV_PORT` (default `3310`), `CLAMAV_ENABLED` (on unless exactly `false`).
- Timeouts: 3 s connect, 60 s whole scan. 64 KiB chunks; files streamed, never fully buffered.
- Fail closed: anything other than `stream: OK` / `stream: <sig> FOUND` = unavailable.
- Error codes/copy: `422 VIRUS_FOUND` "Upload blocked: a virus was detected (<signature>)"; `503 SCANNER_UNAVAILABLE` "Files can't be uploaded right now: the virus scanner isn't reachable. Try again later or contact your administrator."
- Audit action `upload.virus_blocked`, meta `{ filename, signature, route }`.
- Notification types `virus_blocked`, `scanner_unavailable`; recipients = active users holding `settings.manage_system`; always on (not in `ALL_NOTIFICATION_TYPES`, never filtered by `isTypeEnabled`); unavailable notice throttled to 1/hour.
- Status responses never contain host, port or raw socket errors.
- Compose image `clamav/clamav:1.5`, env `CLAMD_CONF_StreamMaxLength: 101M`, `CLAMD_CONF_MaxFileSize: 101M`, `CLAMD_CONF_AlertExceedsMax: "yes"`, volume `clamav_data:/var/lib/clamav`, no published port, no `depends_on` from backend.

## Review Focus

1. **clamd answers in several TCP packets, or the reply arrives split** — the parser must read until the NUL/close, not trust the first `data` event. Test: fake server writes `stream: Eicar-Test-` then `Signature FOUND\0` in two writes → infected. (Task 1)
2. **clamd closes the socket mid-upload (size limit)** — it replies `INSTREAM size limit exceeded. ERROR` and closes while we are still writing; an EPIPE/ECONNRESET on write must become *unavailable*, not an unhandled `'error'` event that crashes the process (the LDAP/ImapFlow EventEmitter crash class). Test: fake server replies + destroys after first chunk → unavailable, process alive. (Task 1)
3. **Zero-byte file** — must still send the terminator and get a verdict, not hang. Test: empty file → clean. (Task 1)
4. **Upload rejected before the scan** (bad extension, signature mismatch, too large) must not reach the scanner, and a scanner rejection must leave no file in the record's upload dir. Test: infected upload → dir has no new files, no `Attachment` row. (Task 3)
5. **Inbound email with a mix** of clean + infected + (scanner down) attachments — clean ones still saved, the others listed in one private note, the ticket itself still created. Test in Task 4.

---

### Task 1: Scanner service + fake clamd

**Files:**
- Create: `backend/src/services/virusScan.js`
- Create: `backend/test/helpers/fakeClamd.js`
- Test: `backend/test/unit/virusScan.test.js`

**Interfaces — Produces:**
- `isEnabled(): boolean`
- `scanFile(path: string): Promise<{clean: true} | {clean: false, signature: string}>`
- `scanBuffer(buf: Buffer): Promise<same>`
- `getStatus(): Promise<{state: 'ok'|'unreachable'|'off', version: string|null, signatureDate: string|null}>` — `zVERSION\0` reply `ClamAV 1.5.4/28150/Sun Oct 11 06:26:01 2026`.
- `class ScannerUnavailableError extends Error` (`code = 'SCANNER_UNAVAILABLE'`, `status = 503`, message = the user copy; underlying cause kept on `.cause`, logged once via `console.error('[virus-scan] …')`).
- `startFakeClamd({ mode, signature?, version?, delayMs? }) → Promise<{ port, received: Buffer[], close() }>`; modes `ok | found | error | sizeLimit | hang | split | garbage`. Records framed chunks so tests can check framing.
- Config read per call (`process.env`), so tests can switch host/port/enabled without re-requiring.

- [ ] Write `virusScan.test.js` tests: `clean file → {clean:true}`; `EICAR reply → {clean:false, signature:'Eicar-Test-Signature'}`; `reply split over two writes is joined`; `ERROR reply → ScannerUnavailableError`; `server closes mid-stream (size limit) → unavailable, no unhandled error`; `connection refused → unavailable`; `hang beyond scan timeout → unavailable` (inject a short timeout via an exported `_setTimeoutsForTest`); `garbage reply → unavailable`; `zero-byte file → clean, terminator sent`; `framing: every chunk is uint32-BE-length-prefixed, ends with 4 zero bytes, starts with zINSTREAM\0`; `scanBuffer uses same framing`; `CLAMAV_ENABLED=false → clean without connecting`; `getStatus ok parses version + signature date`; `getStatus unreachable / off`; `getStatus never includes host or error text`.
- [ ] Run `npx jest test/unit/virusScan.test.js` → FAIL (module missing).
- [ ] Implement service + fake. Socket: `net.connect`, `setTimeout` for connect, overall timer, attach `'error'` before writing, write with backpressure (`await once(sock,'drain')` when `write` returns false) from `fs.createReadStream(path, {highWaterMark: 65536})`; collect reply until `\0` or `'end'`.
- [ ] Run → PASS. Commit `feat(scan): clamd INSTREAM scanner service`.

### Task 2: Security notifications + migration 067

**Files:**
- Create: `backend/migrations/20260101000067-virus-scanning.js` (extend `Notifications.type` enum with `virus_blocked`, `scanner_unavailable`; reuse the read-enum/rewrite-enum pattern from migration 066; down removes them after deleting rows of those types)
- Modify: `backend/src/models/Notification.js:18` (enum)
- Modify: `backend/src/services/notifications.js` (add `notifySecurityAdmins`)
- Modify: `backend/src/services/virusScan.js` (`notifyScannerUnavailable` throttle)
- Modify: `frontend/src/components/NotificationsDropdown.jsx` (`NOTIF_TYPE` entries with a shield icon; click → `scanner_unavailable` `/settings/system`, `virus_blocked` `/settings/audit-log`)
- Test: `backend/test/integration/virusScan.notify.test.js`, `backend/test/integration/virusScan.migration.test.js`

**Interfaces — Produces:**
- `notifySecurityAdmins({ type: 'virus_blocked'|'scanner_unavailable', message: string }): Promise<number>` — recipients: active users for whom `hasPermission(id,'settings.manage_system')`; `Notification.create` directly (bypasses `isTypeEnabled`, `ticketId: null`, no email). Never throws (logs).
- `notifyScannerUnavailable(): Promise<void>` — at most once per hour per process; `_resetThrottleForTest()`.
- `notifyVirusBlocked({ place: string, filename: string, signature: string, who: string }): Promise<void>` — message `Virus blocked: "<filename>" (<signature>) uploaded by <who> to <place>`.

- [ ] Tests: `only manage_system holders get it (admin yes, technician no, inactive no)`; `still delivered when notifications.enabledTypes excludes it`; `new types are not in the Notifications settings list` (GET settings notification types); `unavailable notice throttled: two calls in an hour → one row each admin; after clock +61 min → second` (jest fake timers or injected `now`); migration `up adds both values / down removes them and their rows`.
- [ ] Run → FAIL. Implement. `npm run test:migrate` then run → PASS. Commit `feat(scan): always-on security notifications for admins`.

### Task 3: `scanUpload` middleware on all 9 routes

**Files:**
- Modify: `backend/src/middleware/upload.js` (export `scanUpload(entityType)`)
- Modify routes: `tickets.js:41` (`'Ticket'`), `projects.js:63` (`'Project'`), `assets.js:60` (`'Asset'`), `licenses.js:38` (`'License'`), `contracts.js:29` (`'Contract'`), `knowledge.js:29` (`'KnowledgeArticle'`), `settings.js:91,93` (`'Branding'`) — appended after the existing checks, before the controller.
- Modify: `backend/.env.test` and `.github/workflows/*` test env: `CLAMAV_ENABLED: 'false'`.
- Test: `backend/test/integration/virusScan.uploads.test.js`

**Interfaces — Consumes:** `scanFile`, `ScannerUnavailableError` (Task 1); `notifyVirusBlocked`, `notifyScannerUnavailable` (Task 2); `writeAudit(req, action, entityType, entityId, meta)`.
**Produces:** `scanUpload(entityType: string) → express middleware`. No `req.file` → `next()`. Clean → `next()`. Infected → `fs.promises.unlink`, `writeAudit(req,'upload.virus_blocked', entityType, id-or-null, {filename, signature, route: req.originalUrl})`, `notifyVirusBlocked`, `next(err)` with `status 422, code 'VIRUS_FOUND'`. Unavailable → unlink, `notifyScannerUnavailable()`, `next(err)` 503. Check the app error handler passes `code` + `message` for these statuses (it does for 400 `INVALID_FILE_TYPE`; confirm 422/503 aren't masked as "Internal error").

- [ ] Tests (scanner on, pointed at `startFakeClamd`), table-driven over the 9 routes with each route's minimum valid fixture (reuse existing per-route test fixtures/helpers; logo/favicon need a real PNG/ICO header): `clean upload is stored (200/201, row exists)`; `infected → 422 VIRUS_FOUND, signature in message, no row, no new file in the record's dir, audit row, admin notification`; `scanner down → 503 SCANNER_UNAVAILABLE, no row, no file`; `bad extension never reaches the scanner` (fake `received` empty); `CLAMAV_ENABLED=false → stored without contacting scanner`.
- [ ] Run → FAIL. Implement + wire routes. Run → PASS; run the existing upload tests for these routes (still pass with scanning off). Commit `feat(scan): scan every staff upload before it is stored`.

### Task 4: Inbound email attachments

**Files:**
- Modify: `backend/src/services/inboundEmailService.js` (`saveAttachments` ~L189 and its 4 callers ~L416/442/469/479)
- Test: extend `backend/test/integration/email.inbound.test.js` (new `describe('virus scanning')`)

**Interfaces — Consumes:** `scanBuffer`, `ScannerUnavailableError`, `notifyVirusBlocked`, `notifyScannerUnavailable`.
**Produces:** `saveAttachments(...)` now returns `{ skipped: Array<{ name: string, reason: 'virus'|'unscanned', signature?: string }> }`. A helper `addSkippedAttachmentsNote(ticketId, skipped)` adds one **private** system note (author = system actor, same as other inbound system notes) listing `Removed: <name> — virus detected (<sig>)` / `Not saved: <name> — the virus scanner wasn't reachable`; nothing when `skipped` is empty. Infected → `writeAudit({ user: null }, 'upload.virus_blocked', 'Ticket', ticketId, { filename, signature, route: 'inbound-email', from })` + `notifyVirusBlocked({ place: 'Ticket #N (email from x)', ... })`. Oversized attachments keep today's silent skip (out of scope).

- [ ] Tests: `clean attachments saved as before`; `infected attachment not written, others saved, private note lists it, audit + admin notification`; `scanner down → no attachments saved, ticket still created, note lists each as not saved, admins notified (throttled)`; `note is private (contact never sees it / not emailed)`; `reply onto an existing ticket gets the same treatment`.
- [ ] Run → FAIL. Implement. Run → PASS. Commit `feat(scan): scan inbound email attachments`.

### Task 5: Status endpoint + System info card

**Files:**
- Modify: `backend/src/routes/settings.js` (`router.get('/virus-scan/status', manageSystem, ctrl.virusScanStatus)`), `backend/src/controllers/settingsController.js`
- Modify: `frontend/src/pages/settings/SystemInfo.jsx` (new "Attachment scanning" `SettingsPanel`: Connected / Unreachable / Off states, Test button re-fetches, uses existing `Spinner`, `errMessage`)
- Test: `backend/test/integration/virusScan.status.test.js`, `backend/test/smoke/virusscan.smoke.js`

**Interfaces — Consumes:** `getStatus()` (Task 1). **Produces:** `GET /api/settings/virus-scan/status → { state, version, signatureDate }`.

- [ ] Backend tests: `403 without settings.manage_system`; `ok → version + signatureDate`; `unreachable`; `off`; `body never contains host/port/ECONNREFUSED`.
- [ ] Smoke (fake clamd started in the smoke process, `beforeEach(resetRateLimits)`): `System info shows Connected with version`; `Test re-checks and shows Unreachable after fake closes`; `ticket attachment upload of an "infected" file shows the blocked message and no attachment row appears`.
- [ ] Run → FAIL. Implement. Run → PASS (`npx jest -c jest.smoke.config.js test/smoke/virusscan.smoke.js` after frontend build). Commit `feat(scan): scanner status card in System info`.

### Task 6: Deployment, docs, live check

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.dev.yml` (clamav service + `clamav_data` volume per Global Constraints; backend gets no `depends_on` on it)
- Modify: `.env.example` (three vars, RAM note: ~1.2 GB idle, ~2.4 GB during daily reload, 3–4 GB host recommended; `CLAMAV_ENABLED=false` opt-out)
- Modify: `README.md` (requirements/RAM), `RELEASING.md` or upgrade notes (pull new compose file or uploads are refused), `docs/ROADMAP.md` (5d → Built + plan link)

- [ ] `docker compose -f docker-compose.dev.yml config` validates.
- [ ] Live: start `clamav/clamav:1.5` with the compose env on a scratch network/port, wait for `PING`→`PONG`; with the backend pointed at it (`CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=<port>` via a test run or a scratch script using `scanFile`): EICAR string → `Eicar-Test-Signature` FOUND; a clean PDF → OK; a zip of EICAR → FOUND; `getStatus()` → ok with real version. Stop and remove the container after.
- [ ] Commit `feat(scan): clamav service in compose, docs`.

### Task 7: Finish

- [ ] Full backend suite once (`npm test`), full smoke once (`npm run test:smoke`), frontend build.
- [ ] Security-sensitive work → one fresh reviewer (Opus) over the branch diff against the spec; fix findings test-first.
- [ ] Update memory (`clamav_scanning_plan.md` → built, gotchas), push to dev, confirm CI green.
