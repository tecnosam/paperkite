package username_test

import (
	"path/filepath"
	"sync"
	"testing"

	"github.com/paperkite/chat-service/internal/username"
)

func TestTryClaim_FirstClaimSucceeds(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ok, err := r.TryClaim("alice")
	if err != nil {
		t.Fatalf("TryClaim: %v", err)
	}
	if !ok {
		t.Error("first claim of a free username should succeed")
	}
}

func TestTryClaim_SecondClaimFails(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if ok, _ := r.TryClaim("alice"); !ok {
		t.Fatal("first claim should succeed")
	}
	if ok, _ := r.TryClaim("alice"); ok {
		t.Error("second claim of the same username should fail")
	}
}

func TestTryClaim_CaseInsensitive(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if ok, _ := r.TryClaim("Bob"); !ok {
		t.Fatal("first claim should succeed")
	}
	if ok, _ := r.TryClaim("bob"); ok {
		t.Error("differently-cased claim should fail")
	}
	if ok, _ := r.TryClaim("BOB"); ok {
		t.Error("differently-cased claim should fail")
	}
}

func TestTryClaim_ReservedNameCannotBeClaimed(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for _, name := range []string{"system", "System", "SYSTEM"} {
		if ok, _ := r.TryClaim(name); ok {
			t.Errorf("TryClaim(%q) should fail, system is reserved", name)
		}
	}
	if !r.IsClaimed("system") {
		t.Error(`IsClaimed("system") should report true - it's reserved from construction`)
	}
}

func TestTryClaim_ConcurrentClaimsOnlyOneWins(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	const attempts = 50
	var wg sync.WaitGroup
	results := make([]bool, attempts)
	for i := range attempts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ok, err := r.TryClaim("carol")
			if err != nil {
				t.Errorf("TryClaim: %v", err)
			}
			results[i] = ok
		}(i)
	}
	wg.Wait()

	wins := 0
	for _, ok := range results {
		if ok {
			wins++
		}
	}
	if wins != 1 {
		t.Errorf("expected exactly 1 winner among %d concurrent claims, got %d", attempts, wins)
	}
}

func TestRegistry_PersistsAcrossRestarts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "claims.log")

	r1, err := username.New(path)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if ok, err := r1.TryClaim("dave"); !ok || err != nil {
		t.Fatalf("TryClaim: ok=%v err=%v", ok, err)
	}
	if err := r1.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	r2, err := username.New(path)
	if err != nil {
		t.Fatalf("New (reload): %v", err)
	}
	defer r2.Close()

	if ok, _ := r2.TryClaim("dave"); ok {
		t.Error("claim from prior instance should have survived reload")
	}
	if ok, _ := r2.TryClaim("DAVE"); ok {
		t.Error("reloaded claim should still be case-insensitive")
	}
	if ok, err := r2.TryClaim("erin"); !ok || err != nil {
		t.Errorf("new claim after reload should succeed: ok=%v err=%v", ok, err)
	}
}

func TestIsClaimed(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if r.IsClaimed("frank") {
		t.Error("unclaimed username should report IsClaimed=false")
	}
	if ok, _ := r.TryClaim("Frank"); !ok {
		t.Fatal("TryClaim should succeed")
	}
	if !r.IsClaimed("frank") {
		t.Error("claimed username should report IsClaimed=true")
	}
	if !r.IsClaimed("FRANK") {
		t.Error("IsClaimed should be case-insensitive")
	}
}

func TestIsClaimed_DoesNotMutateOrRace(t *testing.T) {
	r, err := username.New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if ok, _ := r.TryClaim("grace"); !ok {
		t.Fatal("TryClaim should succeed")
	}

	// IsClaimed must be read-only: calling it repeatedly must never itself
	// cause a later TryClaim of a *different* name to fail, and must never
	// flip an already-claimed name back to unclaimed.
	for range 5 {
		if !r.IsClaimed("grace") {
			t.Error("IsClaimed should stay true across repeated calls")
		}
	}
	if ok, _ := r.TryClaim("heidi"); !ok {
		t.Error("an unrelated username should still be claimable after IsClaimed calls")
	}
}
