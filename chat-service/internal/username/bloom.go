package username

import "hash/fnv"

// bloomBits and bloomK are sized for ~1M expected usernames at a ~1%
// false-positive rate. A false positive only costs one extra map lookup in
// Registry.TryClaim, not a correctness issue — the authoritative map is
// always the final word.
const (
	bloomBits = 9_600_000
	bloomK    = 7
)

// bloomFilter is a minimal fixed-size Bloom filter. It never
// false-negatives (a "not present" answer is always correct) but can
// false-positive (a "maybe present" answer for something that isn't), so
// callers must only use it to skip real lookups on the common case, never
// as a source of truth on its own.
type bloomFilter struct {
	bits []uint64
}

func newBloomFilter() *bloomFilter {
	return &bloomFilter{bits: make([]uint64, (bloomBits+63)/64)}
}

func (b *bloomFilter) add(s string) {
	h1, h2 := bloomHashes(s)
	for i := uint64(0); i < bloomK; i++ {
		b.set((h1 + i*h2) % bloomBits)
	}
}

func (b *bloomFilter) mightContain(s string) bool {
	h1, h2 := bloomHashes(s)
	for i := uint64(0); i < bloomK; i++ {
		if !b.get((h1 + i*h2) % bloomBits) {
			return false
		}
	}
	return true
}

func (b *bloomFilter) set(pos uint64) {
	b.bits[pos/64] |= 1 << (pos % 64)
}

func (b *bloomFilter) get(pos uint64) bool {
	return b.bits[pos/64]&(1<<(pos%64)) != 0
}

// bloomHashes derives two independent hashes of s from stdlib FNV variants.
// The Kirsch-Mitzenmacher technique combines them (h1 + i*h2) to simulate
// bloomK independent hash functions without computing bloomK real ones.
func bloomHashes(s string) (uint64, uint64) {
	h1 := fnv.New64a()
	h1.Write([]byte(s))
	sum1 := h1.Sum64()

	h2 := fnv.New64()
	h2.Write([]byte(s))
	sum2 := h2.Sum64()

	return sum1, sum2
}
