// Package config is the agent's enrolment record: which PRISM it talks to,
// its device id, the install's update-signing public key and the intervals
// PRISM asked for. Written once by `prism-agent enroll`, read by the
// service.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Intervals are PRISM's, in seconds (enrolment's `intervals`).
type Intervals struct {
	HeartbeatSec int `json:"heartbeatSec"`
	InventorySec int `json:"inventorySec"`
}

// Config is agent.json.
type Config struct {
	URL             string    `json:"url"`
	DeviceID        int64     `json:"deviceId"`
	UpdatePublicKey string    `json:"updatePublicKey"`
	Intervals       Intervals `json:"intervals"`
	EnrolledAt      time.Time `json:"enrolledAt"`
}

// Defaults when PRISM sent none (or a nonsense value).
const (
	DefaultHeartbeat = 5 * time.Minute
	DefaultInventory = 6 * time.Hour
)

// Heartbeat is the heartbeat interval, never under a minute.
func (c *Config) Heartbeat() time.Duration {
	return clamp(c.Intervals.HeartbeatSec, DefaultHeartbeat, time.Minute)
}

// Inventory is the inventory interval, never under 15 minutes.
func (c *Config) Inventory() time.Duration {
	return clamp(c.Intervals.InventorySec, DefaultInventory, 15*time.Minute)
}

func clamp(sec int, def, min time.Duration) time.Duration {
	if sec <= 0 {
		return def
	}
	d := time.Duration(sec) * time.Second
	if d < min {
		return min
	}
	return d
}

// ErrNotEnrolled: there is no agent.json yet.
var ErrNotEnrolled = errors.New("this computer is not enrolled: run prism-agent enroll --url <PRISM address> --key <enrolment key>")

// Dir is the agent's data folder: PRISM_AGENT_DIR when set (tests, and
// running by hand), else the platform's (see dir_*.go).
func Dir() string {
	if d := os.Getenv("PRISM_AGENT_DIR"); d != "" {
		return d
	}
	return defaultDir()
}

// Path is agent.json in Dir.
func Path() string { return filepath.Join(Dir(), "agent.json") }

// Load reads agent.json.
func Load() (*Config, error) {
	b, err := os.ReadFile(Path())
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotEnrolled
	}
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("agent.json is damaged: %w", err)
	}
	if c.URL == "" || c.DeviceID <= 0 {
		return nil, ErrNotEnrolled
	}
	return &c, nil
}

// Save writes agent.json atomically (temp file, then rename).
func Save(c *Config) error {
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := Path() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, Path())
}
