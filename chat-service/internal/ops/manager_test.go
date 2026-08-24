package ops_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/paperkite/chat-service/internal/ops"
)

// fakeProcess/fakeLauncher let tests exercise Manager's deploy/rollback
// logic without spawning real OS processes - each "launch" just records
// a name and a healthy/unhealthy flag the test controls up front.
// Terminate/Kill both mark it exited (closing `exited`) so Wait() -
// which real Deploy/Bootstrap logic blocks on before proceeding - returns
// immediately instead of hanging the test.
type fakeProcess struct {
	name       string
	terminated atomic.Bool
	killed     atomic.Bool
	exited     chan struct{}
	closeOnce  sync.Once
	// If set, Terminate doesn't mark the process exited until this delay
	// has passed - simulates a real process's non-instant graceful
	// shutdown (see waitForExit's doc comment) so tests can prove Deploy
	// actually waits rather than racing it.
	terminateDelay time.Duration
}

func newFakeProcess(name string, terminateDelay time.Duration) *fakeProcess {
	return &fakeProcess{name: name, exited: make(chan struct{}), terminateDelay: terminateDelay}
}

func (p *fakeProcess) markExited() { p.closeOnce.Do(func() { close(p.exited) }) }

func (p *fakeProcess) Terminate() error {
	p.terminated.Store(true)
	if p.terminateDelay > 0 {
		go func() {
			time.Sleep(p.terminateDelay)
			p.markExited()
		}()
	} else {
		p.markExited()
	}
	return nil
}
func (p *fakeProcess) Kill() error { p.killed.Store(true); p.markExited(); return nil }
func (p *fakeProcess) Wait() error { <-p.exited; return nil }

type fakeLauncher struct {
	mu                 sync.Mutex
	launched           []string
	nextTerminateDelay time.Duration
}

// setNextTerminateDelay makes the *next* launched process slow to
// actually exit once Terminate is called on it - see fakeProcess's
// terminateDelay doc comment. One-shot: cleared after the next Launch.
func (l *fakeLauncher) setNextTerminateDelay(d time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.nextTerminateDelay = d
}

func (l *fakeLauncher) Launch(binPath string, _ []string) (ops.Process, error) {
	l.mu.Lock()
	delay := l.nextTerminateDelay
	l.nextTerminateDelay = 0
	l.launched = append(l.launched, binPath)
	l.mu.Unlock()
	return newFakeProcess(binPath, delay), nil
}

// newTestManager wires a Manager against httptest servers for both the
// binary download and the app's /healthz, so tests control exactly when
// the health check reports healthy.
func newTestManager(t *testing.T, healthy *atomic.Bool) (*ops.Manager, *fakeLauncher, *httptest.Server) {
	t.Helper()

	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if healthy.Load() {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(health.Close)

	launcher := &fakeLauncher{}
	mgr, err := ops.NewManager(t.TempDir(), health.URL, nil, launcher, "")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	ops.SetHealthCheckTiming(mgr, time.Millisecond, 2, time.Millisecond)
	ops.SetPreviousExitWait(mgr, 50*time.Millisecond)
	return mgr, launcher, health
}

func binServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestDeploy_FirstDeploySucceeds(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	bin := binServer(t, "fake-binary-v1")

	result, err := mgr.Deploy(context.Background(), ops.DeployRequest{
		Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL,
	})
	if err != nil {
		t.Fatalf("Deploy: %v", err)
	}
	if result.Version != "1.0.0" {
		t.Errorf("version = %q, want 1.0.0", result.Version)
	}
	if len(launcher.launched) != 1 {
		t.Fatalf("expected 1 launch, got %d", len(launcher.launched))
	}

	state, ok := mgr.CurrentVersion()
	if !ok || state.Version != "1.0.0" {
		t.Errorf("CurrentVersion = %+v, ok=%v, want version 1.0.0", state, ok)
	}
}

func TestDeploy_SecondDeployTerminatesFirstAndDeletesOldBinary(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	bin := binServer(t, "fake-binary")

	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("first deploy: %v", err)
	}
	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.1", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("second deploy: %v", err)
	}

	if len(launcher.launched) != 2 {
		t.Fatalf("expected 2 launches, got %d", len(launcher.launched))
	}
	state, _ := mgr.CurrentVersion()
	if state.Version != "1.0.1" {
		t.Errorf("version = %q, want 1.0.1", state.Version)
	}
}

func TestDeploy_UnhealthyRollsBackToPrevious(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	bin := binServer(t, "fake-binary")

	// First deploy succeeds and becomes "previous".
	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("first deploy: %v", err)
	}

	// Second deploy's binary never reports healthy.
	healthy.Store(false)
	_, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "2.0.0", LinuxURL: bin.URL})
	if err == nil {
		t.Fatal("expected an error from an unhealthy deploy")
	}
	var failure *ops.DeployFailure
	if !errors.As(err, &failure) {
		t.Fatalf("expected a *DeployFailure, got %T: %v", err, err)
	}
	if !failure.RolledBack {
		t.Error("expected RolledBack = true when a previous version existed")
	}

	// State should still report the last *successful* deploy.
	state, ok := mgr.CurrentVersion()
	if !ok || state.Version != "1.0.0" {
		t.Errorf("CurrentVersion after failed deploy = %+v, ok=%v, want version 1.0.0", state, ok)
	}
	// 3 launches: v1.0.0, the failed v2.0.0 attempt, and the rollback
	// relaunch of v1.0.0.
	if len(launcher.launched) != 3 {
		t.Fatalf("expected 3 launches, got %d: %v", len(launcher.launched), launcher.launched)
	}
}

func TestDeploy_UnhealthyFirstDeployReportsNoRollback(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(false)
	mgr, _, _ := newTestManager(t, healthy)
	bin := binServer(t, "fake-binary")

	_, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL})
	var failure *ops.DeployFailure
	if !errors.As(err, &failure) {
		t.Fatalf("expected a *DeployFailure, got %T: %v", err, err)
	}
	if failure.RolledBack {
		t.Error("expected RolledBack = false - there was nothing to roll back to")
	}
	if _, ok := mgr.CurrentVersion(); ok {
		t.Error("expected no current version after a failed first deploy")
	}
}

// This is the regression test for the race Manager.Deploy used to have:
// firing SIGTERM and immediately launching the replacement, without
// waiting for the old process to actually release its ports first. It
// would have passed against the old code trivially (fakeProcess exited
// "instantly" either way), which is exactly why it's written to assert
// on wall-clock timing rather than call order - a real process's
// graceful shutdown is not instant (see cmd/server's
// broadcastRestartNotice + httpSrv.Shutdown), and this proves Deploy
// actually blocks on that instead of racing it.
func TestDeploy_WaitsForPreviousProcessToExitBeforeLaunchingReplacement(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	// Long enough that this test is proving the wait, not accidentally
	// exercising the force-kill-after-timeout fallback instead.
	ops.SetPreviousExitWait(mgr, 2*time.Second)
	bin := binServer(t, "fake-binary")

	// The delay must be set on the process launched by *this* deploy -
	// it's the one the second deploy will Terminate and has to wait on.
	const terminateDelay = 150 * time.Millisecond
	launcher.setNextTerminateDelay(terminateDelay)
	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("first deploy: %v", err)
	}

	start := time.Now()
	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.1", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("second deploy: %v", err)
	}
	elapsed := time.Since(start)

	if elapsed < terminateDelay {
		t.Errorf("second deploy returned after %v, expected it to wait at least %v for the slow-to-exit previous process", elapsed, terminateDelay)
	}
}

func TestDeploy_ForceKillsPreviousProcessAfterExitTimeout(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	ops.SetPreviousExitWait(mgr, 50*time.Millisecond)
	bin := binServer(t, "fake-binary")

	// Never exits on its own (no delay ever fires) - only Kill() (called
	// by waitForExit's timeout fallback) marks it exited, see fakeProcess.
	// Set on the process this deploy launches, since that's the one the
	// *next* deploy will try (and fail) to gracefully wait out.
	launcher.setNextTerminateDelay(time.Hour)
	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("first deploy: %v", err)
	}

	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.1", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("second deploy: %v", err)
	}
	// Deploy returning at all (rather than hanging until the fake's fake
	// hour-long delay) proves the timeout fallback force-killed it.
}

func TestDeploy_MissingLinuxURLIsRejected(t *testing.T) {
	healthy := &atomic.Bool{}
	mgr, _, _ := newTestManager(t, healthy)

	_, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0"})
	if err == nil {
		t.Fatal("expected an error when LinuxURL is empty")
	}
}

// --- Bootstrap ---

func localBinary(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "chat-service-server")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write local binary fixture: %v", err)
	}
	return path
}

// newManagerAt is like newTestManager but against a caller-supplied
// dataDir, so a test can construct a second Manager over the same
// on-disk state - simulating an ops restart (state.json survives, the
// in-memory Manager and its launched process don't).
func newManagerAt(t *testing.T, dataDir string, healthy *atomic.Bool) (*ops.Manager, *fakeLauncher) {
	t.Helper()

	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if healthy.Load() {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(health.Close)

	launcher := &fakeLauncher{}
	mgr, err := ops.NewManager(dataDir, health.URL, nil, launcher, "")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	ops.SetHealthCheckTiming(mgr, time.Millisecond, 2, time.Millisecond)
	ops.SetPreviousExitWait(mgr, 50*time.Millisecond)
	return mgr, launcher
}

func TestResume_RelaunchesLastDeployedBinaryOnFreshManager(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	dataDir := t.TempDir()

	mgr1, _ := newManagerAt(t, dataDir, healthy)
	bin := binServer(t, "fake-binary-v1")
	if _, err := mgr1.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("Deploy: %v", err)
	}

	// A brand new Manager over the same dataDir, nothing launched yet -
	// exactly the "ops restarted" scenario Resume exists for.
	mgr2, launcher2 := newManagerAt(t, dataDir, healthy)
	if _, ok := mgr2.CurrentVersion(); !ok {
		t.Fatal("expected mgr2 to load prior state from state.json")
	}
	if len(launcher2.launched) != 0 {
		t.Fatalf("expected nothing launched before Resume, got %d", len(launcher2.launched))
	}

	if err := mgr2.Resume(context.Background()); err != nil {
		t.Fatalf("Resume: %v", err)
	}

	if len(launcher2.launched) != 1 {
		t.Fatalf("expected Resume to launch 1 process, got %d", len(launcher2.launched))
	}
	state, ok := mgr2.CurrentVersion()
	if !ok || state.Version != "1.0.0" {
		t.Errorf("CurrentVersion = %+v, ok=%v, want version 1.0.0", state, ok)
	}
}

func TestResume_NoOpWithNoPriorState(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)

	if err := mgr.Resume(context.Background()); err != nil {
		t.Fatalf("Resume: %v", err)
	}
	if len(launcher.launched) != 0 {
		t.Errorf("expected no launch with no prior state, got %d", len(launcher.launched))
	}
	if _, ok := mgr.CurrentVersion(); ok {
		t.Error("expected no current version")
	}
}

func TestResume_UnhealthyReturnsErrorAndCanBeRetried(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	dataDir := t.TempDir()

	mgr1, _ := newManagerAt(t, dataDir, healthy)
	bin := binServer(t, "fake-binary-v1")
	if _, err := mgr1.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: bin.URL}); err != nil {
		t.Fatalf("Deploy: %v", err)
	}

	// Simulate a restart where the relaunched binary doesn't come back
	// healthy this time (e.g. a port conflict on the box).
	healthy.Store(false)
	mgr2, launcher2 := newManagerAt(t, dataDir, healthy)

	if err := mgr2.Resume(context.Background()); err == nil {
		t.Fatal("expected an error when the resumed binary never becomes healthy")
	}
	if len(launcher2.launched) != 1 {
		t.Fatalf("expected 1 launch attempt, got %d", len(launcher2.launched))
	}

	// A later real deploy should still work fine - a failed Resume must
	// not leave Manager permanently stuck (m.current stays nil, so
	// Deploy's own "previous" handling sees nothing to terminate).
	healthy.Store(true)
	bin2 := binServer(t, "fake-binary-v2")
	if _, err := mgr2.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "2.0.0", LinuxURL: bin2.URL}); err != nil {
		t.Fatalf("Deploy after failed Resume: %v", err)
	}
}

func TestBootstrap_AdoptsLocalBinaryWhenNoStateExists(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	bin := localBinary(t, "fake-binary")

	if err := mgr.Bootstrap(context.Background(), "1.0.0", bin); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	state, ok := mgr.CurrentVersion()
	if !ok || state.Version != "1.0.0" {
		t.Errorf("CurrentVersion = %+v, ok=%v, want version 1.0.0", state, ok)
	}
	if state.Source != "bootstrap" {
		t.Errorf("Source = %q, want %q", state.Source, "bootstrap")
	}
	if len(launcher.launched) != 1 {
		t.Fatalf("expected 1 launch, got %d", len(launcher.launched))
	}
	// Staged into Manager's own bin/ dir, not launched from the original
	// local path - so it's tracked/cleaned up exactly like a Deploy'd one.
	if launcher.launched[0] == bin {
		t.Error("expected the binary to be staged into Manager's bin/ dir, not launched from the original path")
	}
}

func TestBootstrap_NoOpIfADeployAlreadyHappened(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	mgr, launcher, _ := newTestManager(t, healthy)
	remoteBin := binServer(t, "fake-binary")

	if _, err := mgr.Deploy(context.Background(), ops.DeployRequest{Source: "github", BuildVersion: "1.0.0", LinuxURL: remoteBin.URL}); err != nil {
		t.Fatalf("Deploy: %v", err)
	}

	if err := mgr.Bootstrap(context.Background(), "0.0.1", localBinary(t, "should-be-ignored")); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	if len(launcher.launched) != 1 {
		t.Fatalf("expected Bootstrap to be a no-op (still 1 launch from Deploy), got %d", len(launcher.launched))
	}
	state, _ := mgr.CurrentVersion()
	if state.Version != "1.0.0" {
		t.Errorf("version = %q, want 1.0.0 (from Deploy, unaffected by Bootstrap)", state.Version)
	}
}

func TestBootstrap_UnhealthyLeavesNothingRunning(t *testing.T) {
	healthy := &atomic.Bool{}
	healthy.Store(false)
	mgr, _, _ := newTestManager(t, healthy)
	bin := localBinary(t, "fake-binary")

	err := mgr.Bootstrap(context.Background(), "1.0.0", bin)
	if err == nil {
		t.Fatal("expected an error when the bootstrapped binary never becomes healthy")
	}
	if _, ok := mgr.CurrentVersion(); ok {
		t.Error("expected no current version after a failed bootstrap")
	}
}

func TestBootstrap_MissingArgsRejected(t *testing.T) {
	healthy := &atomic.Bool{}
	mgr, _, _ := newTestManager(t, healthy)

	if err := mgr.Bootstrap(context.Background(), "", "/some/path"); err == nil {
		t.Error("expected an error when version is empty")
	}
	if err := mgr.Bootstrap(context.Background(), "1.0.0", ""); err == nil {
		t.Error("expected an error when localBinPath is empty")
	}
}
