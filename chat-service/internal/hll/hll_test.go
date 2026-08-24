package hll_test

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/paperkite/chat-service/internal/hll"
)

func TestEstimate_EmptyIsZero(t *testing.T) {
	h := hll.New()
	if got := h.Estimate(); got != 0 {
		t.Errorf("Estimate() on empty HLL = %d, want 0", got)
	}
}

func TestEstimate_WithinErrorBoundAcrossCardinalities(t *testing.T) {
	// Standard error for this build's precision is ~0.2% (see hll.go's
	// doc comment); give it a generous margin so this doesn't flake, while
	// still catching a genuinely broken estimator (way off, or a constant).
	const maxRelativeError = 0.015

	for _, n := range []int{0, 1, 10, 100, 1_000, 10_000, 100_000} {
		t.Run(fmt.Sprintf("n=%d", n), func(t *testing.T) {
			h := hll.New()
			for i := 0; i < n; i++ {
				h.Add(fmt.Sprintf("item-%d", i))
			}
			got := h.Estimate()
			if n == 0 {
				if got != 0 {
					t.Errorf("Estimate() = %d, want 0", got)
				}
				return
			}
			relErr := math.Abs(float64(got)-float64(n)) / float64(n)
			if relErr > maxRelativeError {
				t.Errorf("Estimate() = %d, want ~%d (relative error %.4f exceeds %.4f)", got, n, relErr, maxRelativeError)
			}
		})
	}
}

// TestEstimate_AccurateOnStructuredSequentialInputs guards against a real
// bug found during development: raw FNV-1a (no finalizer) has weak
// enough avalanche that structured, near-identical inputs - exactly what
// real room/user IDs look like ("room-1", "room-2", ... - not a
// contrived worst case) - left residual correlation in its high bits,
// which rank() reads from. That produced a consistent ~2-5%
// *under*-estimate on inputs like these, while random 128-bit inputs
// hashed within ~0.1% - i.e. it was invisible on random test data and
// only showed up on realistic, structured IDs. hash64's fmix64 finalizer
// fixes it; this test would have caught the regression before fixing it.
func TestEstimate_AccurateOnStructuredSequentialInputs(t *testing.T) {
	const n = 100_000
	const maxRelativeError = 0.01 // theoretical stderr at this precision is ~0.2%

	for _, prefix := range []string{"room", "user", "trial-0", "trial-1"} {
		t.Run(prefix, func(t *testing.T) {
			h := hll.New()
			for i := 0; i < n; i++ {
				h.Add(fmt.Sprintf("%s-item-%d", prefix, i))
			}
			got := h.Estimate()
			relErr := math.Abs(float64(got)-n) / n
			if relErr > maxRelativeError {
				t.Errorf("Estimate() = %d, want ~%d (relative error %.4f exceeds %.4f)", got, n, relErr, maxRelativeError)
			}
		})
	}
}

func TestAdd_DuplicatesDoNotInflateEstimate(t *testing.T) {
	h := hll.New()
	for i := 0; i < 1000; i++ {
		h.Add("same-item-every-time")
	}
	if got := h.Estimate(); got != 1 {
		t.Errorf("Estimate() after 1000x Add of the same item = %d, want 1", got)
	}
}

func TestSaveLoad_RoundTripsExactly(t *testing.T) {
	h := hll.New()
	for i := 0; i < 5000; i++ {
		h.Add(fmt.Sprintf("room-%d", i))
	}
	want := h.Estimate()

	path := filepath.Join(t.TempDir(), "state.hll")
	if err := h.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := hll.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := loaded.Estimate(); got != want {
		t.Errorf("Estimate() after round-trip = %d, want %d (unchanged from before Save)", got, want)
	}

	// Registers must have actually round-tripped, not just coincidentally
	// produced the same estimate - adding the exact same items again should
	// leave the loaded estimator's estimate unchanged (they're already
	// all accounted for).
	for i := 0; i < 5000; i++ {
		loaded.Add(fmt.Sprintf("room-%d", i))
	}
	if got := loaded.Estimate(); got != want {
		t.Errorf("Estimate() after re-adding identical items = %d, want unchanged %d", got, want)
	}
}

func TestLoad_MissingFileReturnsEmptyEstimator(t *testing.T) {
	h, err := hll.Load(filepath.Join(t.TempDir(), "does-not-exist.hll"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := h.Estimate(); got != 0 {
		t.Errorf("Estimate() on a missing-file Load = %d, want 0", got)
	}
}

func TestLoad_RejectsWrongFormat(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bogus.hll")
	if err := os.WriteFile(path, []byte("not a real hll file"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if _, err := hll.Load(path); err == nil {
		t.Error("Load: expected an error for a file that isn't a valid hll dump")
	}
}
