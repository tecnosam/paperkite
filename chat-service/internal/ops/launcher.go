package ops

import (
	"os"
	"os/exec"
	"syscall"
)

// Process is the subset of process control Manager needs, abstracted
// behind an interface so tests can inject a fake without spawning real
// OS processes. See OSLauncher for the real implementation.
type Process interface {
	// Terminate sends SIGTERM - the "please shut down, and get a chance to
	// broadcast a restart notice first" signal (see cmd/server/main.go).
	Terminate() error
	// Kill sends SIGKILL - used when a newly-launched binary never became
	// healthy and Manager is abandoning it, or when Wait times out on a
	// process that ignored Terminate.
	Kill() error
	// Wait blocks until the process has exited. Manager calls this after
	// Terminate before launching a replacement - firing SIGTERM and
	// immediately launching a new process on the same ports races the old
	// process's own graceful shutdown (broadcasting a restart notice,
	// GracefulStop, httpSrv.Shutdown's own timeout - several seconds, not
	// instant), and the new process predictably fails to bind if it loses
	// that race.
	Wait() error
}

// Launcher starts a binary as a new managed process.
type Launcher interface {
	Launch(binPath string, env []string) (Process, error)
}

type osProcess struct {
	cmd  *exec.Cmd
	done chan struct{}
}

func (p *osProcess) Terminate() error { return p.cmd.Process.Signal(syscall.SIGTERM) }
func (p *osProcess) Kill() error      { return p.cmd.Process.Kill() }
func (p *osProcess) Wait() error {
	<-p.done
	return nil
}

// OSLauncher is the real Launcher, used by cmd/ops. The child inherits
// exactly the env passed in - cmd/ops passes through its own environment
// (os.Environ()) so CHAT_JWT_SECRET, CHAT_USERNAMES_FILE, etc. configured
// on the ops daemon reach the app process it launches, without needing
// to be configured twice.
type OSLauncher struct{}

func (OSLauncher) Launch(binPath string, env []string) (Process, error) {
	cmd := exec.Command(binPath)
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	// A single goroutine owns the one-and-only cmd.Wait() call (calling it
	// twice is an error) - `done` lets any number of Process.Wait() callers
	// observe the exit without racing each other for that call.
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	return &osProcess{cmd: cmd, done: done}, nil
}
