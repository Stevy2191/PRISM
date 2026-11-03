//go:build windows

package keystore

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// DPAPI with machine scope: the elevated installer (or an admin running
// enroll) and the SYSTEM service both read it. Machine scope alone would
// let any local process decrypt, so the file's ACL is what keeps it to
// SYSTEM; DPAPI keeps the seed out of backups and disk images.
const entropy = "PRISM agent device key v1"

func blob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}

func protect(seed []byte) ([]byte, error) {
	var out windows.DataBlob
	ent := []byte(entropy)
	if err := windows.CryptProtectData(blob(seed), nil, blob(ent), 0, nil, windows.CRYPTPROTECT_LOCAL_MACHINE|windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}

func unprotect(b []byte) ([]byte, error) {
	var out windows.DataBlob
	ent := []byte(entropy)
	if err := windows.CryptUnprotectData(blob(b), nil, blob(ent), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}

// SystemOnly is the key file's ACL: SYSTEM only, not inherited.
const SystemOnly = "D:P(A;;FA;;;SY)"

// fileACL is SystemOnly except while a test widens it (AllowCurrentUserForTests).
var fileACL = SystemOnly

// AllowCurrentUserForTests adds the running user to the key file's ACL, so a
// test (not running as SYSTEM) can read back what it wrote. Returns the
// restore function. Never called by the agent itself.
func AllowCurrentUserForTests() func() {
	tok := windows.GetCurrentProcessToken()
	u, err := tok.GetTokenUser()
	if err != nil {
		panic(err)
	}
	fileACL = SystemOnly + "(A;;FA;;;" + u.User.Sid.String() + ")"
	return func() { fileACL = SystemOnly }
}

// FileACL is the key file's DACL as SDDL (for tests).
func FileACL(path string) (string, error) {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return "", err
	}
	return sd.String(), nil
}

func writeRestricted(path string, data []byte) error {
	_ = os.Remove(path)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString(fileACL)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}
