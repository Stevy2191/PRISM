// Package schedule runs the agent's two loops: the heartbeat (every 5
// minutes by default) and the inventory (at start, then every 6 hours).
// A failed run that is worth retrying (PRISM down, 429, network) is tried
// again sooner, backing off with jitter up to the loop's own interval; a run
// PRISM refuses outright (revoked, bad request) waits the full interval.
// Every wait ends when the context does, so the service stops at once.
package schedule

import (
	"context"
	"log"
	"time"

	"github.com/stevy2191/prism/agent/internal/client"
)

// Job is one loop.
type Job struct {
	Name     string
	Interval time.Duration
	// Delay before the first run (0: at once). The heartbeat starts at once;
	// a small random delay spreads a whole office's agents after a reboot.
	FirstDelay time.Duration
	Run        func(ctx context.Context) error
	// The first retry wait after a retryable failure; doubled each time,
	// capped at Interval.
	RetryBase time.Duration
}

// Sleeper waits d or until ctx ends; tests record the waits instead.
type Sleeper func(ctx context.Context, d time.Duration) error

// Loop runs one job until ctx ends.
func Loop(ctx context.Context, j Job, sleep Sleeper, logf func(string, ...any)) {
	if sleep == nil {
		sleep = client.SleepCtx
	}
	if logf == nil {
		logf = log.Printf
	}
	base := j.RetryBase
	if base <= 0 {
		base = 30 * time.Second
	}
	wait := j.FirstDelay
	failures := 0
	for {
		if wait > 0 {
			if err := sleep(ctx, wait); err != nil {
				return
			}
		}
		if ctx.Err() != nil {
			return
		}
		err := j.Run(ctx)
		switch {
		case err == nil:
			failures = 0
			wait = j.Interval
		case client.Retryable(err):
			logf("%s failed, retrying: %v", j.Name, err)
			wait = client.Backoff(failures, base, j.Interval)
			failures++
		default:
			logf("%s refused: %v", j.Name, err)
			failures = 0
			wait = j.Interval
		}
	}
}

// RunAll runs every job until ctx ends, and returns when all have stopped.
func RunAll(ctx context.Context, jobs []Job, sleep Sleeper, logf func(string, ...any)) {
	done := make(chan struct{}, len(jobs))
	for _, j := range jobs {
		go func(j Job) {
			defer func() { done <- struct{}{} }()
			Loop(ctx, j, sleep, logf)
		}(j)
	}
	for range jobs {
		<-done
	}
}
