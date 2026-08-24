package hub

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

const (
	BufferTTL     = 120 * time.Second
	MaxBufferSize = 256

	// MaxSSESubscribersTotal is a server-wide hard ceiling that makes
	// Subscribe reject new connections rather than let per-connection
	// memory grow unbounded. There is deliberately no per-room cap — a
	// single popular room legitimately holding most of the server's
	// subscriber budget is fine; it's total concurrent connections that
	// bounds memory, not how they're distributed across rooms.
	// Checked-then-incremented without a single atomic section, so a race
	// can let a handful of connections through past the cap; that's fine,
	// same tolerance the bloom filter false-positive rate already assumes
	// elsewhere.
	MaxSSESubscribersTotal = 2000

	// sseSubscriberBuffer is the per-subscriber channel capacity. When a
	// subscriber's channel is full (a slow or stalled client), Publish
	// drops the new message for that subscriber rather than blocking the
	// publisher or any other subscriber. Live delivery is best-effort;
	// /poll remains the authoritative way to recover a gap.
	sseSubscriberBuffer = 32

	// SystemSender is the reserved message sender used for server-generated
	// operational notices (see Broadcast) rather than a real connected
	// user. internal/username reserves this exact name so no client can
	// ever claim it and spoof a system message. See PROTOCOL.md's "System
	// messages" section for the client-facing contract.
	SystemSender = "system"
)

// Message is the canonical in-process representation of a chat message.
type Message struct {
	ID        string
	Seq       uint64 // monotonically increasing per room; used as the poll cursor
	Room      string
	Sender    string
	Content   string
	Timestamp time.Time
}

// Hub holds per-room ring buffers for HTTP pollers, plus live-subscriber
// fan-out for SSE.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*roomState

	totalSubs atomic.Int64 // server-wide live SSE subscriber count
}

type roomState struct {
	mu          sync.Mutex
	seq         uint64
	messages    []Message
	lastPublish time.Time
	subs        map[chan Message]struct{} // live SSE subscribers for this room
}

func New() *Hub {
	return &Hub{rooms: make(map[string]*roomState)}
}

// Publish appends msg to the room buffer, enforcing TTL and size cap.
// Seq is assigned by the hub; callers must not set it.
func (h *Hub) Publish(msg Message) {
	r := h.ensureRoom(msg.Room)

	r.mu.Lock()
	defer r.mu.Unlock()

	r.seq++
	msg.Seq = r.seq
	r.lastPublish = msg.Timestamp
	r.messages = append(r.messages, msg)

	// 1. Prune messages outside the TTL window.
	cutoff := time.Now().Add(-BufferTTL)
	i := sort.Search(len(r.messages), func(i int) bool {
		return !r.messages[i].Timestamp.Before(cutoff)
	})
	if i > 0 {
		n := copy(r.messages, r.messages[i:])
		r.messages = r.messages[:n]
	}

	// 2. Enforce the hard size cap by dropping the oldest messages.
	if excess := len(r.messages) - MaxBufferSize; excess > 0 {
		n := copy(r.messages, r.messages[excess:])
		r.messages = r.messages[:n]
	}

	// 3. Fan out to live SSE subscribers, additive to the buffer above.
	// Sends are non-blocking: a subscriber whose channel is already full
	// (a slow or stalled client) just misses this message rather than
	// stalling the publisher or every other subscriber.
	for c := range r.subs {
		select {
		case c <- msg:
		default:
		}
	}
}

// Poll returns all messages in roomID with Seq strictly greater than afterSeq.
//
// Stale cursor: if afterSeq predates the earliest buffered message (pruned by
// TTL or cap), the binary search lands at index 0 and the full buffer is
// returned. Clients should treat a large cursor jump as partial history.
//
// Returns nil if the room has never received a message.
func (h *Hub) Poll(roomID string, afterSeq uint64) []Message {
	h.mu.RLock()
	r := h.rooms[roomID]
	h.mu.RUnlock()
	if r == nil {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	i := sort.Search(len(r.messages), func(i int) bool {
		return r.messages[i].Seq > afterSeq
	})
	if i >= len(r.messages) {
		return nil
	}
	return append([]Message(nil), r.messages[i:]...)
}

// Subscribe registers a live SSE subscriber for roomID and returns a
// channel of newly-published messages, an unsubscribe function the caller
// must call exactly once (typically via defer) when the connection ends,
// and ok=false if the server-wide subscriber cap (MaxSSESubscribersTotal)
// is already at capacity — the caller should reject the connection in that
// case rather than register it. There is no separate per-room cap; a
// single room can hold as many subscribers as the server-wide budget
// allows.
//
// Subscribe (like Publish) lazily creates roomID if it doesn't exist yet,
// so a client can open a live stream on a room nobody has posted to.
//
// The returned channel is small and buffered (sseSubscriberBuffer); see
// Publish for what happens when a subscriber falls behind. Callers should
// Subscribe *before* reading any backlog (e.g. via Poll) so no message
// published in the gap between the two calls is missed — dedup by Seq
// against whatever backlog was already delivered.
func (h *Hub) Subscribe(roomID string) (ch <-chan Message, unsubscribe func(), ok bool) {
	if h.totalSubs.Load() >= MaxSSESubscribersTotal {
		return nil, nil, false
	}

	r := h.ensureRoom(roomID)

	r.mu.Lock()
	c := make(chan Message, sseSubscriberBuffer)
	if r.subs == nil {
		r.subs = make(map[chan Message]struct{})
	}
	r.subs[c] = struct{}{}
	r.mu.Unlock()

	h.totalSubs.Add(1)

	var once sync.Once
	unsubscribe = func() {
		once.Do(func() {
			r.mu.Lock()
			delete(r.subs, c)
			r.mu.Unlock()
			h.totalSubs.Add(-1)
		})
	}
	return c, unsubscribe, true
}

// Rooms returns a snapshot of every room ID the hub currently tracks,
// whether or not it has any live SSE subscribers right now — used by
// Broadcast to reach every room, and available for other server-wide
// operational needs.
func (h *Hub) Rooms() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	rooms := make([]string, 0, len(h.rooms))
	for id := range h.rooms {
		rooms = append(rooms, id)
	}
	return rooms
}

// Broadcast publishes a system message (see SystemSender) carrying
// content to every currently-tracked room, through the exact same
// buffer/poll/SSE delivery path as any other message — no wire-format
// change needed for clients to receive it, they just need to recognize
// the reserved sender. Used for server-wide operational notices, e.g. a
// graceful-restart warning broadcast right before the process exits for
// a deploy (see cmd/server/main.go).
func (h *Hub) Broadcast(content string) {
	rooms := h.Rooms()
	now := time.Now()
	for i, room := range rooms {
		h.Publish(Message{
			ID:        fmt.Sprintf("system-%d-%d", now.UnixNano(), i),
			Room:      room,
			Sender:    SystemSender,
			Content:   content,
			Timestamp: now,
		})
	}
}

// Seq returns the current sequence number for roomID.
// Returns 0 for unknown rooms. The connect handler uses this as the initial
// cursor so clients only see messages published after they connect.
func (h *Hub) Seq(roomID string) uint64 {
	h.mu.RLock()
	r := h.rooms[roomID]
	h.mu.RUnlock()
	if r == nil {
		return 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.seq
}

// NextPollMs returns the suggested number of milliseconds the client should
// wait before its next poll, based on how recently the room received a message.
// The hint is always well below BufferTTL so messages never expire before the
// client polls again.
func (h *Hub) NextPollMs(roomID string) int64 {
	h.mu.RLock()
	r := h.rooms[roomID]
	h.mu.RUnlock()
	if r == nil {
		return 30_000
	}
	r.mu.Lock()
	since := time.Since(r.lastPublish)
	r.mu.Unlock()

	switch {
	case since < 10*time.Second:
		return 1_000
	case since < time.Minute:
		return 5_000
	case since < 5*time.Minute:
		return 20_000
	default:
		return 30_000 // hard cap — well below the 120s BufferTTL
	}
}

// GC removes rooms whose last publish occurred before cutoff and which have
// no live SSE subscribers — a room with an active subscriber is kept
// regardless of lastPublish, since deleting it would silently orphan that
// subscriber's channel (Publish would go on appending to a *new* roomState
// created on the next message, which the existing subscriber never sees).
// Callers control the cutoff so it can be adjusted in tests without sleeping.
// Returns the number of rooms removed.
func (h *Hub) GC(cutoff time.Time) int {
	// Collect candidates without holding the write lock.
	h.mu.RLock()
	candidates := make([]string, 0, len(h.rooms))
	for id := range h.rooms {
		candidates = append(candidates, id)
	}
	h.mu.RUnlock()

	var toDelete []string
	for _, id := range candidates {
		h.mu.RLock()
		r := h.rooms[id]
		h.mu.RUnlock()
		if r == nil {
			continue
		}
		r.mu.Lock()
		idle := r.lastPublish.Before(cutoff) && len(r.subs) == 0
		r.mu.Unlock()
		if idle {
			toDelete = append(toDelete, id)
		}
	}

	if len(toDelete) == 0 {
		return 0
	}

	h.mu.Lock()
	removed := 0
	for _, id := range toDelete {
		if r := h.rooms[id]; r != nil {
			r.mu.Lock()
			if r.lastPublish.Before(cutoff) && len(r.subs) == 0 {
				delete(h.rooms, id)
				removed++
			}
			r.mu.Unlock()
		}
	}
	h.mu.Unlock()

	return removed
}

// StartGC runs periodic garbage collection until ctx is done.
// Rooms idle for longer than 2×BufferTTL are removed. Because seq is
// seeded from UnixMilli on room creation, old cursors from before a GC
// cycle remain valid: the recreated room's seq starts ahead of them.
func (h *Hub) StartGC(ctx context.Context, log *slog.Logger) {
	ticker := time.NewTicker(BufferTTL)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			cutoff := time.Now().Add(-2 * BufferTTL)
			if n := h.GC(cutoff); n > 0 {
				log.Info("hub GC", "rooms_removed", n)
			}
		case <-ctx.Done():
			return
		}
	}
}

// ensureRoom returns the existing roomState for roomID or creates a new one.
// New rooms seed their seq from the current Unix millisecond timestamp so that
// cursors from before a GC cycle cannot accidentally skip new messages.
func (h *Hub) ensureRoom(roomID string) *roomState {
	h.mu.RLock()
	r := h.rooms[roomID]
	h.mu.RUnlock()
	if r != nil {
		return r
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if r = h.rooms[roomID]; r == nil {
		r = &roomState{seq: uint64(time.Now().UnixMilli())}
		h.rooms[roomID] = r
	}
	return r
}
