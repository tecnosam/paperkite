package metrics_test

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/paperkite/chat-service/internal/metrics"
)

func TestSnapshot_ReflectsAddsIndependently(t *testing.T) {
	rec, err := metrics.NewRecorder("", "")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}

	for i := 0; i < 50; i++ {
		rec.AddRoom(fmt.Sprintf("room-%d", i))
	}
	for i := 0; i < 20; i++ {
		rec.AddUser(fmt.Sprintf("user-%d", i))
	}

	snap := rec.Snapshot()
	if snap.UniqueRooms != 50 {
		t.Errorf("UniqueRooms = %d, want 50", snap.UniqueRooms)
	}
	if snap.UniqueUsers != 20 {
		t.Errorf("UniqueUsers = %d, want 20", snap.UniqueUsers)
	}
}

func TestAddRoom_DuplicateConnectsDoNotInflateCount(t *testing.T) {
	rec, err := metrics.NewRecorder("", "")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}

	// Simulates many /connect calls into the same handful of rooms - the
	// realistic case (repeat visitors), not one Add per room ever.
	rooms := []string{"room-a", "room-b", "room-c"}
	for i := 0; i < 100; i++ {
		rec.AddRoom(rooms[i%len(rooms)])
	}

	if got := rec.Snapshot().UniqueRooms; got != 3 {
		t.Errorf("UniqueRooms = %d, want 3", got)
	}
}

func TestNewRecorder_EmptyPathsAreInMemoryOnly(t *testing.T) {
	rec, err := metrics.NewRecorder("", "")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	rec.AddRoom("room-1")
	// Save must be a no-op, not an error, when persistence is disabled.
	if err := rec.Save(); err != nil {
		t.Errorf("Save with empty paths: %v", err)
	}
}

func TestNewRecorder_LoadsPriorStateAndSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	roomsPath := filepath.Join(dir, "rooms.hll")
	usersPath := filepath.Join(dir, "users.hll")

	rec1, err := metrics.NewRecorder(roomsPath, usersPath)
	if err != nil {
		t.Fatalf("NewRecorder (1st): %v", err)
	}
	for i := 0; i < 30; i++ {
		rec1.AddRoom(fmt.Sprintf("room-%d", i))
	}
	for i := 0; i < 15; i++ {
		rec1.AddUser(fmt.Sprintf("user-%d", i))
	}
	want := rec1.Snapshot()

	if err := rec1.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Simulates a process restart: a brand new Recorder over the same
	// on-disk paths, nothing added yet.
	rec2, err := metrics.NewRecorder(roomsPath, usersPath)
	if err != nil {
		t.Fatalf("NewRecorder (2nd): %v", err)
	}
	got := rec2.Snapshot()
	if got != want {
		t.Errorf("Snapshot after restart = %+v, want %+v (loaded from disk)", got, want)
	}
}

func TestStartPersisting_SavesOnTickAndOnShutdown(t *testing.T) {
	dir := t.TempDir()
	roomsPath := filepath.Join(dir, "rooms.hll")
	usersPath := filepath.Join(dir, "users.hll")

	rec, err := metrics.NewRecorder(roomsPath, usersPath)
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	rec.AddRoom("room-before-any-save")

	ctx, cancel := context.WithCancel(context.Background())
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	done := make(chan struct{})
	go func() {
		rec.StartPersisting(ctx, 10*time.Millisecond, log)
		close(done)
	}()

	// Let at least one periodic tick land, then cancel and wait for the
	// final shutdown save - StartPersisting must return only after that
	// final Save completes.
	time.Sleep(30 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("StartPersisting did not return after ctx cancellation")
	}

	// A fresh Recorder over the same paths should now see the persisted state.
	rec2, err := metrics.NewRecorder(roomsPath, usersPath)
	if err != nil {
		t.Fatalf("NewRecorder (after persisting): %v", err)
	}
	if got := rec2.Snapshot().UniqueRooms; got != 1 {
		t.Errorf("UniqueRooms after reload = %d, want 1", got)
	}
}
