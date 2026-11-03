// prism-agent: the PRISM agent (8a).
//
//	prism-agent enroll --url https://prism.example.com --key pk_enr_…
//	prism-agent run           the service's loops (heartbeat, inventory)
//	prism-agent collect --json   print what the inventory would send
//	prism-agent status        enrolment and last contact
//
// Task 8 makes `run` a Windows service and fills the inventory; task 9 adds
// the tray; task 10 installs updates.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/stevy2191/prism/agent/internal/client"
	"github.com/stevy2191/prism/agent/internal/config"
	"github.com/stevy2191/prism/agent/internal/enroll"
	"github.com/stevy2191/prism/agent/internal/keystore"
	"github.com/stevy2191/prism/agent/internal/schedule"
	"github.com/stevy2191/prism/agent/internal/version"
)

const usage = `prism-agent %s

  prism-agent enroll --url <PRISM address> --key <enrolment key>
  prism-agent run
  prism-agent collect --json
  prism-agent status
  prism-agent version
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usage, version.Version)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "enroll":
		err = cmdEnroll(os.Args[2:])
	case "run":
		err = cmdRun()
	case "collect":
		err = cmdCollect(os.Args[2:])
	case "status":
		err = cmdStatus()
	case "version", "--version", "-v":
		fmt.Println(version.Version)
	default:
		fmt.Fprintf(os.Stderr, usage, version.Version)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "prism-agent:", err)
		os.Exit(1)
	}
}

func cmdEnroll(args []string) error {
	fs := flag.NewFlagSet("enroll", flag.ContinueOnError)
	url := fs.String("url", "", "PRISM's address, https://…")
	key := fs.String("key", "", "the enrolment key from the company's Agent page (pk_enr_…)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *url == "" || *key == "" {
		return errors.New("enroll needs --url and --key")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cfg, err := enroll.Run(ctx, *url, *key, hardware())
	if err != nil {
		return err
	}
	fmt.Printf("Enrolled with %s as device %d.\n", cfg.URL, cfg.DeviceID)
	return nil
}

// The service's loops, until stopped (Ctrl+C here; the service manager in
// task 8).
func cmdRun() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	key, err := keystore.Load(config.Dir())
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	c := client.New(cfg.URL, cfg.DeviceID, key)
	log.Printf("prism-agent %s: device %d, reporting to %s", version.Version, cfg.DeviceID, cfg.URL)
	schedule.RunAll(ctx, jobs(cfg, c), nil, log.Printf)
	return nil
}

func jobs(cfg *config.Config, c *client.Client) []schedule.Job {
	return []schedule.Job{
		{
			Name: "heartbeat", Interval: cfg.Heartbeat(), RetryBase: 30 * time.Second,
			Run: func(ctx context.Context) error {
				var out struct {
					Update json.RawMessage `json:"update"`
				}
				_, err := c.Do(ctx, "POST", "/api/v1/agent/v1/heartbeat", map[string]any{"agentVersion": version.Version}, &out)
				return err
			},
		},
		{
			// A short random delay spreads an office's agents after a reboot.
			Name: "inventory", Interval: cfg.Inventory(), RetryBase: 2 * time.Minute,
			FirstDelay: client.Backoff(0, 0, 2*time.Minute),
			Run: func(ctx context.Context) error {
				_, err := c.Do(ctx, "POST", "/api/v1/agent/v1/inventory", collect(), nil)
				return err
			},
		},
	}
}

func cmdCollect(args []string) error {
	fs := flag.NewFlagSet("collect", flag.ContinueOnError)
	_ = fs.Bool("json", true, "print JSON (the only format)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(collect())
}

func cmdStatus() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	_, keyErr := keystore.Load(config.Dir())
	keyState := "present"
	if keyErr != nil {
		keyState = keyErr.Error()
	}
	fmt.Printf("PRISM:      %s\nDevice:     %d\nEnrolled:   %s\nDevice key: %s\nVersion:    %s (%s/%s)\nHeartbeat:  every %s\nInventory:  every %s\n",
		cfg.URL, cfg.DeviceID, cfg.EnrolledAt.Local().Format(time.RFC1123), keyState, version.Version, runtime.GOOS, runtime.GOARCH, cfg.Heartbeat(), cfg.Inventory())
	return nil
}

// The inventory: task 8 fills it from Windows (WMI and the registry). Until
// then, what Go knows without asking the OS.
func collect() map[string]any {
	host, _ := os.Hostname()
	return map[string]any{"hostname": host}
}

// Serial, make and model for enrolment's Asset match: task 8.
func hardware() enroll.Hardware { return enroll.Hardware{} }
