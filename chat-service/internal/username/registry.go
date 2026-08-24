// Package username provides server-wide, permanent username claiming.
//
// A Registry is a bloom filter fronting a small authoritative set: the
// bloom filter is a fast pre-check that lets the common case (username is
// free) skip a map lookup, while the map is the actual source of truth.
// Once TryClaim succeeds for a name, that name is claimed forever — there
// is no release/unclaim path.
package username

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Registry is the authoritative store of claimed usernames, backed by a
// bloom filter fast-path and (optionally) a persistent flat file. Safe for
// concurrent use.
//
// TryClaim is the single entry point for claiming a name, atomically
// checking and setting under one lock so concurrent callers can't both
// win a claim on the same name. It's deliberately its own method (not a
// check-then-set pair) so future callers — e.g. a /reserve endpoint that
// claims a name without connecting — can reuse it as-is.
type Registry struct {
	mu      sync.Mutex
	claimed map[string]string // lowercased username -> original casing
	bloom   *bloomFilter
	file    *os.File // append-only persistence log; nil disables persistence
}

// reservedUsernames can never be claimed via TryClaim. "system" is the
// sender used for server-generated operational broadcasts (see
// hub.SystemSender) — reserving it here means a client can never claim
// it first and later spoof one of those messages.
var reservedUsernames = []string{"system"}

// New creates a Registry. If path is non-empty, existing claims are loaded
// from it on startup and every future claim is appended to it durably. If
// path is empty, the registry is in-memory only (useful for tests).
func New(path string) (*Registry, error) {
	r := &Registry{
		claimed: make(map[string]string),
		bloom:   newBloomFilter(),
	}
	for _, name := range reservedUsernames {
		key := strings.ToLower(name)
		r.claimed[key] = name
		r.bloom.add(key)
	}
	if path == "" {
		return r, nil
	}

	if err := r.load(path); err != nil {
		return nil, err
	}

	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create claims directory: %w", err)
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open claims file: %w", err)
	}
	r.file = f
	return r, nil
}

// load replays a persisted claims file into the authoritative map and a
// freshly-constructed bloom filter. The bloom filter itself is never
// serialized — rebuilding it from the authoritative data is cheap enough
// to do on every startup.
func (r *Registry) load(path string) error {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open claims file: %w", err)
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		original := strings.TrimSpace(sc.Text())
		if original == "" {
			continue
		}
		key := strings.ToLower(original)
		r.claimed[key] = original
		r.bloom.add(key)
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("read claims file: %w", err)
	}
	return nil
}

// TryClaim atomically checks whether username is free (case-insensitively)
// and, if so, claims it permanently. Returns false, nil if the name is
// already claimed. Returns a non-nil error only on a persistence failure,
// in which case the name was not claimed.
func (r *Registry) TryClaim(username string) (bool, error) {
	key := strings.ToLower(username)

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.bloom.mightContain(key) {
		if _, exists := r.claimed[key]; exists {
			return false, nil
		}
	}

	if r.file != nil {
		if _, err := fmt.Fprintln(r.file, username); err != nil {
			return false, fmt.Errorf("persist claim: %w", err)
		}
		if err := r.file.Sync(); err != nil {
			return false, fmt.Errorf("persist claim: %w", err)
		}
	}

	r.claimed[key] = username
	r.bloom.add(key)
	return true, nil
}

// IsClaimed reports whether username (case-insensitively) is currently
// claimed. Unlike TryClaim, it never mutates state — useful for callers
// that already hold independent proof of a prior claim (e.g. a signed
// token) and just want to confirm the registry still agrees, without
// risking a false "already taken" from calling TryClaim on their own name.
func (r *Registry) IsClaimed(username string) bool {
	key := strings.ToLower(username)

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.bloom.mightContain(key) {
		return false
	}
	_, exists := r.claimed[key]
	return exists
}

// Close releases the underlying persistence file, if any.
func (r *Registry) Close() error {
	if r.file == nil {
		return nil
	}
	return r.file.Close()
}
