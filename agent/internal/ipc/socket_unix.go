//go:build darwin || linux

package ipc

// The tray ↔ service channel on macOS and Linux (plans 8b and 8c): a Unix
// socket where only root can create files (SocketPath, per platform). Who
// is asking comes from the socket's peer credentials (peercred_*.go:
// LOCAL_PEERCRED on macOS, SO_PEERCRED on Linux), never from the message;
// the same Server.Handle answers as on Windows.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/stevy2191/prism/agent/internal/inventory"
)

// ErrNotRunning: the service isn't running (no socket, or nobody behind it).
var ErrNotRunning = errors.New("the PRISM Agent service isn't running")

// ErrUntrusted: something is at the socket's path that isn't root's socket.
var ErrUntrusted = errors.New("the PRISM socket isn't the service's")

// Handler answers one request from an identified user.
type Handler func(ctx context.Context, id Identity, line []byte) any

type sockConf struct {
	path string
	uid  uint32 // the owner a trusted socket (and its folder) must have
}

var (
	confMu sync.Mutex
	conf   = sockConf{path: SocketPath, uid: 0}
)

func current() sockConf {
	confMu.Lock()
	defer confMu.Unlock()
	return conf
}

// AllowCurrentUserForTests serves and trusts a socket at path owned by the
// test's own user (the service is root's). Never used by the agent.
func AllowCurrentUserForTests(path string) func() {
	confMu.Lock()
	conf = sockConf{path: path, uid: uint32(os.Geteuid())}
	confMu.Unlock()
	return func() {
		confMu.Lock()
		conf = sockConf{path: SocketPath, uid: 0}
		confMu.Unlock()
	}
}

// trustUIDForTests changes only the owner the client trusts (to see it
// refuse a socket of the wrong owner).
func trustUIDForTests(uid uint32) func() {
	confMu.Lock()
	prev := conf.uid
	conf.uid = uid
	confMu.Unlock()
	return func() { confMu.Lock(); conf.uid = prev; confMu.Unlock() }
}

// peerIdentity: the person behind a uid (inventory.PersonFor, per
// platform); root and system accounts aren't people and are refused.
var peerIdentity = func(uid uint32) (Identity, error) {
	u, err := inventory.PersonFor(uid)
	if err != nil {
		return Identity{}, err
	}
	if u == nil {
		return Identity{}, fmt.Errorf("uid %d is not a person's account", uid)
	}
	return Identity{Account: u.Account, UPN: u.UPN}, nil
}

func ownerOf(fi os.FileInfo) (uint32, bool) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, false
	}
	return st.Uid, true
}

// trusted: a socket (not a symlink) owned by c.uid, in a folder owned by
// c.uid that others can't write to.
func trusted(c sockConf) error {
	fi, err := os.Lstat(c.path)
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotRunning
	}
	if err != nil {
		return err
	}
	if fi.Mode()&os.ModeSocket == 0 || fi.Mode()&os.ModeSymlink != 0 {
		return ErrUntrusted
	}
	if uid, ok := ownerOf(fi); !ok || uid != c.uid {
		return ErrUntrusted
	}
	dir, err := os.Stat(filepath.Dir(c.path))
	if err != nil {
		return ErrUntrusted
	}
	if uid, ok := ownerOf(dir); !ok || uid != c.uid || dir.Mode().Perm()&0o022 != 0 {
		return ErrUntrusted
	}
	return nil
}

// Serve answers the tray until ctx ends.
func Serve(ctx context.Context, h Handler, logf func(string, ...any)) error {
	c := current()
	// A socket already there: if something answers, another server runs
	// and this one won't; if not, it's ours from before and is removed
	// (only a socket of our own owner, never anything else).
	if fi, err := os.Lstat(c.path); err == nil {
		if fi.Mode()&os.ModeSocket == 0 {
			return fmt.Errorf("%s exists and isn't a socket; not touching it", c.path)
		}
		if conn, err := net.DialTimeout("unix", c.path, time.Second); err == nil {
			conn.Close()
			return fmt.Errorf("another server is answering on %s", c.path)
		}
		if uid, ok := ownerOf(fi); !ok || int(uid) != os.Geteuid() {
			return fmt.Errorf("%s belongs to someone else; not touching it", c.path)
		}
		if err := os.Remove(c.path); err != nil {
			return err
		}
	}
	ln, err := net.Listen("unix", c.path)
	if err != nil {
		return fmt.Errorf("could not create the tray socket: %w", err)
	}
	// Any local user may ask; the answer depends on who they are.
	if err := os.Chmod(c.path, 0o666); err != nil {
		ln.Close()
		return err
	}
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	defer os.Remove(c.path)
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			return err
		}
		go serveConn(ctx, conn.(*net.UnixConn), h, logf)
	}
}

func peerUID(conn *net.UnixConn) (uint32, error) {
	raw, err := conn.SyscallConn()
	if err != nil {
		return 0, err
	}
	var uid uint32
	var cerr error
	if err := raw.Control(func(fd uintptr) { uid, cerr = peerCredUID(int(fd)) }); err != nil {
		return 0, err
	}
	return uid, cerr
}

func serveConn(ctx context.Context, conn *net.UnixConn, h Handler, logf func(string, ...any)) {
	defer conn.Close()
	// A client that never finishes its line is cut off.
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	line, err := bufio.NewReaderSize(io.LimitReader(conn, MaxRequest+1), MaxRequest+1).ReadSlice('\n')
	if err != nil && !errors.Is(err, bufio.ErrBufferFull) {
		return
	}
	var answer any
	uid, err := peerUID(conn)
	var id Identity
	if err == nil {
		id, err = peerIdentity(uid)
	}
	if err != nil {
		logf("tray socket: caller refused: %v", err)
		answer = SubmitAnswer{Error: "refused", Message: "The computer couldn't say who you are."}
	} else {
		// The handler may wait on PRISM; give the answer its own time.
		_ = conn.SetDeadline(time.Now().Add(3 * time.Minute))
		answer = h(ctx, id, line)
	}
	b, _ := json.Marshal(answer)
	_, _ = conn.Write(append(b, '\n'))
}

// Call sends one request to the service and reads its answer into out.
func Call(req any, out any, timeout time.Duration) error {
	c := current()
	if err := trusted(c); err != nil {
		return err
	}
	conn, err := net.DialTimeout("unix", c.path, 5*time.Second)
	if err != nil {
		return ErrNotRunning
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	b, err := json.Marshal(req)
	if err != nil {
		return err
	}
	if _, err := conn.Write(append(b, '\n')); err != nil {
		return err
	}
	line, err := bufio.NewReaderSize(conn, 1<<20).ReadSlice('\n')
	if err != nil {
		return fmt.Errorf("no answer from the PRISM Agent service: %w", err)
	}
	return json.Unmarshal(line, out)
}
