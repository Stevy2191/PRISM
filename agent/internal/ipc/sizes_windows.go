//go:build windows

package ipc

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const unsafeSizeofSA = unsafe.Sizeof(windows.SecurityAttributes{})
