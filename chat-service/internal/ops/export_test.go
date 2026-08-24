package ops

import "time"

// SetHealthCheckTiming overrides the health-check delay/retry timing for
// tests (production defaults, set in NewManager, would otherwise make
// every test wait a real 10 seconds per Deploy call). Exported only to
// the test binary via this file's _test.go suffix - never part of a
// normal build.
func SetHealthCheckTiming(m *Manager, delay time.Duration, tries int, every time.Duration) {
	m.healthCheckDelay = delay
	m.healthCheckTries = tries
	m.healthCheckEvery = every
}

// SetPreviousExitWait overrides how long Deploy waits for the previous
// process to exit before force-killing it (production default, set in
// NewManager, would otherwise make a test of that fallback wait a real
// 15 seconds).
func SetPreviousExitWait(m *Manager, wait time.Duration) {
	m.previousExitWait = wait
}
