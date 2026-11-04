package schedule

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stevy2191/prism/agent/internal/client"
)

// A fake clock: records each wait, and ends the loop after `stopAfter` runs.
type rig struct {
	mu    sync.Mutex
	waits []time.Duration
}

func (r *rig) sleep(ctx context.Context, d time.Duration) error {
	r.mu.Lock()
	r.waits = append(r.waits, d)
	r.mu.Unlock()
	return ctx.Err()
}

func run(t *testing.T, j Job, results []error) []time.Duration {
	t.Helper()
	r := &rig{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	n := 0
	j.Run = func(context.Context) error {
		err := results[n]
		n++
		if n == len(results) {
			cancel()
		}
		return err
	}
	Loop(ctx, j, r.sleep, func(string, ...any) {})
	if n != len(results) {
		t.Fatalf("ran %d times, want %d", n, len(results))
	}
	return r.waits
}

func TestHonoursTheInterval(t *testing.T) {
	waits := run(t, Job{Name: "heartbeat", Interval: 5 * time.Minute}, []error{nil, nil, nil})
	// Runs at once, then waits the interval between runs (the last wait is
	// cut short by the cancel).
	want := []time.Duration{5 * time.Minute, 5 * time.Minute, 5 * time.Minute}
	if len(waits) != len(want) {
		t.Fatalf("waits %v, want %v", waits, want)
	}
	for i := range want {
		if waits[i] != want[i] {
			t.Fatalf("waits %v, want %v", waits, want)
		}
	}
}

func TestFirstDelay(t *testing.T) {
	waits := run(t, Job{Name: "inventory", Interval: 6 * time.Hour, FirstDelay: 42 * time.Second}, []error{nil})
	if waits[0] != 42*time.Second {
		t.Fatalf("first wait %v, want 42s", waits[0])
	}
}

func TestBacksOffOnServerErrorsAnd429(t *testing.T) {
	e500 := &client.Error{Status: http.StatusBadGateway}
	e429 := &client.Error{Status: http.StatusTooManyRequests}
	waits := run(t, Job{Name: "heartbeat", Interval: 5 * time.Minute, RetryBase: 30 * time.Second},
		[]error{e500, e500, e429, e500, e500, e500, nil})
	// Retries come sooner than the interval and grow (each in [ceil/2, ceil]),
	// never past the interval; success goes back to the interval.
	ceilings := []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute, 4 * time.Minute, 5 * time.Minute, 5 * time.Minute}
	for i, c := range ceilings {
		if waits[i] < c/2 || waits[i] > c {
			t.Fatalf("retry %d waited %v, want between %v and %v (all: %v)", i, waits[i], c/2, c, waits)
		}
	}
	if waits[len(ceilings)] != 5*time.Minute {
		t.Fatalf("after success waited %v, want the interval", waits[len(ceilings)])
	}
}

func TestARefusalWaitsTheFullInterval(t *testing.T) {
	revoked := &client.Error{Status: http.StatusUnauthorized, Code: "AGENT_UNAUTHORIZED"}
	waits := run(t, Job{Name: "heartbeat", Interval: 5 * time.Minute}, []error{revoked, revoked})
	if waits[0] != 5*time.Minute {
		t.Fatalf("waited %v after a refusal, want the interval", waits[0])
	}
}

func TestNetworkErrorsAreRetried(t *testing.T) {
	waits := run(t, Job{Name: "inventory", Interval: 6 * time.Hour, RetryBase: time.Minute}, []error{errors.New("dial tcp: connection refused"), nil})
	if waits[0] > time.Minute {
		t.Fatalf("waited %v after a network error, want at most the first backoff", waits[0])
	}
}

func TestStopsWhenTheContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		RunAll(ctx, []Job{
			{Name: "a", Interval: time.Hour, Run: func(context.Context) error { return nil }},
			{Name: "b", Interval: time.Hour, Run: func(context.Context) error { return nil }},
		}, nil, func(string, ...any) {})
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("RunAll did not stop")
	}
}

// Scan now: a wake ends the wait and the job runs again at once.
func TestWakeRunsTheJobNow(t *testing.T) {
	wake := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runs := make(chan struct{}, 4)
	j := Job{Name: "inventory", Interval: time.Hour, Wake: wake, Run: func(context.Context) error {
		runs <- struct{}{}
		return nil
	}}
	go Loop(ctx, j, client.SleepCtx, func(string, ...any) {})
	<-runs // the first run
	select {
	case <-runs:
		t.Fatal("ran again without a wake")
	case <-time.After(50 * time.Millisecond):
	}
	wake <- struct{}{}
	select {
	case <-runs:
	case <-time.After(2 * time.Second):
		t.Fatal("a wake didn't run the job")
	}
	// A wake sent while the job runs isn't lost: the next wait ends at once.
	wake <- struct{}{}
	select {
	case <-runs:
	case <-time.After(2 * time.Second):
		t.Fatal("a pending wake didn't run the job")
	}
	cancel()
}

func TestWakeLoopStopsWithItsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		Loop(ctx, Job{Name: "x", Interval: time.Hour, Wake: make(chan struct{}, 1), Run: func(context.Context) error { return nil }}, client.SleepCtx, func(string, ...any) {})
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the loop didn't stop")
	}
}
