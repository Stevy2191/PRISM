//go:build windows

package main

import (
	"errors"
	"image"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	gdi32                      = windows.NewLazySystemDLL("gdi32.dll")
	procGetDC                  = user32.NewProc("GetDC")
	procReleaseDC              = user32.NewProc("ReleaseDC")
	procGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	procShowWindow             = user32.NewProc("ShowWindow")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
)

const (
	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79
	srcCopy           = 0x00CC0020
	captureBlt        = 0x40000000
	swHide            = 0
	swShow            = 5
)

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

func canCapture() bool { return true }

func hideWindow(w window) { _, _, _ = procShowWindow.Call(uintptr(w.Window()), swHide) }
func showWindow(w window) {
	_, _, _ = procShowWindow.Call(uintptr(w.Window()), swShow)
	_, _, _ = procSetForegroundWindow.Call(uintptr(w.Window()))
}

// captureScreen copies every monitor (the virtual screen) with GDI.
func captureScreen() ([]byte, string, string, error) {
	metric := func(i uintptr) int32 { v, _, _ := procGetSystemMetrics.Call(i); return int32(v) }
	x, y, cx, cy := metric(smXVirtualScreen), metric(smYVirtualScreen), metric(smCXVirtualScreen), metric(smCYVirtualScreen)
	if cx <= 0 || cy <= 0 || cx > 32768 || cy > 32768 {
		return nil, "", "", errNoCapture
	}
	screen, _, _ := procGetDC.Call(0)
	if screen == 0 {
		return nil, "", "", errNoCapture
	}
	defer procReleaseDC.Call(0, screen)
	mem, _, _ := procCreateCompatibleDC.Call(screen)
	if mem == 0 {
		return nil, "", "", errNoCapture
	}
	defer procDeleteDC.Call(mem)
	bmp, _, _ := procCreateCompatibleBitmap.Call(screen, uintptr(cx), uintptr(cy))
	if bmp == 0 {
		return nil, "", "", errNoCapture
	}
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(mem, bmp)
	ok, _, _ := procBitBlt.Call(mem, 0, 0, uintptr(cx), uintptr(cy), screen, uintptr(x), uintptr(y), srcCopy|captureBlt)
	// The bitmap must not be selected into a DC while GetDIBits reads it.
	procSelectObject.Call(mem, old)
	if ok == 0 {
		return nil, "", "", errors.New("Windows didn't allow a picture of the screen. Attach a file instead.")
	}
	// 32 bits a pixel, top row first (a negative height).
	hdr := bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: cx, Height: -cy, Planes: 1, BitCount: 32}
	pix := make([]byte, int(cx)*int(cy)*4)
	got, _, _ := procGetDIBits.Call(screen, bmp, 0, uintptr(cy), uintptr(unsafe.Pointer(&pix[0])), uintptr(unsafe.Pointer(&hdr)), 0)
	if got == 0 {
		return nil, "", "", errNoCapture
	}
	// BGRA → RGBA, opaque.
	for i := 0; i+3 < len(pix); i += 4 {
		pix[i], pix[i+2], pix[i+3] = pix[i+2], pix[i], 0xFF
	}
	img := &image.NRGBA{Pix: pix, Stride: int(cx) * 4, Rect: image.Rect(0, 0, int(cx), int(cy))}
	return encodeShot(img)
}
