// Package ops implements the deploy-webhook daemon: a separate process
// (cmd/ops) from the chat-service app itself, whose one job is to receive
// a signed deploy notification, swap the running app binary for a new
// one, and roll back if the new one doesn't come up healthy.
//
// It deliberately knows nothing about chat rooms or the wire protocol -
// its only contact with the app it manages is launching it as a child
// process and polling its GET /healthz.
package ops

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// State is what Manager persists to disk and reports on GET /version.
type State struct {
	Version    string    `json:"version"`
	BinaryPath string    `json:"binary_path"`
	Source     string    `json:"source"`
	DeployedAt time.Time `json:"deployed_at"`
}

// DeployRequest is Manager's input, already extracted from a verified
// DeployClaims by the HTTP handler - Manager itself doesn't touch JWTs.
type DeployRequest struct {
	Source       string
	BuildVersion string
	LinuxURL     string
}

// DeployResult is returned on a successful deploy.
type DeployResult struct {
	Version string
}

// DeployFailure is returned when the new binary never became healthy.
// Distinct from a plain error so the HTTP handler can report whether a
// rollback actually happened.
type DeployFailure struct {
	Reason     string
	RolledBack bool
}

func (e *DeployFailure) Error() string { return e.Reason }

type runningProcess struct {
	proc    Process
	binPath string
	version string
}

// Manager owns the currently-running app process and the on-disk record
// of what's deployed. Safe for concurrent use: Deploy serializes against
// itself (only one deploy at a time), and CurrentVersion never blocks on
// a deploy in progress - see the separate atomic.Pointer for state.
type Manager struct {
	deployMu sync.Mutex // serializes Deploy(); guards `current`
	current  *runningProcess

	state atomic.Pointer[State] // lock-free reads for GET /version

	dataDir           string
	healthURL         string
	env               []string
	launcher          Launcher
	http              *http.Client
	downloadAuthToken string // sent as "Authorization: Bearer <token>" on the download request, if set

	// Tunable for tests; production defaults set in NewManager.
	healthCheckDelay time.Duration
	healthCheckTries int
	healthCheckEvery time.Duration
	previousExitWait time.Duration
}

// NewManager creates the bin/ subdirectory of dataDir if needed and loads
// any prior state.json left by an earlier run of this daemon (e.g. after
// the ops daemon itself restarted - the app process it was managing does
// NOT survive that on its own, since Manager holds no PID across process
// restarts; loading state here only recovers the metadata. Call Resume
// afterward to actually relaunch it, or wait for a fresh Deploy to
// re-establish a live `current`).
//
// downloadAuthToken is sent as a bearer token on the binary download
// request if non-empty - needed if builds are attached to GitHub Releases
// on a *private* repo, where the plain download URL 401s without one.
// Leave it empty for a public repo or any other publicly-reachable URL.
func NewManager(dataDir, healthURL string, env []string, launcher Launcher, downloadAuthToken string) (*Manager, error) {
	if err := os.MkdirAll(filepath.Join(dataDir, "bin"), 0o755); err != nil {
		return nil, fmt.Errorf("create ops data dir: %w", err)
	}
	m := &Manager{
		dataDir:           dataDir,
		healthURL:         healthURL,
		env:               env,
		launcher:          launcher,
		http:              &http.Client{Timeout: 30 * time.Second},
		downloadAuthToken: downloadAuthToken,
		healthCheckDelay:  10 * time.Second,
		healthCheckTries:  3,
		healthCheckEvery:  500 * time.Millisecond,
		previousExitWait:  15 * time.Second,
	}
	if s, err := m.loadState(); err == nil && s.Version != "" {
		m.state.Store(s)
	}
	return m, nil
}

// CurrentVersion reports the last successfully deployed version, if any.
// Never blocks on a Deploy in progress.
func (m *Manager) CurrentVersion() (State, bool) {
	s := m.state.Load()
	if s == nil {
		return State{}, false
	}
	return *s, true
}

func (m *Manager) statePath() string { return filepath.Join(m.dataDir, "state.json") }

func (m *Manager) loadState() (*State, error) {
	b, err := os.ReadFile(m.statePath())
	if err != nil {
		return nil, err
	}
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (m *Manager) saveState(s State) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.statePath(), b, 0o644)
}

// Deploy downloads req.LinuxURL, terminates the currently-running process
// (if any), launches the new binary, and waits healthCheckDelay before
// polling GET /healthz (a few quick retries, to absorb scheduling jitter
// right at that boundary rather than trusting one single sample). On
// success the old binary is deleted and state.json is updated. On
// failure the new process is killed and its binary deleted, and - if
// there was a previous version to fall back to - it's relaunched, so the
// server ends the request in the same state it started, just older.
//
// Only one Deploy runs at a time; a second call blocks on deployMu until
// the first finishes rather than racing it.
func (m *Manager) Deploy(ctx context.Context, req DeployRequest) (*DeployResult, error) {
	if req.LinuxURL == "" {
		return nil, fmt.Errorf("no linux build URL in deploy request")
	}
	if req.BuildVersion == "" {
		return nil, fmt.Errorf("no buildVersion in deploy request")
	}

	m.deployMu.Lock()
	defer m.deployMu.Unlock()

	newPath := filepath.Join(m.dataDir, "bin", "chat-service-server-"+req.BuildVersion)
	if err := m.download(ctx, req.LinuxURL, newPath); err != nil {
		return nil, fmt.Errorf("download binary: %w", err)
	}

	previous := m.current // nil on a first-ever deploy - nothing to terminate or roll back to

	if previous != nil {
		_ = previous.proc.Terminate()
		// Wait for it to actually exit before launching the replacement -
		// SIGTERM doesn't free the port instantly (see cmd/server's
		// broadcastRestartNotice + graceful HTTP/gRPC shutdown, which can
		// take several seconds), and launching straight into that window
		// means the new process predictably fails to bind and this deploy
		// fails for no reason related to the new binary at all. If it's
		// still not gone after previousExitWait, force it - better than
		// letting one stuck process block every future deploy forever.
		m.waitForExit(previous.proc)
	}

	newProc, err := m.launcher.Launch(newPath, m.env)
	if err != nil {
		os.Remove(newPath)
		return nil, fmt.Errorf("launch new binary: %w", err)
	}

	select {
	case <-time.After(m.healthCheckDelay):
	case <-ctx.Done():
	}

	if m.pollHealthy(ctx) {
		if previous != nil {
			os.Remove(previous.binPath)
		}
		m.current = &runningProcess{proc: newProc, binPath: newPath, version: req.BuildVersion}
		s := State{Version: req.BuildVersion, BinaryPath: newPath, Source: req.Source, DeployedAt: time.Now()}
		if err := m.saveState(s); err == nil {
			m.state.Store(&s)
		}
		// If saveState failed, the deploy still succeeded in every way
		// that matters (new process is live and healthy) - GET /version
		// would just be stale until the next successful deploy rewrites
		// it, not worth failing an otherwise-good deploy over.
		return &DeployResult{Version: req.BuildVersion}, nil
	}

	// Rollback.
	_ = newProc.Kill()
	os.Remove(newPath)

	if previous == nil {
		return nil, &DeployFailure{
			Reason:     "new binary never became healthy, and there was no previous version to roll back to",
			RolledBack: false,
		}
	}

	oldProc, err := m.launcher.Launch(previous.binPath, m.env)
	if err != nil {
		m.current = nil
		return nil, &DeployFailure{
			Reason:     fmt.Sprintf("new binary unhealthy, AND rollback failed to relaunch the previous binary: %v", err),
			RolledBack: false,
		}
	}
	m.current = &runningProcess{proc: oldProc, binPath: previous.binPath, version: previous.version}
	return nil, &DeployFailure{
		Reason:     "new binary never became healthy, rolled back to the previous version",
		RolledBack: true,
	}
}

// Resume relaunches the last successfully deployed binary recorded in
// state.json, if nothing is currently running - the missing half of
// surviving an ops restart. NewManager only loads state.json's metadata
// (see its doc comment); it never relaunches a process on its own, so
// without this, chat-service-server stays down after any restart of
// this daemon (systemd restart, a crash-triggered auto-restart, a
// reboot) until CI or a human fires a fresh /deploy - which looks
// identical to the app actually being broken, since GET /version keeps
// reporting the old "running":true from stale on-disk state regardless.
//
// A no-op if there's no prior state at all (nothing to resume from -
// Bootstrap or a first real Deploy is what starts things from cold) or
// if m.current is already set (already running; shouldn't happen this
// early in startup, but cheap to guard).
func (m *Manager) Resume(ctx context.Context) error {
	m.deployMu.Lock()
	defer m.deployMu.Unlock()

	if m.current != nil {
		return nil
	}
	s := m.state.Load()
	if s == nil {
		return nil
	}
	if _, err := os.Stat(s.BinaryPath); err != nil {
		return fmt.Errorf("recorded binary %s is gone: %w", s.BinaryPath, err)
	}

	proc, err := m.launcher.Launch(s.BinaryPath, m.env)
	if err != nil {
		return fmt.Errorf("relaunch %s: %w", s.BinaryPath, err)
	}

	select {
	case <-time.After(m.healthCheckDelay):
	case <-ctx.Done():
	}

	if !m.pollHealthy(ctx) {
		_ = proc.Kill()
		return fmt.Errorf("relaunched %s (version %s) never became healthy", s.BinaryPath, s.Version)
	}

	m.current = &runningProcess{proc: proc, binPath: s.BinaryPath, version: s.Version}
	return nil
}

// Bootstrap adopts an already-locally-present binary (placed there by
// whatever provisioned this host, e.g. deploy/setup-droplet.sh) as the
// initial running version. A no-op if state.json already recorded a
// prior deploy - Bootstrap is only for a truly first-ever start; once
// this daemon has deployed anything for real, that history wins over a
// setup script's one-time seed value, even across an ops restart.
//
// This exists so a version handed to the box at provisioning time ends
// up owned and tracked by Manager exactly like a normal Deploy would,
// rather than started independently (e.g. its own systemd unit) with
// Manager none the wiser - the latter would leave a *later* real Deploy
// unable to terminate it, fighting it for the same ports instead.
//
// Unlike Deploy, there's no download (the binary is already local) and
// no "previous" to terminate or roll back to - if it doesn't become
// healthy, Bootstrap just reports the error and leaves nothing running,
// same as Deploy would for a first-ever failed deploy.
func (m *Manager) Bootstrap(ctx context.Context, version, localBinPath string) error {
	m.deployMu.Lock()
	defer m.deployMu.Unlock()

	if m.state.Load() != nil {
		return nil
	}
	if version == "" || localBinPath == "" {
		return fmt.Errorf("bootstrap needs both a version and a binary path")
	}

	dest := filepath.Join(m.dataDir, "bin", "chat-service-server-"+version)
	if err := copyExecutable(localBinPath, dest); err != nil {
		return fmt.Errorf("stage initial binary: %w", err)
	}

	proc, err := m.launcher.Launch(dest, m.env)
	if err != nil {
		os.Remove(dest)
		return fmt.Errorf("launch initial binary: %w", err)
	}

	select {
	case <-time.After(m.healthCheckDelay):
	case <-ctx.Done():
	}

	if !m.pollHealthy(ctx) {
		_ = proc.Kill()
		os.Remove(dest)
		return fmt.Errorf("initial binary never became healthy")
	}

	m.current = &runningProcess{proc: proc, binPath: dest, version: version}
	s := State{Version: version, BinaryPath: dest, Source: "bootstrap", DeployedAt: time.Now()}
	if err := m.saveState(s); err == nil {
		m.state.Store(&s)
	}
	return nil
}

// waitForExit blocks until proc has exited, or force-kills it after
// previousExitWait if it hasn't - either way, it doesn't return until the
// process is actually gone, so callers can safely assume its ports are
// free.
func (m *Manager) waitForExit(proc Process) {
	done := make(chan struct{})
	go func() {
		_ = proc.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(m.previousExitWait):
		_ = proc.Kill()
		<-done
	}
}

func (m *Manager) pollHealthy(ctx context.Context) bool {
	for i := 0; i < m.healthCheckTries; i++ {
		if m.healthzOnce(ctx) {
			return true
		}
		if i < m.healthCheckTries-1 {
			time.Sleep(m.healthCheckEvery)
		}
	}
	return false
}

func (m *Manager) healthzOnce(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.healthURL, nil)
	if err != nil {
		return false
	}
	res, err := m.http.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == http.StatusOK
}

func (m *Manager) download(ctx context.Context, url, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if m.downloadAuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+m.downloadAuthToken)
	}
	res, err := m.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %s", res.Status)
	}
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, res.Body)
	return err
}

// copyExecutable copies src to dest with the executable bit set - used by
// Bootstrap to move a locally-staged binary into Manager's own bin/
// directory, so it's tracked (and later cleaned up) exactly like a
// binary Deploy downloaded itself.
func copyExecutable(src, dest string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0o755)
}
