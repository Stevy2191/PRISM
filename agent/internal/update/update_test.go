package update

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type served struct {
	version string
	body    []byte
	calls   int
}

func (s *served) Stream(_ context.Context, path string) (*http.Response, error) {
	s.calls++
	if path != "/api/v1/agent/v1/update/download" {
		return nil, errors.New("wrong path " + path)
	}
	h := http.Header{}
	h.Set("X-Prism-Version", s.version)
	return &http.Response{StatusCode: 200, Header: h, Body: io.NopCloser(bytes.NewReader(s.body))}, nil
}

type rig struct {
	t         *testing.T
	key       ed25519.PrivateKey
	u         *Updater
	srv       *served
	installed []string
	logs      []string
}

func newRig(t *testing.T) *rig {
	_, key, _ := ed25519.GenerateKey(nil)
	r := &rig{t: t, key: key, srv: &served{}}
	r.u = &Updater{
		PRISM: r.srv, Dir: t.TempDir(), PublicKey: base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey)),
		Platform: "windows", Arch: "amd64", Current: "0.6.0", Format: "deb",
		Install: func(path, version string) error {
			b, _ := os.ReadFile(path)
			r.installed = append(r.installed, version+":"+string(b))
			return nil
		},
		Logf: func(f string, a ...any) { r.logs = append(r.logs, f) },
	}
	return r
}

// offer signs a package as PRISM does, with the given key.
func (r *rig) offer(version string, body []byte, key ed25519.PrivateKey) Offer {
	sum := sha256.Sum256(body)
	h := hex.EncodeToString(sum[:])
	sig := ed25519.Sign(key, []byte("windows|amd64|"+version+"|"+h))
	r.srv.version, r.srv.body = version, body
	return Offer{Version: version, SHA256: h, Size: int64(len(body)), Signature: base64.StdEncoding.EncodeToString(sig)}
}

func (r *rig) leftovers() []string {
	var names []string
	entries, _ := os.ReadDir(r.u.Dir)
	for _, e := range entries {
		if e.Name() != "state.json" {
			names = append(names, e.Name())
		}
	}
	return names
}

func (r *rig) refused(o Offer, why string) {
	r.t.Helper()
	err := r.u.Apply(context.Background(), o)
	if err == nil || !strings.Contains(err.Error(), why) {
		r.t.Fatalf("err %v, want it to mention %q", err, why)
	}
	if len(r.installed) != 0 {
		r.t.Fatalf("installed %v after a refusal", r.installed)
	}
	if l := r.leftovers(); len(l) != 0 {
		r.t.Fatalf("files left behind: %v", l)
	}
	if len(r.logs) == 0 || !strings.Contains(r.logs[len(r.logs)-1], "refused") {
		r.t.Fatalf("the refusal wasn't logged: %v", r.logs)
	}
}

func TestAGoodPackageIsInstalled(t *testing.T) {
	r := newRig(t)
	o := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	if err := r.u.Apply(context.Background(), o); err != nil {
		t.Fatal(err)
	}
	if len(r.installed) != 1 || r.installed[0] != "0.7.0:MSI 0.7.0" {
		t.Fatalf("installed %v", r.installed)
	}
	if _, err := os.Stat(filepath.Join(r.u.Dir, "prism-agent-0.7.0"+packageExt)); err != nil {
		t.Fatal("the checked package isn't where the installer was pointed")
	}
}

func TestAnotherKeysSignatureIsRefused(t *testing.T) {
	r := newRig(t)
	_, other, _ := ed25519.GenerateKey(nil)
	r.refused(r.offer("0.7.0", []byte("MSI from elsewhere"), other), "signature")
	if r.srv.calls != 0 {
		t.Fatal("downloaded a package whose offer didn't verify")
	}
}

func TestAHashMismatchIsRefusedAndDeleted(t *testing.T) {
	r := newRig(t)
	o := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	r.srv.body = []byte("MSI 0.7.X") // same size, different bytes
	r.refused(o, "sha256")
}

func TestASizeMismatchIsRefused(t *testing.T) {
	r := newRig(t)
	o := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	r.srv.body = []byte("MSI 0.7.0 plus more")
	r.refused(o, "bytes")
}

func TestALowerOrEqualVersionIsRefused(t *testing.T) {
	for _, v := range []string{"0.6.0", "0.5.9", "0.6.0-rc.1"} {
		r := newRig(t)
		r.refused(r.offer(v, []byte("MSI "+v), r.key), "not newer")
	}
}

func TestADifferentVersionDownloadedIsRefused(t *testing.T) {
	r := newRig(t)
	o := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	r.srv.version = "0.8.0" // a newer build was published meanwhile
	r.refused(o, "not the 0.7.0")
}

func TestNoUpdateKeyNoUpdates(t *testing.T) {
	r := newRig(t)
	o := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	r.u.PublicKey = ""
	r.refused(o, "re-enroll")
}

func TestAFailedVersionWaitsBeforeRetrying(t *testing.T) {
	r := newRig(t)
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	r.u.Now = func() time.Time { return now }
	o := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	r.srv.body = []byte("MSI 0.7.X")
	_ = r.u.Apply(context.Background(), o)
	r.srv.body = []byte("MSI 0.7.0") // fixed on the server
	if err := r.u.Apply(context.Background(), o); err == nil || r.srv.calls != 1 {
		t.Fatalf("retried at once: err %v, %d downloads", err, r.srv.calls)
	}
	now = now.Add(RetryAfter + time.Minute)
	if err := r.u.Apply(context.Background(), o); err != nil || len(r.installed) != 1 {
		t.Fatalf("after the wait: err %v, installed %v", err, r.installed)
	}
}

func TestAnInstallerThatWontStartLeavesNothing(t *testing.T) {
	r := newRig(t)
	r.u.Install = func(string, string) error { return errors.New("msiexec missing") }
	r.refused(r.offer("0.7.0", []byte("MSI 0.7.0"), r.key), "installer")
}

func TestCompareMatchesPRISM(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"0.10.0", "0.9.9", 1}, {"1.0.0", "1.0.0", 0}, {"1.0.0-rc.1", "1.0.0", -1},
		{"1.0.0", "1.0.0-rc.1", 1}, {"dev", "0.1.0", -1}, {"0.1.0", "dev", 1},
		{"0.0.0-dev.10", "0.0.0-dev.9", 1}, {"0.0.0-dev.9", "0.0.0-dev.10", -1}, {"0.0.0-dev.10", "0.5.0", -1},
		{"1.0.0-rc.1", "1.0.0-rc.1.1", -1}, {"1.0.0-1", "1.0.0-alpha", -1},
	} {
		if got := Compare(c.a, c.b); got != c.want {
			t.Errorf("Compare(%s, %s) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestMalformedOffersAreRefused(t *testing.T) {
	r := newRig(t)
	good := r.offer("0.7.0", []byte("MSI 0.7.0"), r.key)
	for _, o := range []Offer{
		{Version: "../../evil", SHA256: good.SHA256, Size: 9, Signature: good.Signature},
		{Version: "0.7.0", SHA256: "abc", Size: 9, Signature: good.Signature},
		{Version: "0.7.0", SHA256: good.SHA256, Size: MaxPackage + 1, Signature: good.Signature},
		{Version: "0.7.0", SHA256: good.SHA256, Size: 0, Signature: good.Signature},
	} {
		if err := r.u.Verify(o); err == nil {
			t.Errorf("accepted %+v", o)
		}
	}
}

// The same vector the Node suite checks (backend agent.update.test.js): what
// PRISM signs, the agent accepts.
func TestSharedUpdateSigningVector(t *testing.T) {
	b, err := os.ReadFile("../../testdata/update-signing.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		PublicKeyB64, Platform, Arch, Version, PackageText, SHA256, SignatureB64 string
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(v.PackageText))
	if hex.EncodeToString(sum[:]) != v.SHA256 {
		t.Fatal("the vector's sha256 isn't its package's")
	}
	u := &Updater{PublicKey: v.PublicKeyB64, Platform: v.Platform, Arch: v.Arch, Current: "0.6.0"}
	o := Offer{Version: v.Version, SHA256: v.SHA256, Size: int64(len(v.PackageText)), Signature: v.SignatureB64}
	if err := u.Verify(o); err != nil {
		t.Fatalf("PRISM's signature refused: %v", err)
	}
	u.Arch = "arm64"
	if u.Verify(o) == nil {
		t.Fatal("a signature for amd64 was accepted for arm64")
	}
}
