# Attachment virus scanning (roadmap 5d) — design

Date: 2026-10-16 · Status: approved in chat, spec under review

## Goal

Every file a person or an email puts into PRISM is scanned with ClamAV before it
is stored. If the scanner can't give a clean answer, the file is not stored
(fail closed). Admins hear about virus finds and about the scanner being down.

## Decisions (user, 2026-10-15 / 2026-10-16)

- Own roadmap item (5d), built after 5b.
- **Fail closed.** Scanner unreachable → staff uploads refused with a clear
  error; inbound email attachments not saved, and the ticket note lists them
  as not scanned.
- ClamAV runs as a `clamav/clamav` container (clamd + freshclam) in both
  compose files. PRISM streams files to clamd over TCP (INSTREAM). No new npm
  dependency.
- Settings live in **server env only**: `CLAMAV_HOST`, `CLAMAV_PORT`,
  `CLAMAV_ENABLED`. Turning scanning off needs server access, so a stolen admin
  login can't do it. **Scanning is on when `CLAMAV_ENABLED` is unset**; only
  `CLAMAV_ENABLED=false` turns it off. The user accepted that an install
  updating without the clamav container refuses uploads until it adds the
  container or opts out, and can give the server more RAM.
- Admin warning: in-app notification (first failure, then at most once an
  hour) plus a status card in Settings → System info.
- Infected staff upload: refused, file deleted, audit entry, admins notified.
- Scope: all multer upload routes including branding (logo, favicon) and
  inbound email. Files already stored are **not** rescanned (possible later
  item).

## Architecture

### 1. Scanner service — `backend/src/services/virusScan.js`

- `scanFile(path)` / `scanBuffer(buffer)` →
  `{ clean: true }` | `{ clean: false, signature }`; throws
  `ScannerUnavailableError` on anything else.
- Protocol: connect to `CLAMAV_HOST:CLAMAV_PORT` (defaults `clamav`, `3310`),
  send `zINSTREAM\0`, then chunks of `<uint32 BE length><bytes>` (64 KiB
  chunks, file read as a stream, never fully buffered), then a zero-length
  chunk. Reply `stream: OK` → clean; `stream: <sig> FOUND` → infected; anything
  else (`... ERROR`, "size limit exceeded", empty, malformed) → unavailable.
- Timeouts: 3 s to connect, 60 s for the whole scan → unavailable.
- `getStatus()` → `{ state: 'ok' | 'unreachable' | 'off', version,
  signatureDate }`, using clamd `zVERSION\0` (`ClamAV 1.5.4/28150/<date>`).
- `isEnabled()` reads `CLAMAV_ENABLED` (anything but the string `false` = on).
  When off, `scanFile`/`scanBuffer` return clean without connecting.
- Unavailable → `notifyScannerUnavailable()`: in-memory throttle, at most one
  admin notification per hour (single backend instance, see stack notes).

### 2. Where scanning happens

- **`scanUpload` middleware** in `middleware/upload.js`, placed last before the
  controller on all 9 routes, after the existing cheap checks
  (`verifyFileSignature`, `enforceMaxAttachmentSize`):
  tickets `/:id/attachments`, projects `/:id/files`, assets, licenses,
  contracts `/:id/attachments`, KB `/articles/:id/attachments`, settings
  `/logo` and `/favicon`.
  - Clean → `next()`.
  - Infected → unlink the file, audit `upload.virus_blocked`
    (who, route's entity type + id, original filename, signature), notify
    admins, `422 VIRUS_FOUND`
    "Upload blocked: a virus was detected (<signature>)".
  - Unavailable → unlink, `503 SCANNER_UNAVAILABLE`
    "Files can't be uploaded right now: the virus scanner isn't reachable. Try
    again later or contact your administrator."
  - An unscanned file sits on disk only between multer's write and the scan.
    It has no `Attachment` row, so nothing can serve it, and every outcome but
    clean deletes it.
- **Inbound email** `saveAttachments`: `scanBuffer` each attachment before it is
  written. Infected → not written; system audit entry; admins notified.
  Unavailable → not written. The function returns what it skipped, and the
  ticket gets a private note listing each one:
  "Removed: <name> — virus detected (<signature>)" /
  "Not saved: <name> — the virus scanner wasn't reachable".
- **Not scanned (no new content enters):** merge/split (move existing rows),
  generated asset checkout PDFs, contact CSV import (parsed in memory, never
  stored).

### 3. Admin notifications

- Two new `Notification.type` enum values: `virus_blocked`,
  `scanner_unavailable` (migration 067). `ticketId` stays null for these; the
  message names the place ("Ticket #123", "Knowledge article 7", "email from
  x@y").
- Recipients: active users holding `settings.manage_system` (the people who can
  see the status card).
- Always on: not listed in Settings → Notifications, and `isTypeEnabled` can't
  turn them off, so a security alert can't be silenced from the UI.

### 4. Status card — Settings → System info

- `GET /api/settings/virus-scan/status` (needs `settings.manage_system`) →
  `getStatus()`; does a live check each call (the Test button re-calls it).
- Card states: **Connected** — ClamAV version + signature date;
  **Unreachable** (red) — "Uploads are being refused until the scanner is
  back"; **Off** (warning) — "CLAMAV_ENABLED=false — uploads are not scanned".
- The response never includes host/port or raw socket errors (logged
  server-side only).

### 5. Deployment

- `docker-compose.yml` and `docker-compose.dev.yml` gain:

  ```yaml
  clamav:
    image: clamav/clamav:1.5
    restart: unless-stopped
    environment:
      CLAMD_CONF_StreamMaxLength: 101M
      CLAMD_CONF_MaxFileSize: 101M
      CLAMD_CONF_AlertExceedsMax: "yes"
    volumes:
      - clamav_data:/var/lib/clamav
  ```

  No published port (clamd has no authentication). The backend does not
  `depends_on` it: clamd can take minutes to load signatures, and fail-closed
  covers the gap. `1.5` is the feature-release tag (gets patch updates, per
  ClamAV's guidance), and it ships with signatures preloaded.
- `StreamMaxLength`/`MaxFileSize` 101M sit just above the 100 MB upload
  ceiling, so a file at the limit is fully scanned. `AlertExceedsMax` makes
  archives that exceed scan limits (zip bombs, deep nesting) come back as
  `Heuristics.Limits.Exceeded.*` and get blocked instead of passing unscanned.
- `.env.example`: the three variables, with a note that clamd needs ~1.2 GB
  RAM (up to ~2.4 GB during the daily signature reload; ClamAV recommends a
  3–4 GB host) and that `CLAMAV_ENABLED=false` is the opt-out.
- README/RELEASING: upgrade note — pull the new compose file, or uploads will
  be refused.

## Testing

- Unit (`virusScan.test.js`) against a fake clamd `net` server: OK, FOUND,
  ERROR reply, size-limit reply, hang past timeout, connection refused,
  malformed reply, chunk framing (length prefixes + terminator), VERSION
  parsing, `CLAMAV_ENABLED=false` never connects, hourly throttle.
- Integration: each of the 9 routes — clean upload stored; infected → 422,
  file gone from disk, no row, audit row, admin notification; scanner down →
  503, file gone. Inbound email — infected/unavailable attachment not stored,
  note lists it. Status endpoint — permission check, three states, no
  host/error leak. Migration 067 up/down.
- Test env and CI: `CLAMAV_ENABLED=false` in `.env.test`/CI env; the scanner
  tests switch it on and point `CLAMAV_HOST/PORT` at the fake.
- Smoke: upload blocked message shown in the ticket attachment UI (fake
  scanner).
- Live: run the real `clamav/clamav:1.5` container here and upload the EICAR
  test file through the API.
