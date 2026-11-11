//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/stevy2191/prism/agent/internal/config"
	"github.com/stevy2191/prism/agent/internal/update"
)

// restartTraysAfterUpdate: after a self-update (owner, 2026-11-09: the tray
// stayed gone until the next sign-in), the new service opens the tray again
// in every signed-in session, as that session's user. Only when the
// updater left its marker, and only within a day of it: a normal start or
// a reboot leaves the tray to its sign-in entry, and someone who quit it
// isn't overruled. The tray itself refuses a second copy in a session.
func restartTraysAfterUpdate(logf func(string, ...any)) {
	marker := filepath.Join(config.Dir(), "updates", update.TrayRestartMarker)
	fi, err := os.Stat(marker)
	if err != nil {
		return
	}
	_ = os.Remove(marker)
	if time.Since(fi.ModTime()) > 24*time.Hour {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	tray := filepath.Join(filepath.Dir(exe), "prism-tray.exe")
	if _, err := os.Stat(tray); err != nil {
		return
	}
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err != nil {
		logf("update: listing sessions to restart the tray: %v", err)
		return
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	for _, s := range unsafe.Slice(sessions, count) {
		if s.State != windows.WTSActive {
			continue
		}
		if err := startTrayIn(s.SessionID, tray); err != nil {
			logf("update: restarting the tray in session %d: %v", s.SessionID, err)
		} else {
			logf("update: restarted the tray in session %d", s.SessionID)
		}
	}
}

// startTrayIn runs the tray in a session as its signed-in user, on that
// user's desktop and with their environment.
func startTrayIn(session uint32, tray string) error {
	var tok windows.Token
	if err := windows.WTSQueryUserToken(session, &tok); err != nil {
		return err
	}
	defer tok.Close()
	var env *uint16
	if err := windows.CreateEnvironmentBlock(&env, tok, false); err != nil {
		return err
	}
	defer windows.DestroyEnvironmentBlock(env)
	cmd, err := windows.UTF16PtrFromString(`"` + strings.ReplaceAll(tray, `"`, "") + `"`)
	if err != nil {
		return err
	}
	dir, _ := windows.UTF16PtrFromString(filepath.Dir(tray))
	desktop, _ := windows.UTF16PtrFromString(`winsta0\default`)
	si := windows.StartupInfo{Desktop: desktop}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	appName, _ := windows.UTF16PtrFromString(tray)
	if err := windows.CreateProcessAsUser(tok, appName, cmd, nil, nil, false,
		windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NEW_PROCESS_GROUP, env, dir, &si, &pi); err != nil {
		return err
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	return nil
}
