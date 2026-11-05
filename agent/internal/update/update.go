// Package update installs new agent builds PRISM offers (8a, task 10).
//
// The heartbeat's answer may carry an offer: { version, sha256, size,
// signature }, the signature being Ed25519 with the install's update key
// over "platform|arch|version|sha256" (backend services/agent/updates.js).
// An offer is installed only when:
//   - the version is higher than the running one;
//   - the signature verifies with the public key PRISM gave at enrollment
//     (kept in agent.json), so no one else's build is ever installed;
//   - the downloaded bytes have exactly that sha256 (and the size offered).
//
// Anything else deletes the file, logs why, and leaves the running agent as
// it is. A version that failed isn't tried again for six hours.
package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Offer is the heartbeat's `update`.
type Offer struct {
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
	Signature string `json:"signature"`
}

// MaxPackage is the largest package accepted (an MSI is ~10 MB).
const MaxPackage = 200 << 20

// RetryAfter is how long a failed version is left alone.
const RetryAfter = 6 * time.Hour

// Streamer downloads with a signed request (client.Client.Stream).
type Streamer interface {
	Stream(ctx context.Context, path string) (*http.Response, error)
}

// Updater checks and installs offers. One update runs at a time.
type Updater struct {
	PRISM     Streamer
	Dir       string // where packages are downloaded (SYSTEM only on Windows)
	PublicKey string // the install's update key, base64 (agent.json)
	Platform  string // "windows"
	Arch      string // runtime.GOARCH
	Current   string // the running version
	// Install starts the installer for a checked package; it returns once
	// the installer is launched (it restarts the service itself).
	Install func(path, version string) error
	Logf    func(string, ...any)
	Now     func() time.Time

	mu      sync.Mutex
	running bool
}

var (
	version = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)
	hex64   = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// Compare orders versions as PRISM does (semver precedence): numeric
// major.minor.patch, a pre-release before its release, pre-release parts
// numbers-as-numbers (0.0.0-dev.10 > 0.0.0-dev.9), anything unreadable
// ("dev") lowest.
func Compare(a, b string) int {
	type v struct {
		nums [3]int
		pre  string
		ok   bool
	}
	parse := func(s string) v {
		if !version.MatchString(s) {
			return v{}
		}
		core, pre, _ := strings.Cut(s, "-")
		var out v
		for i, p := range strings.SplitN(core, ".", 3) {
			out.nums[i], _ = strconv.Atoi(p)
		}
		out.pre, out.ok = pre, true
		return out
	}
	x, y := parse(a), parse(b)
	switch {
	case !x.ok && !y.ok:
		return 0
	case !x.ok:
		return -1
	case !y.ok:
		return 1
	}
	for i := 0; i < 3; i++ {
		if x.nums[i] != y.nums[i] {
			if x.nums[i] < y.nums[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case x.pre == y.pre:
		return 0
	case x.pre == "":
		return 1
	case y.pre == "":
		return -1
	default:
		return comparePre(x.pre, y.pre)
	}
}

// comparePre: identifiers one by one, numbers as numbers (dev.10 > dev.9)
// and before words, fewer identifiers first.
func comparePre(a, b string) int {
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(x) || i < len(y); i++ {
		if i >= len(x) {
			return -1
		}
		if i >= len(y) {
			return 1
		}
		xn, xerr := strconv.Atoi(x[i])
		yn, yerr := strconv.Atoi(y[i])
		switch {
		case xerr == nil && yerr == nil:
			if xn != yn {
				if xn < yn {
					return -1
				}
				return 1
			}
		case (xerr == nil) != (yerr == nil):
			if xerr == nil {
				return -1
			}
			return 1
		case x[i] != y[i]:
			if x[i] < y[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

// Verify checks an offer before anything is downloaded: its shape, that it
// is newer, and its signature.
func (u *Updater) Verify(o Offer) error {
	if !version.MatchString(o.Version) || !hex64.MatchString(o.SHA256) || o.Size <= 0 || o.Size > MaxPackage {
		return errors.New("the offer is malformed")
	}
	if Compare(o.Version, u.Current) <= 0 {
		return fmt.Errorf("version %s is not newer than %s", o.Version, u.Current)
	}
	pub, err := base64.StdEncoding.DecodeString(u.PublicKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("no update key from enrollment: re-enroll to receive updates")
	}
	sig, err := base64.StdEncoding.DecodeString(o.Signature)
	if err != nil {
		return errors.New("the signature is malformed")
	}
	msg := u.Platform + "|" + u.Arch + "|" + o.Version + "|" + o.SHA256
	if !ed25519.Verify(ed25519.PublicKey(pub), []byte(msg), sig) {
		return errors.New("the signature doesn't verify with this install's update key")
	}
	return nil
}

// Offered handles a heartbeat's offer in the background; a second offer
// while one is running is ignored.
func (u *Updater) Offered(ctx context.Context, o Offer) {
	u.mu.Lock()
	if u.running {
		u.mu.Unlock()
		return
	}
	u.running = true
	u.mu.Unlock()
	go func() {
		defer func() { u.mu.Lock(); u.running = false; u.mu.Unlock() }()
		_ = u.Apply(ctx, o)
	}()
}

// Apply checks, downloads, checks again and installs one offer.
func (u *Updater) Apply(ctx context.Context, o Offer) error {
	if u.recentlyFailed(o.Version) {
		return fmt.Errorf("update to %s failed recently; not retrying yet", o.Version)
	}
	err := u.apply(ctx, o)
	if err != nil {
		u.logf("update to %s refused: %v (staying on %s)", o.Version, err, u.Current)
		u.recordFailure(o.Version)
		return err
	}
	u.logf("update to %s checked; installer started", o.Version)
	return nil
}

func (u *Updater) apply(ctx context.Context, o Offer) error {
	if err := u.Verify(o); err != nil {
		return err
	}
	if err := prepareDir(u.Dir); err != nil {
		return fmt.Errorf("the updates folder: %w", err)
	}
	final := filepath.Join(u.Dir, "prism-agent-"+o.Version+packageExt)
	partial := final + ".partial"
	_ = os.Remove(partial)
	_ = os.Remove(final)

	resp, err := u.PRISM.Stream(ctx, "/api/v1/agent/v1/update/download")
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if v := resp.Header.Get("X-Prism-Version"); v != o.Version {
		return fmt.Errorf("PRISM sent version %q, not the %s it offered", v, o.Version)
	}
	f, err := os.OpenFile(partial, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, o.Size+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(partial)
		return fmt.Errorf("download: %w", err)
	}
	if n != o.Size {
		os.Remove(partial)
		return fmt.Errorf("the package is %d bytes, not the %d offered", n, o.Size)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != o.SHA256 {
		os.Remove(partial)
		return errors.New("the package's sha256 doesn't match the signed one")
	}
	if err := os.Rename(partial, final); err != nil {
		os.Remove(partial)
		return err
	}
	if u.Install == nil {
		os.Remove(final)
		return errors.New("updates aren't installed on this platform yet")
	}
	if err := u.Install(final, o.Version); err != nil {
		os.Remove(final)
		return fmt.Errorf("could not start the installer: %w", err)
	}
	return nil
}

// --- failed versions, so one bad build doesn't loop ---

type state struct {
	Failed map[string]time.Time `json:"failed"`
}

func (u *Updater) now() time.Time {
	if u.Now != nil {
		return u.Now()
	}
	return time.Now()
}

func (u *Updater) logf(f string, a ...any) {
	if u.Logf != nil {
		u.Logf(f, a...)
	}
}

func (u *Updater) statePath() string { return filepath.Join(u.Dir, "state.json") }

func (u *Updater) load() state {
	s := state{Failed: map[string]time.Time{}}
	if b, err := os.ReadFile(u.statePath()); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	if s.Failed == nil {
		s.Failed = map[string]time.Time{}
	}
	return s
}

func (u *Updater) recentlyFailed(v string) bool {
	t, ok := u.load().Failed[v]
	return ok && u.now().Sub(t) < RetryAfter
}

func (u *Updater) recordFailure(v string) {
	if prepareDir(u.Dir) != nil {
		return
	}
	s := u.load()
	s.Failed[v] = u.now()
	for k, t := range s.Failed {
		if u.now().Sub(t) > 7*24*time.Hour {
			delete(s.Failed, k)
		}
	}
	if b, err := json.Marshal(s); err == nil {
		_ = os.WriteFile(u.statePath(), b, 0o600)
	}
}
