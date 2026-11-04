# PRISM agent 8b — macOS: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac (macOS 13 or later, Apple silicon or Intel) gets the PRISM agent from one `.pkg` and one `sudo prism-agent enroll …` command. It appears as an Asset of its company with its hardware, OS, disks, network, installed apps, usual user and online status, kept current. Its menu-bar **Submit a ticket…** raises a ticket linked to that Asset, with a health snapshot. It updates itself, but only to builds signed by the install. Everything on the server side from 8a is reused; 8b adds the Mac agent, its package, and the Mac parts of the staff screens.

**Architecture:**
- **Same Go module** (`agent/`), same two programs. The Mac code lives in `_darwin.go` files beside the Windows ones. Everything that isn't platform-specific (signing, schedules, enrolment, `inventory.Assemble`, `ipc.Server`, `trayui`, `update.Updater`) is shared and already tested.
- **Service:** a launchd daemon (`/Library/LaunchDaemons/com.prism.agent.plist`), running `prism-agent run` as root.
- **Tray:** `PRISM Agent.app` (a menu-bar app with no Dock icon), started for each user at sign-in by a LaunchAgent. The ticket window is a WKWebView showing the same `trayui` page as on Windows.
- **Tray ↔ service:** a Unix socket at `/var/run/prism-agent.sock`. The service takes the user from the socket's peer credentials (`LOCAL_PEERCRED`), never from the message.
- **Package:** one universal `.pkg` (amd64 and arm64 in each binary, joined with `lipo`), built on a `macos-latest` runner. Binaries are ad-hoc signed; the `.pkg` is unsigned (no Apple Developer ID, owner decision 7), with a drop-in signing and notarisation step for when there is one.

**Tech Stack:**
- **Agent:** Go 1.24 as before; for macOS:
  - `golang.org/x/sys/unix` (peer credentials, `statfs`)
  - `fyne.io/systray` (menu bar; cgo with Cocoa)
  - `github.com/webview/webview_go` (WKWebView; cgo)
  - `howett.net/plist` (reading `Info.plist` and `system_profiler` plist output)
  - Command-line tools that ship with macOS: `system_profiler`, `sw_vers`, `sysctl`, `networksetup`, `dsconfigad`, `dscl`, `launchctl`, `installer`.
- **Packaging:** `pkgbuild` and `productbuild` (on the runner), `lipo`, `codesign -s -` (ad hoc).
- **Backend and frontend:** no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-agent-inventory-tray-design.md`
**Plan 8a:** `docs/superpowers/plans/2026-11-03-agent-8a-server-windows.md` (the server side and the shared agent code)
**Mockups:** `docs/mockups/agent-8/` (approved 2026-11-03). Boards: `TrayMac`, plus `TrayForm` and `TraySent`, which the Mac window shares with Windows.

## Global Constraints

Everything in 8a's Global Constraints still holds (read-and-report only, signed requests, per-company enrolment keys, agent-owned fields, no contacts created except the "Unknown tray user" placeholder, inventory as untrusted text, per-device rate limits). For the Mac, also:

- **Root only where it matters.** `/Library/Application Support/PRISM` is `root:wheel 0755`; the device key, the updates folder and anything with a secret in it are `0600` / `0700`, owned by root. The socket lives in `/var/run`, where only root can create files.
- **No prompt the daemon can't answer.** The daemon runs with no user session. Nothing it does may raise a keychain, TCC or Gatekeeper prompt: it reads only what root can read without asking (no Full Disk Access needed).
- **No Developer ID needed to work.** Every step works with ad-hoc signed binaries and an unsigned `.pkg`. Signing and notarisation are optional CI steps that switch on when the secrets exist.
- **macOS 13 or later.** Older Macs refuse the package (`productbuild` `os-version` requirement).

## Review Focus

- **Tray identity:** the ticket's requester comes from the socket's peer credentials, never from what the tray sends → Task 4.
- **Socket trust:** the tray talks only to a socket owned by root in a root-owned folder, and refuses a symlink or anything else → Task 4.
- **Key storage:** the device key is a root-only file (`0600`, `root:wheel`), never readable by a user → Task 3.
- **Update trust:** a package signed with another install's key, a wrong hash or a lower version is refused, and the agent keeps running; `installer` only ever runs a package the updater checked, from a root-only folder → Task 6.
- **Untrusted command output:** everything read from `system_profiler`, `dscl` and the app bundles goes through `Assemble`'s cleaning, and the agent never runs a command built from that output → Tasks 2 and 3.

---

### Task 1: The platform seams and macOS in CI

**Files:**
- Modify: `agent/internal/*/…_other.go` → split into `_darwin.go` and `_linux.go` stubs where 8b and 8c differ (inventory, snapshot, service, ipc, update, keystore, tray), so each platform's code has its own file and Linux keeps building.
- Modify: `.github/workflows/test.yml` (the agent matrix gains `macos-latest`), `agent/cmd/prism-tray/main_other.go` (Linux only).

- [x] **Step 1:** `go vet ./...` and `go test ./...` pass for `GOOS=darwin` (cross-compiled here, and natively on `macos-latest`) and stay green on Windows and Linux.
- [x] **Step 2: Commit** `refactor(agent): per-platform files for macOS and Linux`

**As built (2026-11-04):**
- `_darwin.go` and `_linux.go` files replace the shared `!windows` stubs where the two will differ: `inventory/collect_*`, `inventory/snapshot_*`, `service/service_*`, `ipc/ipc_*`, `update/update_*` (`packageExt`, `PlatformInstall`) and `cmd/prism-tray/main_*`. Each Mac stub names the Task that replaces it.
- Shared on both (`//go:build darwin || linux`): `keystore_unix.go` (the 0600 root-only key file, which is the Mac's final form; see Notes on the spec) and `update_unix.go` (the 0700 updates folder).
- `test.yml`'s agent job runs `go vet` and `go test -race` on `macos-latest` as well as Ubuntu and Windows.
- Checked here: `go vet` for linux, darwin and windows; both programs build for darwin; the tests pass with `-race`.

### Task 2: Mac inventory

**Files:**
- Create: `agent/internal/inventory/darwin.go` (fills `Raw` from the sources below), `agent/internal/inventory/darwin_parse.go` (pure parsing, built on every OS so it's tested here), `agent/internal/inventory/testdata/macos-*.json|plist` (captured output from an Apple silicon and an Intel Mac).
- Test: `agent/internal/inventory/darwin_parse_test.go`, `agent/internal/inventory/live_darwin_test.go`.

**Sources:**
- `system_profiler -json SPHardwareDataType`: serial number, model name and identifier, chip (or processor name), cores, memory. Make is "Apple". Model reads like "MacBook Air (M3)" (the name plus the chip; the year isn't available without a lookup table).
- `sw_vers`: product name and version and build → `os` = `{ name: "macOS", edition: "macOS", version: "15.1", build: "24B83" }`, shown as "macOS 15.1".
- `sysctl kern.boottime`: last boot. Firmware: `SPHardwareDataType`'s boot ROM version.
- Disks: `statfs` on the mounted volumes under `/` and `/Volumes`, keeping the data volume once (APFS shows the system and data volumes of one disk), with `diskutil info -plist` saying internal, external (USB/Thunderbolt) or removable.
- Network: Go's interfaces (as on Windows), named from `networksetup -listallhardwareports` ("Wi-Fi", "Ethernet"), with the default route's address as the primary.
- Apps: the `.app` bundles in `/Applications` and `/Applications/Utilities` (two levels deep, so apps in vendor folders count; helper apps nested inside other bundles don't), read from each `Contents/Info.plist` (`CFBundleName`, `CFBundleShortVersionString`, `CFBundleIdentifier` → publisher from the identifier's vendor part, install date from the bundle's modification time). No `SPApplicationsDataType`: it takes tens of seconds and walks the whole disk.
- Every command runs with a timeout, with fixed arguments, through `exec.Command` (never a shell).

- [x] **Step 1: Failing tests:** the Apple silicon and Intel fixtures give the payload shape 8a's server reads ("Apple", "MacBook Air (M3)", "macOS 15.1", the build, cores, memory); the data volume is counted once and a USB disk is marked `usb`; apps are read from bundles with versions and dates, nested helper apps skipped, duplicates collapsed; a missing tool or a timeout leaves those fields empty without failing the inventory.
- [x] **Step 2: Live test on `macos-latest`:** `collect` returns a serial, macOS and at least one disk and one app.
- [x] **Step 3–4:** Implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): Mac inventory`

**As built (2026-11-04):**
- **Parsing** lives in `macparse.go` (no build tag, so it's tested here from fixtures): `ParseHardwareJSON`, `MacModel`, `ParseHardwarePorts`, `ParseDiskutilInfo`, `MacDisks`, `ParseAppInfoPlist` and `publisher`. `collect_darwin.go` only gathers the data.
- **Sources, changed from the plan:** the kernel values come from `sysctl` through `golang.org/x/sys/unix` instead of running `sw_vers` and `sysctl`: `kern.osproductversion` and `kern.osversion` (version and build), `kern.boottime`, `hw.memsize`, `hw.physicalcpu` and `machdep.cpu.brand_string`. Only `system_profiler` (serial, model name, chip, boot ROM), `networksetup` (adapter names) and `diskutil info -plist` (per volume) are run, each with a 30 s timeout and fixed arguments.
- **Model:** "MacBook Air (M3)" (M1 to M4, with Pro, Max or Ultra); Intel Macs get the plain name ("MacBook Pro"). Make is "Apple". Firmware is the boot ROM version.
- **Disks** (from `getfsstat`): the data volume `/System/Volumes/Data` is the internal disk ("Macintosh HD", from its volume name without " - Data"), counted once. The sealed system volume and the other `/System/Volumes/*` are skipped, as are network shares, non-disk file systems and mounted disk images (bus "Disk Image"). Under `/Volumes`: USB is `usb`, Thunderbolt and other external buses are a new kind `external`, and an internal removable card is `removable`. **Server:** `external` is now left out of an Asset's storage figure as `usb` and `removable` are, and the Device tab labels it "External".
- **Apps:** the `.app` bundles in `/Applications`, plus one level of vendor folders and `/Applications/Utilities` (each counted once). Fields come from `Info.plist` (XML or binary): display name, short version (else bundle version), and the publisher from the copyright line ("Copyright © 2008-2024 Microsoft Corporation." → "Microsoft Corporation"), else the identifier's vendor part capitalised. The install date is the `Info.plist` file's date.
- **Network:** Go's interfaces renamed from `networksetup` ("en0" → "Wi-Fi"); `utun` tunnels and loopback are dropped by the shared rules.
- **User and domain:** a hook (`macUser`) that Task 3 fills.
- **Tests:** Apple silicon and Intel hardware fixtures; adapter names; disks (the data volume once, USB, Thunderbolt, SD, a disk image skipped, a share skipped); apps from XML and binary plists; publishers; and `TestCollectOnThisMac` on `macos-latest`, where a virtual Mac may have no serial (logged, not failed). Server: `macos15.json` through `agent.inventory.test.js` gives "Apple", "MacBook Air (M3)", "Apple M3 (8 cores)", "macOS", "15.1 (24B83)" and "460 GB (212 GB free)".

### Task 3: The console user, directory binding and the device key

**Files:**
- Create: `agent/internal/inventory/user_darwin.go`, `agent/internal/keystore/keystore_darwin.go`
- Test: `agent/internal/inventory/user_darwin_test.go` (parsing; runs everywhere), `agent/internal/keystore/keystore_test.go` (existing round trip on macOS).

- **Console user:** the owner of `/dev/console` (`stat`), skipping `root` and the login window (`_mbsetupuser`, `loginwindow`).
- **Directory:** `dsconfigad -show` for an Active Directory binding → `domain` (and the snapshot's `directory`). Account: `DOMAIN\user` when bound, else the short name.
- **UPN / email:** from the directory when bound (`dscl "/Active Directory/<DOMAIN>/All Domains" -read /Users/<user> userPrincipalName`), else the local account's `EMailAddress` attribute (`dscl . -read`), else none, so the ticket goes to the placeholder as on Windows.
- **Device key:** a root-only file, `0600 root:wheel`, in `/Library/Application Support/PRISM` (see Notes on the spec for why not the System keychain yet). The folder's own mode is checked at start, and the agent refuses to run if the key file is readable by anyone but root.

- [x] **Step 1: Failing tests:** console-owner parsing skips system accounts; `dsconfigad` and `dscl` output parse to domain and UPN; an unbound Mac uses the local email or none; the key file is created `0600` and refused if its mode is wider.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): Mac console user, directory binding and device key`

**As built (2026-11-04):**
- **Parsing** (`macuser.go`, tested on every OS): `IsMacPerson` (uid 500 or above, not root, `_`-accounts, `loginwindow` or `_mbsetupuser`, and a name safe to pass as an argument), `ParseDsconfigad` (the "Active Directory Domain" line, lower-cased), `ParseDscl` (the first value of each attribute, including keys containing colons and values on a continuation line), `MacAccount` ("RIVERSIDE\\apatel" from the domain's first label, as Windows writes it; else the short name), and `MacUPN` (the directory's `userPrincipalName`, then `EMailAddress`, then `mail`; only a plain address).
- **`user_darwin.go`:** the console user is the owner of `/dev/console`. `MacUserFor(uid)` is shared with Task 4's socket: it looks up the account and runs `dscl /Search -read /Users/<name> <attribute>` once per attribute, so a missing attribute doesn't hide the other. `/Search` covers the local accounts and a bound directory in one look-up, rather than naming the AD node.
- **Key file:** `keystore.Load` now checks the file first (`checkFile`). On macOS and Linux it must be a plain file (not a symlink), with no group or other permission bits, owned by the user the agent runs as (root for the service). Otherwise it's refused with "enrol again". On Windows the check does nothing (the ACL and DPAPI protect the key). A normal user's `prism-agent status` reports the key as belonging to another user, as intended.
- **Tests:** people versus system accounts; bound and unbound; the UPN order and refusals; the key file (0600 accepted; 0644 and a symlink refused). Live on `macos-latest`: this process's user is identified, an unbound Mac gives a plain account name, and root is not a person.

### Task 4: The socket between the tray and the service

**Files:**
- Create: `agent/internal/ipc/socket_darwin.go` (the same `Serve`/`Call` as the Windows pipe, over a Unix socket)
- Test: `agent/internal/ipc/socket_darwin_test.go`

- **Server:** removes a stale socket file only if it's a socket owned by root, then listens on `/var/run/prism-agent.sock` with mode `0666` (any local user may ask; the answer depends on who they are). One JSON line each way, 30 s to send the line, as on Windows.
- **Identity:** `getsockopt(LOCAL_PEERCRED)` → the peer's uid → the user (`os/user`), then the domain prefix and UPN from Task 3. Root and system accounts (uid < 500) are refused as callers.
- **Client:** `Lstat` the socket: a socket (not a symlink), owned by uid 0, in a folder owned by root; anything else is refused before connecting.
- Reuses `ipc.Server.Handle` unchanged, so "a message's own account is ignored" stays covered by the existing tests.

- [x] **Step 1: Failing tests:** a round trip identifies the calling user; a socket owned by a non-root user is refused by the client; a symlink in its place is refused; several callers at once; a second server on the same path is refused while the first runs.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS (on `macos-latest`, with a test hook for the path and owner, as on Windows).
- [x] **Step 5: Commit** `feat(agent): Mac socket between the tray and the service`

**As built (2026-11-04):**
- `ipc/socket_darwin.go` replaces the stub. Same `Serve(ctx, handler, logf)` and `Call(req, out, timeout)` as the Windows pipe, so `cmd/prism-agent` and the tray don't change.
- **Server start:** if something is already at the path: a plain file is never touched (refused); a socket that answers means another server is running (refused); a dead socket is removed only if it's our own owner's. Then it listens and sets mode `0666`. The socket is removed when `Serve` returns.
- **Each connection:** 30 s to send the line. `LOCAL_PEERCRED` (`GetsockoptXucred` on the raw fd) gives the uid; `inventory.MacUserFor` (Task 3) gives the account and UPN; root and system accounts are refused as callers. The handler then gets up to 3 minutes, since a send can wait on PRISM.
- **Client:** checks before connecting that the path is a socket (not a symlink) owned by root, in a folder owned by root that no one else can write to; otherwise `ErrUntrusted`. A missing socket, or nobody listening, is `ErrNotRunning`.
- **Tests** (`socket_darwin_test.go`, on `macos-latest`, in a short folder under `/tmp` because macOS limits socket paths to about 100 bytes):
  - The caller is identified from macOS, and a message claiming another account is ignored; 8 callers at once; the socket is gone after the server stops.
  - The client refuses a socket of the wrong owner, a symlink to a real socket, and a folder others can write to.
  - A second server is refused while the first answers; a stale socket is replaced; a plain file at the path is left untouched.
- Test hooks (`AllowCurrentUserForTests`, `trustUIDForTests`) let the test's own user stand in for root; the agent never calls them.

### Task 5: The launchd daemon, uninstalling, and the Mac snapshot

**Files:**
- Create: `agent/internal/service/service_darwin.go`, `agent/internal/inventory/snapshot_darwin.go`
- Modify: `agent/cmd/prism-agent/main.go` (`uninstall [--remove-data]`)
- Test: `agent/internal/service/service_darwin_test.go` (the plist it writes)

- **Daemon:** `/Library/LaunchDaemons/com.prism.agent.plist`: `RunAtLoad`, `KeepAlive` (restarts after a crash, throttled to 30 s), stdout and stderr to `/Library/Logs/PRISM/agent.log` (rotated by size by the agent). `prism-agent service install|uninstall` writes or removes it and runs `launchctl bootstrap|bootout system`. `run` notices `SIGTERM` from launchd.
- **Uninstall:** `sudo prism-agent uninstall` stops and removes the daemon and the LaunchAgent, the app and the binaries, and keeps the enrolment unless `--remove-data`. (A `.pkg` has no uninstaller of its own.)
- **Snapshot:** OS and build, uptime, memory in use (`vm_stat` and `hw.memsize`), free space per volume, the console user, the directory binding, IP addresses, agent version and time taken; shared `BuildSnapshot`.

- [ ] **Step 1: Failing tests:** the daemon plist runs `prism-agent run` as root with `KeepAlive`; `vm_stat` output parses to memory in use; the snapshot has the spec's fields.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): Mac launchd daemon, uninstall and health snapshot`

### Task 6: Self-update on the Mac

**Files:** Create `agent/internal/update/update_darwin.go`. Test: `agent/internal/update/update_test.go` (shared, already covers the checks).

- The updates folder is `/Library/Application Support/PRISM/updates`, `0700 root:wheel`, reset on each update (as the Windows ACL is).
- After the shared checks (newer version, the install's signature, size and sha256), run `/usr/sbin/installer -pkg <file> -target /` in its own session (`Setsid`), so `launchctl` restarting the daemon from the package's `postinstall` doesn't end the installer. The installer's output goes to `install-<version>.log` beside the package.
- A downloaded file carries no quarantine attribute and `installer` run as root doesn't consult Gatekeeper, so updates need no override (spec). The PRISM signature is the gate.

- [ ] **Step 1: Failing tests:** the shared refusals still pass on macOS; the install command is exactly `installer -pkg <checked path> -target /`, never built from the offer's text.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(agent): signed self-update on the Mac`

### Task 7: The menu-bar app and the ticket window

**Files:**
- Create: `agent/cmd/prism-tray/main_darwin.go`, `agent/cmd/prism-tray/form_darwin.go`, `agent/packaging/macos/PRISM Agent.app/Contents/Info.plist` (`LSUIElement` true, `LSMinimumSystemVersion` 13.0, bundle id `com.prism.tray`), `agent/packaging/macos/com.prism.tray.plist` (LaunchAgent: `LimitLoadToSessionType` Aqua, `RunAtLoad`)
- Test: `agent/internal/trayui/form_test.go` (unchanged page), a build check that the Mac tray compiles with cgo on `macos-latest`.

- **Menu** (TrayMac board): **Submit a ticket…** (Mac menus use the ellipsis for items that open a window), Open the support portal (only when the portal is on), a status line ("Dr-Patel-MacBook · connected", "· can't reach the help desk", "The PRISM Agent service isn't running"), About PRISM Agent. A template icon, so it follows the menu bar's light or dark look.
- **Window:** `prism-tray form` in its own process, as on Windows; WKWebView 460×660, the same `trayui` page (Light or Dark from the system appearance), the same asynchronous send. The draft goes in `~/Library/Application Support/PRISM/draft.json` (0600). Links open with `open` only for an `https://` portal address.
- One menu-bar icon per user session (a lock file in the user's temporary folder).

- [ ] **Step 1:** The tray builds for darwin/arm64 and darwin/amd64 with cgo on `macos-latest`; the page tests still pass; the draft path is the user's own.
- [ ] **Step 2:** Screenshots of the window in Light and Dark from Chromium (as in 8a) match the TrayForm and TraySent boards; the menu matches TrayMac.
- [ ] **Step 3: Commit** `feat(agent): Mac menu-bar app and Submit a ticket window`

### Task 8: The `.pkg` and CI

**Files:**
- Create: `agent/packaging/macos/` (`build.sh`, `scripts/preinstall`, `scripts/postinstall`, `com.prism.agent.plist`, `distribution.xml`)
- Modify: `.github/workflows/agent.yml` (a `macos` job beside `windows`, and a `manifest` job that joins both into `agent-dist`), `.github/workflows/docker-publish.yml` (unchanged contract: it still downloads `agent-dist`)

- **Build:** both architectures with cgo (`CGO_ENABLED=1`, `-arch` per build), joined with `lipo`, ad-hoc signed with `codesign -s - --force --options runtime`. Version stamping as in 8a.
- **Package:** installs `prism-agent` to `/Library/Application Support/PRISM/bin/` with a `/usr/local/bin/prism-agent` link, `PRISM Agent.app` to `/Applications/Utilities/`, and the two launchd plists. `preinstall` stops a running daemon; `postinstall` sets owners and modes, bootstraps the daemon and, for each signed-in user, the LaunchAgent. `distribution.xml` requires macOS 13 and lists both architectures.
- **Optional signing:** when `APPLE_DEVELOPER_ID_APP`, `APPLE_DEVELOPER_ID_INSTALLER` and the notarisation secrets exist, sign with the Developer ID, `productsign` the package and notarise it with `notarytool`; otherwise skip (as `AGENT_SIGNING_PFX` on Windows).
- **Manifest:** `prism-agent-<version>-macos-universal.pkg`, listed for both `macos/amd64` and `macos/arm64` (one file, two entries), beside the two Windows entries.
- **Install test** on `macos-latest` against `agent/tools/stubprism`:
  1. `sudo installer -pkg … -target /` succeeds; the daemon is loaded (`launchctl print system/com.prism.agent`).
  2. `sudo prism-agent enroll` with a wrong key is refused and leaves no key file; with the right key it enrols, and a correctly signed heartbeat from the daemon reaches the stub.
  3. The key file is `0600 root:wheel`; the socket is root's; a normal user's `prism-agent status` works and can't read the key.
  4. Enrolling again with the same PRISM changes nothing.
  5. `sudo prism-agent uninstall` removes the daemon, the app and the binaries and keeps the enrolment; `--remove-data` removes it.

- [ ] **Step 1:** The install test above passes on `macos-latest`; the Windows job is unchanged; `agent-dist` holds three packages and one manifest.
- [ ] **Step 2: Commit** `ci(agent): build, package and test the Mac agent`

### Task 9: The Mac on the staff screens

**Files:**
- Modify: `frontend/src/components/companies/CompanyDevices.jsx` (the macOS tab), `backend/src/controllers/devicesController.js` (a package's display name), `frontend/src/components/assets/AssetDevice.jsx` (Mac wording)
- Test: `backend/test/integration/agent.staff.test.js` (Mac packages listed and downloaded), `backend/test/smoke/agent.smoke.js` (the macOS tab), and a Mac inventory fixture through the server (`backend/test/fixtures/agent/macos15.json` in `agent.inventory.test.js`).

- **Devices → Install command → macOS:** Download for Mac (`.pkg`, universal), then three steps:
  1. Open the package. The first time, macOS blocks it: **System Settings → Privacy & Security → Open Anyway** (TrayMac board note).
  2. Install.
  3. In Terminal: `sudo prism-agent enroll --url <this PRISM> --key <the new key>` (Copy, enabled only right after the key is created, as on Windows).
- **Asset Device tab:** "Joined to" reads "<domain> (Active Directory, bound with dsconfigad)" on a Mac; disks show "Internal" / "External"; the OS line reads "macOS 15.1 · build 24B83".
- **Server:** no new endpoints; `GET /devices/packages` lists the Mac package once (it covers both architectures), with "Universal" in its label.

- [ ] **Step 1: Failing tests:** a Mac inventory fixture fills the Asset ("Apple", "MacBook Air (M3)", "macOS", "15.1 (24B83)", storage counted once); the Mac package is listed once and downloads for both architectures; the smoke test shows the macOS steps and the enrol command with the new key.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS (with the `assets.*` and `companies.page` smokes).
- [ ] **Step 5: Commit** `feat(agent): the Mac on the Devices and Asset screens`

### Task 10: Finish

- [ ] **Step 1:** ROADMAP row 8 → "8b shipped to `dev`"; UPGRADING `## Unreleased`: installing on a Mac (the package, the Gatekeeper override once per Mac, `sudo prism-agent enroll`), uninstalling, that Macs are installed by hand until there's a Developer ID, and the network needs (as Windows).
- [ ] **Step 2:** Full backend and smoke suites, and the agent workflow (Windows and Mac jobs), all green.
- [ ] **Step 3:** Security review (Review Focus above), fix pass, commit, push to `dev`.
- [ ] **Step 4:** Hand test by the owner on a real Mac (Apple silicon; and an Intel one if there is one), macOS 14 or 15: install with the override, enrol, the Asset appears with its apps, a menu-bar ticket arrives, an update installs itself, revoke stops it, uninstall cleans up.

## Notes on the spec

- **The device key is a root-only file, not the System keychain, for now.** A keychain item's access list trusts an app by its code signature. With ad-hoc signing (no Developer ID), every build has a different signature, so after each self-update the daemon would lose access to its own key and, having no user session, couldn't answer the prompt. A `0600 root:wheel` file is readable only by root, as the keychain item would be. When a Developer ID is bought, the key moves into the System keychain, trusted by the stable Team ID, in a later release.
- **Enrolment after install, not inside it.** A `.pkg` can't take properties the way an MSI does, so `sudo prism-agent enroll` is a separate step, as the spec says. For MDM later (with a Developer ID), the package will also read a pre-placed `/Library/Application Support/PRISM/enroll.json`; not in 8b.
- **No `SPApplicationsDataType`.** The spec names "the installed-apps list". Reading the bundles in `/Applications` gives the same list in well under a second, where `system_profiler` takes tens of seconds and searches the whole disk.
- **Model names without the year.** "MacBook Air (M3)" rather than the mockup's "MacBook Air (M3, 2024)": macOS gives the year only through Apple's online lookup or a table PRISM would have to maintain.
