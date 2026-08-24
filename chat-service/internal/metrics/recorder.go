// Package metrics tracks approximate unique-cardinality counts (unique
// chat rooms, unique claimed usernames) via HyperLogLog (see internal/hll)
// and periodically persists them to disk so a restart doesn't reset the
// counts to zero.
package metrics

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/paperkite/chat-service/internal/hll"
)

// Snapshot is the estimate reported by GET /custom-metrics.
type Snapshot struct {
	UniqueRooms uint64 `json:"unique_rooms"`
	UniqueUsers uint64 `json:"unique_users"`
}

// Recorder owns both estimators and their on-disk persistence. Safe for
// concurrent use.
type Recorder struct {
	mu    sync.Mutex
	rooms *hll.HLL
	users *hll.HLL

	// Empty disables persistence for that estimator (in-memory only) -
	// same convention as internal/username.Registry's path argument,
	// useful for tests.
	roomsPath string
	usersPath string
}

// NewRecorder loads any previously-persisted state from roomsPath and
// usersPath, creating their parent directories if needed. Either (or
// both) may be empty, in which case that estimator is in-memory only -
// Save is then a no-op for it.
func NewRecorder(roomsPath, usersPath string) (*Recorder, error) {
	rec := &Recorder{rooms: hll.New(), users: hll.New(), roomsPath: roomsPath, usersPath: usersPath}

	for _, p := range []string{roomsPath, usersPath} {
		if p == "" {
			continue
		}
		if dir := filepath.Dir(p); dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create metrics directory: %w", err)
			}
		}
	}

	if roomsPath != "" {
		rooms, err := hll.Load(roomsPath)
		if err != nil {
			return nil, fmt.Errorf("load rooms hll: %w", err)
		}
		rec.rooms = rooms
	}
	if usersPath != "" {
		users, err := hll.Load(usersPath)
		if err != nil {
			return nil, fmt.Errorf("load users hll: %w", err)
		}
		rec.users = users
	}
	return rec, nil
}

// AddRoom records one occurrence of roomID (the md5 hex room identifier
// derived from a page URL - see internal/token.RoomFromURL). Safe, and
// expected, to call on every request that touches a room, not just the
// one that first creates it: HyperLogLog is idempotent per distinct
// value (see hll.HLL.Add), so re-adding an already-seen room ID doesn't
// inflate the estimate. This deliberately counts every room ever seen,
// including ones since garbage-collected out of the live hub.Hub - it is
// not the same number as "rooms currently active".
func (r *Recorder) AddRoom(roomID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rooms.Add(roomID)
}

// AddUser records one successful, brand-new username claim. Call this
// only when a claim actually succeeds (e.g. username.Registry.TryClaim
// returning true) - not on every /connect, since reusing an
// already-claimed identity via a token isn't a new user.
func (r *Recorder) AddUser(username string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.users.Add(username)
}

// Snapshot returns the current cardinality estimates.
func (r *Recorder) Snapshot() Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	return Snapshot{
		UniqueRooms: r.rooms.Estimate(),
		UniqueUsers: r.users.Estimate(),
	}
}

// Save persists both estimators to disk now (skipping whichever has an
// empty path). Called periodically by StartPersisting and once more on
// shutdown, so the window of possibly-lost updates on a crash is bounded
// by the persist interval, not by however long the process happens to
// run before it next restarts.
func (r *Recorder) Save() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.roomsPath != "" {
		if err := r.rooms.Save(r.roomsPath); err != nil {
			return fmt.Errorf("save rooms hll: %w", err)
		}
	}
	if r.usersPath != "" {
		if err := r.users.Save(r.usersPath); err != nil {
			return fmt.Errorf("save users hll: %w", err)
		}
	}
	return nil
}

// StartPersisting saves both estimators every interval until ctx is
// done, then saves once more before returning - mirrors hub.Hub's
// StartGC, and is meant to be run the same way (a background goroutine
// for the process's lifetime).
func (r *Recorder) StartPersisting(ctx context.Context, interval time.Duration, log *slog.Logger) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := r.Save(); err != nil {
				log.Error("metrics persist failed", "err", err)
			}
		case <-ctx.Done():
			if err := r.Save(); err != nil {
				log.Error("metrics final persist failed", "err", err)
			}
			return
		}
	}
}
