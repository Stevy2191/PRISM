//go:build windows

// Package service runs the agent as the Windows service "PRISMAgent"
// (LocalSystem, automatic start). The MSI registers it (task 11); Install
// and Uninstall are for setting it up by hand.
package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

// Name is the service's name.
const Name = "PRISMAgent"

// IsService: started by the service manager.
func IsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

type handler struct {
	run func(ctx context.Context, logf func(string, ...any))
}

func (h *handler) Execute(_ []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	logf := func(f string, a ...any) {}
	if el, err := eventlog.Open(Name); err == nil {
		defer el.Close()
		logf = func(f string, a ...any) { _ = el.Info(1, fmt.Sprintf(f, a...)) }
	}
	done := make(chan struct{})
	go func() {
		h.run(ctx, logf)
		close(done)
	}()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-done:
				case <-time.After(20 * time.Second):
				}
				return false, 0
			}
		case <-done:
			// The loops ended on their own (e.g. not enrolled): stop, and let
			// the service's recovery settings restart it.
			cancel()
			return false, 1
		}
	}
}

// Run hands the process to the service manager; run is the agent's work,
// which must return when ctx ends.
func Run(run func(ctx context.Context, logf func(string, ...any))) error {
	return svc.Run(Name, &handler{run: run})
}

// Install registers the service for this executable: automatic (delayed)
// start as LocalSystem, restarted on failure, with an event log source.
func Install() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	if s, err := m.OpenService(Name); err == nil {
		s.Close()
		return fmt.Errorf("the %s service already exists", Name)
	}
	s, err := m.CreateService(Name, exe, mgr.Config{
		DisplayName:      "PRISM Agent",
		Description:      "Reports this computer's inventory to PRISM and relays tickets from the PRISM tray.",
		StartType:        mgr.StartAutomatic,
		DelayedAutoStart: true,
	}, "run")
	if err != nil {
		return err
	}
	defer s.Close()
	_ = s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 2 * time.Minute},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Minute},
	}, 24*60*60)
	_ = eventlog.InstallAsEventCreate(Name, eventlog.Error|eventlog.Warning|eventlog.Info)
	return nil
}

// Uninstall stops and removes the service.
func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return fmt.Errorf("the %s service is not installed", Name)
	}
	defer s.Close()
	_, _ = s.Control(svc.Stop)
	for i := 0; i < 20; i++ {
		st, err := s.Query()
		if err != nil || st.State == svc.Stopped {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err := s.Delete(); err != nil {
		return err
	}
	_ = eventlog.Remove(Name)
	return nil
}

// Remove: on Windows the MSI removes the agent (Apps, or
// msiexec /x <package> [REMOVE_DATA=1]).
func Remove(bool, string) error {
	return fmt.Errorf("on Windows, uninstall PRISM Agent from Settings → Apps, or run: msiexec /x <the PRISM Agent MSI> /qn [REMOVE_DATA=1]")
}

// StartLog: nothing to do here.
func StartLog() {}
