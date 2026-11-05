// Package service: the platform's service manager. On macOS, launchd (plan
// 8b, Task 5): the agent runs as a LaunchDaemon (root); `run` is a plain
// foreground process that stops on launchd's SIGTERM.
package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"

	"golang.org/x/sys/unix"
)

// IsService: launchd starts `run` as a normal process; there is no service
// handshake as on Windows.
func IsService() bool { return false }

// Run isn't used on macOS (see IsService).
func Run(func(ctx context.Context, logf func(string, ...any))) error {
	return errors.New("launchd runs `prism-agent run` directly")
}

func needRoot() error {
	if os.Geteuid() != 0 {
		return errors.New("run this with sudo")
	}
	return nil
}

func launchctl(args ...string) error {
	out, err := exec.Command("/bin/launchctl", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl %v: %v: %s", args, err, out)
	}
	return nil
}

// Install writes the LaunchDaemon for this executable and starts it.
func Install() error {
	if err := needRoot(); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(MacLogDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(MacDaemonPlist, DaemonPlist(exe), 0o644); err != nil {
		return err
	}
	_ = launchctl("bootout", "system/"+MacDaemonLabel) // an older one
	return launchctl("bootstrap", "system", MacDaemonPlist)
}

// Uninstall stops the daemon and removes its file.
func Uninstall() error {
	if err := needRoot(); err != nil {
		return err
	}
	_ = launchctl("bootout", "system/"+MacDaemonLabel)
	if err := os.Remove(MacDaemonPlist); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// consoleUID: the person at the screen, whose tray is stopped too.
func consoleUID() (int, bool) {
	st, err := os.Stat("/dev/console")
	if err != nil {
		return 0, false
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok || sys.Uid < 500 {
		return 0, false
	}
	if _, err := user.LookupId(strconv.Itoa(int(sys.Uid))); err != nil {
		return 0, false
	}
	return int(sys.Uid), true
}

// Remove takes the agent off this Mac (a .pkg has no uninstaller): the
// daemon, the menu-bar app and its LaunchAgent, the programs and the
// command-line link, and the installer's receipt. The enrollment (the
// device key, agent.json) stays unless removeData, so reinstalling keeps
// the same device in PRISM.
func Remove(removeData bool, dataDir string) error {
	if err := needRoot(); err != nil {
		return err
	}
	if uid, ok := consoleUID(); ok {
		_ = launchctl("bootout", "gui/"+strconv.Itoa(uid)+"/"+MacTrayLabel)
	}
	_ = exec.Command("/usr/bin/pkill", "-x", "prism-tray").Run()
	if err := Uninstall(); err != nil {
		return err
	}
	for _, p := range []string{MacTrayPlist, MacAgentLink} {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	for _, p := range []string{MacTrayApp, MacBinDir, MacLogDir} {
		if err := os.RemoveAll(p); err != nil {
			return err
		}
	}
	_ = exec.Command("/usr/sbin/pkgutil", "--forget", "com.prism.agent").Run()
	if removeData {
		// Only the agent's own folder, and only if it is one.
		if filepath.Base(dataDir) != "PRISM" {
			return fmt.Errorf("refusing to remove %s", dataDir)
		}
		return os.RemoveAll(dataDir)
	}
	return nil
}

// StartLog keeps the daemon's log (launchd's StandardOutPath) under 10 MB:
// at each start, a log past that becomes agent.log.1 and the daemon's
// output is pointed at a fresh agent.log. Only when it is the daemon (root,
// with its output in that log).
func StartLog() {
	if os.Geteuid() != 0 {
		return
	}
	st, err := os.Stat(MacLog)
	if err != nil || st.Size() <= 10<<20 {
		return
	}
	RotateLog(MacLog, 10<<20)
	f, err := os.OpenFile(MacLog, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	_ = unix.Dup2(int(f.Fd()), 1)
	_ = unix.Dup2(int(f.Fd()), 2)
	_ = f.Close()
}
