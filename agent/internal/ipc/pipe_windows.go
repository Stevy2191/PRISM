//go:build windows

package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	"golang.org/x/sys/windows"

	"github.com/stevy2191/prism/agent/internal/inventory"
)

// PipeName is the service's pipe.
const PipeName = `\\.\pipe\prism-agent`

// The pipe's ACL: SYSTEM and Administrators full; interactive users (the
// people at the keyboard) may read and write data, but not create pipe
// instances of their own (FILE_GENERIC_READ | FILE_WRITE_DATA = 0x12008b,
// without FILE_CREATE_PIPE_INSTANCE). Remote clients are refused.
const pipeSDDL = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x12008b;;;IU)"

// pipeConf is the pipe's name and test-only additions, read once per
// Serve or Call (tests change it).
type pipeConf struct {
	name      string
	extraSDDL string
	extraSID  *windows.SID
}

var (
	confMu sync.Mutex
	conf   = pipeConf{name: PipeName}

	advapi32                       = windows.NewLazySystemDLL("advapi32.dll")
	procImpersonateNamedPipeClient = advapi32.NewProc("ImpersonateNamedPipeClient")
)

// ErrNotRunning: the service isn't running (no pipe).
var ErrNotRunning = errors.New("the PRISM Agent service isn't running")

// ErrUntrusted: a pipe of that name exists but wasn't made by the service
// (not owned by SYSTEM or Administrators): someone else's process.
var ErrUntrusted = errors.New("the PRISM pipe isn't the service's")

// AllowCurrentUserForTests lets a test process (not SYSTEM, maybe not an
// interactive logon) use and own a pipe of its own name. Never used by the
// agent. Returns the restore function.
func AllowCurrentUserForTests(name string) func() {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		panic(err)
	}
	confMu.Lock()
	conf = pipeConf{name: name, extraSDDL: "(A;;0x12008b;;;" + u.User.Sid.String() + ")", extraSID: u.User.Sid}
	confMu.Unlock()
	return func() {
		confMu.Lock()
		conf = pipeConf{name: PipeName}
		confMu.Unlock()
	}
}

func current() pipeConf {
	confMu.Lock()
	defer confMu.Unlock()
	return conf
}

// Handler answers one request from an identified user.
type Handler func(ctx context.Context, id Identity, line []byte) any

// Serve answers the tray until ctx ends.
func Serve(ctx context.Context, h Handler, logf func(string, ...any)) error {
	c := current()
	name, err := windows.UTF16PtrFromString(c.name)
	if err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString(pipeSDDL + c.extraSDDL)
	if err != nil {
		return err
	}
	sa := &windows.SecurityAttributes{Length: uint32(unsafeSizeofSA), SecurityDescriptor: sd}
	// A blocked ConnectNamedPipe ends when someone connects: on shutdown,
	// connect once ourselves.
	done := make(chan struct{})
	defer close(done)
	go func() {
		<-ctx.Done()
		for {
			if f, err := dial(c); err == nil {
				f.Close()
			}
			select {
			case <-done:
				return
			case <-time.After(100 * time.Millisecond):
			}
		}
	}()
	first := true
	for {
		flags := uint32(windows.PIPE_ACCESS_DUPLEX)
		if first {
			// Fails if anyone already made a pipe of this name: the service
			// won't serve beside a squatter.
			flags |= windows.FILE_FLAG_FIRST_PIPE_INSTANCE
		}
		hp, err := windows.CreateNamedPipe(name, flags,
			windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
			windows.PIPE_UNLIMITED_INSTANCES, 64<<10, 64<<10, 0, sa)
		if err != nil {
			if first {
				return fmt.Errorf("could not create the tray pipe: %w", err)
			}
			if ctx.Err() != nil {
				return nil
			}
			time.Sleep(time.Second)
			continue
		}
		first = false
		err = windows.ConnectNamedPipe(hp, nil)
		if ctx.Err() != nil {
			windows.CloseHandle(hp)
			return nil
		}
		if err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
			windows.CloseHandle(hp)
			continue
		}
		go serveOne(ctx, hp, h, logf)
	}
}

func serveOne(ctx context.Context, hp windows.Handle, h Handler, logf func(string, ...any)) {
	f := os.NewFile(uintptr(hp), "prism-agent pipe")
	defer f.Close()
	// A client that never finishes its line is cut off.
	timer := time.AfterFunc(30*time.Second, func() { _ = windows.DisconnectNamedPipe(hp) })
	defer timer.Stop()
	line, err := bufio.NewReaderSize(f, MaxRequest+1).ReadSlice('\n')
	if err != nil && !errors.Is(err, bufio.ErrBufferFull) {
		return
	}
	// The client's identity, from its token: only possible once it has
	// written. Taken on this OS thread, then reverted at once.
	id, err := clientIdentity(hp)
	var answer any
	if err != nil {
		logf("tray pipe: caller refused: %v", err)
		answer = SubmitAnswer{Error: "refused", Message: "Windows couldn't say who you are."}
	} else {
		answer = h(ctx, id, line)
	}
	b, _ := json.Marshal(answer)
	_, _ = f.Write(append(b, '\n'))
	_ = windows.FlushFileBuffers(hp)
	_ = windows.DisconnectNamedPipe(hp)
}

func clientIdentity(hp windows.Handle) (Identity, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if r, _, e := procImpersonateNamedPipeClient.Call(uintptr(hp)); r == 0 {
		return Identity{}, e
	}
	var tok windows.Token
	err := windows.OpenThreadToken(windows.CurrentThread(), windows.TOKEN_QUERY, true, &tok)
	if rerr := windows.RevertToSelf(); rerr != nil {
		// Never carry on as the client.
		panic("RevertToSelf failed: " + rerr.Error())
	}
	if err != nil {
		return Identity{}, err
	}
	defer tok.Close()
	u, err := inventory.UserFromToken(tok)
	if err != nil {
		return Identity{}, err
	}
	return Identity{Account: u.Account, UPN: u.UPN}, nil
}

// dial opens the pipe as a client, letting the server identify but not
// impersonate us, and checks the pipe is the service's.
func dial(c pipeConf) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(c.name)
	if err != nil {
		return nil, err
	}
	var h windows.Handle
	for i := 0; ; i++ {
		h, err = windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING,
			windows.SECURITY_SQOS_PRESENT|windows.SECURITY_IDENTIFICATION, 0)
		if err == nil {
			break
		}
		if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
			return nil, ErrNotRunning
		}
		if !errors.Is(err, windows.ERROR_PIPE_BUSY) || i >= 25 {
			return nil, err
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !trustedOwner(h, c.extraSID) {
		windows.CloseHandle(h)
		return nil, ErrUntrusted
	}
	return os.NewFile(uintptr(h), "prism-agent pipe"), nil
}

func trustedOwner(h windows.Handle, extra *windows.SID) bool {
	sd, err := windows.GetSecurityInfo(h, windows.SE_KERNEL_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return false
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil {
		return false
	}
	if owner.IsWellKnown(windows.WinLocalSystemSid) || owner.IsWellKnown(windows.WinBuiltinAdministratorsSid) {
		return true
	}
	return extra != nil && owner.Equals(extra)
}

// Call sends one request to the service and reads its answer into out.
func Call(req any, out any, timeout time.Duration) error {
	f, err := dial(current())
	if err != nil {
		return err
	}
	defer f.Close()
	timer := time.AfterFunc(timeout, func() { f.Close() })
	defer timer.Stop()
	b, err := json.Marshal(req)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(b, '\n')); err != nil {
		return err
	}
	line, err := bufio.NewReaderSize(f, 1<<20).ReadSlice('\n')
	if err != nil {
		return fmt.Errorf("no answer from the PRISM Agent service: %w", err)
	}
	return json.Unmarshal(line, out)
}
