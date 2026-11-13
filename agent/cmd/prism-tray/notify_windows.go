//go:build windows

package main

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// A pop-up by the notification area (owner, 2026-11-13: a reply or a
// notice from the help desk). It is shown by a short-lived copy of this
// program ("prism-tray notify …"), so nothing here can disturb the icon:
// it adds its own notification icon, shows the balloon (a toast on Windows
// 10 and 11), opens the ticket if it is clicked, and exits.

func notify(title, body string, ticketID int64) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(exe, "notify", title, body, strconv.FormatInt(ticketID, 10))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             windows.Handle
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            windows.Handle
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     windows.Handle
}

type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     windows.Handle
	HIcon         windows.Handle
	HCursor       windows.Handle
	HbrBackground windows.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       windows.Handle
}

type winMsg struct {
	HWnd    windows.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

var (
	shell32              = windows.NewLazySystemDLL("shell32.dll")
	procShellNotifyIcon  = shell32.NewProc("Shell_NotifyIconW")
	procRegisterClassEx  = user32.NewProc("RegisterClassExW")
	procCreateWindowEx   = user32.NewProc("CreateWindowExW")
	procDefWindowProc    = user32.NewProc("DefWindowProcW")
	procGetMessage       = user32.NewProc("GetMessageW")
	procDispatchMessage  = user32.NewProc("DispatchMessageW")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procSetTimer         = user32.NewProc("SetTimer")
	procLoadIcon         = user32.NewProc("LoadIconW")
	procDestroyWindowNtf = user32.NewProc("DestroyWindow")
)

const (
	nimAdd, nimDelete      = 0, 2
	nifMessage, nifIcon    = 0x1, 0x2
	nifTip, nifInfo        = 0x4, 0x10
	niifInfo               = 0x1
	wmApp                  = 0x8000
	wmTimer, wmDestroy     = 0x0113, 0x0002
	ninBalloonTimeout      = 0x0404
	ninBalloonUserClick    = 0x0405
	idiInformation         = 32516
	notifyCallback         = wmApp + 1
	notifyLifetimeMillisec = 25000
)

func utf16Into(dst []uint16, s string) {
	u, err := windows.UTF16FromString(s)
	if err != nil {
		return
	}
	if len(u) > len(dst) {
		u = append(u[:len(dst)-1], 0)
	}
	copy(dst, u)
}

// runNotify is "prism-tray notify <title> <body> <ticketId>".
func runNotify(args []string) {
	if len(args) < 2 {
		return
	}
	title, body := args[0], args[1]
	var ticketID int64
	if len(args) > 2 {
		ticketID, _ = strconv.ParseInt(args[2], 10, 64)
	}
	runtime.LockOSThread()
	clicked := false
	var nid notifyIconData
	proc := syscall.NewCallback(func(hwnd windows.Handle, msg uint32, wparam, lparam uintptr) uintptr {
		switch {
		case msg == notifyCallback && uint32(lparam)&0xFFFF == ninBalloonUserClick:
			clicked = true
			procPostQuitMessage.Call(0)
			return 0
		case msg == notifyCallback && uint32(lparam)&0xFFFF == ninBalloonTimeout, msg == wmTimer, msg == wmDestroy:
			procPostQuitMessage.Call(0)
			return 0
		}
		r, _, _ := procDefWindowProc.Call(uintptr(hwnd), uintptr(msg), wparam, lparam)
		return r
	})
	class, _ := windows.UTF16PtrFromString("PRISMNotify")
	wc := wndClassEx{LpfnWndProc: proc, LpszClassName: class}
	wc.CbSize = uint32(unsafe.Sizeof(wc))
	if r, _, _ := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return
	}
	hwnd, _, _ := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 0, 0, 0, 0, 0)
	if hwnd == 0 {
		return
	}
	icon, _, _ := procLoadIcon.Call(0, idiInformation)
	nid = notifyIconData{HWnd: windows.Handle(hwnd), UID: 1, UFlags: nifMessage | nifIcon | nifTip | nifInfo, UCallbackMessage: notifyCallback, HIcon: windows.Handle(icon), DwInfoFlags: niifInfo}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	utf16Into(nid.SzTip[:], "PRISM")
	utf16Into(nid.SzInfoTitle[:], title)
	utf16Into(nid.SzInfo[:], body)
	if r, _, _ := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&nid))); r == 0 {
		procDestroyWindowNtf.Call(hwnd)
		return
	}
	procSetTimer.Call(hwnd, 1, notifyLifetimeMillisec, 0)
	var m winMsg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
	procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
	procDestroyWindowNtf.Call(hwnd)
	if clicked {
		if ticketID > 0 {
			openForm("ticket", strconv.FormatInt(ticketID, 10))
		} else {
			openForm()
		}
	}
}
