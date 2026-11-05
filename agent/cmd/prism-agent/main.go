// prism-agent: the PRISM agent (8a).
//
//	prism-agent enroll --url https://prism.example.com --key pk_enr_…
//	prism-agent run           the service's loops (heartbeat, inventory);
//	                          the Windows service runs this
//	prism-agent collect --json   print what the inventory would send
//	prism-agent status        enrollment and last contact
//	prism-agent service install|uninstall   set the service up by hand (Windows, or Linux without a package)
//
// Task 9 adds the tray; task 10 installs updates.
package main

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/stevy2191/prism/agent/internal/client"
	"github.com/stevy2191/prism/agent/internal/config"
	"github.com/stevy2191/prism/agent/internal/enroll"
	"github.com/stevy2191/prism/agent/internal/inventory"
	"github.com/stevy2191/prism/agent/internal/ipc"
	"github.com/stevy2191/prism/agent/internal/keystore"
	"github.com/stevy2191/prism/agent/internal/schedule"
	"github.com/stevy2191/prism/agent/internal/service"
	"github.com/stevy2191/prism/agent/internal/update"
	"github.com/stevy2191/prism/agent/internal/version"
)

const usage = `prism-agent %s

  prism-agent enroll --url <PRISM address> --key <enrollment key>
  prism-agent run
  prism-agent collect --json
  prism-agent status
  prism-agent service install|uninstall
  prism-agent uninstall [--remove-data]     (macOS; Windows and Linux packages say how)
  prism-agent whoami     what the tray sees: run it as yourself, not root
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
	case "service":
		err = cmdService(os.Args[2:])
	case "uninstall":
		err = cmdUninstall(os.Args[2:])
	case "whoami":
		err = cmdWhoami()
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
	key := fs.String("key", "", "the enrollment key from the company's Agent page (pk_enr_…)")
	force := fs.Bool("force", false, "enroll again even if already enrolled with this PRISM (a new device identity)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *url == "" || *key == "" {
		return errors.New("enroll needs --url and --key")
	}
	// Re-running the installer with a key (a GPO or Intune redeploy) mustn't
	// make a second identity, and so a second Asset, for the same computer.
	if base, err := enroll.CheckURL(*url); err == nil && !*force {
		if cfg, err := config.Load(); err == nil && cfg.URL == base && keystore.Exists(config.Dir()) {
			fmt.Printf("Already enrolled with %s as device %d (use --force to enroll again).\n", cfg.URL, cfg.DeviceID)
			return nil
		}
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

// The service's loops, until stopped: by the Windows service manager when
// it started us, else Ctrl+C or SIGTERM.
func cmdRun() error {
	service.StartLog()
	if service.IsService() {
		return service.Run(work)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	work(ctx, log.Printf)
	return nil
}

// work runs until ctx ends. A computer that isn't enrolled yet (the service
// can start before the installer enrolls) checks again every minute.
func work(ctx context.Context, logf func(string, ...any)) {
	// The tray's pipe answers from the start (offline until enrolled).
	tray := &ipc.Server{
		AgentVersion: version.Version,
		Snapshot:     func(account string) any { return inventory.CollectSnapshot(account, version.Version) },
		CacheDir:     config.Dir(),
	}
	go func() {
		if err := ipc.Serve(ctx, tray.Handle, logf); err != nil {
			logf("tray pipe: %v", err)
		}
	}()
	for {
		cfg, err := config.Load()
		var key ed25519.PrivateKey
		if err == nil {
			key, err = keystore.Load(config.Dir())
		}
		if err == nil {
			c := client.New(cfg.URL, cfg.DeviceID, key)
			tray.SetPRISM(c)
			logf("prism-agent %s: device %d, reporting to %s", version.Version, cfg.DeviceID, cfg.URL)
			schedule.RunAll(ctx, jobs(cfg, c, logf), nil, logf)
			return
		}
		logf("prism-agent %s: waiting: %v", version.Version, err)
		if client.SleepCtx(ctx, time.Minute) != nil {
			return
		}
	}
}

func jobs(cfg *config.Config, c *client.Client, logf func(string, ...any)) []schedule.Job {
	updater := &update.Updater{
		PRISM: c, Dir: filepath.Join(config.Dir(), "updates"), PublicKey: cfg.UpdatePublicKey,
		Platform: enroll.Platform(), Arch: runtime.GOARCH, Current: version.Version,
		Install: update.PlatformInstall, Logf: logf,
	}
	// PRISM's Scan now: the heartbeat's answer asks for an inventory, which
	// then runs at once rather than at its next turn.
	scanNow := make(chan struct{}, 1)
	return []schedule.Job{
		{
			Name: "heartbeat", Interval: cfg.Heartbeat(), RetryBase: 30 * time.Second,
			Run: func(ctx context.Context) error {
				var out struct {
					Update *update.Offer `json:"update"`
					Scan   bool          `json:"scan"`
				}
				_, err := c.Do(ctx, "POST", "/api/v1/agent/v1/heartbeat", map[string]any{"agentVersion": version.Version}, &out)
				if err == nil && out.Scan {
					select {
					case scanNow <- struct{}{}:
						logf("PRISM asked for a scan: sending the inventory now")
					default:
					}
				}
				if err == nil && out.Update != nil {
					// Checked, downloaded and installed in the background; a
					// refused offer is logged and the agent carries on.
					updater.Offered(ctx, *out.Update)
				}
				return err
			},
		},
		{
			// A short random delay spreads an office's agents after a reboot.
			Name: "inventory", Interval: cfg.Inventory(), RetryBase: 2 * time.Minute,
			FirstDelay: client.Backoff(0, 0, 2*time.Minute), Wake: scanNow,
			Run: func(ctx context.Context) error {
				inv, problems := inventory.Collect()
				for _, p := range problems {
					log.Printf("inventory: %v", p)
				}
				_, err := c.Do(ctx, "POST", "/api/v1/agent/v1/inventory", inv, nil)
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
	inv, problems := inventory.Collect()
	for _, p := range problems {
		fmt.Fprintln(os.Stderr, "warning:", p)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(inv)
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

func cmdService(args []string) error {
	if len(args) != 1 {
		return errors.New("service needs install or uninstall")
	}
	switch args[0] {
	case "install":
		if err := service.Install(); err != nil {
			return err
		}
		fmt.Println("Installed the PRISMAgent service (starts automatically). Start it now with: sc start PRISMAgent")
	case "uninstall":
		if err := service.Uninstall(); err != nil {
			return err
		}
		fmt.Println("Removed the PRISMAgent service.")
	default:
		return errors.New("service needs install or uninstall")
	}
	return nil
}

// What the tray sees: asks the service exactly as the tray does (the same
// pipe or socket, the same checks), as whoever runs it.
func cmdWhoami() error {
	var a ipc.WhoamiAnswer
	if err := ipc.Call(map[string]string{"op": "whoami"}, &a, 30*time.Second); err != nil {
		return fmt.Errorf("the tray can't reach the PRISM Agent service: %w", err)
	}
	state := "connected to the help desk"
	if a.Offline {
		state = "the service is running, but can't reach PRISM (not enrolled, or PRISM is unreachable)"
	}
	fmt.Printf("You:       %s\nCompany:   %s\nComputer:  %s\nHelp desk: %s\nState:     %s\n", a.Name, a.Company, a.Computer, a.Helpdesk.Name, state)
	return nil
}

// The agent off this computer, keeping the enrollment unless --remove-data
// (macOS: a .pkg has no uninstaller; Windows and Linux use their package).
func cmdUninstall(args []string) error {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	removeData := fs.Bool("remove-data", false, "also forget the enrollment (device key and settings)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := service.Remove(*removeData, config.Dir()); err != nil {
		return err
	}
	if *removeData {
		fmt.Println("Removed the PRISM Agent and its enrollment. Revoke the computer in PRISM if it isn't coming back.")
	} else {
		fmt.Println("Removed the PRISM Agent. Its enrollment is kept: installing it again brings the same device back.")
	}
	return nil
}

// Serial, make and model help PRISM claim an existing Asset at enrollment.
func hardware() enroll.Hardware {
	inv, _ := inventory.Collect()
	return enroll.Hardware{SerialNumber: inv.SerialNumber, Make: inv.Make, Model: inv.Model}
}
