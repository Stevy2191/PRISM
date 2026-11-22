//go:build windows

package main

import (
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// user32 is platform_windows.go's.
var (
	procLoadImage  = user32.NewProc("LoadImageW")
	procSendMsg    = user32.NewProc("SendMessageW")
	procSysMetrics = user32.NewProc("GetSystemMetrics")
)

const (
	imageIcon      = 1
	lrLoadFromFile = 0x10
	wmSetIcon      = 0x0080
	iconSmall      = 0
	iconBig        = 1
	smCxIcon       = 11
	smCxSmIcon     = 49
)

// setWindowIcon gives the Help desk window the PRISM icon (the taskbar and
// Alt+Tab show it) from prism.ico, which the MSI installs beside the
// program. Without the file the window keeps Windows' default icon.
func setWindowIcon(hwnd unsafe.Pointer) {
	exe, err := os.Executable()
	if err != nil || hwnd == nil {
		return
	}
	path, err := windows.UTF16PtrFromString(filepath.Join(filepath.Dir(exe), "prism.ico"))
	if err != nil {
		return
	}
	for _, which := range []struct{ kind, metric uintptr }{{iconBig, smCxIcon}, {iconSmall, smCxSmIcon}} {
		size, _, _ := procSysMetrics.Call(which.metric)
		icon, _, _ := procLoadImage.Call(0, uintptr(unsafe.Pointer(path)), imageIcon, size, size, lrLoadFromFile)
		if icon != 0 {
			procSendMsg.Call(uintptr(hwnd), wmSetIcon, which.kind, icon)
		}
	}
}
