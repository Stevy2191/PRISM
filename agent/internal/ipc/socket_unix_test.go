//go:build darwin || linux

package ipc

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stevy2191/prism/agent/internal/inventory"
)

// Unix socket paths are limited to about 100 bytes: a short
// folder under /tmp rather than the test's long temporary one.
func shortDir(t *testing.T) string {
	t.Helper()
	d, err := os.MkdirTemp("/tmp", "pa")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(d, 0o755)
	t.Cleanup(func() { os.RemoveAll(d) })
	return d
}

func serveEcho(t *testing.T, ctx context.Context) <-chan error {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		done <- Serve(ctx, func(_ context.Context, id Identity, line []byte) any {
			return map[string]string{"account": id.Account, "line": strings.TrimSpace(string(line))}
		}, t.Logf)
	}()
	return done
}

func waitUp(t *testing.T) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if _, err := os.Lstat(current().path); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the server never made its socket")
}

func TestSocketIdentifiesTheCallerFromTheOS(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("run as a person's account: root isn't a tray user")
	}
	path := filepath.Join(shortDir(t), "a.sock")
	defer AllowCurrentUserForTests(path)()
	ctx, cancel := context.WithCancel(context.Background())
	done := serveEcho(t, ctx)
	waitUp(t)
	if st, _ := os.Stat(path); st.Mode().Perm() != 0o666 {
		t.Fatalf("socket mode %v, want 0666", st.Mode().Perm())
	}
	var out map[string]string
	// What the message claims about who it is is ignored.
	if err := Call(map[string]string{"op": "whoami", "account": `EVIL\boss`}, &out, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	me, err := inventory.PersonFor(uint32(os.Getuid()))
	if err != nil || me == nil {
		t.Fatalf("this user: %+v %v", me, err)
	}
	if out["account"] != me.Account {
		t.Fatalf("server saw %q, want %q", out["account"], me.Account)
	}
	// Several at once.
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() { var o map[string]string; errs <- Call(map[string]string{"op": "whoami"}, &o, 10*time.Second) }()
	}
	for i := 0; i < 8; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent call: %v", err)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Serve didn't stop")
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the socket outlived the server")
	}
}

func TestTheClientTrustsOnlyItsOwnersSocket(t *testing.T) {
	dir := shortDir(t)
	path := filepath.Join(dir, "b.sock")
	defer AllowCurrentUserForTests(path)()
	var out map[string]any
	if err := Call(map[string]string{"op": "whoami"}, &out, time.Second); err != ErrNotRunning {
		t.Fatalf("no socket: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := serveEcho(t, ctx)
	waitUp(t)
	// The same socket, but the client expects another owner (root): refused.
	restore := trustUIDForTests(uint32(os.Geteuid()) + 1)
	if err := Call(map[string]string{"op": "whoami"}, &out, time.Second); err != ErrUntrusted {
		t.Fatalf("a socket of the wrong owner: %v", err)
	}
	restore()
	// A symlink in its place: refused, even though it leads to a socket.
	link := filepath.Join(dir, "c.sock")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	restoreLink := AllowCurrentUserForTests(link)
	if err := Call(map[string]string{"op": "whoami"}, &out, time.Second); err != ErrUntrusted {
		t.Fatalf("a symlink: %v", err)
	}
	restoreLink()
	defer AllowCurrentUserForTests(path)()
	// A folder others can write to: refused.
	_ = os.Chmod(dir, 0o777)
	if err := Call(map[string]string{"op": "whoami"}, &out, time.Second); err != ErrUntrusted {
		t.Fatalf("a world-writable folder: %v", err)
	}
	_ = os.Chmod(dir, 0o755)
	// A second server on the same path is refused while the first answers.
	if err := Serve(ctx, func(context.Context, Identity, []byte) any { return nil }, t.Logf); err == nil {
		t.Fatal("a second server took the socket")
	}
	cancel()
	<-done
}

func TestAStaleSocketIsReplacedButAFileIsNot(t *testing.T) {
	dir := shortDir(t)
	path := filepath.Join(dir, "d.sock")
	defer AllowCurrentUserForTests(path)()
	// A socket left behind by a crashed server (nobody listening).
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	ln.(*net.UnixListener).SetUnlinkOnClose(false)
	ln.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := serveEcho(t, ctx)
	var out map[string]string
	time.Sleep(200 * time.Millisecond)
	if os.Geteuid() != 0 {
		if err := Call(map[string]string{"op": "whoami"}, &out, 5*time.Second); err != nil {
			t.Fatalf("after a stale socket: %v", err)
		}
	}
	cancel()
	<-done
	// A plain file at the path is never removed.
	if err := os.WriteFile(path, []byte("not a socket"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Serve(context.Background(), func(context.Context, Identity, []byte) any { return nil }, t.Logf); err == nil {
		t.Fatal("served over a plain file")
	}
	if b, _ := os.ReadFile(path); string(b) != "not a socket" {
		t.Fatal("the file was touched")
	}
}
