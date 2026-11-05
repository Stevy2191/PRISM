# PRISM agent 8c — Linux (Ubuntu, Fedora, Arch): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Linux computer running Ubuntu (22.04, 24.04 or the current release), Fedora (the two current releases) or Arch gets the PRISM agent from its own package (`.deb`, `.rpm` or `.pkg.tar.zst`) and one `sudo prism-agent enroll …` command. It appears as an Asset of its company with its hardware, distribution, disks, network, installed software, usual user and online status, kept current. On a desktop, its tray icon (or the **Submit a ticket** launcher app) raises a ticket linked to that Asset with a health snapshot. It updates itself, in its own package format, only to builds signed by the install. With 8a and 8b this completes sub-project 8, released as **v0.5.0**.

**Architecture:**
- **Same Go module and programs.** Linux code lives in `_linux.go` files. The Unix-socket channel and the root-only key file are already shared with macOS, and everything platform-neutral (signing, schedules, enrollment, `Assemble`, `ipc.Server`, `trayui`, `update.Updater`) is reused as it is.
- **Service:** a systemd unit, `prism-agent.service`, running `prism-agent run` as root. Logs go to the journal.
- **Tray:** `prism-tray`, a StatusNotifierItem icon (`fyne.io/systray`'s Linux backend talks D-Bus in pure Go), started at each graphical sign-in through `/etc/xdg/autostart`. The ticket window is WebKitGTK (cgo). Because GNOME shows tray icons only with its AppIndicator extension, every desktop also gets a **Submit a ticket** launcher app that opens the window directly (spec).
- **Tray ↔ service:** `/run/prism-agent.sock`, the user taken from `SO_PEERCRED`. The macOS socket code becomes shared Unix code with a per-platform peer-credential call.
- **Packages:** built from the same files by **nfpm**: `.deb` (Ubuntu, Debian, Mint, Pop!_OS), `.rpm` (Fedora, RHEL, Rocky, Alma) and `.pkg.tar.zst` (Arch, Manjaro, EndeavourOS), each for x86_64 and arm64.
  - The service is one static binary.
  - The tray is built once per architecture on Ubuntu 22.04 (the oldest glibc of the three) against `libwebkit2gtk-4.1` and `libgtk-3`. Their sonames are the same on all three distributions, and each package declares those libraries under its own distribution's names.
- **Updates:** a computer's package format (`deb`, `rpm` or `pacman`) is part of its device record. PRISM offers the newest package in that format, and the agent installs it through its package manager, run outside the service's control group (`systemd-run`) so stopping the service doesn't stop the install.

**Tech Stack:**
- **Agent:** Go 1.24 as before; `fyne.io/systray` (Linux: D-Bus StatusNotifierItem, no cgo), `github.com/webview/webview_go` (WebKitGTK 4.1, cgo), `golang.org/x/sys/unix` (`SO_PEERCRED`, `statfs`). Tools the distributions ship: `loginctl`, `realm`, `lsblk`, `dpkg-query`/`apt-mark`, `rpm`/`dnf`, `pacman`, and optionally `flatpak` and `snap`.
- **Packaging:** nfpm (one `nfpm.yaml`, three packagers), on `ubuntu-22.04` (x86_64) and `ubuntu-22.04-arm` (arm64) runners.
- **Backend and frontend:** migration 079 (`Devices.packageFormat`), nothing else new (076 and 077 went to checkout forms and Scan now, 078 to the enrollment spelling).

**Spec:** `docs/superpowers/specs/2026-11-03-agent-inventory-tray-design.md` (the Per platform table, Linux distributions, Updates)
**Plans 8a and 8b:** `docs/superpowers/plans/2026-11-03-agent-8a-server-windows.md`, `docs/superpowers/plans/2026-11-04-agent-8b-macos.md`
**Mockups:** `docs/mockups/agent-8/` (approved 2026-11-03). Boards: `TrayLinux`, plus `TrayForm` and `TraySent`, which Linux shares with the other two.

## Global Constraints

Everything in 8a's and 8b's Global Constraints holds (read-and-report only, signed requests, per-company keys, agent-owned fields, no contacts created except the placeholder, inventory as untrusted text, per-device limits, root only where it matters, no prompt the service can't answer). For Linux, also:

- **Any systemd distribution in the three families works**, with no distribution-specific code beyond the package format and package list. Other distributions (openSUSE, Alpine, NixOS…) are out of scope (spec).
- **Servers have no tray.** The tray and launcher are installed but only start in a graphical session; a server is inventoried and online like any other computer.
- **The software list is what a person installed,** not every library. That means the packages marked as explicitly installed (`apt-mark showmanual`, `dnf repoquery --userinstalled`, `pacman -Qe`), plus Flatpak and Snap apps. A default Ubuntu desktop has around 2,000 packages, most of them libraries; staff want the applications. See Notes on the spec.
- **Every external command** runs with fixed arguments, a timeout and no shell, as on macOS.

## Review Focus

- **Tray identity:** the requester comes from `SO_PEERCRED` on the socket, never from the message → Task 1.
- **Socket trust:** the tray talks only to a root-owned socket in `/run`, not a symlink, not in a folder others can write to → Task 1 (shared with macOS).
- **Key storage:** the device key is root's alone, mode 0600, refused if wider → shared since 8b; the package keeps `/var/lib/prism-agent` at mode 0700.
- **Update trust:** a package signed with another install's key, a wrong hash, a lower version or another package format is refused; the package manager only ever installs the checked file, from a root-only folder, outside the service's control group → Tasks 5 and 6.
- **Package scripts:** the maintainer scripts run as root on every install, upgrade and removal. They do only what's listed in Task 8 and never source or run anything from the data folder.

---

### Task 1: The socket on Linux, and who is at the computer

**Files:**
- Modify: `agent/internal/ipc/socket_darwin.go` → `socket_unix.go` (`darwin || linux`), with `peerUID` in `peercred_darwin.go` (`LOCAL_PEERCRED`) and `peercred_linux.go` (`SO_PEERCRED`, `GetsockoptUcred`). Linux's path is `/run/prism-agent.sock`.
- Create: `agent/internal/inventory/linuxuser.go` (parsing, every OS), `agent/internal/inventory/user_linux.go`
- Test: `agent/internal/ipc/socket_unix_test.go` (the 8b tests, now on Linux and macOS), `agent/internal/inventory/linuxuser_test.go`

- **The person at the screen:** the active graphical session from `loginctl list-sessions`, then `loginctl show-session <id> -p Active -p Type -p Remote -p Name -p User`. That means Type `x11` or `wayland`, active, and not remote. No such session (a server, or the login screen) means no signed-in user.
- **Realm:** `realm list --name-only` (realmd, SSSD) gives the AD or IPA domain. The account is `DOMAIN\user` (first label of the domain, upper-cased, as on Windows and macOS) or the plain name.
- **UPN:** a realm user's name is often `user@domain` already (SSSD with `use_fully_qualified_names`); otherwise `user@<realm domain>` when joined; else none (the placeholder). The same `IsPerson`-style checks as macOS apply (uid ≥ 1000, a safe name).

- [x] **Step 1: Failing tests:** `loginctl` output parses to the active graphical local session and skips remote, TTY and greeter sessions; `realm list` gives the domain; account and UPN rules for joined, `user@domain` and plain accounts; the socket tests from 8b pass on Linux (the caller identified by `SO_PEERCRED`, the message's account ignored, a socket of the wrong owner, a symlink or a writable folder refused, a second server refused, a stale socket replaced).
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS (`ubuntu-latest` and `macos-latest`).
- [x] **Step 5: Commit** `feat(agent): Linux socket and signed-in user`

**As built (2026-11-04):**
- **Shared socket:** `ipc/socket_unix.go` (`darwin || linux`) is the 8b socket, unchanged apart from where it gets the caller. `peercred_darwin.go` (`LOCAL_PEERCRED`, `/var/run/prism-agent.sock`) and `peercred_linux.go` (`SO_PEERCRED` through `GetsockoptUcred`, `/run/prism-agent.sock`) give the uid, and `inventory.PersonFor(uid)` (per platform) the person. The refusal text is now "The computer couldn't say who you are."
- **Parsing** (`linuxuser.go`, tested on every OS):
  - `ParseSessionIDs` and `ParseKeyValues` read `loginctl`. `IsDesktopSession` means active, local, `x11` or `wayland`, class `user` (so no greeter, SSH or text console).
  - `ParseRealmList`, and `ParseGetentPasswd`.
  - `IsLinuxPerson`: uid 1000 or above, not `nobody`, and a safe name; SSSD's `user@domain` names are allowed.
  - `LinuxPerson`: `DOMAIN\\user` plus `user@domain` from a fully qualified name or the realm, else the plain name and no UPN.
- **`user_linux.go`:**
  - `nameFor` uses Go's own lookup, then `getent passwd <uid>`, since the static service binary's lookup reads only `/etc/passwd` and SSSD users aren't in it.
  - `PersonFor(uid)` and `desktopUser()` (Task 2 uses it for the inventory's signed-in user) check each `loginctl` session id is safe before passing it as an argument.
  - On macOS, `PersonFor` wraps `MacUserFor`.
- **Commands:** `run` moved to `cmd_unix.go` (`darwin || linux`). A tool named without a path is looked for only in `/usr/bin`, `/usr/sbin`, `/bin` and `/sbin`, never the inherited `PATH`, since its location varies between distributions.
- **Tests:** the parsing tests here; `TestPersonForThisProcess` and `TestDesktopUserOnThisComputer` live on Linux. The 8b socket tests now run on Linux as well as macOS. Run here as a test user (uid 1500), the caller was identified by `SO_PEERCRED` as `ptest` with the message's `EVIL\\boss` ignored; the wrong owner, a symlink, a writable folder and a second server were refused; and a stale socket was replaced. GitHub's Ubuntu runner (an ordinary user) runs them on every push.

### Task 2: Linux inventory

**Files:**
- Create: `agent/internal/inventory/linuxparse.go` (every OS), `agent/internal/inventory/collect_linux.go`, `agent/internal/inventory/testdata/linux-*` (from an Ubuntu 24.04 laptop, a Fedora 41 desktop, an Arch desktop and an Ubuntu 22.04 server VM)
- Test: `agent/internal/inventory/linuxparse_test.go`, `agent/internal/inventory/live_linux_test.go`

**Sources:**
- `/sys/class/dmi/id/`: `sys_vendor`, `product_name` (with `product_version` where the vendor puts the model there, as Lenovo does), `product_serial` (root only, read by the service), `bios_version`. Placeholder values are dropped by the shared rules.
- `/proc/cpuinfo` (`model name`, cores counted from distinct `physical id`/`core id` pairs), `/proc/meminfo` (`MemTotal`), `/proc/uptime` and the boot time.
- `/etc/os-release`: `NAME`, `PRETTY_NAME`, `VERSION_ID` and `VERSION_CODENAME`, shown as "Ubuntu" with "24.04 (noble)", "Fedora Linux" with "41", and "Arch Linux" with "rolling".
- Disks: `/proc/self/mountinfo` and `statfs` for real file systems (ext4, xfs, btrfs, f2fs, vfat, exfat, ntfs3), the root file system counted once (btrfs subvolumes of one device too). `lsblk -J -o NAME,TRAN,RM,HOTPLUG,MOUNTPOINTS` marks `usb`, `external` (Thunderbolt, other hot-plug) and `removable`. Network and container mounts (`overlay`, `tmpfs`, `nfs`, `cifs`, `fuse.*`, `/snap/*`) are skipped.
- Network: Go's interfaces as on the other platforms (names such as `enp3s0` and `wlp2s0` are kept), with virtual ones (`docker0`, `veth*`, `br-*`, `virbr*`, `tailscale0`, `wg*`) skipped; the default route's address as the primary.
- Software, by what the system has:
  - `.deb`: `apt-mark showmanual` and `dpkg-query -W -f` for versions; publisher from `Maintainer`, install date from the `.list` file's date.
  - `.rpm`: `dnf repoquery --userinstalled` (`dnf5` or `dnf4`) and `rpm -q --qf` for version, vendor and install time.
  - pacman: `pacman -Qe` and `pacman -Qi` for version, packager and install date.
  - Plus `flatpak list --app --columns=…` and `snap list` when present.
  - Capped at the server's 5,000, explicit packages first.

- [x] **Step 1: Failing tests:** the four fixtures give the payload 8a's server reads (make, model, serial, CPU and cores, memory, "Ubuntu" / "24.04 (noble)", disks counted once with a USB disk marked, adapters without the virtual ones); each package manager's output parses to programs with versions, publishers and dates; Flatpak and Snap apps are added; a missing tool or a timeout leaves those fields empty.
- [x] **Step 2: Live test on `ubuntu-latest`:** `collect` returns Ubuntu, a disk, memory and some software.
- [x] **Step 3–4:** Implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): Linux inventory`

**As built (2026-11-05):**
- Parsers in `linuxparse.go` (every OS): `ParseOSRelease`/`LinuxOS`, `LinuxModel` (Lenovo's model from `product_version`), `ParseCPUInfo` (distinct physical/core id pairs; `cpu cores`, then the processor count, as on ARM), `ParseMemTotal`, `ParseUptime`, `ParseMountInfo` (octal escapes decoded), `ParseLsblk` (partitions, LUKS and LVM take their disk's bus; `rm`/`hotplug` as booleans or "0"/"1"), `LinuxDisks`, `LinuxVirtualAdapter`, `ParseDpkg`, `ParseRPM`, `ParsePacman`, `ParseFlatpak`, `ParseSnapList` (the snap system's own snaps left out).
- Disks: the root first; each device once by major:minor (btrfs subvolumes, bind mounts); `/boot`, `/efi`, snaps, container storage and `/run` (but `/run/media`) skipped; label from lsblk, else the `/media` folder name. A disk under `/media` with no lsblk entry counts as external.
- `dnf -C` (cache only) so the inventory never goes to the network; `pacman -Qei` under `LC_ALL=C` (new `runEnv`) so dates parse. Fedora's version has no codename ("41"); Arch is "rolling".
- Fixtures: this container's real Ubuntu 24.04 `os-release`, `cpuinfo` and `dpkg-query` lines; the Fedora, Arch, laptop and ARM samples follow those tools' documented formats (no such machines to capture from). The live test on `ubuntu-latest` checks distribution, memory, a disk and software.
- On a computer without systemd-logind (a container) the signed-in user is reported as a problem and left empty, as intended.


### Task 3: The health snapshot and the realm

**Files:** Create `agent/internal/inventory/snapshot_linux.go`. Test: `linuxparse_test.go` (meminfo), `live_linux_test.go`.

- OS and version, uptime, memory in use (`MemTotal − MemAvailable`), free space per file system (Task 2's rules), the signed-in account, the realm in the snapshot's `realm` field ("Active Directory: riverside.local"), IPv4 addresses, the agent version and the time taken. The server's note already shows a Realm line.

- [x] **Step 1: Failing tests:** `/proc/meminfo` gives memory in use; the snapshot has the spec's fields and the realm.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): Linux health snapshot`

**As built (2026-11-05):** `ParseMemAvailable` and `ParseRealm` (from `realm list`: "Active Directory: …", "IPA: …", or the realm alone; the first realm only) in `linuxparse.go`; `SnapRaw.Realm` carried into the snapshot's `realm`. Memory is left out (not shown as all in use) on kernels without `MemAvailable`. The snapshot reuses Task 2's disks and adapters and runs no package lists, so a ticket isn't held up.


### Task 4: The systemd service

**Files:**
- Create: `agent/internal/service/service_linux.go`, `agent/packaging/linux/prism-agent.service`
- Modify: `agent/cmd/prism-agent/main.go` (`uninstall` on Linux names the package manager command)
- Test: `agent/internal/service/systemd_test.go` (the unit file)

- **Unit:**
  - `Type=simple`, `ExecStart=/usr/bin/prism-agent run`, `Restart=on-failure`, `RestartSec=30`, `KillMode=mixed`.
  - Hardening that still lets the inventory read what it needs: `ProtectSystem=full`, `ProtectHome=read-only`, `PrivateTmp=yes`, `NoNewPrivileges=no` (the update installs packages), `ReadWritePaths=/var/lib/prism-agent /run`.
  - `WantedBy=multi-user.target`.
- **`prism-agent service install|uninstall`** writes or removes the unit and enables or disables it (for running from a tarball by hand). The packages ship the unit themselves.
- **`prism-agent uninstall`** on Linux says which command removes the package (`sudo apt remove prism-agent`, `sudo dnf remove prism-agent`, `sudo pacman -R prism-agent`), and that purging (`apt purge`) or `--remove-data` also forgets the enrollment.
- **Logs** go to the journal (`journalctl -u prism-agent`), so no log file and no rotation.

- [x] **Step 1: Failing tests:** the unit runs `prism-agent run` as root, restarts on failure, and allows writing only its data folder and `/run`.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): Linux systemd service`

**As built (2026-11-05):** the unit is `service.Unit` in `systemd.go` (no build tag, tested everywhere); `packaging/linux/prism-agent.service` is generated from it by `go run ./tools/genunit`, and a test fails if they differ (kept LF by `.gitattributes`, as the Mac files are). Also `Wants`/`After=network-online.target`. `systemd-analyze verify` accepts it. `prism-agent uninstall` on a packaged install (the unit in `/usr/lib/systemd/system`) refuses and names the package manager's command (and `rm -rf /var/lib/prism-agent` for `--remove-data`); on a hand install it stops, disables and removes the unit, and the data folder with `--remove-data`.


### Task 5: Package formats on the server

**Files:**
- Create: `backend/migrations/20260101000079-agent-package-format.js` (`Devices.packageFormat` ENUM `msi`, `pkg`, `deb`, `rpm`, `pacman`, null)
- Modify: `backend/src/services/agent/enrollment.js` and `routes/agent.js` (the agent sends `packageFormat` at enrollment and on each heartbeat; Windows `msi`, macOS `pkg`), `backend/src/services/agent/updates.js` (manifest entries gain `format`; `latestPackage(platform, arch, format)`; Windows and Mac entries without one keep working), `backend/src/controllers/devicesController.js` (the packages list and download by format)
- Modify: `agent/internal/enroll/enroll.go` and the heartbeat (send the format: from `/etc/os-release` `ID` and `ID_LIKE` on Linux, together with which package manager exists)
- Test: `backend/test/integration/agent.update.test.js`, `agent.staff.test.js`, `agent.model.test.js` (the migration's round trip), `agent/internal/enroll/enroll_test.go`

- [x] **Step 1: Failing tests:** a `deb` device is offered the newest `.deb` and never an `.rpm` of a higher version; a device that hasn't said its format (enrolled with 8a's agent) on Linux is offered nothing; Windows and Mac offers are unchanged; the signed text stays `platform|arch|version|sha256` (the sha256 already pins the file); the packages list has one Linux entry per format and architecture; the migration rolls back and forward.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): package formats for Linux updates`

**As built (2026-11-05):** `Devices.packageFormat` is a STRING(10) (not an ENUM: the allowed values live in `updates.FORMATS`, per platform), migration 079. A format that isn't the device's platform's is ignored at enrollment and on heartbeat, never stored. `latestPackage(platform, arch, format)` defaults to the platform's one format for Windows (msi) and macOS (pkg); Linux has no default, so an agent that hasn't said is offered nothing. Manifest entries without `format` count as msi/pkg. Staff downloads: `/devices/packages/linux/:arch?format=deb|rpm|pacman` (400 without it). The agent decides with `enroll.LinuxPackageFormat` (ID, then ID_LIKE: debian/ubuntu → deb, fedora/rhel/centos → rpm, arch → pacman; else whichever of dpkg-query, pacman, rpm is installed) and sends it at enrollment and on every heartbeat. The two migration round-trip tests re-apply 079 after rebuilding Devices.


### Task 6: Self-update on Linux

**Files:** Create `agent/internal/update/update_linux.go`. Test: `update_linux_test.go`, plus the shared update tests.

- After the shared checks, the install runs as its own transient unit, so systemd stopping `prism-agent.service` during the upgrade doesn't kill it: `systemd-run --unit=prism-agent-update --collect --quiet -- <manager> <args> <checked file>`.
  - `.deb`: `apt-get install -y --allow-downgrades=no ./<file>` (the leading `./` makes apt install a local file).
  - `.rpm`: `dnf install -y <file>`.
  - pacman: `pacman -U --noconfirm <file>`.
- The package's own scripts restart the service. The updates folder is `/var/lib/prism-agent/updates` (0700, as on the other platforms).

- [x] **Step 1: Failing tests:** each format gives exactly its command on the checked path, wrapped in `systemd-run`; the shared refusals still pass on Linux.
- [x] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [x] **Step 5: Commit** `feat(agent): signed self-update on Linux`

**As built (2026-11-05):** `Updater.Format` (from `enroll.PackageFormat()`) names the downloaded file (`extFor`: .deb, .rpm, .pkg.tar.zst; Windows and Mac keep their one), and the Linux installer goes by the checked file's extension. The unit is `prism-agent-update-<version>` (characters other than letters, digits, `.` and `-` replaced), `--collect --quiet --setenv=DEBIAN_FRONTEND=noninteractive`. For `.deb`, apt keeps changed config files (`--force-confdef --force-confold`) rather than stop to ask; apt's default already refuses a downgrade (and the updater only takes newer versions). A relative path or another extension is refused.


### Task 7: The tray, the launcher and the ticket window

**Files:**
- Create: `agent/cmd/prism-tray/platform_linux.go` (`linux && cgo`), `agent/packaging/linux/prism-tray.desktop` (autostart, `OnlyShowIn` unset, `X-GNOME-Autostart-enabled=true`), `agent/packaging/linux/prism-submit-ticket.desktop` (the launcher: Name "Submit a ticket", `Exec=prism-tray form`), an SVG icon for both
- Modify: `agent/cmd/prism-tray/tray.go` (the build tag gains `linux && cgo`), `main_linux.go` → the no-cgo stub
- Test: the CI build (`go build ./cmd/...` on `ubuntu-latest` with `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`), `trayui` unchanged

- **Icon:** the StatusNotifierItem shows the boxed P (a symbolic PNG). Menu: **Submit a ticket**, Open the support portal, the status line, About (TrayLinux board).
- **Window:** WKWebView's Linux counterpart, WebKitGTK 4.1 through `webview_go`, 460×660, following the GTK theme's light or dark preference (the page's `prefers-color-scheme`). The draft goes in `~/.config/PRISM/draft.json`.
- **One icon per session:** a lock in `$XDG_RUNTIME_DIR`. Links open with `xdg-open`, for an https portal address only.
- **Without a tray** (GNOME without the AppIndicator extension), the icon never appears, and the launcher app is the way in.

- [x] **Step 1:** The tray builds for linux/amd64 and linux/arm64 with cgo on Ubuntu 22.04; the page tests pass; the draft path is the user's own.
- [ ] **Step 2:** The menu and window are checked by hand on Ubuntu (GNOME, with Ubuntu's AppIndicator), Fedora (GNOME: launcher only, unless the extension is installed) and Arch (KDE).
- [x] **Step 3: Commit** `feat(agent): Linux tray, launcher and ticket window`

**As built (2026-11-05):**
- `webview_go` asks pkg-config for `webkit2gtk-4.0`, which Ubuntu 24.04 and Fedora 40+ no longer ship. `packaging/linux/pkgconfig/webkit2gtk-4.0.pc` is a shim requiring `webkit2gtk-4.1` (same C API), used through `PKG_CONFIG_PATH` in CI and the package build; the tray links `libwebkit2gtk-4.1.so.0`.
- Built and opened here on Ubuntu 24.04 under Xvfb: the form renders at 460×660 (screenshot in the session). The tray icon is the 32×32 PNG (`trayPNG`, split out of the Windows `.ico`).
- Locks in `$XDG_RUNTIME_DIR` (else `~/.cache/PRISM`). A second "Submit a ticket" while the window is open does nothing: window managers don't let one process raise another's window.
- `prism-tray.desktop` (autostart, `NoDisplay`) and `prism-submit-ticket.desktop` (the launcher) pass `desktop-file-validate`; the icon is `prism-agent.svg`.
- `test.yml`'s Linux agent job installs `libgtk-3-dev` and `libwebkit2gtk-4.1-dev` and sets the shim, since vet and build now compile the tray with cgo there.
- Step 2 (the hand check on Ubuntu, Fedora and Arch) waits for the packages (Task 8).


### Task 8: The packages

**Files:** Create `agent/packaging/linux/nfpm.yaml`, `agent/packaging/linux/scripts/{postinstall,preremove,postremove}`, `agent/packaging/linux/build.sh`.

- **Contents:**
  - `/usr/bin/prism-agent` (static, `CGO_ENABLED=0`) and `/usr/bin/prism-tray` (cgo).
  - `/usr/lib/systemd/system/prism-agent.service`.
  - `/etc/xdg/autostart/prism-tray.desktop`.
  - `/usr/share/applications/prism-submit-ticket.desktop`, and the icons under `/usr/share/icons/hicolor`.
  - `/var/lib/prism-agent` (0700 root) as the data folder.
- **Dependencies:** the service needs only systemd. The tray's libraries are weak dependencies, which a normal install pulls in but a server can leave out:
  - `.deb` Recommends: `libgtk-3-0 | libgtk-3-0t64, libwebkit2gtk-4.1-0, libayatana-appindicator3-1 | libappindicator3-1` (`apt install --no-install-recommends` skips them).
  - `.rpm` Recommends: `gtk3, webkit2gtk4.1` (`dnf --setopt=install_weak_deps=False` skips them).
  - Arch `optdepends`: `gtk3, webkit2gtk-4.1` (installed with `pacman -S --asdeps` when wanted; the package notes it).
  - `prism-tray` checks at start that the libraries are there, and otherwise exits quietly with a line in the journal.
- **Scripts:**
  - **postinstall:** `systemctl daemon-reload`, then `enable --now prism-agent`; on upgrade, `try-restart`.
  - **preremove:** `stop` and `disable` (not on upgrade).
  - **postremove:** `daemon-reload`, and on purge (`.deb`) also removes `/var/lib/prism-agent`.
  - Nothing else, and nothing read from the data folder.
- **Config path:** `config.Dir()` on Linux becomes `/var/lib/prism-agent` (already), and the socket `/run/prism-agent.sock`.
- **Signing:** when the `AGENT_GPG_KEY` secret exists, nfpm signs the `.rpm` and `.pkg.tar.zst` (and the `.deb` with a detached signature), and CI publishes the public key beside the packages. See Notes on the spec.

- [x] **Step 1:** `build.sh` makes six packages (three formats × two architectures) from one version; `rpm -qpR`, `dpkg-deb -I` and `pacman -Qip` show the right dependencies and scripts.
- [x] **Step 2: Commit** `feat(agent): Linux packages`

**As built (2026-11-05):**
- `nfpm.yaml` is a template; `build.sh` fills in version, architecture and the binaries' folder and makes the three formats for one architecture (CI runs it per architecture, Task 9). Checked here with nfpm v2.41.1 for amd64: contents, modes (`/var/lib/prism-agent` 0700 root), dependencies and scripts in all three; the .deb installed, upgraded, removed (enrollment kept) and purged (enrollment gone).
- Versions: .deb and .rpm `0.0.0~dev.N` (before any release); Arch `0.0.0.dev.N`, because nfpm drops a pre-release from Arch's pkgver unless there's an epoch, so `build.sh` gives Arch the version with dots for the dash.
- Arch: nfpm can't write `optdepends`, so `gtk3` and `webkit2gtk-4.1` are plain dependencies there (on .deb and .rpm they stay weak: Recommends).
- Scripts: one `postinstall` for .deb (`configure [old]`) and .rpm (count), plus Arch's `postupgrade`; `preremove` does nothing on an upgrade, else disables the service and closes the trays; `postremove` reloads systemd and on `apt purge` removes the data folder. They skip systemctl when systemd isn't running (a container).
- A tray whose libraries are missing (a server installed without recommends) can't start: the dynamic loader stops it, and the autostart entry fails quietly into the journal. Not handled in the tray itself.
- Not done: signing the packages (`AGENT_GPG_KEY`). The update path doesn't need it (updates are checked with the install's own Ed25519 key); it would matter only for installing from a repository.


### Task 9: CI — build and install-test on the three distributions

**Files:** Modify `.github/workflows/agent.yml` (a `linux` job matrix on `ubuntu-22.04` and `ubuntu-22.04-arm`, an install-test matrix, and the manifest job), `.github/workflows/test.yml` (the agent job installs the GTK and WebKitGTK headers so `go build ./cmd/...` builds the Linux tray).

- **Build:** both architectures, all three formats; the manifest gets one entry per format and architecture (`linux/amd64/deb`, …).
- **Install test, in containers** (`ubuntu:22.04`, `ubuntu:24.04`, `fedora:latest`, `archlinux:latest`, on x86_64):
  1. The package installs with its dependencies through the distribution's own manager.
  2. The files, modes and owners are right; a wrong key is refused.
  3. Enrollment, then `prism-agent run` started directly (no systemd in a plain container) sends a signed heartbeat to `stubprism`.
  4. The socket identifies a test user through `SO_PEERCRED`.
  5. Re-enrolling changes nothing, and the package removes cleanly (purge removes the data).
- **systemd for real**, on the runner itself (`ubuntu-22.04`, which has systemd): install the `.deb`, check the service is active and sends a heartbeat after `enroll` and `systemctl restart`, then `apt-get remove`.

- [ ] **Step 1:** The four container tests and the host test pass; Windows and macOS are unchanged; `agent-dist` holds 2 MSIs, 1 `.pkg` and 6 Linux packages, with one manifest.
- [ ] **Step 2: Commit** `ci(agent): build, package and test the Linux agent`

### Task 10: Linux on the staff screens

**Files:**
- Modify: `frontend/src/components/companies/CompanyDevices.jsx` (the Linux tab), `frontend/src/components/assets/AssetDevice.jsx` (realm wording)
- Test: `backend/test/fixtures/agent/ubuntu2404.json` through `agent.inventory.test.js`; `agent.smoke.js` (the Linux tab)

- **Devices → Install command → Linux:** a choice of Ubuntu/Debian (`.deb`), Fedora/RHEL (`.rpm`) and Arch (`.pkg.tar.zst`), each with its x86_64 or ARM download and its install command (`sudo apt install ./prism-agent_….deb`, `sudo dnf install ./prism-agent-….rpm`, `sudo pacman -U prism-agent-….pkg.tar.zst`), then `sudo prism-agent enroll --url … --key …` (Copy only right after the key is created).
- A line on GNOME: the tray icon needs the AppIndicator extension (Ubuntu has it); everywhere, **Submit a ticket** is in the applications list.
- **Asset Device tab:** "Realm" for Linux ("riverside.local (joined with realmd)" or "Not joined to a realm"), and the OS line reads "Ubuntu 24.04 (noble)".

- [ ] **Step 1: Failing tests:** an Ubuntu inventory fixture fills the Asset ("Ubuntu", "24.04 (noble)", the root file system counted once); the smoke test shows the three distributions' commands and the enroll command with the new key.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS (with the `assets.*` and `companies.page` smokes).
- [ ] **Step 5: Commit** `feat(agent): Linux on the Devices and Asset screens`

### Task 11: Finish, and v0.5.0

- [ ] **Step 1:** ROADMAP row 8 → 8c on `dev`; UPGRADING `## Unreleased` gains installing on Linux (the three distributions, the enroll command, GNOME's AppIndicator note, removing).
- [ ] **Step 2:** Full backend and smoke suites, and the agent workflow (Windows, macOS, Linux), all green.
- [ ] **Step 3:** Security review (Review Focus above), fix pass, commit, push to `dev`.
- [ ] **Step 4:** The owner's hand test on Ubuntu 24.04, Fedora (current) and Arch (with KDE or GNOME): install, enroll, the Asset appears with its software, a ticket from the tray or the launcher, an update installs itself, revoke stops it, removal cleans up. A server install (no desktop) appears Online with no tray.
- [ ] **Step 5:** With 8a's, 8b's and 8c's hand tests passed: fold `## Unreleased` into `## v0.5.0` in UPGRADING (with "Before upgrading": migrations 074 to 079, nothing else required), merge `dev` into `main`, and tag `v0.5.0` (the owner pushes the tag, as for v0.4.0). The release builds the agent packages from the tag (version 0.5.0), so every enrolled computer updates to the release.

## Notes on the spec

- **Software is what a person installed.** The spec says "dpkg/rpm/pacman". Listing every package would fill the Software tab with libraries (around 2,000 on a default Ubuntu desktop, sometimes past PRISM's 5,000 cap on a busy server). The packages marked as explicitly installed, plus Flatpak and Snap apps, are the applications staff look for. The cut can be revisited if staff want the full list.
- **Package signing.** The spec says Linux packages are "signed with a GPG key PRISM generates", whose public key apt, dnf and pacman trust. But installing a downloaded file (`apt install ./x.deb`, `dnf install ./x.rpm`, `pacman -U x.pkg.tar.zst`) doesn't check a repository signature by default, and updates are protected by PRISM's own signature as on Windows and macOS. So 8c signs the packages when a CI key exists and publishes its public key, without making signing a requirement. A real repository (`apt`/`dnf` sources pointing at PRISM) would need the key and is left for later.
- **A package format per device.** The spec's manifest is platform and architecture. Linux needs the format too, so a Fedora computer is never offered a `.deb`: migration 079 and Task 5.
- **One tray build for all three distributions,** linked against WebKitGTK 4.1 and GTK 3. These are on Ubuntu 22.04 and later, current Fedora and Arch, the spec's versions. The libraries are weak dependencies (Task 8), so a server without a desktop installs the service alone.
