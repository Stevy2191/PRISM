# PRISM 8d — Install keys you can copy again, install links and push scripts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installing the PRISM agent on a computer that's already in use, or a one-off new one, takes no key juggling:
- a company's **install key** can be copied again at any time (today it's shown once);
- an **install link** opens a page that downloads an installer already carrying the enrollment, for someone with admin rights at the computer (or entering an admin's password when Windows or macOS asks);
- ready-made **push scripts** install the agent silently across a fleet through whatever the client uses: PDQ Deploy, Group Policy, Intune, any RMM, a Mac MDM.

**Owner decisions (2026-11-09):**
1. Most production users are **standard users**, so a link they open alone can't install a service (no download can get around that). The link is for whoever has admin rights; the fleet is reached by **push** (the owner's own company uses GPO and PDQ; clients may use anything else, or nothing).
2. A computer enrolled through a link or a push **starts working right away**. The key's expiry, its use limit and Revoke keep it in check; no approval step.
3. One-off installs must not need a new key each time.

**Architecture:**
- **Copyable keys.** `AgentEnrollmentKeys` gains `secretEnc` (the key encrypted with `utils/tokenCrypto.js`, as other stored secrets), `maxUses` (null = unlimited) and `lastUsedAt`. Enrollment still matches on `keyHash`. Keys made from now on can be revealed (`POST /devices/enrollment-keys/:id/reveal`, Manage devices, audited) and **rotated** (new secret, same name, settings and history; the old secret stops working). Keys from before this have no `secretEnc`: they keep working, and the screen says "Made before keys could be copied again; rotate it to copy it."
- **A use limit.** Enrollment refuses a key whose `enrolledCount` has reached `maxUses` (`403 This install key has been used up`). Re-enrolling a device already enrolled with that key (the "retry reuses a never-reported device" path) doesn't count again.
- **Install links:** `https://<PUBLIC_APP_URL>/install/<key>`, served without sign-in, only while the key is usable:
  - `GET /install/:key`: a small page (the PRISM look, the company's name, nothing else about it) that detects the system and offers **Download for Windows** / **Download for Mac**, and on Linux the one-line command. A revoked, expired or used-up key gets "This install link no longer works. Ask your IT team for a new one." Unknown keys get the same page (no difference to probe).
  - `GET /install/:key/windows` and `/mac`: the normal signed installer, unchanged, served as `PRISM-Agent-Setup_<host>_<key>.msi` / `.pkg`. The **file name carries the enrollment**, so the file's signature stays intact.
  - `GET /install/:key/linux.sh`: a short script that finds the distribution (apt, dnf or pacman), downloads its package from `/install/:key/linux/<format>/<arch>`, installs it and enrolls.
  - Rate-limited per IP like the agent's other unsigned endpoints; every download is logged against the key (time, IP, platform).
- **The installers read their own name.**
  - **Windows MSI:** when `PRISM_URL`/`ENROLL_KEY` aren't given, a deferred custom action runs `prism-agent enroll --from-installer "[OriginalDatabase]"`. The agent parses `PRISM-Agent-Setup_<host>_<key>` out of the file name (tolerating a browser's ` (1)`), and enrolls with `https://<host>`. A name without them changes nothing (double-click install as today).
  - **Mac pkg:** `postinstall` gets the package path as `$1` and does the same.
  - The host in a file name is checked (a DNS name, optional port, nothing else) and only `https` is used.
- **Push scripts** (shown on the key, with the URL and key filled in, each with Copy):
  - **Windows PowerShell** (one script for PDQ Deploy, a GPO startup script, Intune and any RMM): skips a computer that already has the `PRISMAgent` service, downloads `/install/:key/windows` over HTTPS to a temporary file, runs `msiexec /i … /qn PRISM_URL=… ENROLL_KEY=…`, exits with msiexec's code, deletes the file.
  - **Mac and Linux shell** (for an RMM or a Mac MDM script): `curl -fsSL https://…/install/<key>/<mac|linux>.sh | sudo sh`; the Mac script installs the pkg with `installer -pkg` and enrolls.
  - Short notes per tool: **PDQ Deploy** (a PowerShell step, run as Deploy User, "Run as Local System"), **Group Policy** (Computer Configuration → Policies → Windows Settings → Scripts → Startup, PowerShell tab), **Intune** (Devices → Scripts → Platform scripts, run in system context, 64-bit), **RMM** (run as SYSTEM/root), **Jamf/Kandji/Mosyle** (a script run as root; until there's an Apple Developer ID, MDMs deploy an unsigned pkg poorly, so the script path is the way).

**Tech Stack:** as now. Migration 083.

## Global Constraints

- **The key is a secret, now one PRISM can read back.** Only staff with Manage devices can reveal it; each reveal is audited; it's never in a list response or a log line. A leaked key enrolls computers into that company only, and only until it expires, is used up, rotated or revoked.
- **The public install routes say nothing about the company or key** beyond the company's display name on a working link, and the same page for unknown, revoked and expired keys.
- **The installers stay the signed files.** Only the served file name differs; nothing is rewritten.
- **A file name is untrusted input.** The parser accepts only `PRISM-Agent-Setup_<dns-name[:port]>_pk_enr_<base64url>`; anything else is ignored, never passed to a shell.
- **Old keys keep working** exactly as before.
- American spelling: enroll, enrollment.

## Review Focus

- Reveal and rotate: permission, audit, no secret in list responses or logs → Task 1.
- Public `/install` routes: no leak between "unknown" and "revoked", rate limits, served files are the manifest's checked files → Task 2.
- The installers' file-name parsing (MSI custom action, Mac postinstall, the agent's parser) → Task 3.
- The push scripts: HTTPS only, no secret in a URL that's logged by PRISM (the key is in the path, so `/install/` paths are logged with the key masked) → Tasks 2 and 4.

---

### Task 1: Install keys you can copy again, with a use limit

**Files:**
- Create: `backend/migrations/20260101000083-enrollment-key-copy.js`
- Modify: `backend/src/models/AgentEnrollmentKey.js`, the enrollment-key controller and routes, `services/agent/enroll*.js`
- Test: `backend/test/integration/agent.enrollmentKeys.test.js`, migration round trip

- [ ] **Step 1: Failing tests:** a new key can be revealed by Manage devices only (403 otherwise), and the reveal is audited; list responses never carry the secret; rotate gives a new secret, the old one stops enrolling, the history stays; `maxUses` refuses the next computer but not a retry of one already enrolled; an old key (no `secretEnc`) still enrolls and says it can't be revealed.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): install keys you can copy again, rotate and limit`

### Task 2: Install links

**Files:**
- Create: `backend/src/routes/install.js`, `backend/src/controllers/installController.js`, `backend/src/views/install.html` (or a tiny server-rendered page), `backend/src/services/agent/installScripts.js` (the Linux and Mac shell scripts, the Windows PowerShell)
- Modify: `backend/src/app.js` (mount `/install` outside `/api`, with the rate limiter), `frontend/nginx.conf` (pass `/install/` to the backend), the request logger (mask the key in `/install/` paths)
- Test: `backend/test/integration/agent.install.test.js`

- [ ] **Step 1: Failing tests:** a usable key's page names the company and offers the right download for a Windows, Mac and Linux user agent; an unknown, revoked, expired or used-up key gets the same "no longer works" page; `/windows` and `/mac` serve the manifest's file under `PRISM-Agent-Setup_<host>_<key>.<ext>`, `/linux.sh` and `/mac.sh` carry the URL and key and only HTTPS; downloads are logged against the key; the logger masks the key.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): install links`

### Task 3: Installers that enroll from their file name

**Files:**
- Modify: `agent/cmd/prism-agent/main.go` (`enroll --from-installer <path>`), create `agent/internal/enroll/fromname.go` (+ tests), `agent/packaging/windows/prism-agent.wxs` (the custom action when the properties are empty), `agent/packaging/macos/scripts/postinstall`
- Test: Go tests for the parser; the Windows and Mac CI jobs install a renamed package against the CI server and see the device enroll

- [ ] **Step 1: Failing tests:** the parser takes `PRISM-Agent-Setup_prism.example.com_pk_enr_abc.msi`, `…_prism.example.com:8443_….pkg` and `… (1).msi`; refuses a missing key, a host with a path, `@`, spaces or a scheme, and anything longer than 255 characters; an installer with no enrollment in its name installs as today.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS (CI on Windows and macOS).
- [ ] **Step 5: Commit** `feat(agent): installers enroll from an install link's file name`

### Task 4: The Devices tab: Copy, Rotate, links and push scripts

**Files:**
- Modify: `frontend/src/components/companies/CompanyDevices.jsx` (split the install part into `InstallKey.jsx` if it grows), `frontend/src/api/…`
- Test: `backend/test/smoke/agent.smoke.js`

- Each key row: **Copy key**, **Copy install link**, **Rotate**, **Revoke**, its expiry, uses ("12 of 50", or "12"), last used.
- **New install key** asks for a name, an expiry (Never, 14 days, 30 days, a date) and an optional limit.
- **Deploy** for a key opens tabs: **Install link** (the address and what the person will see), **PDQ Deploy**, **Group Policy**, **Intune**, **RMM** (the same PowerShell with its notes), **Mac**, **Linux** (the one-liner). Each script has its Copy button and is filled in with the URL and key.
- The existing per-platform tabs stay for downloading an installer by hand.

- [ ] **Step 1–5:** smoke tests (create a key with a limit, copy it again later, rotate it and see the old link stop working, the scripts carry the URL and key), implement, commit `feat(agent): copy, rotate and deploy install keys`

### Task 5: Docs and finish

- [ ] UPGRADING `## Unreleased` (migration 083; install keys made before can't be revealed until rotated; install links; the push scripts; standard users need a push or an admin's password), ROADMAP row 8 (8d), full suites, agent workflow green, security review (Review Focus), commit `docs(8d): install keys, install links and push scripts`, push to `dev`. 8d ships with v0.5.0.
