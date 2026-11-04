//go:build windows

package ipc

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestPipeRoundTripIdentifiesTheCaller(t *testing.T) {
	defer AllowCurrentUserForTests(fmt.Sprintf(`\\.\pipe\prism-agent-test-%d`, time.Now().UnixNano()))()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	served := make(chan error, 1)
	go func() {
		served <- Serve(ctx, func(_ context.Context, id Identity, line []byte) any {
			return map[string]string{"account": id.Account, "line": strings.TrimSpace(string(line))}
		}, t.Logf)
	}()
	var out map[string]string
	var err error
	for i := 0; i < 50; i++ {
		if err = Call(map[string]string{"op": "whoami", "account": `EVIL\boss`}, &out, 10*time.Second); err != ErrNotRunning {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	tu, _ := windows.GetCurrentProcessToken().GetTokenUser()
	acct, dom, _, _ := tu.User.Sid.LookupAccount("")
	if out["account"] != dom+`\`+acct {
		t.Fatalf("server saw %q, want this process's user %s\\%s", out["account"], dom, acct)
	}
	// Several at once.
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() {
			var o map[string]string
			errs <- Call(map[string]string{"op": "whoami"}, &o, 10*time.Second)
		}()
	}
	for i := 0; i < 8; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent call: %v", err)
		}
	}
	cancel()
	select {
	case err := <-served:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve didn't stop")
	}
}

func TestNoServiceIsNotRunning(t *testing.T) {
	defer AllowCurrentUserForTests(`\\.\pipe\prism-agent-nobody-here`)()
	var out map[string]any
	if err := Call(map[string]string{"op": "whoami"}, &out, time.Second); err != ErrNotRunning {
		t.Fatalf("err %v, want ErrNotRunning", err)
	}
}

func TestASecondServerOnTheSameNameIsRefused(t *testing.T) {
	defer AllowCurrentUserForTests(fmt.Sprintf(`\\.\pipe\prism-agent-dup-%d`, time.Now().UnixNano()))()
	ctx, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() { first <- Serve(ctx, func(context.Context, Identity, []byte) any { return nil }, t.Logf) }()
	time.Sleep(200 * time.Millisecond)
	err := Serve(ctx, func(context.Context, Identity, []byte) any { return nil }, t.Logf)
	// The first server stops before the test ends (and its pipe name is
	// put back).
	cancel()
	select {
	case <-first:
	case <-time.After(5 * time.Second):
		t.Fatal("the first server didn't stop")
	}
	if err == nil {
		t.Fatal("a second server took the same pipe name")
	}
}
