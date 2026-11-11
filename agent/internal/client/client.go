// Package client talks to PRISM: unsigned enrollment, then every request
// signed with the device's Ed25519 key, exactly as the server checks it
// (backend/src/middleware/agentAuth.js):
//
//	METHOD \n path?query \n unix-seconds \n nonce \n hex(sha256(body))
//
// sent as X-Prism-Device, X-Prism-Timestamp, X-Prism-Nonce and
// X-Prism-Signature (base64). Each attempt gets a fresh timestamp and nonce.
//
// TLS uses the operating system's certificate store (Go's default on
// Windows and macOS; the system bundle on Linux), so a PRISM behind a
// company CA that the computer trusts works without extra setup.
package client

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Canonical is the string a request's signature covers.
func Canonical(method, pathQuery, ts, nonce string, body []byte) string {
	sum := sha256.Sum256(body)
	return method + "\n" + pathQuery + "\n" + ts + "\n" + nonce + "\n" + hex.EncodeToString(sum[:])
}

// Sign signs a request; base64 (standard, padded), as Node's crypto.sign.
func Sign(key ed25519.PrivateKey, method, pathQuery, ts, nonce string, body []byte) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(Canonical(method, pathQuery, ts, nonce, body))))
}

// PublicKeyB64 is the raw public key, base64, as enrollment sends it.
func PublicKeyB64(key ed25519.PrivateKey) string {
	return base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
}

// NewNonce is 16 random bytes, base64url without padding (22 characters;
// the server takes 16 to 32).
func NewNonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// ErrRedirect: PRISM's address answered with a redirect, which the agent
// doesn't follow (check the PRISM address: https, and the exact host).
var ErrRedirect = errors.New("PRISM's address redirected the agent; use the exact https:// address of PRISM")

// Error is PRISM's answer to a refused request.
type Error struct {
	Status     int
	Code       string
	Message    string
	RetryAfter time.Duration
}

func (e *Error) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("PRISM refused the request (%d %s): %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("PRISM refused the request (%d)", e.Status)
}

// Retryable: worth trying again later (server trouble or rate limit, or
// the network). A 4xx other than 429 is not: the request itself is wrong,
// or this device is revoked.
func Retryable(err error) bool {
	if err == nil {
		return false
	}
	var e *Error
	if errors.As(err, &e) {
		return e.Status == http.StatusTooManyRequests || e.Status >= 500
	}
	return !errors.Is(err, context.Canceled) && !errors.Is(err, ErrRedirect)
}

// Client is one enrolled device's connection to PRISM.
type Client struct {
	BaseURL  string // https://prism.example.com, no trailing slash
	DeviceID int64
	Key      ed25519.PrivateKey
	HTTP     *http.Client
	// Attempts per call (1 = no retry) and the first backoff; doubled each
	// time with full jitter, capped at MaxBackoff.
	Attempts    int
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
	// Sleep waits between attempts; tests replace it.
	Sleep func(ctx context.Context, d time.Duration) error
	// Now gives the signing time; tests replace it.
	Now func() time.Time
}

// New is a client with the agent's defaults: 3 attempts, 2 s first backoff.
func New(baseURL string, deviceID int64, key ed25519.PrivateKey) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"), DeviceID: deviceID, Key: key,
		HTTP: &http.Client{
			Timeout: 60 * time.Second,
			// PRISM's agent API never redirects; a redirect would carry the
			// signed headers somewhere else, so it is refused.
			CheckRedirect: func(*http.Request, []*http.Request) error { return ErrRedirect },
		},
		Attempts: 3, BaseBackoff: 2 * time.Second, MaxBackoff: time.Minute,
	}
}

// SleepCtx waits d, or until ctx ends.
func SleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Backoff is attempt n's wait (n from 0): full jitter in [0, min(max, base·2ⁿ)],
// at least half of it so retries don't bunch at zero.
func Backoff(n int, base, max time.Duration) time.Duration {
	ceil := base << uint(n)
	if ceil <= 0 || ceil > max {
		ceil = max
	}
	half := ceil / 2
	j, _ := rand.Int(rand.Reader, big.NewInt(int64(ceil-half)+1))
	return half + time.Duration(j.Int64())
}

// Do sends a signed request; `in` is JSON-encoded (nil for no body), and a
// JSON answer is decoded into `out` when it is not nil. Returns the status
// (200, 201, 204…). Retries server errors, 429 and network failures.
func (c *Client) Do(ctx context.Context, method, path string, in, out any) (int, error) {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return 0, err
		}
	}
	resp, err := c.send(ctx, method, path, body, true)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out); err != nil && !errors.Is(err, io.EOF) {
			return resp.StatusCode, fmt.Errorf("PRISM's answer could not be read: %w", err)
		}
	}
	return resp.StatusCode, nil
}

// DoBytes sends raw bytes as a signed POST (the signature covers exactly
// those bytes), and decodes a JSON answer into out when it is not nil: the
// tray's attachments.
func (c *Client) DoBytes(ctx context.Context, path, contentType string, body []byte, out any) (int, error) {
	resp, err := c.sendAs(ctx, http.MethodPost, path, contentType, body, true)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out); err != nil && !errors.Is(err, io.EOF) {
			return resp.StatusCode, fmt.Errorf("PRISM's answer could not be read: %w", err)
		}
	}
	return resp.StatusCode, nil
}

// Stream sends a signed GET and returns the open response for a 2xx (the
// caller closes it): downloads.
func (c *Client) Stream(ctx context.Context, path string) (*http.Response, error) {
	return c.send(ctx, http.MethodGet, path, nil, true)
}

func (c *Client) attempts() int {
	if c.Attempts < 1 {
		return 1
	}
	return c.Attempts
}

func (c *Client) sleep(ctx context.Context, d time.Duration) error {
	if c.Sleep != nil {
		return c.Sleep(ctx, d)
	}
	return SleepCtx(ctx, d)
}

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) send(ctx context.Context, method, path string, body []byte, signed bool) (*http.Response, error) {
	return c.sendAs(ctx, method, path, "application/json", body, signed)
}

func (c *Client) sendAs(ctx context.Context, method, path, contentType string, body []byte, signed bool) (*http.Response, error) {
	var last error
	for n := 0; n < c.attempts(); n++ {
		if n > 0 {
			wait := Backoff(n-1, c.BaseBackoff, c.MaxBackoff)
			var e *Error
			if errors.As(last, &e) && e.RetryAfter > wait {
				wait = e.RetryAfter
			}
			if err := c.sleep(ctx, wait); err != nil {
				return nil, err
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		if body != nil {
			req.Header.Set("Content-Type", contentType)
		}
		req.Header.Set("User-Agent", "prism-agent")
		if signed {
			ts := strconv.FormatInt(c.now().Unix(), 10)
			nonce := NewNonce()
			req.Header.Set("X-Prism-Device", strconv.FormatInt(c.DeviceID, 10))
			req.Header.Set("X-Prism-Timestamp", ts)
			req.Header.Set("X-Prism-Nonce", nonce)
			req.Header.Set("X-Prism-Signature", Sign(c.Key, method, req.URL.RequestURI(), ts, nonce, body))
		}
		resp, err := c.httpClient().Do(req)
		if err != nil {
			last = err
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if errors.Is(err, ErrRedirect) {
				return nil, err
			}
			continue
		}
		if resp.StatusCode < 400 {
			return resp, nil
		}
		last = readError(resp)
		if !Retryable(last) {
			return nil, last
		}
	}
	return nil, last
}

func readError(resp *http.Response) *Error {
	defer resp.Body.Close()
	e := &Error{Status: resp.StatusCode}
	var body struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body) == nil {
		e.Message, e.Code = body.Message, body.Code
	}
	if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && s > 0 {
		e.RetryAfter = time.Duration(s) * time.Second
	}
	return e
}

// EnrollRequest is POST /api/v1/agent/v1/enroll's body.
type EnrollRequest struct {
	EnrollKey    string `json:"enrollKey"`
	PublicKey    string `json:"publicKey"`
	Platform     string `json:"platform"`
	Arch         string `json:"arch"`
	AgentVersion string `json:"agentVersion"`
	Hostname     string `json:"hostname"`
	SerialNumber string `json:"serialNumber,omitempty"`
	Make         string `json:"make,omitempty"`
	Model        string `json:"model,omitempty"`
	// The package format this computer installs (msi, pkg, deb, rpm,
	// pacman): PRISM offers updates in it only (8c).
	PackageFormat string `json:"packageFormat,omitempty"`
}

// EnrollResponse is its answer.
type EnrollResponse struct {
	DeviceID        int64  `json:"deviceId"`
	UpdatePublicKey string `json:"updatePublicKey"`
	Intervals       struct {
		HeartbeatSec int `json:"heartbeatSec"`
		InventorySec int `json:"inventorySec"`
	} `json:"intervals"`
}

// Enroll registers this computer with PRISM using an enrollment key. The
// one unsigned call: the device has no id yet.
func (c *Client) Enroll(ctx context.Context, r EnrollRequest) (*EnrollResponse, error) {
	body, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	resp, err := c.send(ctx, http.MethodPost, "/api/v1/agent/v1/enroll", body, false)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out EnrollResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("PRISM's enrollment answer could not be read: %w", err)
	}
	if out.DeviceID <= 0 {
		return nil, errors.New("PRISM's enrollment answer has no device id")
	}
	return &out, nil
}
