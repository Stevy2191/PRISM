package client

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

type vector struct {
	SeedHex      string `json:"seedHex"`
	PublicKeyB64 string `json:"publicKeyB64"`
	Method       string `json:"method"`
	PathQuery    string `json:"pathQuery"`
	Timestamp    string `json:"timestamp"`
	Nonce        string `json:"nonce"`
	Body         string `json:"body"`
	Canonical    string `json:"canonical"`
	SignatureB64 string `json:"signatureB64"`
}

// The same file the Node suite checks (backend/test/integration/agent.auth.test.js).
func TestSharedSigningVector(t *testing.T) {
	b, err := os.ReadFile("../../testdata/signing.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vector
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	seed, _ := hex.DecodeString(v.SeedHex)
	key := ed25519.NewKeyFromSeed(seed)
	if got := PublicKeyB64(key); got != v.PublicKeyB64 {
		t.Fatalf("public key %s, want %s", got, v.PublicKeyB64)
	}
	if got := Canonical(v.Method, v.PathQuery, v.Timestamp, v.Nonce, []byte(v.Body)); got != v.Canonical {
		t.Fatalf("canonical\n%q\nwant\n%q", got, v.Canonical)
	}
	if got := Sign(key, v.Method, v.PathQuery, v.Timestamp, v.Nonce, []byte(v.Body)); got != v.SignatureB64 {
		t.Fatalf("signature %s, want %s", got, v.SignatureB64)
	}
}

func TestNonceShape(t *testing.T) {
	n := NewNonce()
	if len(n) < 16 || len(n) > 32 {
		t.Fatalf("nonce %q is %d characters", n, len(n))
	}
	if n == NewNonce() {
		t.Fatal("nonces repeat")
	}
}

func testClient(url string) (*Client, ed25519.PrivateKey) {
	_, key, _ := ed25519.GenerateKey(nil)
	c := New(url, 7, key)
	c.Sleep = func(context.Context, time.Duration) error { return nil }
	return c, key
}

func TestSignedRequestVerifiesOnTheServerSide(t *testing.T) {
	var c *Client
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Prism-Signature"))
		canon := Canonical(r.Method, r.URL.RequestURI(), r.Header.Get("X-Prism-Timestamp"), r.Header.Get("X-Prism-Nonce"), body)
		ts, _ := strconv.ParseInt(r.Header.Get("X-Prism-Timestamp"), 10, 64)
		if r.Header.Get("X-Prism-Device") != "7" || !ed25519.Verify(c.Key.Public().(ed25519.PublicKey), []byte(canon), sig) || time.Since(time.Unix(ts, 0)) > time.Minute {
			w.WriteHeader(401)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"update": nil, "path": r.URL.RequestURI()})
	}))
	defer srv.Close()
	c, _ = testClient(srv.URL + "/")
	var out struct{ Path string }
	status, err := c.Do(context.Background(), "POST", "/api/v1/agent/v1/heartbeat", map[string]string{"agentVersion": "0.6.0"}, &out)
	if err != nil || status != 200 {
		t.Fatalf("status %d, err %v", status, err)
	}
	status, err = c.Do(context.Background(), "GET", "/api/v1/agent/v1/tray/whoami?account=RIVERSIDE%5Cmchen", nil, &out)
	if err != nil || status != 200 || out.Path != "/api/v1/agent/v1/tray/whoami?account=RIVERSIDE%5Cmchen" {
		t.Fatalf("GET with a query: status %d, err %v, path %q", status, err, out.Path)
	}
}

func TestRetriesServerErrorsAnd429ThenSucceeds(t *testing.T) {
	var calls atomic.Int32
	nonces := map[string]bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonces[r.Header.Get("X-Prism-Nonce")] = true
		switch calls.Add(1) {
		case 1:
			w.WriteHeader(503)
		case 2:
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(429)
			_, _ = w.Write([]byte(`{"error":true,"code":"RATE_LIMITED","message":"Too many"}`))
		default:
			w.WriteHeader(204)
		}
	}))
	defer srv.Close()
	c, _ := testClient(srv.URL)
	var waits []time.Duration
	c.Sleep = func(_ context.Context, d time.Duration) error { waits = append(waits, d); return nil }
	status, err := c.Do(context.Background(), "GET", "/api/v1/agent/v1/update", nil, nil)
	if err != nil || status != 204 {
		t.Fatalf("status %d, err %v", status, err)
	}
	if calls.Load() != 3 || len(nonces) != 3 {
		t.Fatalf("%d calls with %d nonces, want 3 and 3 (a fresh nonce each attempt)", calls.Load(), len(nonces))
	}
	if waits[1] < 30*time.Second {
		t.Fatalf("Retry-After ignored: waited %v", waits[1])
	}
}

func TestARefusalIsNotRetried(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":true,"code":"AGENT_UNAUTHORIZED","message":"Not a known device"}`))
	}))
	defer srv.Close()
	c, _ := testClient(srv.URL)
	_, err := c.Do(context.Background(), "POST", "/api/v1/agent/v1/heartbeat", map[string]string{}, nil)
	var e *Error
	if err == nil || !asError(err, &e) || e.Code != "AGENT_UNAUTHORIZED" || Retryable(err) {
		t.Fatalf("err %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("%d calls, want 1", calls.Load())
	}
}

func TestGivesUpAfterTheAttempts(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(500)
	}))
	defer srv.Close()
	c, _ := testClient(srv.URL)
	_, err := c.Do(context.Background(), "POST", "/x", nil, nil)
	if err == nil || !Retryable(err) || calls.Load() != 3 {
		t.Fatalf("err %v after %d calls", err, calls.Load())
	}
}

func TestBackoffStaysInItsWindow(t *testing.T) {
	for n := 0; n < 10; n++ {
		ceil := time.Second << uint(n)
		if ceil > time.Minute {
			ceil = time.Minute
		}
		for i := 0; i < 50; i++ {
			d := Backoff(n, time.Second, time.Minute)
			if d < ceil/2 || d > ceil {
				t.Fatalf("Backoff(%d) = %v, want in [%v, %v]", n, d, ceil/2, ceil)
			}
		}
	}
}

func asError(err error, target **Error) bool {
	e, ok := err.(*Error)
	if ok {
		*target = e
	}
	return ok
}

func TestRedirectsAreNotFollowed(t *testing.T) {
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Prism-Signature") != "" {
			elsewhere.Add(1)
		}
		w.WriteHeader(200)
	}))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	var calls atomic.Int32
	c, _ := testClient(srv.URL)
	c.HTTP.Transport = countingTransport{&calls}
	_, err := c.Do(context.Background(), "POST", "/api/v1/agent/v1/heartbeat", map[string]string{"agentVersion": "0.6.0"}, nil)
	if calls.Load() != 1 {
		t.Fatalf("%d requests, want 1 (a redirect isn't retried)", calls.Load())
	}
	if !errors.Is(err, ErrRedirect) || Retryable(err) {
		t.Fatalf("err %v, want ErrRedirect (not retried)", err)
	}
	if elsewhere.Load() != 0 {
		t.Fatal("the signed request was sent to the redirect target")
	}
}

type countingTransport struct{ n *atomic.Int32 }

func (t countingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	t.n.Add(1)
	return http.DefaultTransport.RoundTrip(r)
}

func TestDoBytesSignsExactlyTheBytesItSends(t *testing.T) {
	var c *Client
	payload := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 300000)...)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Prism-Signature"))
		canon := Canonical(r.Method, r.URL.RequestURI(), r.Header.Get("X-Prism-Timestamp"), r.Header.Get("X-Prism-Nonce"), body)
		if r.Header.Get("Content-Type") != "application/octet-stream" || !bytes.Equal(body, payload) || !ed25519.Verify(c.Key.Public().(ed25519.PublicKey), []byte(canon), sig) {
			w.WriteHeader(401)
			return
		}
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 9})
	}))
	defer srv.Close()
	c, _ = testClient(srv.URL)
	var out struct{ ID int }
	status, err := c.DoBytes(context.Background(), "/api/v1/agent/v1/tray/tickets/5/attachments?name=a.png", "application/octet-stream", payload, &out)
	if err != nil || status != 201 || out.ID != 9 {
		t.Fatalf("status %d, err %v, out %+v", status, err, out)
	}
}
