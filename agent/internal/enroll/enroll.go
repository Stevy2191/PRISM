// Package enroll registers this computer with PRISM: makes the device key,
// sends the public half with the enrollment key, and saves agent.json.
package enroll

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/stevy2191/prism/agent/internal/client"
	"github.com/stevy2191/prism/agent/internal/config"
	"github.com/stevy2191/prism/agent/internal/keystore"
	"github.com/stevy2191/prism/agent/internal/version"
)

// Hardware is what helps PRISM match an Asset that already exists (by
// serial number). Filled by the platform's collector (task 8); may be empty.
type Hardware struct {
	SerialNumber, Make, Model string
}

// CheckURL accepts an https:// address (http:// only for localhost, for
// trying PRISM on one machine) and returns it without a trailing slash.
func CheckURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", errors.New("the PRISM address must be like https://prism.example.com")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return "", errors.New("the PRISM address must start with https://")
	}
	return strings.TrimRight(u.Scheme+"://"+u.Host+u.Path, "/"), nil
}

// Platform is PRISM's name for this OS.
func Platform() string {
	if runtime.GOOS == "darwin" {
		return "macos"
	}
	return runtime.GOOS
}

// Run enrolls and saves. A failure leaves any earlier enrollment as it was.
func Run(ctx context.Context, rawURL, enrollKey string, hw Hardware) (*config.Config, error) {
	base, err := CheckURL(rawURL)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(strings.TrimSpace(enrollKey), "pk_enr_") {
		return nil, errors.New("that is not an enrollment key (they start pk_enr_)")
	}
	// Before anything reaches PRISM: enrolling needs the rights the
	// service has (an administrator's PowerShell on Windows, sudo elsewhere).
	if err := checkPrivileges(); err != nil {
		return nil, err
	}
	host, _ := os.Hostname()
	dir := config.Dir()
	// The new key goes in a staging folder until PRISM accepts it.
	stage := dir + ".enrolling"
	_ = os.RemoveAll(stage)
	defer os.RemoveAll(stage)
	key, err := keystore.Create(stage)
	if err != nil {
		return nil, fmt.Errorf("could not make the device key: %w", err)
	}
	c := client.New(base, 0, key)
	resp, err := c.Enroll(ctx, client.EnrollRequest{
		EnrollKey: strings.TrimSpace(enrollKey), PublicKey: client.PublicKeyB64(key),
		Platform: Platform(), Arch: runtime.GOARCH, AgentVersion: version.Version, Hostname: host,
		SerialNumber: hw.SerialNumber, Make: hw.Make, Model: hw.Model,
	})
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := keystore.Install(stage, dir); err != nil {
		return nil, fmt.Errorf("could not save the device key: %w", err)
	}
	cfg := &config.Config{
		URL: base, DeviceID: resp.DeviceID, UpdatePublicKey: resp.UpdatePublicKey,
		Intervals:  config.Intervals{HeartbeatSec: resp.Intervals.HeartbeatSec, InventorySec: resp.Intervals.InventorySec},
		EnrolledAt: time.Now().UTC(),
	}
	if err := config.Save(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// skipPrivilegeCheck lets tests enroll into a temporary folder as an
// ordinary user. Never set by the agent.
var skipPrivilegeCheck = false
