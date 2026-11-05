package enroll

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"

	"github.com/stevy2191/prism/agent/internal/client"
	"github.com/stevy2191/prism/agent/internal/config"
	"github.com/stevy2191/prism/agent/internal/keystore"
)

const goodKey = "pk_enr_abcdefghijklmnopqrstuvwxyz0123456789ABCD"

// A fake PRISM that accepts goodKey only.
func fakePrism(t *testing.T, seen *client.EnrollRequest) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agent/v1/enroll" || r.Method != "POST" || r.Header.Get("X-Prism-Signature") != "" {
			w.WriteHeader(404)
			return
		}
		var req client.EnrollRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		*seen = req
		if req.EnrollKey != goodKey {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":true,"code":"ENROLL_KEY_INVALID","message":"That enrolment key is not valid"}`))
			return
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"deviceId":42,"updatePublicKey":"11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=","intervals":{"heartbeatSec":300,"inventorySec":21600}}`))
	}))
}

// The tests enrol into a temporary folder as an ordinary user.
func TestMain(m *testing.M) {
	skipPrivilegeCheck = true
	os.Exit(m.Run())
}

// Without the service's rights, enrolling stops before asking PRISM, and
// says how to get them.
func TestEnrollingNeedsAdministratorOrRoot(t *testing.T) {
	skipPrivilegeCheck = false
	defer func() { skipPrivilegeCheck = true }()
	if checkPrivileges() == nil {
		t.Skip("running with the rights already (root, or an elevated Windows runner)")
	}
	t.Setenv("PRISM_AGENT_DIR", t.TempDir())
	_, err := Run(context.Background(), "https://prism.example.com", "pk_enr_x", Hardware{})
	if err == nil || !(strings.Contains(err.Error(), "sudo") || strings.Contains(err.Error(), "administrator")) {
		t.Fatalf("err %v", err)
	}
}

func TestEnrolmentSavesTheConfigAndKey(t *testing.T) {
	defer keystore.AllowCurrentUserForTests()()
	t.Setenv("PRISM_AGENT_DIR", t.TempDir())
	var seen client.EnrollRequest
	srv := fakePrism(t, &seen)
	defer srv.Close()
	// httptest is http://127.0.0.1, which CheckURL allows for local testing.
	cfg, err := Run(context.Background(), srv.URL+"/", goodKey, Hardware{SerialNumber: "7XK4Q93", Make: "Dell Inc."})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DeviceID != 42 || cfg.Heartbeat().Minutes() != 5 || cfg.Inventory().Hours() != 6 {
		t.Fatalf("config %+v", cfg)
	}
	saved, err := config.Load()
	if err != nil || saved.URL != srv.URL || saved.DeviceID != 42 || saved.UpdatePublicKey == "" {
		t.Fatalf("saved %+v, err %v", saved, err)
	}
	key, err := keystore.Load(config.Dir())
	if err != nil {
		t.Fatal(err)
	}
	// PRISM was sent the public half of the key that was kept.
	if seen.PublicKey != base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey)) {
		t.Fatal("the saved key is not the one PRISM was sent")
	}
	if seen.Platform != Platform() || seen.Arch != runtime.GOARCH || seen.Hostname == "" || seen.SerialNumber != "7XK4Q93" {
		t.Fatalf("sent %+v", seen)
	}
}

func TestRefusedWithoutAValidKey(t *testing.T) {
	t.Setenv("PRISM_AGENT_DIR", t.TempDir())
	var seen client.EnrollRequest
	srv := fakePrism(t, &seen)
	defer srv.Close()
	_, err := Run(context.Background(), srv.URL, "pk_enr_wrong", Hardware{})
	var e *client.Error
	if !errors.As(err, &e) || e.Code != "ENROLL_KEY_INVALID" {
		t.Fatalf("err %v, want ENROLL_KEY_INVALID", err)
	}
	// Nothing saved: not enrolled, no key left behind.
	if _, err := config.Load(); !errors.Is(err, config.ErrNotEnrolled) {
		t.Fatalf("config after a refusal: %v", err)
	}
	if _, err := os.Stat(keystore.Path(config.Dir())); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a key was left behind")
	}
	// Not even sent when it doesn't look like a key.
	seen = client.EnrollRequest{}
	if _, err := Run(context.Background(), srv.URL, "hello", Hardware{}); err == nil || seen.EnrollKey != "" {
		t.Fatalf("a non-key was sent: err %v", err)
	}
}

func TestCheckURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://prism.example.com/":     "https://prism.example.com",
		" https://prism.example.com/x/ ": "https://prism.example.com/x",
		"http://localhost:8080":          "http://localhost:8080",
	} {
		if got, err := CheckURL(in); err != nil || got != want {
			t.Errorf("CheckURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"http://prism.example.com", "prism.example.com", "ftp://x", ""} {
		if _, err := CheckURL(bad); err == nil {
			t.Errorf("CheckURL(%q) accepted", bad)
		}
	}
}
